// src/transformer.ts
import * as BABYLON from '@babylonjs/core';
import type { GLBViewer } from './viewer';

export type TransformMode = 'translate' | 'rotate';

export class Transformer {
  private gizmo: BABYLON.PositionGizmo | BABYLON.RotationGizmo | null = null;
  private gizmoManager: BABYLON.GizmoManager;
  private scene: BABYLON.Scene;
  private currentMode: TransformMode = 'translate';

  constructor(viewer: GLBViewer) {
    this.scene = viewer.getScene();
    
    this.gizmoManager = new BABYLON.GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
    this.gizmoManager.boundingBoxGizmoEnabled = false;
    this.gizmoManager.usePointerToAttachGizmos = false;
  }

  /** Attach gizmo to the mesh matching uuid. */
  attachTo(uuid: string): void {
    const mesh = this.scene.meshes.find(m => m.uniqueId.toString() === uuid);
    if (mesh) {
      this.gizmoManager.attachToMesh(mesh);
    }
  }

  /** Detach gizmo (call when nothing is active). */
  detach(): void {
    this.gizmoManager.attachToMesh(null);
  }

  /** Switch between 'translate' and 'rotate'. Scale is never exposed. */
  setMode(mode: TransformMode): void {
    this.currentMode = mode;
    if (mode === 'translate') {
      this.gizmoManager.positionGizmoEnabled = true;
      this.gizmoManager.rotationGizmoEnabled = false;
    } else {
      this.gizmoManager.positionGizmoEnabled = false;
      this.gizmoManager.rotationGizmoEnabled = true;
    }
  }
}
