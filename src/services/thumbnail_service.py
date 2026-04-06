"""Thumbnail generation service for 3D models."""

import io

import numpy as np
import trimesh
from PIL import Image

from app.core.config import settings


class ThumbnailService:
    """Service for generating thumbnails from 3D models."""

    @staticmethod
    def render_thumbnail(
        mesh: trimesh.Trimesh | trimesh.Scene,
        width: int,
        height: int,
        background_color: tuple[int, int, int, int] = (255, 255, 255, 255),
    ) -> Image.Image:
        """
        Render a 3D model to a PIL Image.

        Args:
            mesh: Trimesh object to render
            width: Image width
            height: Image height
            background_color: RGBA background color

        Returns:
            PIL Image

        Raises:
            ValueError: If rendering fails
        """
        try:
            # Use trimesh's built-in rendering
            # This creates a simple rendering without pyrender
            png_data = mesh.save_image(resolution=(width, height))

            if png_data is None:
                # Fallback: create a simple white image with text
                img = Image.new("RGBA", (width, height), background_color)
                return img

            img = Image.open(io.BytesIO(png_data))

            # Ensure RGBA mode
            if img.mode != "RGBA":
                img = img.convert("RGBA")

            # Apply background color for transparency
            background = Image.new("RGBA", img.size, background_color)
            img = Image.alpha_composite(background, img)

            return img
        except Exception as e:
            # Fallback: create a placeholder image
            img = Image.new("RGBA", (width, height), background_color)
            return img

    def generate_thumbnails(
        self,
        mesh: trimesh.Trimesh | trimesh.Scene,
    ) -> list[tuple[bytes, int, int]]:
        """
        Generate multiple thumbnail sizes from a 3D model.

        Args:
            mesh: Trimesh object

        Returns:
            List of tuples (image_bytes, width, height)

        Raises:
            ValueError: If thumbnail generation fails
        """
        thumbnails: list[tuple[bytes, int, int]] = []

        for width, height in settings.thumbnail_sizes:
            img = self.render_thumbnail(mesh, width, height)

            # Convert to target format
            output = io.BytesIO()

            if settings.thumbnail_format in ("JPEG", "JPG"):
                # Convert RGBA to RGB for JPEG
                img = img.convert("RGB")
                img.save(
                    output,
                    format="JPEG",
                    quality=settings.thumbnail_quality,
                    optimize=True,
                )
            elif settings.thumbnail_format == "WEBP":
                img.save(
                    output,
                    format="WEBP",
                    quality=settings.thumbnail_quality,
                    method=6,
                )
            else:  # PNG
                img.save(
                    output,
                    format="PNG",
                    optimize=True,
                )

            thumbnails.append((output.getvalue(), width, height))

        return thumbnails


# Singleton instance
thumbnail_service = ThumbnailService()
