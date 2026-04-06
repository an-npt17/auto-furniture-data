# GLB Viewer — Mesh Selection, Transform & Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Bun + Three.js GLB viewer with mesh selection (viewport click + sidebar tree), move/rotate transforms (no scale), and export selected meshes as `.glb` or position data as `.json`.

**Architecture:** Split the current monolithic `viewer.ts` into six focused modules (`viewer`, `selector`, `transformer`, `exporter`, `panel`, `main`) sharing a lightweight `SelectionStore`. `main.ts` becomes the browser entry point and wires all modules together.

**Tech Stack:** Bun, TypeScript, Three.js 0.183.2 (`TransformControls`, `GLTFExporter`, `Raycaster`), HTML/CSS (no frameworks)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/store.ts` | **Create** | `SelectionStore` interface + `createStore()` factory |
| `src/viewer.ts` | **Modify** | Scene/camera/renderer — remove DOM wiring, add getters + frame/load callbacks |
| `src/selector.ts` | **Create** | Raycasting click-to-select, highlight, `setActive()` |
| `src/transformer.ts` | **Create** | `TransformControls` attach/detach, translate/rotate mode |
| `src/exporter.ts` | **Create** | `GLTFExporter` → `.glb` download; world positions → `.json` download |
| `src/panel.ts` | **Create** | Left sidebar: object tree, checkboxes, live position display |
| `src/main.ts` | **Create** | Entry point: DOM setup, toolbar events, module wiring |
| `public/index.html` | **Modify** | New layout: toolbar + sidebar + viewport (replaces existing) |
| `index.ts` | **Modify** | Change Bun.build entrypoint from `viewer.ts` → `main.ts` |
| `tests/store.test.ts` | **Create** | Unit tests for `SelectionStore` |
| `tests/exporter.test.ts` | **Create** | Unit tests for `buildPositionEntries()` (pure function) |
| `tests/panel.test.ts` | **Create** | Unit tests for `resolveMeshName()` (pure function) |

---

## Task 1: Create SelectionStore

**Files:**
- Create: `src/store.ts`
- Create: `tests/store.test.ts`

- [ ] **Step 1: Create `src/store.ts`**

```ts
// src/store.ts

export interface SelectionStore {
  checked: Set<string>;  // mesh UUIDs selected for export
  active: string | null; // UUID of the mesh currently held by TransformControls
}

export function createStore(): SelectionStore {
  return {
    checked: new Set(),
    active: null,
  };
}
```

- [ ] **Step 2: Write tests**

```ts
// tests/store.test.ts
import { test, expect } from "bun:test";
import { createStore } from "../src/store";

test("createStore returns empty checked set and null active", () => {
  const store = createStore();
  expect(store.checked.size).toBe(0);
  expect(store.active).toBeNull();
});

test("store.checked can add and remove UUIDs", () => {
  const store = createStore();
  store.checked.add("uuid-1");
  expect(store.checked.has("uuid-1")).toBe(true);
  store.checked.delete("uuid-1");
  expect(store.checked.has("uuid-1")).toBe(false);
});

test("store.active can be set and cleared", () => {
  const store = createStore();
  store.active = "uuid-abc";
  expect(store.active).toBe("uuid-abc");
  store.active = null;
  expect(store.active).toBeNull();
});
```

- [ ] **Step 3: Run tests — expect PASS (pure logic, no WebGL)**

```bash
cd /home/annpt/LLM-Blockchain/auto-furniture-data/glb-viewer
bun test tests/store.test.ts
```

Expected:
```
✓ createStore returns empty checked set and null active
✓ store.checked can add and remove UUIDs
✓ store.active can be set and cleared
3 pass, 0 fail
```

- [ ] **Step 4: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat(store): add SelectionStore type and factory"
```

---

## Task 2: Refactor viewer.ts

