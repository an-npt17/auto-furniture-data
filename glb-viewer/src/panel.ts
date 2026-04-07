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
