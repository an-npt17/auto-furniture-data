# Quick Start Guide

## Starting the GLB Viewer

Run one of these commands in the `glb-viewer` folder:

```bash
# Option 1: Regular start
bun start

# Option 2: Hot reload during development
bun dev

# Option 3: Direct command
bun run index.ts
```

The server will start at **http://localhost:3000**

## Adding GLB Files

### Method 1: Upload via Browser
1. Open http://localhost:3000
2. Click "Upload GLB" button
3. Select your `.glb` file

### Method 2: Use Models Folder
1. Copy your `.glb` files to the `models/` folder
2. In the browser, enter the path in the URL field: `/models/your-file.glb`
3. Click "Load"

### Method 3: Remote URL
1. Enter any public URL to a GLB file
2. Click "Load"

## Example GLB Models to Test

Try these free models:
- https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb
- https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BoxAnimated/glTF-Binary/BoxAnimated.glb

## Viewer Controls

| Action | Input |
|--------|-------|
| Rotate model | Left click + drag |
| Pan/move | Right click + drag |
| Zoom | Mouse wheel |
| Change background | Use color picker in top bar |

## Troubleshooting

**Port 3000 already in use?**
Edit `index.ts` and change the port number:
```typescript
port: 3001,  // or any available port
```

**Model not loading?**
- Check browser console (F12) for errors
- Ensure the file is a valid `.glb` or `.gltf` file
- For local files, make sure they're in the `models/` folder

**TypeScript errors?**
Run this command to check:
```bash
bun run --bun tsc --noEmit
```
