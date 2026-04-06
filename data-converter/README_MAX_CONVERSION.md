# .max to FBX/GLB Converter - Complete Solution

## Your Problem Solved! 🎉

**Problem:** Converting .max files (houses/rooms) to FBX/GLB causes objects to become scattered and lose their parent-child relationships.

**Solution:** Use the specialized scripts I created that **preserve hierarchy, groups, and all relationships**.

---

## ⚡ Quick Start (Choose Your Method)

### Method 1: Simple Command (Recommended) ⭐

```bash
# Basic usage
./convert_max.sh house.max

# Specify format
./convert_max.sh house.max --format glb

# Auto-group by object names
./convert_max.sh house.max --group-by-name

# Launch GUI
./convert_max.sh --gui
```

### Method 2: GUI (Easiest for Beginners)

```bash
python3 max_converter_gui.py
```

Then click buttons to select file and convert!

### Method 3: Batch Processing (For Multiple Files)

```bash
# Convert entire directory
python3 batch_max_converter.py ./input_houses/ ./output_houses/ --format glb
```

---

## 📁 What I Created for You

| File | Purpose |
|------|---------|
| **convert_max.sh** | ⭐ **START HERE** - Simple wrapper script |
| **max_to_fbx_preserve_hierarchy.py** | Main conversion engine (preserves hierarchy) |
| **batch_max_converter.py** | Batch convert entire directories |
| **max_converter_gui.py** | Graphical interface |
| **QUICK_REFERENCE.txt** | One-page cheat sheet |
| **HIERARCHY_PRESERVATION_GUIDE.md** | Detailed guide for house/room models |
| **MAX_TO_FBX_GUIDE.md** | General .max conversion guide |

**Legacy scripts** (older methods):
- `max_to_fbx_blender.py` - Basic Blender conversion
- `max_to_fbx_assimp.py` - Using Assimp library
- `max_to_fbx_wine.py` - Using Windows FBX Converter
- `universal_max_converter.py` - Tries all methods
- `setup_max_converter.sh` - Install dependencies

---

## 🎯 How It Solves Your Problem

### Before (Scattered Objects)
```
Import house.max → Blender
Result: 200+ objects in flat list
├─ Chair_001
├─ Chair_002
├─ Table_001
├─ Wall_001
└─ ... (no organization)
```

### After (Organized Hierarchy) ✅
```
Convert with hierarchy preservation
Result: Organized structure
└─ SceneRoot
    ├─ Living_Room
    │   ├─ Chair_001
    │   ├─ Chair_002
    │   └─ Table_001
    ├─ Kitchen
    │   ├─ Counter
    │   └─ Sink
    └─ Bedroom
        └─ ...
```

**All parent-child relationships, groups, and positions are preserved!**

---

## 🚀 Getting Started (5 Minutes)

### Step 1: Test with One File

```bash
# Make sure you have a .max file
# If not, you can test with .3ds or .obj first

./convert_max.sh your_house.max
```

### Step 2: Verify the Output

```bash
# Open in Blender GUI to check hierarchy
blender your_house.fbx

# Look at the Outliner panel (top-right)
# You should see a tree structure, not a flat list
```

### Step 3: Use in Your Project

```bash
# For Unity
cp your_house.fbx /path/to/unity/Assets/Models/

# For Web (Three.js, Babylon.js)
./convert_max.sh your_house.max --format glb
# Use your_house.glb in your web app

# For Unreal Engine
# Import your_house.fbx via Content Browser
```

---

## 🎨 Special Features for House/Room Models

### 1. Auto-Grouping by Name

If your objects are named like:
- `Living_Room_Chair_001`
- `Living_Room_Table_001`
- `Bedroom_Bed_001`

```bash
./convert_max.sh house.max --group-by-name
```

Result: Automatically creates groups:
- `Living_Room` containing Chair_001, Table_001
- `Bedroom` containing Bed_001

### 2. Preserve All Relationships

✅ What gets preserved:
- Parent-child object links
- Groups and collections
- Object transforms (position, rotation, scale)
- Materials and textures (embedded)
- Animations
- Cameras and lights
- Empty objects (used for grouping)

### 3. Multiple Output Formats

```bash
# FBX (best for Unity/Unreal)
./convert_max.sh house.max --format fbx

# GLB (best for Web)
./convert_max.sh house.max --format glb

# glTF (for distribution)
./convert_max.sh house.max --format gltf
```

---

## 📖 Documentation

### Quick Help
```bash
# Show available options
./convert_max.sh

# Read quick reference
cat QUICK_REFERENCE.txt

# Open full guide
less HIERARCHY_PRESERVATION_GUIDE.md
```

