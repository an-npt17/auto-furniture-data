# .max to .fbx Conversion Guide for Linux

## Overview

This guide provides multiple methods to convert Autodesk .max files to .fbx format on Linux.

## Methods (in order of reliability)

### Method 1: Universal Converter (Recommended)
**Best choice - tries all available methods automatically**

```bash
# Install dependencies (choose one or more)
pip install pyassimp
# or
sudo apt-get install python3-pyassimp libassimp-dev

# Convert
python3 universal_max_converter.py input.max output.fbx
```

### Method 2: Assimp (Python)
**Most compatible with various formats**

```bash
# Install
pip install pyassimp
# or
sudo apt-get install python3-pyassimp libassimp-dev

# Convert
python3 max_to_fbx_assimp.py input.max output.fbx
```

### Method 3: Blender
**Good for .3ds and some .max files**

```bash
# Blender is already installed on your system

# Using the script
blender --background --python max_to_fbx_blender.py -- input.max output.fbx

# Or using Blender GUI
blender
# Then: File > Import > Autodesk 3DS
# Then: File > Export > FBX
```

### Method 4: Autodesk FBX Converter (via Wine)
**Most reliable for .max files, but requires setup**

```bash
# 1. Download FBX Converter
wget https://damassets.autodesk.net/content/dam/autodesk/www/adn/fbx/2020-1/fbx20201_fbxconverter_win.exe

# 2. Install via Wine
wine fbx20201_fbxconverter_win.exe

# 3. Convert
python3 max_to_fbx_wine.py input.max output.fbx
```

---

## Troubleshooting

### .max Files Have Limited Linux Support

**.max files are proprietary** and not fully supported on Linux. Here are workarounds:

#### Option A: Convert to intermediate format first
If you have access to Windows/3ds Max:
1. Open .max file in 3ds Max
2. Export as .3ds or .obj
3. Then convert .3ds → .fbx on Linux

#### Option B: Use online converters
- AnyConv: https://anyconv.com/max-to-fbx-converter/
- CloudConvert: https://cloudconvert.com/max-to-fbx
- Aspose: https://products.aspose.app/3d/conversion/max-to-fbx

#### Option C: Use Windows VM
```bash
# Install VirtualBox or QEMU/KVM
sudo apt-get install virtualbox

# Install Windows + 3ds Max in VM
# Then export .max → .fbx manually
```

---

## Quick Start Examples

### Single file conversion:
```bash
python3 universal_max_converter.py model.max model.fbx
```

### Batch conversion:
```bash
# Convert all .max files in a directory
for file in *.max; do
    python3 universal_max_converter.py "$file" "${file%.max}.fbx"
done
```

### Check available methods:
```bash
python3 universal_max_converter.py
```

---

## Dependencies Installation

### Ubuntu/Debian:
```bash
sudo apt-get update
sudo apt-get install -y \
    blender \
    python3-pip \
    python3-pyassimp \
    libassimp-dev \
    wine \
    winetricks
```

### Fedora/RHEL:
```bash
sudo dnf install -y \
    blender \
    python3-pip \
    assimp \
    assimp-devel \
    wine
```

### Arch Linux:
```bash
sudo pacman -S \
    blender \
    python-pip \
    assimp \
    wine
```

### Python packages:
```bash
pip install pyassimp
```

---

## File Format Compatibility

| Format | Read | Write | Notes |
|--------|------|-------|-------|
| .max   | ⚠️   | ❌    | Limited support, use .3ds instead |
| .3ds   | ✅   | ✅    | Best intermediate format |
| .fbx   | ✅   | ✅    | Target format |
| .obj   | ✅   | ✅    | Good alternative |
| .dae   | ✅   | ✅    | COLLADA format |
| .blend | ✅   | ✅    | Blender native |
| .gltf  | ✅   | ✅    | Modern web format |

---

## Advanced Usage

### Custom FBX export settings (Blender):
```python
bpy.ops.export_scene.fbx(
    filepath="output.fbx",
    use_selection=False,
    global_scale=1.0,
    apply_unit_scale=True,
    bake_anim=True,
    embed_textures=True,
    axis_forward='-Z',
    axis_up='Y'
)
```

### Assimp with custom flags:
```python
import pyassimp
scene = pyassimp.load(
    "input.max",
    processing=pyassimp.postprocess.aiProcess_Triangulate |
               pyassimp.postprocess.aiProcess_FlipUVs
)
```

---

## Known Limitations

1. **.max format is proprietary** - no perfect open-source converter exists
2. **Version compatibility** - newer .max versions may not work
3. **Materials/textures** - may require manual adjustment after conversion
4. **Animations** - complex animations may not transfer perfectly
5. **Plugins** - 3ds Max plugin effects won't convert

---

## Recommended Workflow

```
Option 1 (Best):
.max → (3ds Max) → .fbx

Option 2 (Good):
.max → (3ds Max) → .3ds → (Linux tools) → .fbx

Option 3 (Fair):
.max → (Universal Converter) → .fbx
```

---

## Support

For issues or questions, check:
- Blender: https://www.blender.org/support/
- Assimp: https://github.com/assimp/assimp
- FBX SDK: https://www.autodesk.com/developer-network/platform-technologies/fbx-sdk
