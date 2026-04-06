#!/usr/bin/env python3
"""
Convert .max to .fbx/.glb while preserving hierarchy and relationships
Maintains parent-child relationships, groups, and scene structure

Usage: blender --background --python max_to_fbx_preserve_hierarchy.py -- input.max output.fbx
"""

import bpy
import sys
import os


def preserve_hierarchy_export(input_path, output_path, export_format="fbx"):
    """
    Export with full hierarchy preservation

    Args:
        input_path: Input file path (.max, .3ds, .obj, .blend)
        output_path: Output file path (.fbx, .glb)
        export_format: 'fbx' or 'glb'
    """

    # Clear existing scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Import with hierarchy preservation
    try:
        ext = input_path.lower().split(".")[-1]

        print(f"Importing {ext.upper()} file: {input_path}")

        if ext == "max":
            # .max files need special handling - try .3ds import
            print("WARNING: .max format has limited support")
            print("Attempting import as 3DS format...")
            bpy.ops.import_scene.autodesk_3ds(
                filepath=input_path,
                constrain_size=0.0,  # No size constraint
                use_image_search=True,
                use_apply_transform=True,
            )

        elif ext == "3ds":
            bpy.ops.import_scene.autodesk_3ds(
                filepath=input_path,
                constrain_size=0.0,
                use_image_search=True,
                use_apply_transform=True,
            )

        elif ext == "obj":
            bpy.ops.import_scene.obj(
                filepath=input_path,
                use_split_objects=True,  # Keep objects separate
                use_split_groups=True,  # Keep groups
                use_image_search=True,
            )

        elif ext == "fbx":
            bpy.ops.import_scene.fbx(
                filepath=input_path,
                use_custom_normals=True,
                use_image_search=True,
            )

        elif ext == "blend":
            bpy.ops.wm.open_mainfile(filepath=input_path)

        else:
            print(f"Unsupported format: {ext}")
            return False

    except Exception as e:
        print(f"Import failed: {e}")
        return False

    # Print scene hierarchy
    print("\n=== Scene Hierarchy ===")
    print_hierarchy()

    # Create parent empty for entire scene (optional, helps keep everything together)
    create_scene_parent = True
    if create_scene_parent:
        bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
        scene_parent = bpy.context.active_object
        scene_parent.name = "SceneRoot"

        # Parent all root objects to scene parent
        root_objects = [
            obj
            for obj in bpy.data.objects
            if obj.parent is None and obj != scene_parent
        ]
        for obj in root_objects:
            obj.parent = scene_parent
            obj.matrix_parent_inverse = scene_parent.matrix_world.inverted()

        print(f"\nCreated scene root with {len(root_objects)} child objects")

    # Export with hierarchy preservation
    try:
        if export_format.lower() == "fbx" or output_path.lower().endswith(".fbx"):
            print(f"\nExporting to FBX: {output_path}")
            export_fbx_with_hierarchy(output_path)

        elif export_format.lower() in ["glb", "gltf"] or output_path.lower().endswith(
            (".glb", ".gltf")
        ):
            print(f"\nExporting to GLB/glTF: {output_path}")
            export_gltf_with_hierarchy(output_path)

        else:
            print(f"Unsupported export format: {export_format}")
            return False

        print(f"\n✓ Successfully exported with hierarchy preserved!")
        print(f"✓ Output: {output_path}")
        return True

    except Exception as e:
        print(f"Export failed: {e}")
        return False


def export_fbx_with_hierarchy(output_path):
    """Export to FBX with full hierarchy preservation"""
    bpy.ops.export_scene.fbx(
        filepath=output_path,
        # Scene settings
        use_selection=False,  # Export everything
        use_active_collection=False,  # Export all collections
        # Hierarchy preservation
        use_custom_props=True,  # Keep custom properties
        add_leaf_bones=False,  # Don't add extra bones
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        # Transform settings
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_NONE",  # Keep original scale
        bake_space_transform=False,  # Keep hierarchy transforms
        # Object types (include everything)
        object_types={"ARMATURE", "CAMERA", "EMPTY", "LIGHT", "MESH", "OTHER"},
        # Mesh settings
        use_mesh_modifiers=True,
        use_mesh_modifiers_render=True,
        mesh_smooth_type="FACE",
        use_subsurf=False,
        use_mesh_edges=False,
        use_tspace=False,
        # Materials and textures
        path_mode="COPY",  # Copy textures
        embed_textures=True,  # Embed in FBX
        # Animation
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=True,
        bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True,
        bake_anim_step=1.0,
        bake_anim_simplify_factor=1.0,
        # Armature settings
        use_armature_deform_only=False,
        armature_nodetype="NULL",
        # Axis conversion
        axis_forward="-Z",
        axis_up="Y",
    )


