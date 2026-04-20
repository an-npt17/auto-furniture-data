// src/scene-viewer.ts
import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders";

interface MetadataEntry {
  id: string;
  name: string;
  category: string;
  shape: string;
  size: number[];
  placementType: string;
  color: string;
  modelUrl: string;
  position: { x: number; y: number; z: number };
}

class SceneViewer {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera!: BABYLON.FreeCamera;
  private canvas: HTMLCanvasElement;
  private loadedMeshes: Map<string, BABYLON.AbstractMesh[]> = new Map();
  private loadedRoots: Map<string, BABYLON.TransformNode> = new Map();
  private metadataEntries: MetadataEntry[] = [];
  private selectedId: string | null = null;
  private selectionListener: ((id: string | null) => void) | null = null;
  private usePresetColors = false;
  private currentFolder: string | null = null;

  setSelectionListener(listener: ((id: string | null) => void) | null): void {
    this.selectionListener = listener;
  }

  setUsePresetColors(enabled: boolean): void {
    this.usePresetColors = enabled;
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  getMetadataEntries(): MetadataEntry[] {
    return this.metadataEntries;
  }

  getEntry(id: string): MetadataEntry | undefined {
    return this.metadataEntries.find((e) => e.id === id);
  }

  getCurrentFolder(): string | null {
    return this.currentFolder;
  }

  updateEntry(id: string, patch: Partial<MetadataEntry>): void {
    const entry = this.metadataEntries.find((e) => e.id === id);
    if (!entry) return;
    Object.assign(entry, patch);
  }

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    this.scene = new BABYLON.Scene(this.engine);

    this.setupScene();
    this.setupCamera();
    this.setupLights();

    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener("resize", () => this.engine.resize());
  }

  private setupScene(): void {
    this.scene.clearColor = new BABYLON.Color4(0.8, 0.8, 0.85, 1);

    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground",
      {
        width: 1000,
        height: 1000,
        subdivisions: 2,
      },
      this.scene,
    );
    ground.position.y = 0;

