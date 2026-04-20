import * as THREE from "three";
import { FlyControls } from "three/examples/jsm/controls/FlyControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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

type SceneMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  map?: THREE.Texture | null;
  userData: {
    baseColor?: THREE.Color;
    baseEmissive?: THREE.Color;
    baseEmissiveIntensity?: number;
  };
};

const HIGHLIGHT_COLOR = new THREE.Color(0.2, 0.4, 0.8);

class SceneViewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: FlyControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private gltfLoader: GLTFLoader;
  private canvas: HTMLCanvasElement;
  private loadedMeshes: Map<string, THREE.Mesh[]> = new Map();
  private loadedRoots: Map<string, THREE.Object3D> = new Map();
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
    return this.metadataEntries.find((entry) => entry.id === id);
  }

  getCurrentFolder(): string | null {
    return this.currentFolder;
  }

  updateEntry(id: string, patch: Partial<MetadataEntry>): void {
    const entry = this.metadataEntries.find((item) => item.id === id);
    if (!entry) return;
    Object.assign(entry, patch);
  }

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(
      this.getViewportWidth(),
      this.getViewportHeight(),
      false,
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc8ccd9);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.getAspectRatio(),
      0.05,
      5000,
    );
    this.camera.position.set(0, 2, -8);

    this.controls = new FlyControls(this.camera, this.canvas);
    this.controls.movementSpeed = 8;
    this.controls.rollSpeed = 0;
    this.controls.autoForward = false;
    this.controls.dragToLook = true;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
    );

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(dracoLoader);

    this.setupScene();
    this.setupInteractions();

    this.renderer.setAnimationLoop(this.animate);
    window.addEventListener("resize", this.handleResize);
  }

  private getViewportWidth(): number {
    return this.canvas.clientWidth || window.innerWidth;
  }

  private getViewportHeight(): number {
    return this.canvas.clientHeight || window.innerHeight;
  }

  private getAspectRatio(): number {
    return this.getViewportWidth() / Math.max(this.getViewportHeight(), 1);
  }

  private setupScene(): void {
    const ambient = new THREE.HemisphereLight(0xffffff, 0x8c93a6, 1.1);
    this.scene.add(ambient);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(6, 12, 5);
    dirLight1.castShadow = true;
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.45);
    dirLight2.position.set(-6, 8, -6);
    this.scene.add(dirLight2);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({
        color: 0x66666f,
        roughness: 1,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    ground.name = "ground";
    this.scene.add(ground);

    const grid = new THREE.GridHelper(1000, 50, 0x80808a, 0x55555e);
    grid.position.y = 0.01;
    this.scene.add(grid);
  }

  private setupInteractions(): void {
    this.canvas.addEventListener("click", this.handleCanvasClick);
    this.canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.handlePointerDown);
  }

  private handleResize = (): void => {
    this.camera.aspect = this.getAspectRatio();
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(
      this.getViewportWidth(),
      this.getViewportHeight(),
      false,
    );
  };

  private handleCanvasClick = (event: MouseEvent): void => {
    this.updatePointer(event.clientX, event.clientY);
    this.selectFromPointer();
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.updatePointer(event.clientX, event.clientY);
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const zoomFactor = Math.exp(event.deltaY * 0.0015);
    this.camera.fov = THREE.MathUtils.clamp(
      this.camera.fov * zoomFactor,
      25,
      75,
    );
    this.camera.updateProjectionMatrix();
  };

  private animate = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.controls.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private updatePointer(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }

  private selectFromPointer(): void {
    if (this.loadedRoots.size === 0) return;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(
      Array.from(this.loadedRoots.values()),
      true,
    );

    for (const hit of intersections) {
      const objectId = this.findObjectIdFromObject(hit.object);
      if (objectId) {
        this.selectObject(objectId);
        return;
      }
    }
  }

  private findObjectIdFromObject(object: THREE.Object3D): string | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      const objectId = node.userData?.objectId;
      if (typeof objectId === "string" && objectId.length > 0) return objectId;
      node = node.parent;
    }
    return null;
  }

  async loadMetadataFolder(folder: string): Promise<void> {
    this.currentFolder = folder;
    const metadataURL = `/data/${folder}/metadata.json`;
    const response = await fetch(metadataURL);
    if (!response.ok) {
      throw new Error(`Failed to load metadata.json from ${folder}`);
    }

    const entries = (await response.json()) as MetadataEntry[];
    this.metadataEntries = entries;

    this.showLoading(true, `Loading ${entries.length} objects...`);
    let loaded = 0;

    for (const entry of entries) {
      const fileName = entry.modelUrl.replace(/^\/models\//, "");
      const glbURL = `/data/${folder}/${encodeURIComponent(fileName)}`;

      try {
        await this.loadGLB(entry, glbURL);
        loaded += 1;
        this.updateLoadingProgress(`${loaded}/${entries.length} objects`);
      } catch (error) {
        console.warn(`Skipped ${entry.id}: ${(error as Error).message}`);
      }
    }

    this.showLoading(false);
    this.focusCamera();
  }

  private async loadGLB(entry: MetadataEntry, url: string): Promise<void> {
    const gltf = await this.gltfLoader.loadAsync(url);
    const root = gltf.scene;

    if (!root) {
      throw new Error("No scene");
    }

    root.name = `${entry.id}_root`;
    root.userData.objectId = entry.id;

    const meshes: THREE.Mesh[] = [];

    root.traverse((object: THREE.Object3D) => {
      object.userData = { ...object.userData, objectId: entry.id };

      if (object instanceof THREE.Mesh) {
        meshes.push(object);
        object.castShadow = true;
        object.receiveShadow = true;
        object.material = this.cloneMaterial(object.material, entry.id);
        this.applyMaterialDefaults(object.material, entry.id);
      }
    });

    if (meshes.length === 0) {
      throw new Error("No meshes");
    }

    this.scene.add(root);
    this.loadedRoots.set(entry.id, root);
    this.loadedMeshes.set(entry.id, meshes);
    this.refreshSelectionState(entry.id);
  }

  private cloneMaterial(
    material: THREE.Material | THREE.Material[] | null,
    id: string,
  ): THREE.Material | THREE.Material[] {
    if (Array.isArray(material)) {
      return material.map((item) => this.cloneSingleMaterial(item, id));
    }

    if (material) {
      return this.cloneSingleMaterial(material, id);
    }

    const fallback = new THREE.MeshStandardMaterial({
      color: this.usePresetColors
        ? this.colorFromHash(this.hashCode(id))
        : 0xb8b8b8,
      roughness: 0.8,
      metalness: 0.05,
    });
    this.captureBaseMaterialState(fallback);
    return fallback;
  }

  private cloneSingleMaterial(
    material: THREE.Material,
    id: string,
  ): THREE.Material {
    const cloned = material.clone();
    this.captureBaseMaterialState(cloned as SceneMaterial);
    return cloned;
  }

  private captureBaseMaterialState(material: SceneMaterial): void {
    if (material.color) {
      material.userData.baseColor = material.color.clone();
    }
    if (material.emissive) {
      material.userData.baseEmissive = material.emissive.clone();
    }
    if (typeof material.emissiveIntensity === "number") {
      material.userData.baseEmissiveIntensity = material.emissiveIntensity;
    }
  }

  private applyMaterialDefaults(
    material: THREE.Material | THREE.Material[],
    id: string,
  ): void {
    const materials = Array.isArray(material) ? material : [material];

    for (const item of materials) {
      const typed = item as SceneMaterial;

      if (
        this.usePresetColors &&
        typed.color &&
        !typed.map &&
        this.isWhiteColor(typed.color)
      ) {
        typed.color.copy(this.colorFromHash(this.hashCode(id)));
      }

      if (typeof typed.roughness === "number") {
        typed.roughness = 0.7;
      }

      if (typeof typed.metalness === "number") {
        typed.metalness = 0.1;
      }

      this.captureBaseMaterialState(typed);
    }
  }

  private refreshSelectionState(id: string): void {
    if (this.selectedId === id) {
      this.setObjectHighlighted(id, true);
    }
  }

  private setObjectHighlighted(id: string | null, highlighted: boolean): void {
    if (!id) return;

    const meshes = this.loadedMeshes.get(id);
    if (!meshes) return;

    for (const mesh of meshes) {
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        this.applyHighlightToMaterial(material as SceneMaterial, highlighted);
      }
    }
  }

  private applyHighlightToMaterial(
    material: SceneMaterial,
    highlighted: boolean,
  ): void {
    if (material.emissive) {
      if (highlighted) {
        material.emissive.copy(HIGHLIGHT_COLOR);
        if (typeof material.emissiveIntensity === "number") {
          material.emissiveIntensity = Math.max(
            0.8,
            material.emissiveIntensity,
          );
        }
      } else {
        if (material.userData.baseEmissive) {
          material.emissive.copy(material.userData.baseEmissive);
        }
        if (typeof material.userData.baseEmissiveIntensity === "number") {
          material.emissiveIntensity = material.userData.baseEmissiveIntensity;
        }
      }
      return;
    }

    if (!material.color) return;

    if (highlighted) {
      const baseColor = material.userData.baseColor ?? material.color.clone();
      material.color.copy(baseColor).lerp(HIGHLIGHT_COLOR, 0.3);
      return;
    }

    if (material.userData.baseColor) {
      material.color.copy(material.userData.baseColor);
    }
  }

  selectObject(id: string | null): void {
    if (this.selectedId === id) {
      this.selectionListener?.(id);
      return;
    }

    if (this.selectedId) {
      this.setObjectHighlighted(this.selectedId, false);
    }

    this.selectedId = id;

    if (id) {
      this.setObjectHighlighted(id, true);
    }

    this.selectionListener?.(id);
  }

  isSelected(id: string): boolean {
    return this.selectedId === id;
  }

  clearScene(): void {
    if (this.selectedId) {
      this.setObjectHighlighted(this.selectedId, false);
    }

    for (const root of this.loadedRoots.values()) {
      this.scene.remove(root);
      this.disposeObject(root);
    }

    this.loadedMeshes.clear();
    this.loadedRoots.clear();
    this.metadataEntries = [];
    this.selectedId = null;
    this.currentFolder = null;
    this.selectionListener?.(null);
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((node: THREE.Object3D) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of materials) {
          material.dispose();
        }
      }
    });
  }

  resetCamera(): void {
    this.focusCamera();
  }

  private focusCamera(): void {
    if (this.loadedRoots.size === 0) {
      this.camera.position.set(0, 2, -8);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    const box = new THREE.Box3();
    const temp = new THREE.Box3();

    for (const root of this.loadedRoots.values()) {
      temp.setFromObject(root);
      if (!temp.isEmpty()) {
        box.union(temp);
      }
    }

    if (box.isEmpty()) {
      this.camera.position.set(0, 2, -8);
      this.camera.lookAt(0, 0, 0);
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 1);

    this.camera.position.set(
      center.x,
      center.y + Math.max(radius * 0.35, 2),
      center.z - Math.max(radius * 1.8, 8),
    );
    this.camera.lookAt(center);
  }

  private showLoading(show: boolean, text = "Loading..."): void {
    const overlay = document.getElementById("loading-overlay")!;
    const textEl = document.getElementById("loading-text")!;
    if (show) {
      textEl.textContent = text;
      overlay.classList.add("active");
      return;
    }

    overlay.classList.remove("active");
  }

  private updateLoadingProgress(progress: string): void {
    document.getElementById("loading-progress")!.textContent = progress;
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let index = 0; index < str.length; index += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  private colorFromHash(hash: number): THREE.Color {
    const hue = (hash % 360) / 360;
    const saturation = 0.5 + (hash % 30) / 100;
    const lightness = 0.5 + (hash % 20) / 100;
    return new THREE.Color().setHSL(hue, saturation, lightness);
  }

  private isWhiteColor(color: THREE.Color): boolean {
    return color.r > 0.98 && color.g > 0.98 && color.b > 0.98;
  }
}

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
      const folders = (await response.json()) as string[];
      this.folderSelect.innerHTML =
        '<option value="">-- Select folder --</option>';

      for (const folder of folders) {
        const option = document.createElement("option");
        option.value = folder;
        option.textContent = folder;
        this.folderSelect.appendChild(option);
      }

      if (folders.length === 1) {
        this.folderSelect.value = folders[0]!;
        void this.loadSelectedFolder();
      }
    } catch {
      // Ignore folder discovery failures.
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
    } catch (error) {
      alert("Error loading folder: " + (error as Error).message);
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

  private syncSelectedListItem(id: string | null): void {
    this.objectList.querySelectorAll(".object-item").forEach((element) => {
      const item = element as HTMLElement;
      item.classList.toggle("selected", item.dataset.objectId === id);
    });
  }

  private async saveCurrentEntry(): Promise<void> {
    if (!this.activeId) return;

    const folder = this.viewer.getCurrentFolder();
    if (!folder) return;

    this.viewer.updateEntry(this.activeId, {
      name: this.fieldName.value.trim(),
      category: this.fieldCategory.value,
      placementType: this.fieldPlacementType.value,
    });

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
        this.updateObjectList();
      } else {
        const err = (await response.json()) as { error?: string };
        this.saveStatus.textContent = `Error: ${err.error ?? "Unknown error"}`;
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
      item.dataset.objectId = entry.id;

      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = entry.name || entry.id;

      const catSpan = document.createElement("span");
      catSpan.className = "coords";
      catSpan.textContent = entry.category;

      item.appendChild(nameSpan);
      item.appendChild(catSpan);

      item.addEventListener("click", () => {
        this.objectList.querySelectorAll(".object-item").forEach((element) => {
          element.classList.remove("selected");
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
    this.syncSelectedListItem(id);
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

window.addEventListener("DOMContentLoaded", () => {
  new UIController();
});
