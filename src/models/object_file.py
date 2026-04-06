"""Database models for object files (GLB variants and thumbnails)."""

from enum import Enum
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.object_3d import Object3D


class FileType(str, Enum):
    """Type of file stored."""

    GLB_SMALL = "glb_small"
    GLB_NORMAL = "glb_normal"
    GLB_BIG = "glb_big"
    THUMBNAIL = "thumbnail"


class ObjectFile(Base, TimestampMixin):
    """Files associated with a 3D object."""

    __tablename__ = "object_files"

    id: Mapped[UUID] = mapped_column(
        primary_key=True,
        default=uuid4,
        index=True,
    )

    object_id: Mapped[UUID] = mapped_column(
        ForeignKey("objects_3d.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    file_type: Mapped[FileType] = mapped_column(
        String(20),
        nullable=False,
        index=True,
    )

    # Storage info
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # For thumbnails: dimensions
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Relationships
    object_3d: Mapped["Object3D"] = relationship(
        "Object3D",
        back_populates="files",
    )

    def __repr__(self) -> str:
        """String representation."""
        return (
            f"<ObjectFile(id={self.id}, object_id={self.object_id}, "
            f"type={self.file_type})>"
        )
