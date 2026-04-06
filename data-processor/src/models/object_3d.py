"""Database models for 3D objects."""

from enum import Enum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from src.models.object_file import ObjectFile


class ProcessingStatus(str, Enum):
    """Processing status for 3D objects."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Object3D(Base, TimestampMixin):
    """3D object metadata model."""

    __tablename__: str = "objects_3d"

    id: Mapped[UUID] = mapped_column(
        primary_key=True,
        default=uuid4,
        index=True,
    )

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Original file info
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_size_bytes: Mapped[int] = mapped_column(nullable=False)

    # Processing status
    status: Mapped[ProcessingStatus] = mapped_column(
        String(20),
        default=ProcessingStatus.PENDING,
        nullable=False,
        index=True,
    )
    processing_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Metadata extracted from 3D model
    model_metadata: Mapped[dict[str, object] | None] = mapped_column(
        "metadata",  # Column name in database
        JSON,
        nullable=True,
        default=dict,
    )

    # Relationships
    files: Mapped[list["ObjectFile"]] = relationship(
        "ObjectFile",
        back_populates="object_3d",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        """String representation."""
        return f"<Object3D(id={self.id}, name={self.name}, status={self.status})>"