def export_gltf_with_hierarchy(output_path):
    """Export to glTF/GLB with full hierarchy preservation"""

    # Determine if glb or gltf
    export_format = "GLB" if output_path.lower().endswith(".glb") else "GLTF_SEPARATE"

    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format=export_format,
        # Scene settings
        use_selection=False,  # Export everything
        use_visible=False,  # Export hidden objects too
        use_renderable=False,
        use_active_collection=False,
        # Hierarchy preservation
        export_extras=True,  # Keep custom properties
        export_cameras=True,
        export_lights=True,
        # Transform settings
        export_yup=True,  # Use Y-up convention
        export_apply=False,  # Don't apply transforms (preserve hierarchy)
        # Mesh settings
        export_texcoords=True,
        export_normals=True,
        export_draco_mesh_compression_enable=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_colors=True,
        # Animation
        export_animations=True,
        export_frame_range=True,
        export_frame_step=1,
        export_force_sampling=True,
        export_nla_strips=True,
        export_def_bones=False,
        optimize_animation_size=False,
        # Compression
        export_image_format="AUTO",
        export_texture_dir="",
    )


def print_hierarchy(obj=None, level=0):
    """Recursively print scene hierarchy"""
    if obj is None:
        # Print all root objects
        root_objects = [o for o in bpy.data.objects if o.parent is None]
        print(f"Total objects: {len(bpy.data.objects)}")
        print(f"Root objects: {len(root_objects)}\n")
        for root in root_objects:
            print_hierarchy(root, 0)
    else:
        # Print object with indentation
        indent = "  " * level
        obj_type = obj.type
        print(f"{indent}├─ {obj.name} ({obj_type})")

        # Print children
        children = [o for o in bpy.data.objects if o.parent == obj]
        for child in children:
            print_hierarchy(child, level + 1)


def group_objects_by_prefix(prefix_length=3):
    """
    Group objects by name prefix (e.g., "Living_Room_Chair" -> "Living_Room")
    Useful for organizing scattered objects
    """
    print("\n=== Grouping objects by name prefix ===")

    # Create collections by prefix
    prefixes = {}

    for obj in bpy.data.objects:
        if obj.type == "MESH":
            # Extract prefix
            parts = obj.name.split("_")
            if len(parts) > 1:
                prefix = "_".join(parts[:prefix_length])
            else:
                prefix = "Ungrouped"

            if prefix not in prefixes:
                prefixes[prefix] = []
            prefixes[prefix].append(obj)

    # Create collections
    for prefix, objects in prefixes.items():
        # Create collection
        collection = bpy.data.collections.new(name=prefix)
        bpy.context.scene.collection.children.link(collection)

        # Move objects to collection
        for obj in objects:
            # Unlink from all collections
            for coll in obj.users_collection:
                coll.objects.unlink(obj)
            # Link to new collection
            collection.objects.link(obj)

        print(f"Created collection '{prefix}' with {len(objects)} objects")


def merge_by_material():
    """Group objects by material - useful for rooms with same materials"""
    print("\n=== Grouping by material ===")

    material_groups = {}

    for obj in bpy.data.objects:
        if obj.type == "MESH" and len(obj.data.materials) > 0:
            mat_name = obj.data.materials[0].name
            if mat_name not in material_groups:
                material_groups[mat_name] = []
            material_groups[mat_name].append(obj)

    for mat_name, objects in material_groups.items():
        print(f"Material '{mat_name}': {len(objects)} objects")


def main():
    # Parse arguments
    argv = sys.argv
    if "--" not in argv:
        print(
            "Usage: blender --background --python max_to_fbx_preserve_hierarchy.py -- input.max output.fbx [options]"
        )
        print("\nOptions:")
        print("  --group-by-name    Group objects by name prefix")
        print("  --create-root      Create scene root parent (default: True)")
        print("  --format fbx|glb   Output format (auto-detected from extension)")
        sys.exit(1)

    argv = argv[argv.index("--") + 1 :]

    if len(argv) < 2:
        print("Error: Please provide input and output file paths")
        sys.exit(1)

    input_file = argv[0]
    output_file = argv[1]

    # Check options
    group_by_name = "--group-by-name" in argv

    # Determine output format
    if output_file.lower().endswith(".fbx"):
        export_format = "fbx"
    elif output_file.lower().endswith((".glb", ".gltf")):
        export_format = "glb"
    else:
        print(f"Warning: Unknown extension, defaulting to FBX")
        export_format = "fbx"

    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)

    # Convert
    success = preserve_hierarchy_export(input_file, output_file, export_format)

    # Optional grouping
    if group_by_name and success:
        group_objects_by_prefix()
        # Re-export with groups
        if export_format == "fbx":
            export_fbx_with_hierarchy(output_file)
        else:
            export_gltf_with_hierarchy(output_file)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
