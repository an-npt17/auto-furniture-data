"""API endpoints for 3D objects."""

import logging
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.core.config import settings
from src.db import DBSession
from src.models import Object3D, ProcessingStatus
from src.schemas import (
    Object3DListResponse,
    Object3DResponse,
    Object3DUpdate,
    UploadResponse,
)
from src.services import etl_service, r2_storage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/objects", tags=["3D Objects"])


@router.post(
    "/upload",
    status_code=status.HTTP_201_CREATED,
)
async def upload_object(
    db: DBSession,
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File(description="GLB file to upload")],
    name: Annotated[str, Form(description="Object name")],
    description: Annotated[str | None, Form(description="Object description")] = None,
) -> UploadResponse:
    """
    Upload a 3D object (GLB file) for processing.

    The file will be processed in the background to generate:
    - Small variant (low poly)
    - Normal variant (medium poly)
    - Big variant (high poly)
    - Multiple thumbnail images
    """
    # Validate file type
    if file.content_type not in ("model/gltf-binary", "application/octet-stream"):
        if not file.filename or not file.filename.endswith(".glb"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only GLB files are supported",
            )

    # Validate file size
    file_data = await file.read()
    file_size = len(file_data)
    max_size = settings.max_upload_size_mb * 1024 * 1024

    if file_size > max_size:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size: {settings.max_upload_size_mb}MB",
        )

    try:
        # Create database record
        obj = Object3D(
            name=name,
            description=description,
            original_filename=file.filename or "uploaded.glb",
            original_size_bytes=file_size,
            status=ProcessingStatus.PENDING,
        )
        db.add(obj)
        await db.commit()
        await db.refresh(obj)

        # Upload original file to R2
        original_path = f"{settings.storage_prefix}/{obj.id}/original.glb"
        r2_storage.upload_file(
            file_data,
            original_path,
            "model/gltf-binary",
        )

        # Schedule background processing
        background_tasks.add_task(etl_service.process_object, db, obj.id)

        return UploadResponse(
            object_id=obj.id,
            message="Upload successful. Processing started.",
            status=ProcessingStatus.PENDING,
        )

    except Exception as e:
        logger.error(f"Failed to upload object: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload object",
        ) from e


@router.get("", response_model=Object3DListResponse)
async def list_objects(
    db: DBSession,
    page: Annotated[int, Query(ge=1, description="Page number")] = 1,
    page_size: Annotated[int, Query(ge=1, le=100, description="Items per page")] = 20,
    status_filter: Annotated[
        ProcessingStatus | None,
        Query(description="Filter by processing status"),
    ] = None,
) -> Object3DListResponse:
    """
    List all 3D objects with pagination.

    Supports filtering by processing status.
    """
    # Build query
    query = select(Object3D).options(selectinload(Object3D.files))

    if status_filter is not None:
        query = query.where(Object3D.status == status_filter)

    # Get total count
    count_query = select(func.count()).select_from(Object3D)
    if status_filter is not None:
        count_query = count_query.where(Object3D.status == status_filter)

    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Add pagination
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    query = query.order_by(Object3D.created_at.desc())

    # Execute query
    result = await db.execute(query)
    objects = result.scalars().all()

    total_pages = (total + page_size - 1) // page_size

    return Object3DListResponse(
        items=[Object3DResponse.model_validate(obj) for obj in objects],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{object_id}", response_model=Object3DResponse)
async def get_object(
    db: DBSession,
    object_id: UUID,
) -> Object3DResponse:
    """
    Get a single 3D object by ID.

    Returns all metadata and associated files.
    """
    result = await db.execute(
        select(Object3D)
        .options(selectinload(Object3D.files))
        .where(Object3D.id == object_id)
    )
    obj = result.scalar_one_or_none()

    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object not found",
        )

    return Object3DResponse.model_validate(obj)


@router.patch("/{object_id}", response_model=Object3DResponse)
async def update_object(
    db: DBSession,
    object_id: UUID,
    update_data: Object3DUpdate,
) -> Object3DResponse:
    """
    Update a 3D object's metadata.

    Only name and description can be updated.
    """
    result = await db.execute(
        select(Object3D)
        .options(selectinload(Object3D.files))
        .where(Object3D.id == object_id)
    )
    obj = result.scalar_one_or_none()

    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object not found",
        )

    # Update fields
    if update_data.name is not None:
        obj.name = update_data.name
    if update_data.description is not None:
        obj.description = update_data.description

    await db.commit()
    await db.refresh(obj)

    return Object3DResponse.model_validate(obj)


@router.delete("/{object_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_object(
    db: DBSession,
    object_id: UUID,
) -> None:
    """
    Delete a 3D object and all associated files.

    This removes the object from the database and deletes all files from R2.
    """
    result = await db.execute(
        select(Object3D)
        .options(selectinload(Object3D.files))
        .where(Object3D.id == object_id)
    )
    obj = result.scalar_one_or_none()

    if obj is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Object not found",
        )

    # Delete files from R2
    file_paths = [f.storage_path for f in obj.files]

    # Also delete original if it still exists
    original_path = f"{settings.storage_prefix}/{object_id}/original.glb"
    if r2_storage.file_exists(original_path):
        file_paths.append(original_path)

    if file_paths:
        r2_storage.delete_files(file_paths)

    # Delete from database (cascades to files)
    await db.delete(obj)
    await db.commit()
