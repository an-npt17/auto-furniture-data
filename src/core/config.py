"""Application configuration using Pydantic Settings."""

from typing import Literal

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "3D Object ETL System"
    app_version: str = "0.1.0"
    debug: bool = False

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Database
    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/furniture_db"
    )

    # Cloudflare R2
    r2_endpoint_url: str = Field(
        default="",
        description="R2 endpoint URL (e.g., https://account_id.r2.cloudflarestorage.com)",
    )
    r2_access_key_id: str = Field(default="", description="R2 Access Key ID")
    r2_secret_access_key: str = Field(default="", description="R2 Secret Access Key")
    r2_bucket_name: str = Field(default="furniture-3d-objects")
    r2_region: str = Field(default="auto")
    r2_public_url: str | None = Field(
        default=None, description="Public URL for R2 bucket if using custom domain"
    )

    # Storage paths
    storage_prefix: str = Field(
        default="objects", description="Prefix for object storage paths"
    )

    # 3D Processing
    glb_small_max_faces: int = Field(
        default=5000, description="Maximum faces for small GLB variant"
    )
    glb_normal_max_faces: int = Field(
        default=50000, description="Maximum faces for normal GLB variant"
    )
    glb_big_max_faces: int = Field(
        default=200000, description="Maximum faces for big GLB variant"
    )

    # Thumbnail generation
    thumbnail_sizes: list[tuple[int, int]] = Field(
        default=[(256, 256), (512, 512), (1024, 1024)],
        description="Thumbnail sizes to generate (width, height)",
    )
    thumbnail_format: Literal["PNG", "JPEG", "WEBP"] = Field(default="WEBP")
    thumbnail_quality: int = Field(default=85, ge=1, le=100)

    # Upload limits
    max_upload_size_mb: int = Field(default=500, description="Max upload size in MB")


settings = Settings()
