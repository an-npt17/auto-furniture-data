#!/bin/bash
# Simple wrapper for converting .max files with hierarchy preservation
# Usage: ./convert_max.sh input.max [output.fbx] [options]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if blender is installed
if ! command -v blender &>/dev/null; then
	echo -e "${RED}Error: Blender not found${NC}"
	echo "Install with: sudo apt-get install blender"
	exit 1
fi

# Check arguments
if [ $# -lt 1 ]; then
	echo "Usage: $0 input.max [output.fbx] [options]"
	echo ""
	echo "Options:"
	echo "  --format fbx|glb|gltf    Output format (default: fbx)"
	echo "  --group-by-name          Group objects by name prefix"
	echo "  --gui                    Open in GUI mode"
	echo ""
	echo "Examples:"
	echo "  $0 house.max                          # Convert to house.fbx"
	echo "  $0 house.max house.glb                # Convert to GLB"
	echo "  $0 house.max --format glb             # Convert to GLB (auto-named)"
	echo "  $0 house.max --group-by-name          # Auto-group by naming"
	echo "  $0 --gui                              # Open GUI"
	exit 1
fi

# Parse arguments
INPUT_FILE=""
OUTPUT_FILE=""
FORMAT="fbx"
GROUP_BY_NAME=""
GUI_MODE=false

for arg in "$@"; do
	case $arg in
	--format)
		shift
		FORMAT="$1"
		shift
		;;
	--group-by-name)
		GROUP_BY_NAME="--group-by-name"
		shift
		;;
	--gui)
		GUI_MODE=true
		shift
		;;
	*)
		if [ -z "$INPUT_FILE" ]; then
			INPUT_FILE="$arg"
		elif [ -z "$OUTPUT_FILE" ]; then
			OUTPUT_FILE="$arg"
		fi
		shift
		;;
	esac
done

# GUI mode
if [ "$GUI_MODE" = true ]; then
	echo -e "${GREEN}Launching GUI...${NC}"
	python3 max_converter_gui.py
	exit 0
fi

# Check input file
if [ ! -f "$INPUT_FILE" ]; then
	echo -e "${RED}Error: Input file not found: $INPUT_FILE${NC}"
	exit 1
fi

# Auto-generate output file if not provided
if [ -z "$OUTPUT_FILE" ]; then
	BASENAME="${INPUT_FILE%.*}"
	OUTPUT_FILE="${BASENAME}.${FORMAT}"
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONVERTER_SCRIPT="${SCRIPT_DIR}/max_to_fbx_preserve_hierarchy.py"

if [ ! -f "$CONVERTER_SCRIPT" ]; then
	echo -e "${RED}Error: Converter script not found: $CONVERTER_SCRIPT${NC}"
	exit 1
fi

# Print info
echo -e "${GREEN}=== .max to ${FORMAT^^} Converter ===${NC}"
echo "Input:  $INPUT_FILE"
echo "Output: $OUTPUT_FILE"
echo "Format: ${FORMAT^^}"
if [ -n "$GROUP_BY_NAME" ]; then
	echo "Options: Group by name prefix"
fi
echo ""

# Run conversion
echo -e "${YELLOW}Converting... (this may take a while)${NC}"

blender --background \
	--python "$CONVERTER_SCRIPT" \
	-- \
	"$INPUT_FILE" \
	"$OUTPUT_FILE" \
	$GROUP_BY_NAME

# Check if successful
if [ -f "$OUTPUT_FILE" ]; then
	FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
	echo -e "${GREEN}✓ Conversion successful!${NC}"
	echo "Output: $OUTPUT_FILE ($FILE_SIZE)"
	echo ""
	echo "Next steps:"
	echo "  1. Verify: blender $OUTPUT_FILE"
	echo "  2. Import into your 3D software/game engine"
else
	echo -e "${RED}✗ Conversion failed${NC}"
	exit 1
fi
