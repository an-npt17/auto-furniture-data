#!/usr/bin/env python3
"""Export Blender top-level object hierarchies to per-object GLB files and a manifest.

Run inside Blender, for example:

  blender --background --factory-startup --python blender_export.py -- input.glb output_dir

If no output directory is given, a sibling `<scene>_models` folder is used.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


def parse_args() -> tuple[Path | None, Path | None]:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    input_path = Path(argv[0]).resolve() if argv else None
    output_dir = None
    for item in argv[1:]:
        if item.startswith("--output-dir="):
            output_dir = item.split("=", 1)[1]
            break

    if output_dir is None and len(argv) > 1:
        output_dir = argv[1]

    return input_path, Path(output_dir).resolve() if output_dir else None


def sanitize_name(name: str, fallback_index: int) -> str:
    clean = name.strip() or f"{fallback_index}"
    return re.sub(r'[/\\:*?"<>|]+', "_", clean)


def dedupe_name(name: str, used: dict[str, int]) -> str:
    count = used.get(name, 0)
    used[name] = count + 1
    return name if count == 0 else f"{name}_{count}"


def round4(value: float) -> float:
    return round(value, 4)


def blender_to_gltf(vec: Vector) -> Vector:
    # Blender is Z-up; the viewer expects the exported GLB's Y-up coordinates.
    return Vector((vec.x, vec.z, -vec.y))


def iter_subtree(root: bpy.types.Object) -> Iterable[bpy.types.Object]:
    stack = [root]
    seen: set[str] = set()
    while stack:
        obj = stack.pop()
        if obj.name in seen:
            continue
        seen.add(obj.name)
        yield obj
        stack.extend(obj.children)


def has_mesh_descendant(root: bpy.types.Object) -> bool:
    for obj in iter_subtree(root):
        if obj.type == "MESH":
            return True
    return False


def scene_roots(scene: bpy.types.Scene) -> list[bpy.types.Object]:
    return [
        obj for obj in scene.objects if obj.parent is None and has_mesh_descendant(obj)
    ]


def subtree_world_bounds(root: bpy.types.Object) -> tuple[Vector, Vector] | None:
    points: list[Vector] = []
    for obj in iter_subtree(root):
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))

    if not points:
        return None

    min_v = Vector((float("inf"), float("inf"), float("inf")))
    max_v = Vector((float("-inf"), float("-inf"), float("-inf")))
    for point in points:
        gltf_point = blender_to_gltf(point)
        min_v.x = min(min_v.x, gltf_point.x)
        min_v.y = min(min_v.y, gltf_point.y)
        min_v.z = min(min_v.z, gltf_point.z)
        max_v.x = max(max_v.x, gltf_point.x)
        max_v.y = max(max_v.y, gltf_point.y)
        max_v.z = max(max_v.z, gltf_point.z)

    return min_v, max_v


def guess_category(size: Vector) -> str:
    smallest = min(size.x, size.y, size.z)
    largest = max(size.x, size.y, size.z)
    if smallest <= 0.25 and largest >= 1.5:
        return "wall"
    return "furniture"


def is_generic_name(name: str) -> bool:
    lowered = name.lower()
    return (
        lowered.startswith("node_")
        or lowered.startswith("box")
        or lowered.startswith("mesh_")
        or lowered.startswith("object")
    )


def metadata_name(obj: bpy.types.Object) -> str | None:
    for key in ("label", "object_name", "group_name", "name", "mesh_name"):
        value = obj.get(key)
        if isinstance(value, str) and value.strip() and not is_generic_name(value):
            return value.strip()
    if obj.name and not is_generic_name(obj.name):
        return obj.name
    return None


def resolve_group_name(root: bpy.types.Object, fallback_index: int) -> str:
    candidates: list[str] = []
    root_meta = metadata_name(root)
    if root_meta:
        candidates.append(root_meta)
    for obj in iter_subtree(root):
        meta = metadata_name(obj)
        if meta:
            candidates.append(meta)
    for candidate in candidates:
        if candidate and not is_generic_name(candidate):
            return candidate
    return (
        root.name
        if root.name and not is_generic_name(root.name)
        else f"{fallback_index}"
    )


def export_root(root: bpy.types.Object, out_path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in iter_subtree(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_animations=False,
    )


def export_root_object(root: bpy.types.Object, out_path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in iter_subtree(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    root["object_name"] = root.name

    bpy.ops.export_scene.gltf(
        filepath=str(out_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_animations=False,
    )


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_glb(glb_path: Path) -> None:
    if not glb_path.exists():
        raise FileNotFoundError(f"Input GLB not found: {glb_path}")

    bpy.ops.import_scene.gltf(filepath=str(glb_path))


def main() -> int:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.mode != "OBJECT" else None
    bpy.context.view_layer.update()

    input_path, output_dir = parse_args()
    if input_path is None:
        raise RuntimeError(
            "Usage: blender --background --factory-startup --python blender_export.py -- input.glb [output-dir]"
        )

    clear_scene()
    import_glb(input_path)

    if output_dir is None:
        output_dir = input_path.with_name(f"{input_path.stem}_models")

    output_dir.mkdir(parents=True, exist_ok=True)

    roots = scene_roots(bpy.context.scene)
    if not roots:
        raise RuntimeError("No exportable root objects found in the current scene.")

    manifest: dict[str, dict[str, object]] = {}
    walls: list[dict[str, object]] = []
    scene_objects: list[dict[str, object]] = []
    scene_locations: list[dict[str, float | str]] = []
    room_templates: list[dict[str, object]] = []
    used_names: dict[str, int] = {}
    source_file = Path(bpy.data.filepath).name if bpy.data.filepath else "scene.blend"
    room_id = Path(bpy.data.filepath).stem if bpy.data.filepath else "scene"

    for index, root in enumerate(roots):
        group_key = dedupe_name(
            sanitize_name(resolve_group_name(root, index), index), used_names
        )
        file_name = f"{group_key}.glb"
        file_path = output_dir / file_name

        location = blender_to_gltf(root.matrix_world.translation)
        bounds = subtree_world_bounds(root)
        if bounds is None:
            size = Vector((0.0, 0.0, 0.0))
        else:
            min_v, max_v = bounds
            size = max_v - min_v

        export_root_object(root, file_path)

        manifest[group_key] = {
            "size": [round4(size.x), round4(size.y), round4(size.z)],
            "category": guess_category(size),
            "file_name": file_name,
            "baked_transform": True,
            "world_location": {
                "x": round4(location.x),
                "y": round4(location.y),
                "z": round4(location.z),
            },
            "location": {
                "x": 0.0,
                "y": 0.0,
                "z": 0.0,
            },
        }

        if manifest[group_key]["category"] == "wall":
            walls.append(
                {
                    "id": group_key,
                    "name": root.name,
                    "size": manifest[group_key]["size"],
                    "file_name": file_name,
                }
            )
        else:
            scene_objects.append(
                {
                    "id": group_key,
                    "name": root.name,
                    "size": manifest[group_key]["size"],
                    "file_name": file_name,
                    "category": "furniture",
                    "location": manifest[group_key]["location"],
                }
            )
            scene_locations.append(
                {
                    "id": group_key,
                    "ox": round4(location.x),
                    "oy": round4(location.y),
                    "oz": round4(location.z),
                }
            )

        print(f"[{index + 1}/{len(roots)}] {file_name}")

    room_templates.append(
        {
            "id": room_id,
            "source_file": source_file,
            "wall_ids": [entry["id"] for entry in walls],
            "scene_object_ids": [entry["id"] for entry in scene_objects],
            "wall_count": len(walls),
            "scene_object_count": len(scene_objects),
        }
    )

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    (output_dir / "walls.json").write_text(
        json.dumps(walls, indent=2), encoding="utf-8"
    )
    (output_dir / "scene_objects.json").write_text(
        json.dumps(scene_objects, indent=2), encoding="utf-8"
    )
    (output_dir / "scene_locations.json").write_text(
        json.dumps(scene_locations, indent=2), encoding="utf-8"
    )
    (output_dir / "room_templates.json").write_text(
        json.dumps(room_templates, indent=2), encoding="utf-8"
    )

    print(f"Exported {len(roots)} object(s) to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