Remove the `DOMContentLoaded` block (moves to `main.ts`). Add getters, `onFrame()`, and `onModelLoad()` callbacks. Tag loaded meshes with `userData.isSceneMesh = true` so the selector can filter out TransformControls gizmo objects.

**Files:**
- Modify: `src/viewer.ts` (full replacement)

- [ ] **Step 1: Replace `src/viewer.ts`**

```ts
// src/viewer.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class GLBViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private loader: GLTFLoader;
  private currentModel: THREE.Object3D | null = null;
  private frameCallbacks: Array<() => void> = [];
  private modelLoadCallbacks: Array<(scene: THREE.Group) => void> = [];

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2a2a);

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(2, 2, 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 5);
    dir1.castShadow = true;
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-5, 5, -5);
    this.scene.add(dir2);

    this.scene.add(new THREE.GridHelper(10, 10));

    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(dracoLoader);

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();
  }

  getScene(): THREE.Scene { return this.scene; }
  getCamera(): THREE.PerspectiveCamera { return this.camera; }
  getRenderer(): THREE.WebGLRenderer { return this.renderer; }
  getCanvas(): HTMLCanvasElement { return this.renderer.domElement; }
  getOrbitControls(): OrbitControls { return this.controls; }

  /** Register a callback invoked every animation frame (for live panel updates). */
  onFrame(cb: () => void): void {
    this.frameCallbacks.push(cb);
  }

  /** Register a callback invoked after a model loads successfully. */
  onModelLoad(cb: (scene: THREE.Group) => void): void {
    this.modelLoadCallbacks.push(cb);
  }

  loadModel(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.currentModel) {
        this.scene.remove(this.currentModel);
        this.currentModel = null;
      }

      const loadingEl = document.getElementById('loading-indicator');
      const progressEl = document.getElementById('loading-progress');
      loadingEl?.classList.add('active');

      this.loader.load(
        url,
        (gltf) => {
          this.currentModel = gltf.scene;

          this.currentModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              // Tag so selector can distinguish model meshes from gizmos
              mesh.userData.isSceneMesh = true;
              if (!mesh.material) {
                mesh.material = new THREE.MeshStandardMaterial({ color: 0x808080 });
              }
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          this.scene.add(this.currentModel);

          const box = new THREE.Box3().setFromObject(this.currentModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          if (size.x === 0 && size.y === 0 && size.z === 0) {
            loadingEl?.classList.remove('active');
            reject(new Error('Model has no geometry'));
            return;
          }

          this.currentModel.position.sub(center);
          const maxDim = Math.max(size.x, size.y, size.z);
          this.currentModel.scale.multiplyScalar(2 / maxDim);

          const distance = maxDim * 1.5;
          this.camera.position.set(distance, distance, distance);
          this.controls.target.set(0, 0, 0);
          this.controls.update();

          loadingEl?.classList.remove('active');
          this.modelLoadCallbacks.forEach(cb => cb(gltf.scene));
          resolve();
        },
        (progress) => {
          if (progress.total > 0 && progressEl) {
            progressEl.textContent = `${((progress.loaded / progress.total) * 100).toFixed(1)}%`;
          }
        },
        (error) => {
          loadingEl?.classList.remove('active');
          reject(error);
        }
      );
    });
  }

  private onWindowResize(): void {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.frameCallbacks.forEach(cb => cb());
    this.renderer.render(this.scene, this.camera);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/viewer.ts
git commit -m "refactor(viewer): expose getters, frame/load callbacks, tag scene meshes"
```

---

## Task 3: Create selector.ts

Raycasting on the canvas `pointerdown` event. Uses `userData.isSceneMesh` to ignore TransformControls gizmo objects.

**Files:**
- Create: `src/selector.ts`

Note: Depends on WebGL/canvas — tested manually in Task 10.

- [ ] **Step 1: Create `src/selector.ts`**

