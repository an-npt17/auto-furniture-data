# GLB Viewer — Mesh Selection, Transform & Export Design

**Date:** 2026-04-06
**Status:** Approved

---

## Overview

Extend the existing Bun + Three.js GLB viewer with three new capabilities:
1. **Mesh selection** — click in viewport or check in sidebar tree
2. **Transform editing** — move and rotate selected mesh (no scale) via TransformControls
3. **Export** — export selected meshes as a new `.glb` file, or export their positions/rotations as `.json`

---

## Architecture

Split the current monolithic `viewer.ts` into focused modules. Each file stays within 200–400 lines.

```
src/
├── viewer.ts        # Scene, camera, renderer, lighting, animation loop
├── selector.ts      # Raycasting click-to-select, hover highlight, SelectionStore
├── transformer.ts   # TransformControls attach/detach, translate/rotate mode toggle
├── exporter.ts      # GLTFExporter: export selected meshes → .glb or .json download
├── panel.ts         # Left sidebar: object tree, checkboxes, live position display
└── main.ts          # Entry point: wires all modules, owns SelectionStore instance
public/
└── index.html       # Updated layout with sidebar + toolbar
```

### SelectionStore

A plain shared object passed by reference to all modules:

```ts
interface SelectionStore {
  checked: Set<string>;   // mesh UUIDs checked for export
  active: string | null;  // UUID of the mesh currently holding TransformControls
}
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Load File]  [Translate] [Rotate]  [Export GLB] [Export JSON]│
├──────────────┬──────────────────────────────────────────────┤
│ Object Tree  │                                              │
│ ☐ Chair      │                                              │
│   ☐ Seat     │           3D Viewport                        │
│   ☑ Back     │        (Three.js canvas)                     │
│   ☑ Leg_1    │                                              │
│   ☐ Leg_2    │                                              │
│              │                                              │
│ ──────────── │                                              │
│ Active Object│                                              │
│ x:  1.23     │                                              │
│ y:  0.00     │                                              │
│ z: -0.45     │                                              │
│ rx: 0.00°    │                                              │
│ ry: 45.0°    │                                              │
│ rz: 0.00°    │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

---

## Module Responsibilities

### `viewer.ts`
- Owns `THREE.Scene`, `PerspectiveCamera`, `WebGLRenderer`, `OrbitControls`
- Exposes `loadModel(url): Promise<THREE.Group>` — returns the loaded scene graph
- Exposes `getScene()`, `getCamera()`, `getRenderer()` for other modules
- Disables `OrbitControls` while TransformControls is dragging (prevents conflicts)

### `selector.ts`
- Listens for `pointerdown` on the canvas via `THREE.Raycaster`
- On click: sets `store.active` to the hit mesh UUID, adds to `store.checked`
- Applies a highlight material (emissive overlay) to the active mesh
- Exposes `setActive(uuid)` so `panel.ts` can trigger selection from the tree

### `transformer.ts`
- Owns `TransformControls` instance, added to the scene
- Watches `store.active`: attaches controls to the corresponding mesh
- Exposes `setMode('translate' | 'rotate')` — called by toolbar buttons
- Scale is never exposed or changed
- Fires `store` update on drag end so `panel.ts` refreshes position display

### `panel.ts`
- Reads the loaded scene graph and builds the object tree HTML
- Checkbox change → updates `store.checked`, triggers export button state
- Tree item click → calls `selector.setActive(uuid)`
- Polls (via `requestAnimationFrame` callback from `viewer`) to refresh position/rotation display for `store.active`
- Mesh with empty name → displayed as `Mesh_<index>`

### `exporter.ts`
- **Export GLB**: clones all meshes in `store.checked`, passes to `GLTFExporter.parse()`, triggers browser download of the binary blob as `export.glb`
- **Export JSON**: collects `{ name, uuid, position: {x,y,z}, rotation: {x,y,z} }` for each checked mesh using `getWorldPosition` / `getWorldQuaternion` converted to Euler degrees, downloads as `positions.json`
- Both export buttons are disabled when `store.checked` is empty

### `main.ts`
- Instantiates `SelectionStore`
- Instantiates all modules in order, passing shared dependencies
- Wires toolbar button events to `transformer.setMode()` and `exporter` methods
- Wires `viewer.loadModel()` result to `panel.buildTree()`

---

## Key Behaviors

| Action | Result |
|---|---|
| Click mesh in viewport | Sets as active (TransformControls attach) + adds to checked + highlights in tree |
| Click empty space | Deactivates TransformControls, clears active highlight |
| Check item in tree | Adds to `store.checked` (export set), does not change active |
| Click item label in tree | Sets as active (same as viewport click) |
| Translate button | `transformer.setMode('translate')` |
| Rotate button | `transformer.setMode('rotate')` |
| Export GLB (checked items) | Downloads `export.glb` with cloned selected meshes |
| Export JSON (checked items) | Downloads `positions.json` with world position + rotation |
| Export with nothing checked | Buttons disabled, tooltip: "Select at least one object" |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| GLB load failure | Error toast displayed in viewport overlay |
| Model with zero geometry | Alert: "Model has no geometry" (existing behavior retained) |
| Mesh with no name | Label falls back to `Mesh_<index>` |
| Export GLB with 0 checked | Button disabled |
| GLTFExporter failure | Console error + user-facing toast |

---

## Out of Scope

- Scale editing (explicitly excluded)
- Multi-object simultaneous transform (single active object only)
- Undo/redo
- Animation playback editing
- Material editing
