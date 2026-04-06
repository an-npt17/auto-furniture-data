"""Initial schema for 3D objects

Revision ID: b82a76d9de00
Revises:
Create Date: 2026-04-01 15:17:43.821786

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b82a76d9de00"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create objects_3d table
    op.create_table(
        "objects_3d",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("original_size_bytes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("processing_error", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_objects_3d_id"), "objects_3d", ["id"], unique=False)
    op.create_index(op.f("ix_objects_3d_name"), "objects_3d", ["name"], unique=False)
    op.create_index(
        op.f("ix_objects_3d_status"), "objects_3d", ["status"], unique=False
    )

    # Create object_files table
    op.create_table(
        "object_files",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("object_id", sa.UUID(), nullable=False),
        sa.Column("file_type", sa.String(length=20), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["object_id"], ["objects_3d.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_object_files_file_type"), "object_files", ["file_type"], unique=False
    )
    op.create_index(op.f("ix_object_files_id"), "object_files", ["id"], unique=False)
    op.create_index(
        op.f("ix_object_files_object_id"), "object_files", ["object_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_object_files_object_id"), table_name="object_files")
    op.drop_index(op.f("ix_object_files_id"), table_name="object_files")
    op.drop_index(op.f("ix_object_files_file_type"), table_name="object_files")
    op.drop_table("object_files")
    op.drop_index(op.f("ix_objects_3d_status"), table_name="objects_3d")
    op.drop_index(op.f("ix_objects_3d_name"), table_name="objects_3d")
    op.drop_index(op.f("ix_objects_3d_id"), table_name="objects_3d")
    op.drop_table("objects_3d")
