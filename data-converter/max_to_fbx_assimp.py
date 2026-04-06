#!/usr/bin/env python3
"""
Convert 3D files to FBX using Assimp (Open Asset Import Library)
Supports: .max (limited), .3ds, .obj, .dae, .blend, .fbx, and 40+ formats

Installation:
    pip install pyassimp
    # or
    sudo apt-get install python3-pyassimp
"""

import os
import sys

import pyassimp
from pyassimp import export, load


def convert_to_fbx(input_file, output_file):
    """Convert 3D model to FBX format using Assimp"""
    try:
        print(f"Loading: {input_file}")

        # Load the scene
        scene = pyassimp.load(input_file)

        print(f"Scene loaded successfully")
        print(f"  - Meshes: {len(scene.meshes)}")
        print(f"  - Materials: {len(scene.materials)}")
        print(f"  - Textures: {len(scene.textures)}")

        # Export to FBX
        print(f"Exporting to: {output_file}")
        export(scene, output_file, file_type="fbx")

        # Release the scene
        pyassimp.release(scene)

        print(f"✓ Successfully converted to FBX!")
        return True

    except Exception as e:
        print(f"✗ Conversion failed: {e}")
        print(f"\nNote: .max file support is limited in Assimp")
        print(f"Try converting .max to .3ds first using 3ds Max or alternative tools")
        return False


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 max_to_fbx_assimp.py input.max output.fbx")
        print("\nSupported input formats:")
        print("  .max (limited), .3ds, .obj, .dae, .blend, .gltf, .stl, and more")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)

    success = convert_to_fbx(input_file, output_file)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
