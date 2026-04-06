#!/usr/bin/env python3
"""
Convert .max to .fbx using Autodesk FBX Converter via Wine
This is the most reliable method for Linux
"""

import subprocess
import sys
import os
from pathlib import Path


def install_fbx_converter():
    """Instructions to install Autodesk FBX Converter"""
    print("""
    === Installing Autodesk FBX Converter ===
    
    1. Download FBX Converter from Autodesk:
       https://www.autodesk.com/developer-network/platform-technologies/fbx-converter-archives
    
    2. Install via Wine:
       wine fbx20201_fbxconverter_win.exe
    
    3. Default install location (Wine):
       ~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.1/bin/FbxConverter.exe
    """)


def find_fbx_converter():
    """Find FBX Converter executable in Wine prefix"""
    possible_paths = [
        os.path.expanduser(
            "~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.1/bin/FbxConverter.exe"
        ),
        os.path.expanduser(
            "~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.2/bin/FbxConverter.exe"
        ),
        os.path.expanduser(
            "~/.wine/drive_c/Program Files/Autodesk/FBX/FBX Converter/2020.3/bin/FbxConverter.exe"
        ),
        os.path.expanduser(
            "~/.wine/drive_c/Program Files (x86)/Autodesk/FBX/FBX Converter/2020.1/bin/FbxConverter.exe"
        ),
    ]

    for path in possible_paths:
        if os.path.exists(path):
            return path

    return None


def convert_with_fbx_converter(input_file, output_file, converter_path):
    """Convert using Autodesk FBX Converter"""

    # Convert paths to Windows format for Wine
    input_win = subprocess.check_output(["winepath", "-w", input_file]).decode().strip()
    output_win = (
        subprocess.check_output(["winepath", "-w", output_file]).decode().strip()
    )

    cmd = [
        "wine",
        converter_path,
        input_win,
        output_win,
        "/sffFBX",  # Source file format
        "/dffFBX",  # Destination file format
        "/v",  # Verbose
    ]

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(result.stdout)
        print(f"✓ Successfully converted: {output_file}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Conversion failed: {e}")
        print(e.stderr)
        return False


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 max_to_fbx_wine.py input.max output.fbx")
        sys.exit(1)

    input_file = os.path.abspath(sys.argv[1])
    output_file = os.path.abspath(sys.argv[2])

    if not os.path.exists(input_file):
        print(f"Error: Input file not found: {input_file}")
        sys.exit(1)

    converter_path = find_fbx_converter()

    if not converter_path:
        print("✗ FBX Converter not found!")
        install_fbx_converter()
        sys.exit(1)

    print(f"Found FBX Converter: {converter_path}")
    success = convert_with_fbx_converter(input_file, output_file, converter_path)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
