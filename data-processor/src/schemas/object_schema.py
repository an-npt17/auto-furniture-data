"""Pydantic schemas for API requests and responses."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from src.models import FileType, ProcessingStatus


class ObjectFileSchema(BaseModel):
    """Schema for object file information."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    object_id: UUID
    file_type: FileType
    storage_path: str
    file_size_bytes: int
    content_type: str
    width: int | None = None
    height: int | None = None
    created_at: datetime
    updated_at: datetime


class Object3DBase(BaseModel):
    """Base schema for 3D object."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class Object3DCreate(Object3DBase):
    """Schema for creating a 3D object."""

    pass


class Object3DUpdate(BaseModel):
    """Schema for updating a 3D object."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class Object3DResponse(Object3DBase):
    """Schema for 3D object response."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    original_filename: str
    original_size_bytes: int
    status: ProcessingStatus
    processing_error: str | None = None
    model_metadata: dict[str, Any] | None = Field(None, alias="metadata")
    files: list[ObjectFileSchema] = []
    created_at: datetime
    updated_at: datetime


class Object3DListResponse(BaseModel):
    """Schema for paginated list of 3D objects."""

    items: list[Object3DResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class UploadResponse(BaseModel):
    """Schema for upload response."""

    object_id: UUID
    message: str
    status: ProcessingStatus


class ErrorResponse(BaseModel):
    """Schema for error responses."""

    detail: str
    error_code: str | None = None