```ts
// src/selector.ts
import * as THREE from 'three';
import type { GLBViewer } from './viewer';
import type { SelectionStore } from './store';

export class Selector {
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private store: SelectionStore;
  private activeMesh: THREE.Mesh | null = null;
  private originalMaterial: THREE.Material | THREE.Material[] | null = null;
  private onSelectCallbacks: Array<(mesh: THREE.Mesh | null) => void> = [];

  constructor(viewer: GLBViewer, store: SelectionStore) {
    this.scene = viewer.getScene();
    this.camera = viewer.getCamera();
    this.canvas = viewer.getCanvas();
    this.store = store;
    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
  }

  /** Register a callback invoked when active selection changes. */
  onSelect(cb: (mesh: THREE.Mesh | null) => void): void {
    this.onSelectCallbacks.push(cb);
  }

  /**
   * Programmatically activate a mesh by UUID.
   * Called from panel tree label clicks.
   */
  setActive(uuid: string): void {
    const obj = this.scene.getObjectByProperty('uuid', uuid);
    if (obj && (obj as THREE.Mesh).isMesh) {
      this.applySelection(obj as THREE.Mesh);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    // Only hit meshes that belong to the loaded model (not gizmo helpers)
    const hit = intersects.find(
      i => (i.object as THREE.Mesh).isMesh && i.object.userData.isSceneMesh
    );

    if (hit) {
      this.applySelection(hit.object as THREE.Mesh);
    } else {
      this.clearActive();
    }
  }

  private applySelection(mesh: THREE.Mesh): void {
    this.restoreHighlight();

    // Store original material and apply emissive highlight clone
    this.originalMaterial = mesh.material;
    const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const highlighted = base.clone() as THREE.MeshStandardMaterial;
    if ('emissive' in highlighted) {
      highlighted.emissive = new THREE.Color(0x4488ff);
      highlighted.emissiveIntensity = 0.4;
    }
    mesh.material = highlighted;
    this.activeMesh = mesh;

    this.store.active = mesh.uuid;
    this.store.checked.add(mesh.uuid);
    this.onSelectCallbacks.forEach(cb => cb(mesh));
  }

  private clearActive(): void {
    this.restoreHighlight();
    this.store.active = null;
    this.onSelectCallbacks.forEach(cb => cb(null));
  }

  private restoreHighlight(): void {
    if (this.activeMesh && this.originalMaterial !== null) {
      this.activeMesh.material = this.originalMaterial;
    }
    this.activeMesh = null;
    this.originalMaterial = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/selector.ts
git commit -m "feat(selector): add raycasting mesh selection with emissive highlight"
```

---

## Task 4: Create transformer.ts

Wraps `TransformControls`. Disables `OrbitControls` while dragging to prevent conflicts. Only exposes `translate` and `rotate` modes — never `scale`.

**Files:**
- Create: `src/transformer.ts`

- [ ] **Step 1: Create `src/transformer.ts`**

```ts
// src/transformer.ts
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { GLBViewer } from './viewer';

export type TransformMode = 'translate' | 'rotate';

export class Transformer {
  private controls: TransformControls;
  private scene: THREE.Scene;

  constructor(viewer: GLBViewer) {
    this.scene = viewer.getScene();

    this.controls = new TransformControls(
      viewer.getCamera(),
      viewer.getCanvas()
    );
    this.controls.setMode('translate');
    this.scene.add(this.controls);

    // Disable OrbitControls while dragging to prevent camera/gizmo conflict
    this.controls.addEventListener('dragging-changed', (event) => {
      viewer.getOrbitControls().enabled = !(event as any).value;
    });
  }

  /** Attach TransformControls to the object matching uuid. */
  attachTo(uuid: string): void {
    const obj = this.scene.getObjectByProperty('uuid', uuid);
    if (obj) {
      this.controls.attach(obj as THREE.Object3D);
    }
  }

  /** Detach TransformControls (call when nothing is active). */
  detach(): void {
    this.controls.detach();
  }

  /** Switch between 'translate' and 'rotate'. Scale is never exposed. */
  setMode(mode: TransformMode): void {
    this.controls.setMode(mode);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/transformer.ts
git commit -m "feat(transformer): add TransformControls with translate/rotate modes"
```

