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
    this.scene.add(this.controls as unknown as THREE.Object3D);

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