    const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.4, 0.4, 0.45);
    groundMat.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    ground.material = groundMat;
    ground.isPickable = false;
    ground.receiveShadows = true;

    const gridSize = 500;
    const gridStep = gridSize / 50;
    for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
      const lineX = BABYLON.MeshBuilder.CreateLines(
        `gridX_${i}`,
        {
          points: [
            new BABYLON.Vector3(i, 0.01, -gridSize / 2),
            new BABYLON.Vector3(i, 0.01, gridSize / 2),
          ],
        },
        this.scene,
      );
      lineX.color = new BABYLON.Color3(0.5, 0.5, 0.55);
      lineX.isPickable = false;

      const lineZ = BABYLON.MeshBuilder.CreateLines(
        `gridZ_${i}`,
        {
          points: [
            new BABYLON.Vector3(-gridSize / 2, 0.01, i),
            new BABYLON.Vector3(gridSize / 2, 0.01, i),
          ],
        },
        this.scene,
      );
      lineZ.color = new BABYLON.Color3(0.5, 0.5, 0.55);
      lineZ.isPickable = false;
    }

    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== BABYLON.PointerEventTypes.POINTERDOWN) return;
      const pick = this.scene.pick(
        this.scene.pointerX,
        this.scene.pointerY,
        (mesh) => mesh.isPickable,
      );
      if (!pick?.hit || !pick.pickedMesh) return;

      const objectId = this.findObjectIdFromMesh(pick.pickedMesh);
      if (objectId) this.selectObject(objectId);
    });
  }

  private setupCamera(): void {
    this.camera = new BABYLON.FreeCamera(
      "camera",
      new BABYLON.Vector3(0, 2, -8),
      this.scene,
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
  }

  private setupLights(): void {
    const hemi = new BABYLON.HemisphericLight(
      "hemiLight",
      new BABYLON.Vector3(0, 1, 0),
      this.scene,
    );
    hemi.intensity = 1.2;
    hemi.diffuse = new BABYLON.Color3(1, 1, 1);
    hemi.groundColor = new BABYLON.Color3(0.6, 0.6, 0.7);

    const dirLight1 = new BABYLON.DirectionalLight(
      "dirLight1",
      new BABYLON.Vector3(1, -1.5, 1),
      this.scene,
    );
    dirLight1.position = new BABYLON.Vector3(-100, 100, -100);
    dirLight1.intensity = 0.8;

    const dirLight2 = new BABYLON.DirectionalLight(
      "dirLight2",
      new BABYLON.Vector3(-1, -1.5, -1),
      this.scene,
    );
    dirLight2.position = new BABYLON.Vector3(100, 100, 100);
    dirLight2.intensity = 0.6;
  }

  private findObjectIdFromMesh(mesh: BABYLON.AbstractMesh): string | null {
    let node: BABYLON.Node | null = mesh;
    while (node) {
      const metadata = node.metadata as { objectId?: string } | undefined;
      if (metadata?.objectId) return metadata.objectId;
      node = node.parent;
    }
    return null;
  }

  async loadMetadataFolder(folder: string): Promise<void> {
    this.currentFolder = folder;
    const metadataURL = `/data/${folder}/metadata.json`;
    const response = await fetch(metadataURL);
    if (!response.ok)
      throw new Error(`Failed to load metadata.json from ${folder}`);

    const entries: MetadataEntry[] = await response.json();
    this.metadataEntries = entries;

    this.showLoading(true, `Loading ${entries.length} objects...`);
    let loaded = 0;

    for (const entry of entries) {
      // modelUrl is like "/models/SomeName.glb" — the actual file is in the folder
      const fileName = entry.modelUrl.replace(/^\/models\//, "");
      const glbURL = `/data/${folder}/${encodeURIComponent(fileName)}`;

      try {
        await this.loadGLB(entry.id, glbURL);
        loaded++;
        this.updateLoadingProgress(`${loaded}/${entries.length} objects`);
      } catch (err) {
        console.warn(`Skipped ${entry.id}: ${(err as Error).message}`);
      }
    }

    this.showLoading(false);
    this.focusCamera();
  }

  private loadGLB(id: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      BABYLON.SceneLoader.ImportMesh(
        "",
        "",
        url,
        this.scene,
        (meshes) => {
          if (meshes.length === 0) {
            reject(new Error("No meshes"));
            return;
          }

          const root = new BABYLON.TransformNode(`${id}_root`, this.scene);
          root.metadata = { objectId: id };
          for (const mesh of meshes) {
            if (mesh.parent === null) mesh.parent = root;
            mesh.metadata = { objectId: id };
          }
          this.enhanceMaterials(meshes, id);
          this.loadedRoots.set(id, root);
          this.loadedMeshes.set(id, meshes);
          resolve();
        },
        undefined,
        (_scene, message) => reject(new Error(message)),
      );
    });
  }

  private enhanceMaterials(meshes: BABYLON.AbstractMesh[], id: string): void {
    for (const mesh of meshes) {
      if (!this.usePresetColors) continue;
      if (mesh.material) {
        const mat = mesh.material as
          | BABYLON.PBRMaterial
          | BABYLON.StandardMaterial;
        if (mat instanceof BABYLON.StandardMaterial) {
          if (!mat.diffuseTexture && mat.diffuseColor.equalsFloats(1, 1, 1)) {
            mat.diffuseColor = this.colorFromHash(this.hashCode(id));
          }
          mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        } else if (mat instanceof BABYLON.PBRMaterial) {
          if (!mat.albedoTexture && mat.albedoColor.equalsFloats(1, 1, 1)) {
            mat.albedoColor = this.colorFromHash(this.hashCode(id));
          }
          mat.metallic = 0.1;
          mat.roughness = 0.7;
        }
      } else if (this.usePresetColors) {
        const defaultMat = new BABYLON.StandardMaterial(
          `mat_${id}`,
          this.scene,
        );
        defaultMat.diffuseColor = this.colorFromHash(this.hashCode(id));
        defaultMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        mesh.material = defaultMat;
      }
    }
  }

  selectObject(id: string | null): void {
    if (this.selectedId) {
      const prevMeshes = this.loadedMeshes.get(this.selectedId);
      if (prevMeshes) {
        for (const mesh of prevMeshes) {
          if (mesh.material)
            (mesh.material as any).emissiveColor = new BABYLON.Color3(0, 0, 0);
        }
      }
    }

    this.selectedId = id;

    if (id) {
      const meshes = this.loadedMeshes.get(id);
      if (meshes) {
        for (const mesh of meshes) {
          if (mesh.material)
            (mesh.material as any).emissiveColor = new BABYLON.Color3(
              0.2,
              0.4,
              0.8,
            );
        }
      }
    }

    this.selectionListener?.(id);
  }

  clearScene(): void {
    for (const meshes of this.loadedMeshes.values()) {
      for (const mesh of meshes) mesh.dispose();
    }
    for (const root of this.loadedRoots.values()) root.dispose();
    this.loadedMeshes.clear();
    this.loadedRoots.clear();
    this.metadataEntries = [];
    this.selectedId = null;
    this.currentFolder = null;
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
      meshes.forEach((mesh) => {
        mesh.computeWorldMatrix(true);
        const bounds = mesh.getBoundingInfo();
        min = BABYLON.Vector3.Minimize(min, bounds.boundingBox.minimumWorld);
        max = BABYLON.Vector3.Maximize(max, bounds.boundingBox.maximumWorld);
      });
    });

    const center = BABYLON.Vector3.Center(min, max);
    const diagonal = max.subtract(min).length();

    this.camera.position = center.add(
      new BABYLON.Vector3(
        0,
        Math.max(diagonal * 0.25, 2),
        -Math.max(diagonal * 0.75, 8),
      ),
    );
    this.camera.setTarget(center);
  }

  private showLoading(show: boolean, text = "Loading..."): void {
    const overlay = document.getElementById("loading-overlay")!;
    const textEl = document.getElementById("loading-text")!;
    if (show) {
      textEl.textContent = text;
      overlay.classList.add("active");
    } else {
      overlay.classList.remove("active");
    }
  }

  private updateLoadingProgress(progress: string): void {
    document.getElementById("loading-progress")!.textContent = progress;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private colorFromHash(hash: number): BABYLON.Color3 {
    const hue = (hash % 360) / 360;
    const sat = 0.5 + (hash % 30) / 100;
    const light = 0.5 + (hash % 20) / 100;
    return BABYLON.Color3.FromHSV(hue * 360, sat, light);
  }
}

