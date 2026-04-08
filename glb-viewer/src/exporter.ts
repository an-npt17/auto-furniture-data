// src/exporter.ts
import * as BABYLON from '@babylonjs/core';
import { GLTF2Export } from '@babylonjs/serializers';
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
  private scene: BABYLON.Scene;
  private store: SelectionStore;

  constructor(scene: BABYLON.Scene, store: SelectionStore) {
    this.scene = scene;
    this.store = store;
  }

  exportGLB(): void {
    if (this.store.checked.size === 0) return;

    const meshesToExport = this.scene.meshes.filter(mesh => 
      this.store.checked.has(mesh.uniqueId.toString()) && mesh.metadata?.isSceneMesh
    );

    if (meshesToExport.length === 0) {
      showToast('No meshes to export');
      return;
    }

    GLTF2Export.GLBAsync(this.scene, 'export', {
      shouldExportNode: (node: BABYLON.Node) => meshesToExport.includes(node as any)
    }).then((glb: any) => {
      glb.downloadFiles();
    }).catch((error: any) => {
      console.error('GLB export error:', error);
      showToast('GLB export failed: ' + String(error));
    });
  }

  exportJSON(): void {
    if (this.store.checked.size === 0) return;

    const raws: RawEntry[] = [];
    let idx = 0;
    
    this.store.checked.forEach(uuid => {
      const mesh = this.scene.meshes.find(m => m.uniqueId.toString() === uuid);
      if (!mesh) return;
      
      const pos = mesh.position;
      const rot = mesh.rotation;
      
      raws.push({
        name: mesh.name || `Mesh_${idx}`,
        uuid,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotationDeg: {
          x: BABYLON.Tools.ToDegrees(rot.x),
          y: BABYLON.Tools.ToDegrees(rot.y),
          z: BABYLON.Tools.ToDegrees(rot.z),
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