---

## Task 5: Create exporter.ts

Two exports: (1) selected meshes cloned into a new scene → `.glb` download via `GLTFExporter`; (2) world positions/rotations of selected meshes → `.json` download. `buildPositionEntries()` is extracted as a pure function for testing.

**Files:**
- Create: `src/exporter.ts`
- Create: `tests/exporter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/exporter.test.ts
import { test, expect } from "bun:test";
import { buildPositionEntries } from "../src/exporter";

test("buildPositionEntries maps raw entries to PositionEntry shape", () => {
  const entries = buildPositionEntries([
    {
      name: "Chair",
      uuid: "uuid-1",
      position: { x: 1, y: 2, z: 3 },
      rotationDeg: { x: 0, y: 45, z: 0 },
    },
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0].name).toBe("Chair");
  expect(entries[0].uuid).toBe("uuid-1");
  expect(entries[0].position.x).toBe(1);
  expect(entries[0].rotation.y).toBe(45);
});

test("buildPositionEntries rounds values to 4 decimal places", () => {
  const entries = buildPositionEntries([
    {
      name: "Leg",
      uuid: "uuid-2",
      position: { x: 1.23456789, y: 0, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
    },
  ]);
  expect(entries[0].position.x).toBe(1.2346);
});

test("buildPositionEntries handles empty array", () => {
  expect(buildPositionEntries([])).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/exporter.test.ts
```

Expected: `FAIL — Cannot find module '../src/exporter'`

- [ ] **Step 3: Create `src/exporter.ts`**

```ts
// src/exporter.ts
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { SelectionStore } from './store';

export interface PositionEntry {
  name: string;
  uuid: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

interface RawEntry {
  name: string;
  uuid: string;
  position: { x: number; y: number; z: number };
  rotationDeg: { x: number; y: number; z: number };
}

/** Pure function — build PositionEntry array from pre-resolved raw data. */
export function buildPositionEntries(raws: RawEntry[]): PositionEntry[] {
  return raws.map(r => ({
    name: r.name,
    uuid: r.uuid,
    position: {
      x: round4(r.position.x),
      y: round4(r.position.y),
      z: round4(r.position.z),
    },
    rotation: {
      x: round4(r.rotationDeg.x),
      y: round4(r.rotationDeg.y),
      z: round4(r.rotationDeg.z),
    },
  }));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
    'background:#e53e3e', 'color:#fff', 'padding:8px 16px', 'border-radius:4px',
    'font-size:13px', 'z-index:9999',
  ].join(';');
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

export class Exporter {
  private scene: THREE.Scene;
  private store: SelectionStore;
  private gltfExporter = new GLTFExporter();

  constructor(scene: THREE.Scene, store: SelectionStore) {
    this.scene = scene;
    this.store = store;
  }

  exportGLB(): void {
    if (this.store.checked.size === 0) return;

    const exportScene = new THREE.Scene();
    this.store.checked.forEach(uuid => {
      const obj = this.scene.getObjectByProperty('uuid', uuid);
      if (obj) exportScene.add(obj.clone());
    });

    this.gltfExporter.parse(
      exportScene,
      (result) => {
        downloadBlob(
          new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }),
          'export.glb'
        );
      },
      (error) => {
        console.error('GLTFExporter error:', error);
        showToast('GLB export failed: ' + String(error));
      },
      { binary: true }
    );
  }

  exportJSON(): void {
    if (this.store.checked.size === 0) return;

    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const euler = new THREE.Euler();

    const raws: RawEntry[] = [];
    let idx = 0;
    this.store.checked.forEach(uuid => {
      const obj = this.scene.getObjectByProperty('uuid', uuid);
      if (!obj) return;
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      euler.setFromQuaternion(worldQuat);
      raws.push({
        name: obj.name || `Mesh_${idx}`,
        uuid,
        position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
        rotationDeg: {
          x: THREE.MathUtils.radToDeg(euler.x),
          y: THREE.MathUtils.radToDeg(euler.y),
          z: THREE.MathUtils.radToDeg(euler.z),
        },
      });
      idx++;
    });

    const entries = buildPositionEntries(raws);
    downloadBlob(
      new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' }),
      'positions.json'
    );
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/exporter.test.ts
```

