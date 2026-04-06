#!/bin/bash
# Setup script for .max to .fbx conversion tools

echo "=== Setting up .max to .fbx Conversion Tools ==="
echo ""

# Detect Linux distribution
if [ -f /etc/os-release ]; then
	. /etc/os-release
	OS=$ID
else
	OS="unknown"
fi

echo "Detected OS: $OS"
echo ""

# Install system dependencies
echo "Installing system dependencies..."

case $OS in
ubuntu | debian)
	sudo apt-get update
	sudo apt-get install -y python3-pip python3-pyassimp libassimp-dev blender wine winetricks
	;;
fedora | rhel | centos)
	sudo dnf install -y python3-pip assimp assimp-devel blender wine
	;;
arch | manjaro)
	sudo pacman -S --noconfirm python-pip assimp blender wine
	;;
*)
	echo "Unknown distribution. Please install manually:"
	echo "  - Python 3"
	echo "  - Assimp library"
	echo "  - Blender"
	echo "  - Wine (optional)"
	;;
esac

# Install Python dependencies
echo ""
echo "Installing Python dependencies..."
pip3 install --user pyassimp

# Verify installations
echo ""
echo "=== Verification ==="

if command -v python3 &>/dev/null; then
	echo "✓ Python 3: $(python3 --version)"
else
	echo "✗ Python 3 not found"
fi

if command -v blender &>/dev/null; then
	echo "✓ Blender: $(blender --version 2>&1 | head -n1)"
else
	echo "✗ Blender not found"
fi

if command -v wine &>/dev/null; then
	echo "✓ Wine: $(wine --version)"
else
	echo "✗ Wine not found (optional)"
fi

if python3 -c "import pyassimp" 2>/dev/null; then
	echo "✓ PyAssimp installed"
else
	echo "✗ PyAssimp not found"
fi

# Make scripts executable
chmod +x max_to_fbx_blender.py
chmod +x max_to_fbx_wine.py
chmod +x max_to_fbx_assimp.py
chmod +x universal_max_converter.py

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Usage:"
echo "  ./universal_max_converter.py input.max output.fbx"
echo ""
echo "See MAX_TO_FBX_GUIDE.md for detailed instructions"
