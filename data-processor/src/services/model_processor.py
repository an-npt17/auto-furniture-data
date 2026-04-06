"""3D model processing service using trimesh."""

import io
from typing import Literal, cast

import trimesh

from src.core.config import settings


class ModelProcessingService:
    """Service for processing 3D models (GLB files)."""

    @staticmethod
    def load_model(file_data: bytes) -> trimesh.Scene:
        """
        Load a 3D model from bytes.

        Args:
            file_data: GLB file data

        Returns:
            Loaded trimesh Scene (may contain single Trimesh or multiple geometries)

        Raises:
            ValueError: If model cannot be loaded
        """
        try:
            file_obj = io.BytesIO(file_data)
            mesh = trimesh.load(file_obj, file_type="glb")

            # Convert single Trimesh to Scene for consistent handling
            if isinstance(mesh, trimesh.Trimesh):
                scene = trimesh.Scene()
                scene.add_geometry(mesh)
                return scene

            return cast(trimesh.Scene, mesh)
        except Exception as e:
            raise ValueError(f"Failed to load 3D model: {e}") from e

    @staticmethod
    def get_model_metadata(
        mesh: trimesh.Scene,
    ) -> dict[str, object]:
        """
        Extract metadata from a 3D model Scene.

        Args:
            mesh: Trimesh Scene

        Returns:
            Dictionary of metadata
        """
        metadata: dict[str, object] = {}

        # For scenes, get combined geometry
        combined = mesh.dump(concatenate=True)

        if not isinstance(combined, trimesh.Trimesh):
            metadata["type"] = "scene"
            metadata["geometry_count"] = len(mesh.geometry)
            return metadata

        metadata["type"] = "mesh"
        metadata["vertices_count"] = int(len(combined.vertices))
        metadata["faces_count"] = int(len(combined.faces))
        metadata["is_watertight"] = bool(combined.is_watertight)
        metadata["is_empty"] = bool(combined.is_empty)

        # Bounding box
        bounds = combined.bounds
        metadata["bounds_min"] = bounds[0].tolist()
        metadata["bounds_max"] = bounds[1].tolist()

        # Volume and area (if watertight)
        if combined.is_watertight:
            metadata["volume"] = float(combined.volume)
        metadata["area"] = float(combined.area)

        return metadata

    @staticmethod
    def simplify_model(
        mesh: trimesh.Trimesh | trimesh.Scene,
        target_faces: int,
    ) -> trimesh.Trimesh:
        """
        Simplify a 3D model to a target face count.

        Args:
            mesh: Trimesh object
            target_faces: Target number of faces

        Returns:
            Simplified trimesh object

        Raises:
            ValueError: If simplification fails
        """
        try:
            # Convert scene to single mesh if needed
            if isinstance(mesh, trimesh.Scene):
                combined = mesh.dump(concatenate=True)
                if not isinstance(combined, trimesh.Trimesh):
                    raise ValueError("Cannot simplify complex scene")
                mesh = combined

            # Skip if already below target
            current_faces = len(mesh.faces)
            if current_faces <= target_faces:
                return mesh

            # Use quadric decimation for simplification
            simplified = mesh.simplify_quadric_decimation(target_faces)

            if not isinstance(simplified, trimesh.Trimesh):
                raise ValueError("Simplification returned non-mesh object")

            return simplified
        except Exception as e:
            raise ValueError(f"Failed to simplify model: {e}") from e

    def create_variant(
        self,
        file_data: bytes,
        variant_type: Literal["small", "normal", "big"],
    ) -> bytes:
        """
        Create a GLB variant with appropriate face count.

        Args:
            file_data: Original GLB file data
            variant_type: Type of variant to create

        Returns:
            Processed GLB file data

        Raises:
            ValueError: If processing fails
        """
        # Load the model
        mesh = self.load_model(file_data)

        # Determine target face count
        target_faces_map = {
            "small": settings.glb_small_max_faces,
            "normal": settings.glb_normal_max_faces,
            "big": settings.glb_big_max_faces,
        }
        target_faces = target_faces_map[variant_type]

        # Simplify if needed
        if isinstance(mesh, trimesh.Scene):
            # Try to simplify each geometry in the scene
            simplified_geometries = {}
            for name, geom in mesh.geometry.items():
                if isinstance(geom, trimesh.Trimesh):
                    simplified_geometries[name] = self.simplify_model(
                        geom, target_faces
                    )
                else:
                    simplified_geometries[name] = geom

            # Create new scene with simplified geometries
            result_mesh = trimesh.Scene()
            for name, geom in simplified_geometries.items():
                result_mesh.add_geometry(geom, node_name=name)
        else:
            result_mesh = self.simplify_model(mesh, target_faces)

        # Export to GLB
        output = io.BytesIO()
        result_mesh.export(output, file_type="glb")
        return output.getvalue()


# Singleton instance
model_processor = ModelProcessingService()