### Full Guides Included

1. **QUICK_REFERENCE.txt** - One-page cheat sheet
2. **HIERARCHY_PRESERVATION_GUIDE.md** - Detailed guide for house/room models
3. **MAX_TO_FBX_GUIDE.md** - General .max conversion info

---

## 🔧 Troubleshooting

### Problem: "Objects still scattered"
```bash
# Solution 1: Use auto-grouping
./convert_max.sh house.max --group-by-name

# Solution 2: Convert to .3ds first (better compatibility)
# In 3ds Max: File > Export > .3ds
# Then: ./convert_max.sh house.3ds --format fbx
```

### Problem: "Import failed"
```bash
# .max files have limited Linux support
# Best solution: Export from 3ds Max as .3ds or .fbx first
# Alternative: Use Wine method
python3 max_to_fbx_wine.py house.max house.fbx
```

### Problem: "Missing textures"
```bash
# Copy texture files to same directory as .max file
# Script will auto-find and embed them
```

---

## 💡 Best Practices

### For Best Results:

1. **If you have access to 3ds Max (Windows):**
   - Export as .3ds format (best compatibility)
   - Or export directly as .fbx
   - Then convert on Linux if needed

2. **Naming Convention:**
   - Use consistent prefixes: `Room_ObjectType_Number`
   - Example: `Living_Room_Chair_001`
   - Enables auto-grouping feature

3. **Organization in 3ds Max:**
   - Group related objects before export
   - Link child objects to parents
   - Clean up unused objects

4. **File Size:**
   - For large files (>100MB), use GLB format
   - Or split into multiple files by room

---

## 🎯 Common Workflows

### Workflow 1: Single House Model
```bash
./convert_max.sh modern_house.max
blender modern_house.fbx  # Verify
cp modern_house.fbx ~/UnityProject/Assets/Models/
```

### Workflow 2: Room Library
```bash
python3 batch_max_converter.py ./all_rooms/ ./converted/ --format glb
# Check report
cat converted/conversion_report.json
```

### Workflow 3: Web Application
```bash
./convert_max.sh apartment.max --format glb
# Use apartment.glb in Three.js/Babylon.js
```

---

## 🌟 Key Advantages of This Solution

1. **Hierarchy Preservation** - Parent-child relationships maintained
2. **Batch Processing** - Convert entire directories at once
3. **Multiple Formats** - FBX, GLB, glTF support
4. **Auto-Grouping** - Smart organization by object names
5. **Cross-Platform** - Works on any Linux distribution
6. **GUI Option** - For users who prefer visual interface
7. **Well-Documented** - Comprehensive guides included

---

## 📊 Format Recommendations

| Use Case | Format | Command |
|----------|--------|---------|
| Unity | FBX | `./convert_max.sh model.max --format fbx` |
| Unreal Engine | FBX | `./convert_max.sh model.max --format fbx` |
| Web (Three.js) | GLB | `./convert_max.sh model.max --format glb` |
| Blender | FBX/GLB | `./convert_max.sh model.max --format fbx` |
| Distribution | glTF | `./convert_max.sh model.max --format gltf` |

---

## 🚦 Next Steps

1. **Test with one file:**
   ```bash
   ./convert_max.sh test.max
   ```

2. **Verify in Blender:**
   ```bash
   blender test.fbx
   # Check hierarchy in Outliner panel
   ```

3. **If satisfied, batch convert:**
   ```bash
   python3 batch_max_converter.py ./all_models/ ./converted/ --format fbx
   ```

4. **Import into your target platform and enjoy!**

---

## 🆘 Need Help?

1. **Read the quick reference:**
   ```bash
   cat QUICK_REFERENCE.txt
   ```

2. **Check full documentation:**
   ```bash
   less HIERARCHY_PRESERVATION_GUIDE.md
   ```

3. **Run with debug output:**
   ```bash
   blender --python max_to_fbx_preserve_hierarchy.py -- test.max test.fbx
   ```

4. **Test with simpler format first:**
   ```bash
   # If .max doesn't work, try with .3ds or .obj
   ./convert_max.sh test.3ds
   ```

---

## 📝 Summary

You now have a **complete toolkit** for converting .max files to FBX/GLB with **full hierarchy preservation**. This solves your problem of scattered objects when importing house/room models.

**Start here:** `./convert_max.sh your_file.max`

All the complexity is handled for you while preserving your carefully organized scene structure! 🎉

---

**Created for:** Converting architectural models (houses, rooms, furniture) from .max format  
**Platform:** Linux (tested with Blender installed)  
**License:** Free to use and modify