// ── UI Controller ──
class UIController {
  private viewer: SceneViewer;
  private folderSelect: HTMLSelectElement;
  private btnLoadFolder: HTMLButtonElement;
  private objectList: HTMLElement;
  private listCount: HTMLElement;
  private objectCount: HTMLElement;
  private btnResetCamera: HTMLButtonElement;
  private btnClearScene: HTMLButtonElement;
  private togglePresets: HTMLInputElement;
  private detailsPanel: HTMLElement;
  private fieldName: HTMLInputElement;
  private fieldCategory: HTMLSelectElement;
  private fieldPlacementType: HTMLSelectElement;
  private btnSaveMetadata: HTMLButtonElement;
  private saveStatus: HTMLElement;
  private activeId: string | null = null;

  constructor() {
    this.viewer = new SceneViewer("render-canvas");

    this.folderSelect = document.getElementById(
      "folder-select",
    ) as HTMLSelectElement;
    this.btnLoadFolder = document.getElementById(
      "btn-load-folder",
    ) as HTMLButtonElement;
    this.objectList = document.getElementById("object-list") as HTMLElement;
    this.listCount = document.getElementById("list-count") as HTMLElement;
    this.objectCount = document.getElementById("object-count") as HTMLElement;
    this.btnResetCamera = document.getElementById(
      "btn-reset-camera",
    ) as HTMLButtonElement;
    this.btnClearScene = document.getElementById(
      "btn-clear-scene",
    ) as HTMLButtonElement;
    this.togglePresets = document.getElementById(
      "toggle-presets",
    ) as HTMLInputElement;
    this.detailsPanel = document.getElementById("details-panel") as HTMLElement;
    this.fieldName = document.getElementById("field-name") as HTMLInputElement;
    this.fieldCategory = document.getElementById(
      "field-category",
    ) as HTMLSelectElement;
    this.fieldPlacementType = document.getElementById(
      "field-placement-type",
    ) as HTMLSelectElement;
    this.btnSaveMetadata = document.getElementById(
      "btn-save-metadata",
    ) as HTMLButtonElement;
    this.saveStatus = document.getElementById("save-status") as HTMLElement;

    this.viewer.setSelectionListener((id) => this.showDetails(id));
    this.viewer.setUsePresetColors(false);
    this.setupEventListeners();
    void this.loadFolderList();
  }

  private async loadFolderList(): Promise<void> {
    try {
      const response = await fetch("/api/folders");
      const folders: string[] = await response.json();
      this.folderSelect.innerHTML =
        '<option value="">-- Select folder --</option>';
      for (const folder of folders) {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        this.folderSelect.appendChild(option);
      }
      // Auto-select if only one folder
      if (folders.length === 1) {
        this.folderSelect.value = folders[0]!;
        void this.loadSelectedFolder();
      }
    } catch {
      // ignore
    }
  }

