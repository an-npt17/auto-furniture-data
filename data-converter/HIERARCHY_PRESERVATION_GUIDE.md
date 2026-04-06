# Converting .max House/Room Models with Hierarchy Preservation

## Problem
When importing .max files (houses/rooms with many related objects) into Blender, objects lose their parent-child relationships and become scattered, requiring manual grouping.

## Solution
Use specialized scripts that **preserve hierarchy, groups, and parent-child relationships** during conversion.

---

## Quick Start

### Method 1: Single File with Hierarchy (Recommended)

```bash
# Convert .max to .fbx (preserves all relationships)
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.fbx

# Convert to GLB (better for web/game engines)
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.glb

# Group objects by name prefix (Living_Room_*, Bedroom_*, etc.)
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.fbx --group-by-name
```

### Method 2: Batch Convert Entire Directory

```bash
# Convert all .max files in a folder
python3 batch_max_converter.py ./input_houses/ ./output_houses/ --format glb

# Results:
# input_houses/house1.max -> output_houses/house1.glb
# input_houses/house2.max -> output_houses/house2.glb
# input_houses/rooms/bedroom.max -> output_houses/rooms/bedroom.glb
```

### Method 3: GUI (Easiest)

```bash
# Install GUI dependencies (optional)
pip install PyQt5

# Run GUI
python3 max_converter_gui.py
```

Then:
1. Click "Select Input File"
2. Choose output format (FBX/GLB)
3. Check "Preserve hierarchy"
4. Click "Convert"

---

## What Gets Preserved

✅ **Preserved:**
- Parent-child relationships
- Object hierarchy
- Groups and collections
- Object transforms (position, rotation, scale)
- Materials and textures
- Animations (if any)
- Custom properties
- Empty objects (used for grouping)
- Cameras and lights

❌ **Not Preserved (3ds Max specific):**
- 3ds Max modifiers (converted to mesh)
- 3ds Max-specific plugins
- Some procedural materials
- XRef objects

---

## Understanding the Output

### Before (Scattered Objects):
```
Scene
├─ Chair_001
├─ Chair_002
├─ Table_001
├─ Wall_001
├─ Wall_002
└─ Floor_001
```

### After (Organized Hierarchy):
```
Scene
└─ SceneRoot
    ├─ Living_Room (Empty/Group)
    │   ├─ Chair_001
    │   ├─ Chair_002
    │   └─ Table_001
    ├─ Structure (Empty/Group)
    │   ├─ Wall_001
    │   ├─ Wall_002
    │   └─ Floor_001
    └─ Lighting (Empty/Group)
        ├─ Light_001
        └─ Light_002
```

---

## Advanced Usage

### 1. Group by Naming Convention

If your objects are named like:
- `Living_Room_Chair_001`
- `Living_Room_Table_001`
- `Bedroom_Bed_001`
- `Bedroom_Desk_001`

Use:
```bash
blender --background --python max_to_fbx_preserve_hierarchy.py -- \
    house.max house.fbx --group-by-name
```

This creates collections:
- `Living_Room` → Chair_001, Table_001
- `Bedroom` → Bed_001, Desk_001

### 2. Batch Convert with Options

```bash
# Convert directory, GLB format, preserve hierarchy
python3 batch_max_converter.py \
    ./source_models/ \
    ./converted_models/ \
    --format glb

# Check conversion report
cat converted_models/conversion_report.json
```

### 3. Convert and Import into Unity/Unreal

**For Unity:**
```bash
# Convert to FBX (Unity's preferred format)
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.fbx

# Import into Unity:
# - Drag house.fbx into Assets/
# - Hierarchy preserved automatically
```

**For Unreal Engine:**
```bash
# Convert to FBX
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.fbx

# Or GLB for Datasmith
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.glb
```

**For Web (Three.js, Babylon.js):**
```bash
# GLB is best for web
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.glb
```

---

## Troubleshooting

### Issue 1: "Objects still scattered after import"

**Cause:** .max file doesn't have hierarchy, or import failed

**Solution 1:** Use `--group-by-name` to auto-create hierarchy
```bash
blender --background --python max_to_fbx_preserve_hierarchy.py -- \
    house.max house.fbx --group-by-name
```

**Solution 2:** Convert to .3ds first (better compatibility)
```bash
# In 3ds Max (Windows):
# File > Export > Export to .3ds
# Then on Linux:
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.3ds house.fbx
```

### Issue 2: "Import failed - unsupported format"

**Cause:** .max file version too new

**Solutions:**
1. **Best:** Open in 3ds Max, save as older version (.3ds format)
2. Use Autodesk FBX Converter (Wine):
   ```bash
   python3 max_to_fbx_wine.py house.max house.fbx
   ```
3. Use online converter first

### Issue 3: "Materials/textures missing"

**Solution:** Use `embed_textures=True` (already enabled in script)

If still missing:
```bash
# Copy texture files to same directory as .max file
# Script will auto-find them
```

### Issue 4: "Conversion timeout"

**Cause:** File too large

**Solution:** Increase timeout in script
```python
# Edit max_to_fbx_preserve_hierarchy.py
timeout=300  # Change to 900 (15 minutes)
```

---

## Best Practices for House/Room Models

### 1. Prepare .max File (if you have access to 3ds Max)

In 3ds Max before exporting:
```
1. Group related objects
   - Select objects → Group → Create Group

2. Name objects consistently
   - Living_Room_Chair_001
   - Living_Room_Table_001
   - Bedroom_Bed_001

3. Link objects to parents
   - Select child → Link → Click parent

4. Export to intermediate format
   - File > Export > .3ds (best compatibility)
   - File > Export > .fbx (direct)
```