Expected:
```
✓ buildPositionEntries maps raw entries to PositionEntry shape
✓ buildPositionEntries rounds values to 4 decimal places
✓ buildPositionEntries handles empty array
3 pass, 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/exporter.ts tests/exporter.test.ts
git commit -m "feat(exporter): add GLB and JSON export with buildPositionEntries"
```

---

## Task 6: Create panel.ts

Builds the object tree from the loaded scene graph. Checkbox toggles `store.checked`. Label click calls `selector.setActive()`. `refreshPosition()` runs every frame via `viewer.onFrame()` to show live x/y/z/rx/ry/rz.

**Files:**
- Create: `src/panel.ts`
- Create: `tests/panel.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/panel.test.ts
import { test, expect } from "bun:test";
import { resolveMeshName } from "../src/panel";

test("resolveMeshName returns the mesh name when non-empty", () => {
  expect(resolveMeshName("Chair_Seat", 0)).toBe("Chair_Seat");
});

test("resolveMeshName falls back to Mesh_<index> for empty name", () => {
  expect(resolveMeshName("", 3)).toBe("Mesh_3");
});

test("resolveMeshName falls back to Mesh_<index> for whitespace-only name", () => {
  expect(resolveMeshName("   ", 7)).toBe("Mesh_7");
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
bun test tests/panel.test.ts
```

Expected: `FAIL — Cannot find module '../src/panel'`

- [ ] **Step 3: Create `src/panel.ts`**