  private async loadSelectedFolder(): Promise<void> {
    const folder = this.folderSelect.value;
    if (!folder) return;

    try {
      this.viewer.clearScene();
      await this.viewer.loadMetadataFolder(folder);
      this.updateObjectList();
      this.updateObjectCount();
    } catch (err) {
      alert("Error loading folder: " + (err as Error).message);
    }
  }

  private setupEventListeners(): void {
    this.btnLoadFolder.addEventListener(
      "click",
      () => void this.loadSelectedFolder(),
    );

    this.btnResetCamera.addEventListener("click", () =>
      this.viewer.resetCamera(),
    );

    this.btnClearScene.addEventListener("click", () => {
      if (confirm("Clear all objects from the scene?")) {
        this.viewer.clearScene();
        this.updateObjectList();
        this.updateObjectCount();
        this.showDetails(null);
      }
    });

    this.togglePresets.addEventListener("change", () => {
      this.viewer.setUsePresetColors(this.togglePresets.checked);
    });

    this.btnSaveMetadata.addEventListener(
      "click",
      () => void this.saveCurrentEntry(),
    );
  }

  private async saveCurrentEntry(): Promise<void> {
    if (!this.activeId) return;

    const folder = this.viewer.getCurrentFolder();
    if (!folder) return;

    // Apply form values to the entry
    this.viewer.updateEntry(this.activeId, {
      name: this.fieldName.value.trim(),
      category: this.fieldCategory.value,
      placementType: this.fieldPlacementType.value,
    });

    // Save to server
    try {
      const response = await fetch("/api/save-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder,
          data: this.viewer.getMetadataEntries(),
        }),
      });

      if (response.ok) {
        this.saveStatus.textContent = "Saved!";
        this.saveStatus.style.color = "#6a6";
        // Update the sidebar label
        this.updateObjectList();
      } else {
        const err = await response.json();
        this.saveStatus.textContent = `Error: ${err.error}`;
        this.saveStatus.style.color = "#a66";
      }
    } catch {
      this.saveStatus.textContent = "Network error";
      this.saveStatus.style.color = "#a66";
    }

    setTimeout(() => {
      this.saveStatus.textContent = "";
    }, 2000);
  }

  private updateObjectList(): void {
    const entries = this.viewer.getMetadataEntries();

    if (entries.length === 0) {
      this.objectList.innerHTML = `
        <div class="empty-state">
          Select a folder with metadata.json and click "Load"
        </div>
      `;
      this.listCount.textContent = "0";
      return;
    }

    this.objectList.innerHTML = "";
    this.listCount.textContent = entries.length.toString();

    for (const entry of entries) {
      const item = document.createElement("div");
      item.className = "object-item";
      if (entry.id === this.activeId) item.classList.add("selected");

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = entry.name || entry.id;

      const catSpan = document.createElement("span");
      catSpan.className = "coords";
      catSpan.textContent = entry.category;

      item.appendChild(nameSpan);
      item.appendChild(catSpan);

      item.addEventListener("click", () => {
        this.objectList.querySelectorAll(".object-item").forEach((el) => {
          el.classList.remove("selected");
        });
        item.classList.add("selected");
        this.viewer.selectObject(entry.id);
      });

      this.objectList.appendChild(item);
    }
  }

  private updateObjectCount(): void {
    const count = this.viewer.getMetadataEntries().length;
    this.objectCount.textContent =
      count === 0
        ? "No objects loaded"
        : `${count} object${count === 1 ? "" : "s"} loaded`;
  }

  private showDetails(id: string | null): void {
    this.activeId = id;
    if (!id) {
      this.detailsPanel.classList.add("hidden");
      return;
    }

    const entry = this.viewer.getEntry(id);
    if (!entry) {
      this.detailsPanel.classList.add("hidden");
      return;
    }

    this.detailsPanel.classList.remove("hidden");
    this.fieldName.value = entry.name;
    this.fieldCategory.value = entry.category;
    this.fieldPlacementType.value = entry.placementType;
    this.saveStatus.textContent = "";
  }
}

// ── Initialize ──
window.addEventListener("DOMContentLoaded", () => {
  new UIController();
});
