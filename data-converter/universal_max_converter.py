#!/usr/bin/env python3
"""
Universal .max to .fbx converter for Linux
Tries multiple conversion methods in order of reliability
"""

import os
import sys
import subprocess
from pathlib import Path


class MaxToFbxConverter:
    def __init__(self, input_file, output_file):
        self.input_file = os.path.abspath(input_file)
        self.output_file = os.path.abspath(output_file)
        self.methods = []

        # Detect available conversion methods
        self._detect_methods()

    def _detect_methods(self):
        """Detect available conversion methods"""

        # Method 1: Assimp (most universal)
        try:
            import pyassimp

            self.methods.append(("assimp", self._convert_assimp))
            print("✓ Assimp available")
        except ImportError:
            print("✗ Assimp not available (pip install pyassimp)")

        # Method 2: Blender
        if subprocess.run(["which", "blender"], capture_output=True).returncode == 0:
            self.methods.append(("blender", self._convert_blender))
            print("✓ Blender available")
        else:
            print("✗ Blender not available")

        # Method 3: FBX Converter via Wine
        fbx_converter = self._find_fbx_converter()
        if fbx_converter:
            self.methods.append(
                ("fbx_converter", lambda: self._convert_fbx_converter(fbx_converter))
            )
            print(f"✓ FBX Converter available: {fbx_converter}")
        else:
            print("✗ FBX Converter not available")

    def _find_fbx_converter(self):
        """Find Autodesk FBX Converter"""
        possible_paths = [
            "~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.1/bin/FbxConverter.exe",
            "~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.2/bin/FbxConverter.exe",
            "~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.3/bin/FbxConverter.exe",
        ]

        for path in possible_paths:
            expanded = os.path.expanduser(path)
            if os.path.exists(expanded):
                return expanded
        return None

    def _convert_assimp(self):
        """Convert using Assimp"""
        import pyassimp
        from pyassimp import load, export

        print("\n=== Trying Assimp ===")
        try:
            scene = pyassimp.load(self.input_file)
            export(scene, self.output_file, file_type="fbx")
            pyassimp.release(scene)
            return True
        except Exception as e:
            print(f"Assimp failed: {e}")
            return False

    def _convert_blender(self):
        """Convert using Blender"""
        print("\n=== Trying Blender ===")

        # Create temporary Blender script
        script = f'''
import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    bpy.ops.import_scene.autodesk_3ds(filepath="{self.input_file}")
    bpy.ops.export_scene.fbx(filepath="{self.output_file}")
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {{e}}")
'''

        script_path = "/tmp/blender_convert.py"
        with open(script_path, "w") as f:
            f.write(script)

        try:
            result = subprocess.run(
                ["blender", "--background", "--python", script_path],
                capture_output=True,
                text=True,
                timeout=60,
            )

            if "SUCCESS" in result.stdout:
                return True
            else:
                print(f"Blender failed: {result.stdout}")
                return False
        except Exception as e:
            print(f"Blender failed: {e}")
            return False
        finally:
            if os.path.exists(script_path):
                os.remove(script_path)

    def _convert_fbx_converter(self, converter_path):
        """Convert using Autodesk FBX Converter"""
        print("\n=== Trying FBX Converter ===")

        try:
            input_win = (
                subprocess.check_output(["winepath", "-w", self.input_file])
                .decode()
                .strip()
            )
            output_win = (
                subprocess.check_output(["winepath", "-w", self.output_file])
                .decode()
                .strip()
            )

            cmd = [
                "wine",
                converter_path,
                input_win,
                output_win,
                "/sffFBX",
                "/dffFBX",
                "/v",
            ]

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

            if os.path.exists(self.output_file):
                return True
            else:
                print(f"FBX Converter failed: {result.stderr}")
                return False
        except Exception as e:
            print(f"FBX Converter failed: {e}")
            return False

    def convert(self):
        """Try all available conversion methods"""

        if not os.path.exists(self.input_file):
            print(f"✗ Input file not found: {self.input_file}")
            return False

        if not self.methods:
            print("\n✗ No conversion methods available!")
            print("\nInstall one of the following:")
            print("  1. pip install pyassimp  (recommended)")
            print("  2. sudo apt-get install blender")
            print("  3. Install FBX Converter via Wine")
            return False

        print(f"\nInput:  {self.input_file}")
        print(f"Output: {self.output_file}")
        print(f"\nAvailable methods: {len(self.methods)}")

        for method_name, method_func in self.methods:
            print(f"\n{'=' * 50}")
            print(f"Attempting: {method_name}")
            print(f"{'=' * 50}")

            try:
                if method_func():
                    print(f"\n✓ SUCCESS! Converted using: {method_name}")
                    print(f"✓ Output saved to: {self.output_file}")
                    return True
            except Exception as e:
                print(f"✗ {method_name} failed: {e}")
                continue

        print("\n✗ All conversion methods failed")
        print("\nSuggestions:")
        print("  1. Try converting .max to .3ds first (better compatibility)")
        print("  2. Check if .max file is corrupted")
        print("  3. Try opening in 3ds Max and exporting manually")
        return False


def main():
    if len(sys.argv) < 3:
        print("Universal .max to .fbx Converter for Linux")
        print("\nUsage: python3 universal_max_converter.py input.max output.fbx")
        print("\nThis script tries multiple conversion methods:")
        print("  1. Assimp (Open Asset Import Library)")
        print("  2. Blender")
        print("  3. Autodesk FBX Converter (via Wine)")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    converter = MaxToFbxConverter(input_file, output_file)
    success = converter.convert()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