```ts
// src/panel.ts
import * as THREE from 'three';
import type { SelectionStore } from './store';
import type { Selector } from './selector';

/** Pure function — exported for testing. */
export function resolveMeshName(name: string, index: number): string {
  return name.trim() ? name.trim() : `Mesh_${index}`;
}

export class Panel {
  private treeEl: HTMLElement;
  private posEl: HTMLElement;
  private store: SelectionStore;
  private selector: Selector;
  private scene: THREE.Scene;

  constructor(
    treeEl: HTMLElement,
    posEl: HTMLElement,
    store: SelectionStore,
    selector: Selector,
    scene: THREE.Scene
  ) {
    this.treeEl = treeEl;
    this.posEl = posEl;
    this.store = store;
    this.selector = selector;
    this.scene = scene;
  }

  /** Rebuild the object tree from the freshly loaded scene graph. */
  buildTree(loadedScene: THREE.Group): void {
    this.treeEl.innerHTML = '';
    this.store.checked.clear();

    const meshes: THREE.Mesh[] = [];
    loadedScene.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });

    if (meshes.length === 0) {
      this.treeEl.innerHTML = '<p class="no-meshes">No meshes found</p>';
      return;
    }

    meshes.forEach((mesh, idx) => {
      const name = resolveMeshName(mesh.name, idx);

      const row = document.createElement('div');
      row.className = 'tree-row';
      row.dataset.uuid = mesh.uuid;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `mesh-cb-${mesh.uuid}`;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.store.checked.add(mesh.uuid);
        } else {
          this.store.checked.delete(mesh.uuid);
        }
        this.syncExportButtons();
      });

      const label = document.createElement('label');
      label.htmlFor = checkbox.id;
      label.textContent = name;
      label.title = name;
      // Label click = activate (not just checkbox toggle)
      label.addEventListener('click', (e) => {
        e.preventDefault();
        this.selector.setActive(mesh.uuid);
        this.store.checked.add(mesh.uuid);
        checkbox.checked = true;
        this.syncExportButtons();
      });

      row.appendChild(checkbox);
      row.appendChild(label);
      this.treeEl.appendChild(row);
    });
  }

  /** Highlight the tree row for the active UUID; clear all others. */
  setActiveRow(uuid: string | null): void {
    this.treeEl.querySelectorAll<HTMLElement>('.tree-row').forEach(row => {
      row.classList.toggle('active', row.dataset.uuid === uuid);
    });
  }

  /**
   * Refresh the position/rotation display for store.active.
   * Called every animation frame via viewer.onFrame().
   */
  refreshPosition(): void {
    if (!this.store.active) {
      this.posEl.innerHTML = '<p class="no-active">No mesh selected</p>';
      return;
    }
    const obj = this.scene.getObjectByProperty('uuid', this.store.active);
    if (!obj) return;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    obj.getWorldPosition(pos);
    obj.getWorldQuaternion(quat);
    euler.setFromQuaternion(quat);

    const f = (n: number) => n.toFixed(3);
    const deg = (n: number) => THREE.MathUtils.radToDeg(n).toFixed(1);

    this.posEl.innerHTML = `
      <table class="pos-table">
        <tr><th>x</th><td>${f(pos.x)}</td></tr>
        <tr><th>y</th><td>${f(pos.y)}</td></tr>
        <tr><th>z</th><td>${f(pos.z)}</td></tr>
        <tr><th>rx°</th><td>${deg(euler.x)}</td></tr>
        <tr><th>ry°</th><td>${deg(euler.y)}</td></tr>
        <tr><th>rz°</th><td>${deg(euler.z)}</td></tr>
      </table>`;
  }

  private syncExportButtons(): void {
    const has = this.store.checked.size > 0;
    const glbBtn = document.getElementById('btn-export-glb') as HTMLButtonElement | null;
    const jsonBtn = document.getElementById('btn-export-json') as HTMLButtonElement | null;
    if (glbBtn) glbBtn.disabled = !has;
    if (jsonBtn) jsonBtn.disabled = !has;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
bun test tests/panel.test.ts
```

Expected:
```
✓ resolveMeshName returns the mesh name when non-empty
✓ resolveMeshName falls back to Mesh_<index> for empty name
✓ resolveMeshName falls back to Mesh_<index> for whitespace-only name
3 pass, 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/panel.ts tests/panel.test.ts
git commit -m "feat(panel): add object tree, checkboxes, and live position display"
```

---

## Task 7: Create main.ts

Wires all modules together. Handles toolbar button events and file input. Registers frame/load callbacks.

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Create `src/main.ts`**

