"""ETL service for processing 3D objects."""

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models import FileType, Object3D, ObjectFile, ProcessingStatus
from src.services.model_processor import model_processor
from src.services.storage_service import r2_storage
from src.services.thumbnail_service import thumbnail_service

logger = logging.getLogger(__name__)


class ETLService:
    """Service for Extract, Transform, Load pipeline for 3D objects."""

    async def process_object(
        self,
        db: AsyncSession,
        object_id: UUID,
    ) -> None:
        """
        Process a 3D object: extract, transform (create variants), and load to R2.

        Args:
            db: Database session
            object_id: ID of the object to process

        Raises:
            ValueError: If object not found or processing fails
        """
        # Fetch object
        result = await db.execute(select(Object3D).where(Object3D.id == object_id))
        obj = result.scalar_one_or_none()

        if obj is None:
            raise ValueError(f"Object {object_id} not found")

        try:
            # Update status to processing
            obj.status = ProcessingStatus.PROCESSING
            await db.commit()

            # EXTRACT: Download original file from temporary storage
            # For now, we assume the file was already uploaded to R2 as original
            original_path = self._get_storage_path(object_id, "original", "glb")
            original_data = r2_storage.download_file(original_path)

            # TRANSFORM: Process the model
            logger.info(f"Processing object {object_id}")

            # Load and extract metadata
            mesh = model_processor.load_model(original_data)
            metadata = model_processor.get_model_metadata(mesh)
            obj.model_metadata = metadata

            # Create variants
            variants = {
                FileType.GLB_SMALL: model_processor.create_variant(
                    original_data, "small"
                ),
                FileType.GLB_NORMAL: model_processor.create_variant(
                    original_data, "normal"
                ),
                FileType.GLB_BIG: model_processor.create_variant(original_data, "big"),
            }

            # Generate thumbnails
            thumbnails = thumbnail_service.generate_thumbnails(mesh)

            # LOAD: Upload variants to R2 and create database records
            for file_type, data in variants.items():
                storage_path = self._get_storage_path(
                    object_id,
                    file_type.value,
                    "glb",
                )

                r2_storage.upload_file(
                    data,
                    storage_path,
                    "model/gltf-binary",
                )

                # Create database record
                obj_file = ObjectFile(
                    object_id=object_id,
                    file_type=file_type,
                    storage_path=storage_path,
                    file_size_bytes=len(data),
                    content_type="model/gltf-binary",
                )
                db.add(obj_file)

            # Upload thumbnails
            for thumb_data, width, height in thumbnails:
                storage_path = self._get_storage_path(
                    object_id,
                    f"thumbnail_{width}x{height}",
                    settings.thumbnail_format.lower(),
                )

                content_type = self._get_content_type(settings.thumbnail_format)
                r2_storage.upload_file(
                    thumb_data,
                    storage_path,
                    content_type,
                )

                # Create database record
                obj_file = ObjectFile(
                    object_id=object_id,
                    file_type=FileType.THUMBNAIL,
                    storage_path=storage_path,
                    file_size_bytes=len(thumb_data),
                    content_type=content_type,
                    width=width,
                    height=height,
                )
                db.add(obj_file)

            # Delete original file
            r2_storage.delete_file(original_path)

            # Update status to completed
            obj.status = ProcessingStatus.COMPLETED
            obj.processing_error = None
            await db.commit()

            logger.info(f"Successfully processed object {object_id}")

        except Exception as e:
            logger.error(f"Failed to process object {object_id}: {e}")
            obj.status = ProcessingStatus.FAILED
            obj.processing_error = str(e)
            await db.commit()
            raise

    @staticmethod
    def _get_storage_path(
        object_id: UUID,
        file_type: str,
        extension: str,
    ) -> str:
        """Generate storage path for a file."""
        return f"{settings.storage_prefix}/{object_id}/{file_type}.{extension}"

    @staticmethod
    def _get_content_type(format_name: str) -> str:
        """Get content type for image format."""
        content_types = {
            "PNG": "image/png",
            "JPEG": "image/jpeg",
            "JPG": "image/jpeg",
            "WEBP": "image/webp",
        }
        return content_types.get(format_name.upper(), "image/png")


# Singleton instance
etl_service = ETLService()
