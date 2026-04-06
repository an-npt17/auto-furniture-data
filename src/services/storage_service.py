"""Cloudflare R2 storage service."""

import io
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import settings


class R2StorageService:
    """Service for interacting with Cloudflare R2 storage."""

    def __init__(self) -> None:
        """Initialize R2 client."""
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name=settings.r2_region,
            config=Config(signature_version="s3v4"),
        )
        self.bucket_name = settings.r2_bucket_name

    def upload_file(
        self,
        file_data: bytes | BinaryIO,
        object_key: str,
        content_type: str,
    ) -> str:
        """
        Upload a file to R2.

        Args:
            file_data: File data as bytes or file-like object
            object_key: The key (path) for the object in R2
            content_type: MIME type of the file

        Returns:
            The object key of the uploaded file

        Raises:
            ClientError: If upload fails
        """
        try:
            if isinstance(file_data, bytes):
                file_data = io.BytesIO(file_data)

            self.client.upload_fileobj(
                file_data,
                self.bucket_name,
                object_key,
                ExtraArgs={"ContentType": content_type},
            )
            return object_key
        except ClientError as e:
            raise RuntimeError(f"Failed to upload file to R2: {e}") from e

    def download_file(self, object_key: str) -> bytes:
        """
        Download a file from R2.

        Args:
            object_key: The key (path) of the object in R2

        Returns:
            File data as bytes

        Raises:
            ClientError: If download fails
        """
        try:
            response = self.client.get_object(
                Bucket=self.bucket_name,
                Key=object_key,
            )
            return response["Body"].read()
        except ClientError as e:
            raise RuntimeError(f"Failed to download file from R2: {e}") from e

    def delete_file(self, object_key: str) -> None:
        """
        Delete a file from R2.

        Args:
            object_key: The key (path) of the object in R2

        Raises:
            ClientError: If deletion fails
        """
        try:
            self.client.delete_object(
                Bucket=self.bucket_name,
                Key=object_key,
            )
        except ClientError as e:
            raise RuntimeError(f"Failed to delete file from R2: {e}") from e

    def delete_files(self, object_keys: list[str]) -> None:
        """
        Delete multiple files from R2.

        Args:
            object_keys: List of object keys to delete

        Raises:
            ClientError: If deletion fails
        """
        if not object_keys:
            return

        try:
            objects = [{"Key": key} for key in object_keys]
            self.client.delete_objects(
                Bucket=self.bucket_name,
                Delete={"Objects": objects},
            )
        except ClientError as e:
            raise RuntimeError(f"Failed to delete files from R2: {e}") from e

    def get_public_url(self, object_key: str) -> str:
        """
        Get the public URL for an object.

        Args:
            object_key: The key (path) of the object in R2

        Returns:
            Public URL for the object
        """
        if settings.r2_public_url:
            return f"{settings.r2_public_url}/{object_key}"
        return f"{settings.r2_endpoint_url}/{self.bucket_name}/{object_key}"

    def file_exists(self, object_key: str) -> bool:
        """
        Check if a file exists in R2.

        Args:
            object_key: The key (path) of the object in R2

        Returns:
            True if file exists, False otherwise
        """
        try:
            self.client.head_object(
                Bucket=self.bucket_name,
                Key=object_key,
            )
            return True
        except ClientError:
            return False


# Singleton instance
r2_storage = R2StorageService()