### 2. Verify Hierarchy After Conversion

```bash
# Open in Blender GUI to check
blender house.fbx

# Check hierarchy in Outliner (top-right panel)
# Should show nested structure, not flat list
```

### 3. Optimize for Target Platform

**For Unity/Unreal (Real-time):**
```bash
# FBX format, moderate poly count
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.fbx
```

**For Web (Performance critical):**
```bash
# GLB format, compressed
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.glb
# Then use gltf-pipeline to compress:
gltf-pipeline -i house.glb -o house_compressed.glb -d
```

**For Rendering (Quality priority):**
```bash
# Keep high poly, use FBX or glTF
blender --background --python max_to_fbx_preserve_hierarchy.py -- house.max house.gltf
```

---

## Script Options Reference

### max_to_fbx_preserve_hierarchy.py

```bash
blender --background --python max_to_fbx_preserve_hierarchy.py -- \
    INPUT OUTPUT [OPTIONS]

OPTIONS:
  --group-by-name    Auto-group objects by name prefix
  --create-root      Create SceneRoot parent (default: True)
  --format fbx|glb   Output format (auto-detected from extension)
```

### batch_max_converter.py

```bash
python3 batch_max_converter.py INPUT_DIR OUTPUT_DIR [OPTIONS]

OPTIONS:
  --format fbx|glb|gltf   Output format (default: fbx)
  --no-hierarchy          Disable hierarchy preservation
```

---

## Example Workflows

### Workflow 1: Single House Model

```bash
# 1. Convert with hierarchy
blender --background --python max_to_fbx_preserve_hierarchy.py -- \
    house_model.max house_model.fbx

# 2. Verify in Blender GUI
blender house_model.fbx

# 3. Use in your project
cp house_model.fbx /path/to/unity/project/Assets/Models/
```

### Workflow 2: Room Library

```bash
# Directory structure:
# rooms/
# ├── living_room.max
# ├── bedroom.max
# ├── kitchen.max
# └── bathroom.max

# Batch convert
python3 batch_max_converter.py rooms/ converted_rooms/ --format glb

# Result:
# converted_rooms/
# ├── living_room.glb
# ├── bedroom.glb
# ├── kitchen.glb
# ├── bathroom.glb
# └── conversion_report.json
```

### Workflow 3: Furniture Collection

```bash
# Objects named: Sofa_001, Sofa_002, Table_001, Chair_001, etc.

# Convert with auto-grouping
blender --background --python max_to_fbx_preserve_hierarchy.py -- \
    furniture_collection.max furniture_collection.fbx --group-by-name

# Opens with groups:
# - Sofa group (Sofa_001, Sofa_002)
# - Table group (Table_001)
# - Chair group (Chair_001)
```

---

## Performance Tips

### Large Files (>100MB)

```bash
# 1. Increase timeout
timeout=900  # 15 minutes

# 2. Convert in chunks (split by room in 3ds Max first)

# 3. Use GLB with compression
blender --background --python max_to_fbx_preserve_hierarchy.py -- \
    large_house.max large_house.glb
```

### Many Small Files

```bash
# Use batch converter with parallel processing
# (Add to batch_max_converter.py if needed)
python3 batch_max_converter.py rooms/ output/ --format fbx
```

---

## Integration Examples

### Three.js (Web)

```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const loader = new GLTFLoader();
loader.load('house.glb', (gltf) => {
    const model = gltf.scene;
    
    // Hierarchy preserved!
    console.log(model.children); // Shows room groups
    
    scene.add(model);
});
```

### Unity

```csharp
// Drag house.fbx into Assets/Models/
// Hierarchy automatically preserved in prefab

GameObject house = Instantiate(housePrefab);
Transform livingRoom = house.transform.Find("Living_Room");
```

### Blender Python (Post-processing)

```python
import bpy

# Load converted file
bpy.ops.import_scene.fbx(filepath="house.fbx")

# Access hierarchy
for obj in bpy.data.objects:
    if obj.parent:
        print(f"{obj.name} is child of {obj.parent.name}")
```

---

## File Format Comparison

| Feature | FBX | GLB | glTF |
|---------|-----|-----|------|
| Hierarchy | ✅ | ✅ | ✅ |
| Unity support | ✅✅ | ✅ | ✅ |
| Unreal support | ✅✅ | ✅ | ✅ |
| Web support | ⚠️ | ✅✅ | ✅✅ |
| File size | Large | Small | Medium |
| Texture embed | ✅ | ✅ | ⚠️ |
| Animation | ✅✅ | ✅ | ✅ |
| Binary | Yes | Yes | No (JSON) |

**Recommendation:**
- **Unity/Unreal:** FBX
- **Web:** GLB
- **Distribution:** glTF

---

## Next Steps

1. **Test with one file first:**
   ```bash
   blender --background --python max_to_fbx_preserve_hierarchy.py -- test.max test.fbx
   ```

2. **Verify hierarchy in Blender GUI:**
   ```bash
   blender test.fbx
   # Check Outliner panel (top right)
   ```

3. **If good, batch convert:**
   ```bash
   python3 batch_max_converter.py ./all_models/ ./converted/ --format fbx
   ```

4. **Import into your target engine and verify**

---

## Support & Resources

- **Blender Manual:** https://docs.blender.org/manual/en/latest/
- **FBX Format:** https://www.autodesk.com/products/fbx/overview
- **glTF Format:** https://www.khronos.org/gltf/

For issues, check the conversion log and error messages.
