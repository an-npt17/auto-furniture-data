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
