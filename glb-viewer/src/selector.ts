// src/selector.ts
import * as BABYLON from "@babylonjs/core";
import type { GLBViewer } from "./viewer";
import type { SelectionStore } from "./store";

export class Selector {
  private scene: BABYLON.Scene;
  private camera: BABYLON.ArcRotateCamera;
  private canvas: HTMLCanvasElement;
  private store: SelectionStore;
  private activeMesh: BABYLON.AbstractMesh | null = null;
  private highlightLayer: BABYLON.HighlightLayer;
  private onSelectCallbacks: Array<
    (mesh: BABYLON.AbstractMesh | null) => void
  > = [];

  constructor(viewer: GLBViewer, store: SelectionStore) {
    this.scene = viewer.getScene();
    this.camera = viewer.getCamera();
    this.canvas = viewer.getCanvas();
    this.store = store;

    this.highlightLayer = new BABYLON.HighlightLayer("highlight", this.scene);

    this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
  }

  /** Register a callback invoked when active selection changes. */
  onSelect(cb: (mesh: BABYLON.AbstractMesh | null) => void): void {
    this.onSelectCallbacks.push(cb);
  }

  /**
   * Programmatically activate a mesh by UUID.
   * Called from panel tree label clicks.
   */
  setActive(uuid: string): void {
    const mesh = this.scene.meshes.find((m) => m.uniqueId.toString() === uuid);
    if (mesh && mesh.metadata?.isSceneMesh) {
      this.applySelection(mesh);
    }
  }

  private onPointerDown(event: PointerEvent): void {
    const pickResult = this.scene.pick(
      event.clientX,
      event.clientY,
      (mesh) => mesh.metadata?.isSceneMesh === true,
    );

    if (pickResult?.hit && pickResult.pickedMesh) {
      this.applySelection(pickResult.pickedMesh);
    } else {
      this.clearActive();
    }
  }

  private applySelection(mesh: BABYLON.AbstractMesh): void {
    this.clearHighlight();

    this.activeMesh = mesh;
    if (mesh instanceof BABYLON.Mesh) {
      this.highlightLayer.addMesh(
        mesh,
        BABYLON.Color3.FromHexString("#4488ff"),
      );
    }

    const uuid = mesh.uniqueId.toString();
    this.store.active = uuid;
    this.store.checked.add(uuid);
    this.onSelectCallbacks.forEach((cb) => {
      cb(mesh);
    });
  }

  private clearActive(): void {
    this.clearHighlight();
    this.store.active = null;
    this.onSelectCallbacks.forEach((cb) => {
      cb(null);
    });
  }

  private clearHighlight(): void {
    if (this.activeMesh) {
      if (this.activeMesh instanceof BABYLON.Mesh) {
        this.highlightLayer.removeMesh(this.activeMesh);
      }
      this.activeMesh = null;
    }
  }
}