```ts
// src/main.ts
import { GLBViewer } from './viewer';
import { createStore } from './store';
import { Selector } from './selector';
import { Transformer } from './transformer';
import { Exporter } from './exporter';
import { Panel } from './panel';

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('viewer-container') as HTMLElement;
  const treeEl = document.getElementById('object-tree') as HTMLElement;
  const posEl = document.getElementById('position-panel') as HTMLElement;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const btnTranslate = document.getElementById('btn-translate') as HTMLButtonElement;
  const btnRotate = document.getElementById('btn-rotate') as HTMLButtonElement;
  const btnExportGlb = document.getElementById('btn-export-glb') as HTMLButtonElement;
  const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;

  const store = createStore();
  const viewer = new GLBViewer(container);
  const selector = new Selector(viewer, store);
  const transformer = new Transformer(viewer);
  const exporter = new Exporter(viewer.getScene(), store);
  const panel = new Panel(treeEl, posEl, store, selector, viewer.getScene());

  // Viewport/tree selection → attach TransformControls + highlight tree row
  selector.onSelect((mesh) => {
    if (mesh) {
      transformer.attachTo(mesh.uuid);
      panel.setActiveRow(mesh.uuid);
    } else {
      transformer.detach();
      panel.setActiveRow(null);
    }
  });

  // Model loaded → rebuild sidebar tree, reset export buttons
  viewer.onModelLoad((scene) => {
    panel.buildTree(scene);
    btnExportGlb.disabled = true;
    btnExportJson.disabled = true;
  });

  // Every frame → refresh position/rotation display
  viewer.onFrame(() => panel.refreshPosition());

  // Toolbar: mode buttons
  btnTranslate.addEventListener('click', () => {
    transformer.setMode('translate');
    btnTranslate.classList.add('active');
    btnRotate.classList.remove('active');
  });

  btnRotate.addEventListener('click', () => {
    transformer.setMode('rotate');
    btnRotate.classList.add('active');
    btnTranslate.classList.remove('active');
  });

  // Toolbar: export buttons
  btnExportGlb.addEventListener('click', () => exporter.exportGLB());
  btnExportJson.addEventListener('click', () => exporter.exportJSON());

  // File input
  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      await viewer.loadModel(url);
    } catch (err) {
      alert('Error loading model: ' + err);
    }
  });

  // Auto-load sample model if present
  fetch('/models/sample.glb', { method: 'HEAD' })
    .then(() => viewer.loadModel('/models/sample.glb'))
    .catch(() => {});
});
```

- [ ] **Step 2: Commit**

```bash
git add src/main.ts
git commit -m "feat(main): wire all modules — selection, transform, export, panel"
```

---

## Task 8: Update index.html

Replace the existing layout with a toolbar + sidebar + viewport layout.

**Files:**
- Modify: `public/index.html` (full replacement)

- [ ] **Step 1: Replace `public/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GLB Viewer</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Toolbar ── */
    #toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #252525;
      border-bottom: 1px solid #333;
      flex-shrink: 0;
    }

    #toolbar .sep { width: 1px; height: 24px; background: #444; margin: 0 2px; }

    #toolbar button,
    #toolbar label.file-btn {
      padding: 5px 14px;
      border-radius: 4px;
      border: 1px solid #444;
      background: #333;
      color: #e0e0e0;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.15s;
      user-select: none;
    }

    #toolbar button:hover,
    #toolbar label.file-btn:hover { background: #444; }

    #toolbar button.active {
      background: #2b5ee8;
      border-color: #2b5ee8;
      color: #fff;
    }

    #toolbar button:disabled {
      opacity: 0.38;
      cursor: not-allowed;
    }

    /* ── Main area ── */
    #main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    #sidebar {
      width: 220px;
      flex-shrink: 0;
      background: #202020;
      border-right: 1px solid #333;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #777;
      padding: 9px 12px 6px;
      border-bottom: 1px solid #2a2a2a;
    }

    #object-tree {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .tree-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: default;
    }

    .tree-row:hover { background: #2a2a2a; }
    .tree-row.active { background: #1b3a72; }

    .tree-row input[type="checkbox"] {
      cursor: pointer;
      accent-color: #4488ff;
      flex-shrink: 0;
    }

    .tree-row label {
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      font-size: 12px;
      color: #ccc;
    }

    .no-meshes {
      padding: 10px 12px;
      font-size: 11px;
      color: #555;
    }

    /* ── Position panel ── */
    #pos-section { border-top: 1px solid #2a2a2a; }

    #position-panel { padding: 8px 12px 10px; }

    .no-active { font-size: 11px; color: #555; }

    .pos-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }

    .pos-table th {
      color: #777;
      text-align: left;
      padding: 2px 0;
      width: 34px;
      font-weight: normal;
    }

    .pos-table td {
      color: #ccc;
      text-align: right;
      font-family: 'Courier New', monospace;
      font-size: 11px;
    }

    /* ── Viewport ── */
    #viewer-container {
      flex: 1;
      position: relative;
      overflow: hidden;
    }

    #viewer-container canvas {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }

    /* ── Loading overlay ── */
    #loading-indicator {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.55);
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;
      font-size: 14px;
    }

    #loading-indicator.active { display: flex; }

    .loading-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #333;
      border-top-color: #4488ff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

  <div id="toolbar">
    <input type="file" id="file-input" accept=".glb" style="display:none" />
    <label for="file-input" class="file-btn">Load GLB</label>
    <div class="sep"></div>
    <button id="btn-translate" class="active">Translate</button>
    <button id="btn-rotate">Rotate</button>
    <div class="sep"></div>
    <button id="btn-export-glb" disabled>Export GLB</button>
    <button id="btn-export-json" disabled>Export JSON</button>
  </div>

  <div id="main">

    <div id="sidebar">
      <div class="sidebar-section-title">Objects</div>
      <div id="object-tree">
        <p class="no-meshes">Load a GLB file to begin</p>
      </div>
      <div id="pos-section">
        <div class="sidebar-section-title">Position</div>
        <div id="position-panel">
          <p class="no-active">No mesh selected</p>
        </div>
      </div>
    </div>

    <div id="viewer-container">
      <div id="loading-indicator">
        <div class="loading-spinner"></div>
        <span>Loading...</span>
        <span id="loading-progress"></span>
      </div>
    </div>

  </div>

  <script type="module" src="/viewer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): sidebar + toolbar layout with object tree and position panel"
```

