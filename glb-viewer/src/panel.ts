// src/panel.ts
import * as BABYLON from "@babylonjs/core";
import type { SelectionStore } from "./store";
import type { Selector } from "./selector";

/** Pure function — exported for testing. */
export function resolveMeshName(name: string, index: number): string {
  return name.trim() ? name.trim() : `Mesh_${index}`;
}

export class Panel {
  private treeEl: HTMLElement;
  private posEl: HTMLElement;
  private store: SelectionStore;
  private selector: Selector;
  private scene: BABYLON.Scene;

  constructor(
    treeEl: HTMLElement,
    posEl: HTMLElement,
    store: SelectionStore,
    selector: Selector,
    scene: BABYLON.Scene,
  ) {
    this.treeEl = treeEl;
    this.posEl = posEl;
    this.store = store;
    this.selector = selector;
    this.scene = scene;
  }

  /** Rebuild the object tree from the freshly loaded scene graph. */
  buildTree(rootNode: BABYLON.AbstractMesh): void {
    this.treeEl.innerHTML = "";
    this.store.checked.clear();

    const meshes: BABYLON.AbstractMesh[] = [];

    // Get all meshes from the scene that are tagged as scene meshes
    this.scene.meshes.forEach((mesh) => {
      if (
        mesh.metadata?.isSceneMesh &&
        mesh.name !== "ground" &&
        mesh.name !== "__root__"
      ) {
        meshes.push(mesh);
      }
    });

    if (meshes.length === 0) {
      this.treeEl.innerHTML = '<p class="no-meshes">No meshes found</p>';
      return;
    }

    meshes.forEach((mesh, idx) => {
      const name = resolveMeshName(mesh.name, idx);

      const row = document.createElement("div");
      row.className = "tree-row";
      row.dataset.uuid = mesh.uniqueId.toString();

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `mesh-cb-${mesh.uniqueId}`;
      // Default to CHECKED (visible)
      checkbox.checked = true;
      this.store.checked.add(mesh.uniqueId.toString());

      checkbox.addEventListener("change", () => {
        const uuid = mesh.uniqueId.toString();
        if (checkbox.checked) {
          this.store.checked.add(uuid);
          mesh.setEnabled(true);
        } else {
          this.store.checked.delete(uuid);
          mesh.setEnabled(false);
        }
        this.syncExportButtons();
      });

      const label = document.createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = name;
      label.title = name;
      // Label click = activate (not just checkbox toggle)
      label.addEventListener("click", (e) => {
        e.preventDefault();
        const uuid = mesh.uniqueId.toString();
        this.selector.setActive(uuid);
        this.store.checked.add(uuid);
        checkbox.checked = true;
        mesh.setEnabled(true);
        this.syncExportButtons();
      });

      row.appendChild(checkbox);
      row.appendChild(label);
      this.treeEl.appendChild(row);
    });

    this.syncExportButtons();
  }

  /** Highlight the tree row for the active UUID; clear all others. */
  setActiveRow(uuid: string | null): void {
    this.treeEl.querySelectorAll<HTMLElement>(".tree-row").forEach((row) => {
      row.classList.toggle("active", row.dataset.uuid === uuid);
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

    const mesh = this.scene.meshes.find(
      (m) => m.uniqueId.toString() === this.store.active,
    );
    if (!mesh) return;

    const pos = mesh.position;
    const rot = mesh.rotation;

    const f = (n: number) => n.toFixed(3);
    const deg = (n: number) => BABYLON.Tools.ToDegrees(n).toFixed(1);

    this.posEl.innerHTML = `
      <table class="pos-table">
        <tr><th>x</th><td>${f(pos.x)}</td></tr>
        <tr><th>y</th><td>${f(pos.y)}</td></tr>
        <tr><th>z</th><td>${f(pos.z)}</td></tr>
        <tr><th>rx°</th><td>${deg(rot.x)}</td></tr>
        <tr><th>ry°</th><td>${deg(rot.y)}</td></tr>
        <tr><th>rz°</th><td>${deg(rot.z)}</td></tr>
      </table>`;
  }

  private syncExportButtons(): void {
    const has = this.store.checked.size > 0;
    const glbBtn = document.getElementById(
      "btn-export-glb",
    ) as HTMLButtonElement | null;
    const jsonBtn = document.getElementById(
      "btn-export-json",
    ) as HTMLButtonElement | null;
    if (glbBtn) glbBtn.disabled = !has;
    if (jsonBtn) jsonBtn.disabled = !has;
  }
}
