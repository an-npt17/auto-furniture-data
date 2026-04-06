#!/usr/bin/env python3
"""
Batch convert .max files to .fbx/.glb with hierarchy preservation
Handles entire directories of house/room models

Usage: python3 batch_max_converter.py input_dir/ output_dir/ --format glb
"""

import os
import sys
import subprocess
from pathlib import Path
import argparse
import json


class BatchMaxConverter:
    def __init__(self, input_dir, output_dir, format="fbx", preserve_hierarchy=True):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.format = format.lower()
        self.preserve_hierarchy = preserve_hierarchy

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Find blender
        self.blender_path = self._find_blender()
        if not self.blender_path:
            raise RuntimeError("Blender not found. Please install Blender.")

        print(f"Found Blender: {self.blender_path}")

    def _find_blender(self):
        """Find Blender executable"""
        result = subprocess.run(["which", "blender"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
        return None

    def find_max_files(self, extensions=[".max", ".3ds"]):
        """Find all .max and .3ds files in input directory"""
        files = []
        for ext in extensions:
            files.extend(self.input_dir.rglob(f"*{ext}"))
        return sorted(files)

    def convert_file(self, input_file):
        """Convert a single file"""
        # Generate output path
        relative_path = input_file.relative_to(self.input_dir)
        output_file = self.output_dir / relative_path.with_suffix(f".{self.format}")

        # Create output subdirectory
        output_file.parent.mkdir(parents=True, exist_ok=True)

        print(f"\n{'=' * 60}")
        print(f"Converting: {input_file.name}")
        print(f"Output: {output_file}")
        print(f"{'=' * 60}")

        # Use hierarchy-preserving script
        script_path = Path(__file__).parent / "max_to_fbx_preserve_hierarchy.py"

        if not script_path.exists():
            print(f"Error: {script_path} not found")
            return False

        # Build blender command
        cmd = [
            self.blender_path,
            "--background",
            "--python",
            str(script_path),
            "--",
            str(input_file),
            str(output_file),
        ]

        if self.preserve_hierarchy:
            cmd.append("--create-root")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minutes per file
            )

            if result.returncode == 0:
                print(f"✓ Success: {output_file.name}")
                return True
            else:
                print(f"✗ Failed: {input_file.name}")
                print(f"Error: {result.stderr}")
                return False

        except subprocess.TimeoutExpired:
            print(f"✗ Timeout: {input_file.name}")
            return False
        except Exception as e:
            print(f"✗ Error: {e}")
            return False

    def convert_all(self):
        """Convert all files in batch"""
        files = self.find_max_files()

        if not files:
            print(f"No .max or .3ds files found in {self.input_dir}")
            return

        print(f"\nFound {len(files)} files to convert")
        print(f"Output format: {self.format.upper()}")
        print(f"Output directory: {self.output_dir}")

        results = {"total": len(files), "success": 0, "failed": 0, "files": []}

        for i, input_file in enumerate(files, 1):
            print(f"\n[{i}/{len(files)}]")

            success = self.convert_file(input_file)

            results["files"].append(
                {"input": str(input_file), "status": "success" if success else "failed"}
            )

            if success:
                results["success"] += 1
            else:
                results["failed"] += 1

        # Save report
        report_path = self.output_dir / "conversion_report.json"
        with open(report_path, "w") as f:
            json.dump(results, f, indent=2)

        # Print summary
        print(f"\n{'=' * 60}")
        print("CONVERSION SUMMARY")
        print(f"{'=' * 60}")
        print(f"Total files: {results['total']}")
        print(f"✓ Successful: {results['success']}")
        print(f"✗ Failed: {results['failed']}")
        print(f"\nReport saved to: {report_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Batch convert .max files to .fbx/.glb with hierarchy preservation"
    )
    parser.add_argument("input_dir", help="Input directory containing .max files")
    parser.add_argument("output_dir", help="Output directory for converted files")
    parser.add_argument(
        "--format",
        choices=["fbx", "glb", "gltf"],
        default="fbx",
        help="Output format (default: fbx)",
    )
    parser.add_argument(
        "--no-hierarchy", action="store_true", help="Disable hierarchy preservation"
    )

    args = parser.parse_args()

    try:
        converter = BatchMaxConverter(
            args.input_dir,
            args.output_dir,
            format=args.format,
            preserve_hierarchy=not args.no_hierarchy,
        )
        converter.convert_all()
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
