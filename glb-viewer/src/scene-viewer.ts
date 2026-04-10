// src/scene-viewer.ts
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders';

interface ManifestEntry {
  file_name: string;
  location: Location3D;
  baked_transform?: boolean;
  world_location?: Location3D;
  label?: string;
  scale?: Location3D;
  category?: 'wall' | 'furniture';
}

interface Location3D {
  x: number;
  y: number;
  z: number;
}

interface SceneLocationEntry {
  id: string;
  ox: number;
  oy: number;
  oz: number;
}

interface SceneGroupEntry {
  id: string;
  label: string;
  children: string[];
  category?: 'wall' | 'furniture';
}

interface LoadedObject {
  name: string;
  entry: PartialManifestEntry;
}

interface Manifest {
  [objectName: string]: ManifestEntry;
}

type PartialManifestEntry = {
  file_name: string;
  location?: Location3D;
  baked_transform?: boolean;
  world_location?: Location3D;
  label?: string;
  scale?: Location3D;
  category?: 'wall' | 'furniture';
};

type ManifestLike = Record<string, PartialManifestEntry>;

type SceneLocations = Record<string, Location3D>;

type DetailsFormState = {
  label: string;
  file_name: string;
  location: Location3D;
  world_location: Location3D;
  scale: Location3D;
  category: 'wall' | 'furniture';
};

class SceneViewer {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.FreeCamera;
  private canvas: HTMLCanvasElement;
  private loadedMeshes: Map<string, BABYLON.AbstractMesh[]> = new Map();
  private loadedRoots: Map<string, BABYLON.TransformNode> = new Map();
  private loadedObjects: Map<string, LoadedObject> = new Map();
  private manifestData: ManifestLike = {};
  private sceneGroups: SceneGroupEntry[] = [];
  private selectedObjectName: string | null = null;
  private selectionListener: ((objectName: string | null) => void) | null = null;
  private usePresetColors = false;
  private preserveCameraOnSelect = true;
  private writableManifest: FileSystemFileHandle | null = null;
  private writableBaseURL: string | null = null;
  private getLocation(entry: PartialManifestEntry): Location3D {
    const location = entry.location ?? { x: 0, y: 0, z: 0 };
    return location;
  }

  private applyObjectLocation(rootNode: BABYLON.TransformNode, entry: PartialManifestEntry): void {
    if (entry.baked_transform) return;
    const location = this.getLocation(entry);
    rootNode.position = new BABYLON.Vector3(location.x, location.y, location.z);
  }

  private applyObjectScale(rootNode: BABYLON.TransformNode, entry: PartialManifestEntry): void {
    const scale = entry.scale ?? { x: 1, y: 1, z: 1 };
    rootNode.scaling = new BABYLON.Vector3(scale.x, scale.y, scale.z);
  }

  private findObjectNameFromMesh(mesh: BABYLON.AbstractMesh): string | null {
    let node: BABYLON.Node | null = mesh;
    while (node) {
      const metadata = node.metadata as { objectName?: string } | undefined;
      if (metadata?.objectName) return metadata.objectName;
      node = node.parent;
    }
    return null;
  }

  setSelectionListener(listener: ((objectName: string | null) => void) | null): void {
    this.selectionListener = listener;
  }

  setUsePresetColors(enabled: boolean): void {
    this.usePresetColors = enabled;
  }

  setPreserveCameraOnSelect(enabled: boolean): void {
    this.preserveCameraOnSelect = enabled;
  }

  getSelectedObjectName(): string | null {
    return this.selectedObjectName;
  }

  getManifestData(): ManifestLike {
    return structuredClone(this.manifestData);
  }

  getSceneGroups(): SceneGroupEntry[] {
    return structuredClone(this.sceneGroups);
  }

  getObjectEntry(objectName: string): PartialManifestEntry | null {
    return this.manifestData[objectName] ?? null;
  }

