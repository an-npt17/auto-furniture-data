#!/usr/bin/env python3
"""
Convert .max/.3ds/.obj/.fbx files to .fbx / .glb / .gltf using Blender
Requires: Blender 2.8+
For .max import, the add-on 'bl_ext.blender_org.io_scene_max' must be enabled.
Usage:
  blender --background --python max_to_fbx_blender.py -- input.max output.fbx
  blender --background --python max_to_fbx_blender.py -- input.max output.glb
  blender --background --python max_to_fbx_blender.py -- input.max output.gltf
"""

import os
import sys

import addon_utils
import bpy

_MAX_ADDON = "bl_ext.blender_org.io_scene_max"


def _blender_version() -> tuple[int, int]:
    """Return (major, minor) of the running Blender."""
    return (bpy.app.version[0], bpy.app.version[1])


def _import(input_path: str) -> bool:
    """Import a 3D file into the current Blender scene."""
    major, minor = _blender_version()
    lower = input_path.lower()

    try:
        if lower.endswith(".max"):
            loaded, _enabled = addon_utils.check(_MAX_ADDON)
            if not loaded:
                addon_utils.enable(_MAX_ADDON, default_set=False)
            bpy.ops.import_scene.max(filepath=input_path)

        elif lower.endswith(".3ds"):
            if (major, minor) >= (4, 0):
                print(
                    f"Error: The .3ds importer was removed in Blender 4.0 (running {major}.{minor}). "
                    + "Convert to .obj or .fbx in a separate tool first."
                )
                return False
            bpy.ops.import_scene.autodesk_3ds(filepath=input_path)

        elif lower.endswith(".obj"):
            # OBJ importer was rewritten as bpy.ops.wm.obj_import in Blender 3.3.
            if (major, minor) >= (3, 3):
                bpy.ops.wm.obj_import(filepath=input_path)
            else:
                bpy.ops.import_scene.obj(filepath=input_path)

        elif lower.endswith(".fbx"):
            bpy.ops.import_scene.fbx(filepath=input_path)

        else:
            print(f"Unsupported input format: {input_path}")
            return False

    except Exception as e:
        print(f"Import failed: {e}")
        return False

    return True


def _export_fbx(output_path: str) -> bool:
    """Export the current scene as FBX."""
    try:
        bpy.ops.export_scene.fbx(
            filepath=output_path,
            use_selection=False,
            global_scale=1.0,
            apply_unit_scale=True,
            apply_scale_options="FBX_SCALE_NONE",
            bake_space_transform=False,
            object_types={"ARMATURE", "CAMERA", "EMPTY", "LIGHT", "MESH", "OTHER"},
            use_mesh_modifiers=True,
            use_mesh_modifiers_render=True,
            mesh_smooth_type="OFF",
            use_custom_props=False,
            add_leaf_bones=True,
            primary_bone_axis="Y",
            secondary_bone_axis="X",
            use_armature_deform_only=False,
            armature_nodetype="NULL",
            bake_anim=True,
            bake_anim_use_all_bones=True,
            bake_anim_use_nla_strips=True,
            bake_anim_use_all_actions=True,
            bake_anim_force_startend_keying=True,
            bake_anim_step=1.0,
            bake_anim_simplify_factor=1.0,
            path_mode="AUTO",
            embed_textures=False,
            batch_mode="OFF",
            use_batch_own_dir=True,
            use_metadata=True,
            axis_forward="-Z",
            axis_up="Y",
        )
        return True
    except Exception as e:
        print(f"FBX export failed: {e}")
        return False


def _export_gltf(output_path: str) -> bool:
    """Export the current scene as GLB or GLTF."""
    lower = output_path.lower()
    if lower.endswith(".glb"):
        fmt = "GLB"
    else:
        # .gltf — embed buffers/textures so it stays a single file
        fmt = "GLTF_EMBEDDED"

    try:
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format=fmt,
            use_selection=False,
            export_apply=True,
            export_yup=True,
        )
        return True
    except Exception as e:
        print(f"glTF export failed: {e}")
        return False


def convert(input_path: str, output_path: str) -> bool:
    """Import input_path and export to output_path (fbx/glb/gltf)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)

    if not _import(input_path):
        return False

    lower_out = output_path.lower()
    if lower_out.endswith(".fbx"):
        success = _export_fbx(output_path)
    elif lower_out.endswith(".glb") or lower_out.endswith(".gltf"):
        success = _export_gltf(output_path)
    else:
        print(f"Unsupported output format: {output_path}")
        return False

    if success:
        print(f"Successfully exported to: {output_path}")
    return success


if __name__ == "__main__":
    argv = sys.argv
    if "--" not in argv:
        print(
            "Usage: blender --background --python max_to_fbx_blender.py -- input.max output.[fbx|glb|gltf]"
        )
        sys.exit(1)

    argv = argv[argv.index("--") + 1:]

    if len(argv) < 2:
        print("Error: Please provide input and output file paths")
        print(
            "Usage: blender --background --python max_to_fbx_blender.py -- input.max output.[fbx|glb|gltf]"
        )
        sys.exit(1)

    input_file = argv[0]
    output_file = argv[1]

    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)

    sys.exit(0 if convert(input_file, output_file) else 1)