---

## Task 9: Update index.ts server entrypoint

Change the Bun.build entrypoint from `src/viewer.ts` to `src/main.ts`.

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: In `index.ts`, update the entrypoint**

Find this line:
```ts
entrypoints: ["src/viewer.ts"],
```

Replace with:
```ts
entrypoints: ["src/main.ts"],
```

- [ ] **Step 2: Commit**

```bash
git add index.ts
git commit -m "chore(server): build from src/main.ts as entry point"
```

---

## Task 10: Run all tests + manual smoke test

- [ ] **Step 1: Run all unit tests**

```bash
bun test
```

Expected:
```
✓ createStore returns empty checked set and null active
✓ store.checked can add and remove UUIDs
✓ store.active can be set and cleared
✓ buildPositionEntries maps raw entries to PositionEntry shape
✓ buildPositionEntries rounds values to 4 decimal places
✓ buildPositionEntries handles empty array
✓ resolveMeshName returns the mesh name when non-empty
✓ resolveMeshName falls back to Mesh_<index> for empty name
✓ resolveMeshName falls back to Mesh_<index> for whitespace-only name
9 pass, 0 fail
```

- [ ] **Step 2: Start dev server**

```bash
bun run dev
```

Open `http://localhost:3000`

- [ ] **Step 3: Manual smoke test checklist**

- [ ] Page loads — sidebar shows "Load a GLB file to begin", Export buttons disabled
- [ ] Load a `.glb` → object tree populates, each mesh has a checkbox + label
- [ ] Click a mesh in viewport → row highlights blue, position panel shows x/y/z/rx/ry/rz
- [ ] Click a label in tree → same effect as viewport click
- [ ] Check a checkbox → Export GLB + Export JSON buttons become enabled
- [ ] Click Translate button → it highlights active; drag mesh → position values update live
- [ ] Click Rotate button → it highlights active; rotate mesh → rotation values update live
- [ ] Click empty space in viewport → TransformControls detach, position panel shows "No mesh selected"
- [ ] With 2+ meshes checked, click Export GLB → `export.glb` downloads
- [ ] Click Export JSON → `positions.json` downloads; open it — confirms names + rounded position/rotation values
- [ ] OrbitControls work normally when NOT dragging a gizmo

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: smoke test pass — GLB viewer mesh selection feature complete"
```