  updateObjectEntry(objectName: string, patch: Partial<PartialManifestEntry>): void {
    const current = this.manifestData[objectName];
    if (!current) return;
    this.manifestData[objectName] = { ...current, ...patch };

    const loaded = this.loadedObjects.get(objectName);
    if (loaded) {
      loaded.entry = this.manifestData[objectName];
    }

    const root = this.loadedRoots.get(objectName);
    if (root && this.manifestData[objectName].scale) {
      const scale = this.manifestData[objectName].scale!;
      root.scaling = new BABYLON.Vector3(scale.x, scale.y, scale.z);
    }
  }

  saveManifestToFile(filename = 'manifest.json'): void {
    const json = this.saveManifestJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async bindWritableFolder(manifestHandle: FileSystemFileHandle, baseURL: string): Promise<void> {
    this.writableManifest = manifestHandle;
    this.writableBaseURL = baseURL;
  }

  async persistManifestIfPossible(): Promise<boolean> {
    if (!this.writableManifest) return false;
    const writable = await this.writableManifest.createWritable();
    await writable.write(this.saveManifestJSON());
    await writable.close();
    return true;
  }

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new BABYLON.Engine(this.canvas, true, { 
      preserveDrawingBuffer: true,
      stencil: true 
    });
    this.scene = new BABYLON.Scene(this.engine);

    this.setupScene();
    this.setupCamera();
    this.setupLights();

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });

    console.log('SceneViewer initialized.');
  }

  private setupScene(): void {
    // Light gray background
    this.scene.clearColor = new BABYLON.Color4(0.8, 0.8, 0.85, 1);
    
    // Simple ground plane
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { 
      width: 1000, 
      height: 1000,
      subdivisions: 2
    }, this.scene);
    ground.position.y = 0;
    
    const groundMaterial = new BABYLON.StandardMaterial('groundMat', this.scene);
    groundMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.45);
    groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    ground.material = groundMaterial;
    ground.isPickable = false;
    ground.receiveShadows = true;

    // Create grid
    const gridSize = 500;
    const gridDivisions = 50;
    const gridStep = gridSize / gridDivisions;
    
    for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
      const lineX = BABYLON.MeshBuilder.CreateLines(`gridX_${i}`, {
        points: [
          new BABYLON.Vector3(i, 0.01, -gridSize / 2),
          new BABYLON.Vector3(i, 0.01, gridSize / 2)
        ]
      }, this.scene);
      lineX.color = new BABYLON.Color3(0.5, 0.5, 0.55);
      lineX.isPickable = false;

      const lineZ = BABYLON.MeshBuilder.CreateLines(`gridZ_${i}`, {
        points: [
          new BABYLON.Vector3(-gridSize / 2, 0.01, i),
          new BABYLON.Vector3(gridSize / 2, 0.01, i)
        ]
      }, this.scene);
      lineZ.color = new BABYLON.Color3(0.5, 0.5, 0.55);
      lineZ.isPickable = false;
    }

    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (mesh) => mesh.isPickable);
      if (!pick?.hit || !pick.pickedMesh) return;

      const objectName = this.findObjectNameFromMesh(pick.pickedMesh);
      if (objectName) {
        this.selectObject(objectName);
      }
    });

    console.log('Scene setup complete');
  }

  private setupCamera(): void {
    this.camera = new BABYLON.FreeCamera(
      'camera',
      new BABYLON.Vector3(0, 2, -8),
      this.scene
    );
    this.camera.attachControl(this.canvas, true);
    this.camera.speed = 0.5;
    this.camera.angularSensibility = 3000;
    this.camera.inertia = 0.7;
    this.camera.minZ = 0.05;
    this.camera.fov = 0.8;
    this.camera.keysUp = [87, 38];
    this.camera.keysDown = [83, 40];
    this.camera.keysLeft = [65, 37];
    this.camera.keysRight = [68, 39];
    this.camera.inputs.addMouseWheel();

    console.log('Camera setup complete');
  }

  private setupLights(): void {
    // Strong hemispheric light
    const hemi = new BABYLON.HemisphericLight(
      'hemiLight',
      new BABYLON.Vector3(0, 1, 0),
      this.scene
    );
    hemi.intensity = 1.2;
    hemi.diffuse = new BABYLON.Color3(1, 1, 1);
    hemi.groundColor = new BABYLON.Color3(0.6, 0.6, 0.7);

    // Strong directional lights
    const dirLight1 = new BABYLON.DirectionalLight(
      'dirLight1',
      new BABYLON.Vector3(1, -1.5, 1),
      this.scene
    );
    dirLight1.position = new BABYLON.Vector3(-100, 100, -100);
    dirLight1.intensity = 0.8;

    const dirLight2 = new BABYLON.DirectionalLight(
      'dirLight2',
      new BABYLON.Vector3(-1, -1.5, -1),
      this.scene
    );
    dirLight2.position = new BABYLON.Vector3(100, 100, 100);
    dirLight2.intensity = 0.6;

    console.log('Lights setup complete');
  }

  async loadManifestFromURL(manifestURL: string, baseURL: string): Promise<void> {
    console.log('Loading manifest from:', manifestURL);
    const response = await fetch(manifestURL);
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.statusText}`);
    }

    const manifest: ManifestLike = await response.json();
    this.manifestData = manifest;
    this.sceneGroups = await this.loadSceneGroupsFromURL(baseURL);
    const locations = await this.loadSceneLocations(baseURL);
    for (const [objectName, location] of Object.entries(locations)) {
      if (manifest[objectName] && !manifest[objectName].location) {
        manifest[objectName].location = location;
      }
    }
    console.log('Manifest loaded, objects:', Object.keys(manifest).length);

    this.showLoading(true, 'Loading objects...');

    const entries = Object.entries(manifest);
    let loaded = 0;

    for (const [objectName, entry] of entries) {
      const glbURL = `${baseURL}/${entry.file_name}`;
      
      try {
        await this.loadObjectFromURL(objectName, entry, glbURL);
        loaded++;
        this.updateLoadingProgress(`${loaded}/${entries.length} objects`);
        console.log(`Loaded ${loaded}/${entries.length}: ${objectName}`);
      } catch (err) {
        console.error(`Error loading ${objectName}:`, err);
      }
    }

    console.log(`Finished loading ${loaded} objects`);
    this.showLoading(false);
    this.focusCamera();
  }

  private async loadSceneLocations(baseURL: string): Promise<SceneLocations> {
    try {
      const response = await fetch(`${baseURL}/scene_locations.json`);
      if (!response.ok) {
        return {};
      }

      const entries: SceneLocationEntry[] = await response.json();
      return Object.fromEntries(entries.map((entry) => [entry.id, { x: entry.ox, y: entry.oy, z: entry.oz }]));
    } catch {
      return {};
    }
  }

  private async loadSceneGroupsFromURL(baseURL: string): Promise<SceneGroupEntry[]> {
    try {
      const response = await fetch(`${baseURL}/scene_groups.json`);
      if (!response.ok) return [];
      return await response.json();
    } catch {
      return [];
    }
  }

  async loadManifest(files: FileList): Promise<void> {
    const manifestFile = Array.from(files).find(f => f.name === 'manifest.json');
    if (!manifestFile) {
      throw new Error('manifest.json not found in selected folder');
    }

    const manifestText = await manifestFile.text();
    const manifest: ManifestLike = JSON.parse(manifestText);
    this.manifestData = manifest;

    const groupsFile = Array.from(files).find(f => f.name === 'scene_groups.json');
    this.sceneGroups = groupsFile ? JSON.parse(await groupsFile.text()) : [];

    // Create a map of filename -> File
    const fileMap = new Map<string, File>();
    Array.from(files).forEach(file => {
      if (file.name.endsWith('.glb')) {
        fileMap.set(file.name, file);
      }
    });

    // Show loading overlay
    this.showLoading(true, 'Loading objects...');

    const entries = Object.entries(manifest);
    let loaded = 0;

    for (const [objectName, entry] of entries) {
      const glbFile = fileMap.get(entry.file_name);
      if (!glbFile) {
        console.warn(`GLB file not found: ${entry.file_name}`);
        continue;
      }

      try {
        await this.loadObject(objectName, entry, glbFile);
        loaded++;
        this.updateLoadingProgress(`${loaded}/${entries.length} objects`);
      } catch (err) {
        console.error(`Error loading ${objectName}:`, err);
      }
    }

    this.showLoading(false);
    this.focusCamera();
  }

  private async loadObject(
    objectName: string,
    entry: PartialManifestEntry,
    file: File
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      BABYLON.SceneLoader.ImportMesh(
        '',
        '',
        file,
        this.scene,
        (meshes) => {
          if (meshes.length > 0) {
            const rootNode = new BABYLON.TransformNode(`${objectName}_root`, this.scene);
            rootNode.metadata = { objectName };
            for (const mesh of meshes) {
              if (mesh.parent === null) {
                mesh.parent = rootNode;
              }
              mesh.metadata = { objectName };
            }
            this.applyObjectScale(rootNode, entry);
            this.applyObjectLocation(rootNode, entry);

            this.enhanceMeshMaterials(meshes, objectName);
            this.loadedRoots.set(objectName, rootNode);
            this.loadedMeshes.set(objectName, meshes);
            this.loadedObjects.set(objectName, { name: objectName, entry });
          } else {
            reject(new Error(`No meshes loaded from ${file.name}`));
            return;
          }

          resolve();
        },
        null,
        (scene, message) => {
          reject(new Error(message));
        }
      );
    });
  }

  private async loadObjectFromURL(
    objectName: string,
    entry: PartialManifestEntry,
    url: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Loading ${objectName} from ${url}`);
      
      BABYLON.SceneLoader.ImportMesh(
        '',
        '',
        url,
        this.scene,
        (meshes) => {
          console.log(`${objectName}: loaded ${meshes.length} meshes`);
          
          if (meshes.length > 0) {
            const rootNode = new BABYLON.TransformNode(`${objectName}_root`, this.scene);
            rootNode.metadata = { objectName };
            for (const mesh of meshes) {
              if (mesh.parent === null) {
                mesh.parent = rootNode;
              }
              mesh.metadata = { objectName };
            }
            this.applyObjectScale(rootNode, entry);
            this.applyObjectLocation(rootNode, entry);

            this.enhanceMeshMaterials(meshes, objectName);
            this.loadedRoots.set(objectName, rootNode);
            this.loadedMeshes.set(objectName, meshes);
            this.loadedObjects.set(objectName, { name: objectName, entry });
          } else {
            reject(new Error(`No meshes loaded from ${url}`));
            return;
          }

          resolve();
        },
        (event) => {
          // Progress callback
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total * 100).toFixed(0);
            console.log(`${objectName}: ${progress}%`);
          }
        },
        (scene, message, exception) => {
          console.error(`Error loading ${objectName}:`, message, exception);
          reject(new Error(message));
        }
      );
    });
  }

  private enhanceMeshMaterials(meshes: BABYLON.AbstractMesh[], objectName: string): void {
    for (const mesh of meshes) {
      mesh.metadata = { objectName };
      
      if (mesh.material) {
        const mat = mesh.material as BABYLON.PBRMaterial | BABYLON.StandardMaterial;
        
        if (!this.usePresetColors) {
          continue;
        }

        if (mat instanceof BABYLON.StandardMaterial) {
          if (!mat.diffuseTexture && mat.diffuseColor.equalsFloats(1, 1, 1)) {
            const hash = this.hashCode(objectName);
            mat.diffuseColor = this.getColorFromHash(hash);
          }
          mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        } else if (mat instanceof BABYLON.PBRMaterial) {
          if (!mat.albedoTexture && mat.albedoColor.equalsFloats(1, 1, 1)) {
            const hash = this.hashCode(objectName);
            mat.albedoColor = this.getColorFromHash(hash);
          }
          mat.metallic = 0.1;
          mat.roughness = 0.7;
        }
      } else {
        if (!this.usePresetColors) {
          continue;
        }
        const defaultMat = new BABYLON.StandardMaterial(`mat_${objectName}`, this.scene);
        const hash = this.hashCode(objectName);
        defaultMat.diffuseColor = this.getColorFromHash(hash);
        defaultMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mesh.material = defaultMat;
      }
    }
  }

  clearScene(): void {
    for (const meshes of this.loadedMeshes.values()) {
      for (const mesh of meshes) {
        mesh.dispose();
      }
    }
    for (const root of this.loadedRoots.values()) {
      root.dispose();
    }
    this.loadedMeshes.clear();
    this.loadedRoots.clear();
    this.loadedObjects.clear();
    this.selectedObjectName = null;
  }

  resetCamera(): void {
    this.focusCamera();
  }

  private focusCamera(): void {
    if (this.loadedMeshes.size === 0) {
      this.camera.position = new BABYLON.Vector3(0, 2, -8);
      this.camera.setTarget(BABYLON.Vector3.Zero());
      return;
    }

    let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
    let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);

    this.loadedMeshes.forEach((meshes) => {
      meshes.forEach(mesh => {
        mesh.computeWorldMatrix(true);
          const bounds = mesh.getBoundingInfo();
          const meshMin = bounds.boundingBox.minimumWorld;
          const meshMax = bounds.boundingBox.maximumWorld;

        min = BABYLON.Vector3.Minimize(min, meshMin);
        max = BABYLON.Vector3.Maximize(max, meshMax);
      });
    });

    const center = BABYLON.Vector3.Center(min, max);
    const size = max.subtract(min);
    const diagonal = size.length();

    const avgPos = BABYLON.Vector3.Center(min, max);

    this.camera.position = avgPos.add(new BABYLON.Vector3(0, Math.max(diagonal * 0.25, 2), -Math.max(diagonal * 0.75, 8)));
    this.camera.setTarget(avgPos);
    
    console.log(`Camera focused: center=${center}, size=${diagonal.toFixed(2)}, objects=${this.loadedMeshes.size}`);
  }

  selectObject(objectName: string | null): void {
    if (this.selectedObjectName) {
      const prevMeshes = this.loadedMeshes.get(this.selectedObjectName);
      if (prevMeshes) {
        for (const mesh of prevMeshes) {
          if (mesh.material) {
            (mesh.material as any).emissiveColor = new BABYLON.Color3(0, 0, 0);
          }
        }
      }
    }

    this.selectedObjectName = objectName;

    if (objectName) {
      const meshes = this.loadedMeshes.get(objectName);
      if (meshes) {
        for (const mesh of meshes) {
          if (mesh.material) {
            (mesh.material as any).emissiveColor = new BABYLON.Color3(0.2, 0.4, 0.8);
          }
        }

        const root = this.loadedRoots.get(objectName);
        if (root && !this.preserveCameraOnSelect) {
          this.camera.target = root.getAbsolutePosition();
        }
      }
    }

    this.selectionListener?.(objectName);
  }

  getLoadedObjects(): Array<{ name: string; entry: PartialManifestEntry }> {
    return Array.from(this.loadedObjects.values()).map(({ name, entry }) => ({
      name,
      entry: {
        file_name: entry.file_name,
        location: this.getLocation(entry),
        world_location: entry.world_location,
        label: entry.label,
        scale: entry.scale,
        baked_transform: entry.baked_transform,
        category: entry.category,
      },
    }));
  }

  getDetails(objectName: string): DetailsFormState | null {
    const entry = this.manifestData[objectName];
    if (!entry) return null;

    return {
      label: entry.label ?? objectName,
      file_name: entry.file_name,
      location: this.getLocation(entry),
      world_location: entry.world_location ?? this.getLocation(entry),
      scale: entry.scale ?? { x: 1, y: 1, z: 1 },
      category: entry.category ?? 'furniture',
    };
  }

  saveManifestJSON(): string {
    return JSON.stringify(this.manifestData, null, 2);
  }

  updateManifestFileName(objectName: string, nextFileName: string): void {
    const current = this.manifestData[objectName];
    if (!current) return;
    this.manifestData[objectName] = { ...current, file_name: nextFileName };

    const loaded = this.loadedObjects.get(objectName);
    if (loaded) {
      loaded.entry = this.manifestData[objectName];
    }
  }

  setSceneGroups(groups: SceneGroupEntry[]): void {
    this.sceneGroups = structuredClone(groups);
  }

  createSceneGroup(label: string, children: string[]): SceneGroupEntry {
    const group: SceneGroupEntry = {
      id: `group_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      label,
      children: [...children],
      category: 'furniture',
    };
    this.sceneGroups.push(group);
    return group;
  }

  updateSceneGroup(groupId: string, patch: Partial<SceneGroupEntry>): void {
    const group = this.sceneGroups.find(item => item.id === groupId);
    if (!group) return;
    Object.assign(group, patch);
  }

  saveSceneGroupsToFile(filename = 'scene_groups.json'): void {
    const blob = new Blob([JSON.stringify(this.sceneGroups, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private showLoading(show: boolean, text = 'Loading...'): void {
    const overlay = document.getElementById('loading-overlay')!;
    const textEl = document.getElementById('loading-text')!;
    if (show) {
      textEl.textContent = text;
      overlay.classList.add('active');
    } else {
      overlay.classList.remove('active');
    }
  }

  private updateLoadingProgress(progress: string): void {
    const progressEl = document.getElementById('loading-progress')!;
    progressEl.textContent = progress;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private getColorFromHash(hash: number): BABYLON.Color3 {
    const hue = (hash % 360) / 360;
    const saturation = 0.5 + (hash % 30) / 100;
    const lightness = 0.5 + (hash % 20) / 100;
    
    return BABYLON.Color3.FromHSV(hue * 360, saturation, lightness);
  }
}

// ── UI Controller ──
class UIController {
  private viewer: SceneViewer;
  private folderInput: HTMLInputElement;
  private objectList: HTMLElement;
  private listCount: HTMLElement;
  private objectCount: HTMLElement;
  private btnResetCamera: HTMLButtonElement;
  private btnClearScene: HTMLButtonElement;
  private btnLoadOutput: HTMLButtonElement;
  private btnBindFolder: HTMLButtonElement;
  private togglePresets: HTMLInputElement;
  private detailsPanel: HTMLElement;
  private fieldLabel: HTMLInputElement;
  private fieldFileName: HTMLInputElement;
  private fieldScale: HTMLInputElement;
  private fieldLocation: HTMLInputElement;
  private fieldCategory: HTMLInputElement;
  private btnSaveMetadata: HTMLButtonElement;
  private btnDownloadJson: HTMLButtonElement;
  private activeObjectName: string | null = null;
  private activeGroupId: string | null = null;

  constructor() {
    this.viewer = new SceneViewer('render-canvas');
    
    this.folderInput = document.getElementById('folder-input') as HTMLInputElement;
    this.objectList = document.getElementById('object-list') as HTMLElement;
    this.listCount = document.getElementById('list-count') as HTMLElement;
    this.objectCount = document.getElementById('object-count') as HTMLElement;
    this.btnResetCamera = document.getElementById('btn-reset-camera') as HTMLButtonElement;
    this.btnClearScene = document.getElementById('btn-clear-scene') as HTMLButtonElement;
    this.btnLoadOutput = document.getElementById('btn-load-output') as HTMLButtonElement;
    this.btnBindFolder = document.getElementById('btn-bind-folder') as HTMLButtonElement;
    this.togglePresets = document.getElementById('toggle-presets') as HTMLInputElement;
    this.detailsPanel = document.getElementById('details-panel') as HTMLElement;
    this.fieldLabel = document.getElementById('field-label') as HTMLInputElement;
    this.fieldFileName = document.getElementById('field-file-name') as HTMLInputElement;
    this.fieldScale = document.getElementById('field-scale') as HTMLInputElement;
    this.fieldLocation = document.getElementById('field-location') as HTMLInputElement;
    this.fieldCategory = document.getElementById('field-category') as HTMLInputElement;
    this.btnSaveMetadata = document.getElementById('btn-save-metadata') as HTMLButtonElement;
    this.btnDownloadJson = document.getElementById('btn-download-json') as HTMLButtonElement;

    this.viewer.setSelectionListener((objectName) => this.showDetails(objectName));
    this.viewer.setUsePresetColors(false);
    this.viewer.setPreserveCameraOnSelect(true);
    this.setupEventListeners();
    void this.preloadOutput();
  }

  private async preloadOutput(): Promise<void> {
    try {
      await this.viewer.loadManifestFromURL('/output/manifest.json', '/output');
      this.updateObjectList();
      this.updateObjectCount();
    } catch {
      // Output preload is best-effort.
    }
  }

  private setupEventListeners(): void {
    this.folderInput.addEventListener('change', async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      try {
        await this.viewer.loadManifest(files);
        this.updateObjectList();
        this.updateObjectCount();
      } catch (err) {
        alert('Error loading manifest: ' + (err as Error).message);
      }
    });

    this.btnLoadOutput.addEventListener('click', async () => {
      try {
        await this.viewer.loadManifestFromURL('/output/manifest.json', '/output');
        this.updateObjectList();
        this.updateObjectCount();
      } catch (err) {
        alert('Error loading output folder: ' + (err as Error).message);
      }
    });

    this.btnBindFolder.addEventListener('click', async () => {
      const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (!picker) {
        alert('This browser does not support folder write-back.');
        return;
      }

      try {
        const dirHandle = await picker();
        const fileHandle = await dirHandle.getFileHandle('manifest.json', { create: false });
        await this.viewer.bindWritableFolder(fileHandle, '');
        alert('Folder bound for write-back. Use Save JSON to persist edits.');
      } catch (err) {
        alert('Could not bind folder: ' + (err as Error).message);
      }
    });

    this.btnResetCamera.addEventListener('click', () => {
      this.viewer.resetCamera();
    });

    this.btnClearScene.addEventListener('click', () => {
      if (confirm('Clear all objects from the scene?')) {
        this.viewer.clearScene();
        this.updateObjectList();
        this.updateObjectCount();
        this.showDetails(null);
      }
    });

    this.togglePresets.addEventListener('change', () => {
      this.viewer.setUsePresetColors(this.togglePresets.checked);
    });

    this.btnSaveMetadata.addEventListener('click', () => {
      if (this.activeGroupId) {
        this.applyGroupToSelection();
      }
      if (this.activeObjectName) {
        this.applyFormToSelection();
      }
      void this.persistManifest();
    });

    this.btnDownloadJson.addEventListener('click', () => {
      if (this.activeGroupId) this.applyGroupToSelection();
      if (this.activeObjectName) this.applyFormToSelection();
      void this.persistManifest();
    });

    this.objectList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const groupRow = target.closest<HTMLElement>('.group-row');
      if (!groupRow) return;

      const groupId = groupRow.dataset.groupId;
      if (!groupId) return;
      this.activeGroupId = groupId;
      this.activeObjectName = null;
      this.detailsPanel.classList.remove('hidden');
      this.fieldLabel.value = groupRow.dataset.groupLabel ?? '';
      this.fieldFileName.value = '';
      this.fieldScale.value = '';
      this.fieldLocation.value = '';
      this.fieldCategory.value = groupRow.dataset.groupCategory || 'furniture';
    });

    [this.fieldLabel, this.fieldFileName, this.fieldScale, this.fieldLocation, this.fieldCategory].forEach((input) => {
      input.addEventListener('change', () => this.applyFormToSelection());
    });
  }

  private updateObjectList(): void {
    const objects = this.viewer.getLoadedObjects();
    const groups = this.viewer.getSceneGroups();
    
    if (objects.length === 0 && groups.length === 0) {
      this.objectList.innerHTML = `
        <div class="empty-state">
          Click "Load Folder" and select a folder containing:<br>
          • manifest.json<br>
          • .glb files
        </div>
      `;
      this.listCount.textContent = '0';
      return;
    }

    this.objectList.innerHTML = '';
    this.listCount.textContent = (objects.length + groups.length).toString();

    groups.forEach((group) => {
      const groupRow = document.createElement('div');
      groupRow.className = 'object-item group-row';
      groupRow.dataset.groupId = group.id;
      groupRow.dataset.groupLabel = group.label;
      groupRow.dataset.groupCategory = group.category || 'furniture';

      const groupName = document.createElement('span');
      groupName.className = 'name';
      groupName.textContent = group.label;

      const groupCount = document.createElement('span');
      groupCount.className = 'coords';
      groupCount.textContent = `${group.children.length} items`;

      groupRow.appendChild(groupName);
      groupRow.appendChild(groupCount);
      this.objectList.appendChild(groupRow);
    });

    objects.sort((a, b) => a.name.localeCompare(b.name));

    objects.forEach(({ name, entry }) => {
      const item = document.createElement('div');
      item.className = 'object-item';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = entry.label || name;
      
      item.appendChild(nameSpan);
      
      item.addEventListener('click', () => {
        this.objectList.querySelectorAll('.object-item').forEach(el => {
          el.classList.remove('selected');
        });
        
        item.classList.add('selected');
        this.activeGroupId = null;
        this.viewer.selectObject(name);
      });
      
      this.objectList.appendChild(item);
    });
  }

  private updateObjectCount(): void {
    const count = this.viewer.getLoadedObjects().length;
    this.objectCount.textContent = count === 0 
      ? 'No objects loaded' 
      : `${count} object${count === 1 ? '' : 's'} loaded`;
  }

  private showDetails(objectName: string | null): void {
    this.activeGroupId = null;
    this.activeObjectName = objectName;
    if (!objectName) {
      this.detailsPanel.classList.add('hidden');
      return;
    }

    const details = this.viewer.getDetails(objectName);
    if (!details) {
      this.detailsPanel.classList.add('hidden');
      return;
    }

    this.detailsPanel.classList.remove('hidden');
    this.fieldLabel.value = details.label;
    this.fieldFileName.value = details.file_name;
    this.fieldScale.value = `${details.scale.x}, ${details.scale.y}, ${details.scale.z}`;
    this.fieldLocation.value = `${details.location.x}, ${details.location.y}, ${details.location.z}`;
    this.fieldCategory.value = details.category;
  }

  private applyFormToSelection(): void {
    if (!this.activeObjectName) return;

    const parseVector = (value: string): { x: number; y: number; z: number } | null => {
      const parts = value.split(',').map(part => Number(part.trim()));
      if (parts.length !== 3 || parts.some(part => Number.isNaN(part))) return null;
      return { x: parts[0]!, y: parts[1]!, z: parts[2]! };
    };

    const scale = parseVector(this.fieldScale.value);
    const location = parseVector(this.fieldLocation.value);
    if (!scale || !location) return;

    const category = this.fieldCategory.value.trim() === 'wall' ? 'wall' : 'furniture';

    this.viewer.updateObjectEntry(this.activeObjectName, {
      label: this.fieldLabel.value.trim(),
      scale,
      location,
      world_location: location,
      category,
    });
    this.viewer.updateManifestFileName(this.activeObjectName, this.fieldFileName.value.trim() || this.fieldFileName.value);
  }

  private applyGroupToSelection(): void {
    if (!this.activeGroupId) return;
    this.viewer.updateSceneGroup(this.activeGroupId, {
      label: this.fieldLabel.value.trim() || 'Group',
      category: this.fieldCategory.value.trim() === 'wall' ? 'wall' : 'furniture',
    });
    this.updateObjectList();
  }

  private async persistManifest(): Promise<void> {
    try {
      const saved = await this.viewer.persistManifestIfPossible();
      if (!saved) {
        this.viewer.saveManifestToFile();
      }
    } catch {
      this.viewer.saveManifestToFile();
    }
  }

}

// ── Initialize ──
window.addEventListener('DOMContentLoaded', () => {
  new UIController();
});
