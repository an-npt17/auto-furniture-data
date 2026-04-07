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
    const matArr = Array.isArray(mesh.material) ? mesh.material : null;
    const base = matArr ? matArr[0] : mesh.material as THREE.Material;
    if (!base) return;
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
