import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Quat4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface MetadataEntry {
  id: string;
  name: string;
  category: string;
  shape: string;
  size: number[];
  placementType: string;
  price: string;
  color: string;
  modelUrl: string;
  position: Vec3;
  rotation?: Quat4;
}

interface TransformSnapshot {
  id: string;
  name: string;
  category: string;
  placementType: string;
  price: string;
  position: Vec3;
  rotation: Quat4;
  worldSize: Vec3;
  metadataSize: Vec3 | null;
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

const HIGHLIGHT_COLOR = new THREE.Color(0.23, 0.52, 0.98);
const DEFAULT_POSITION: Vec3 = { x: 0, y: 0, z: 0 };
const DEFAULT_ROTATION: Quat4 = { x: 0, y: 0, z: 0, w: 1 };

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function cloneQuat4(value: Quat4): Quat4 {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function vec3From(
  input: Partial<Vec3> | null | undefined,
  fallback: Vec3,
): Vec3 {
  if (!input) return cloneVec3(fallback);
  return {
    x: Number.isFinite(input.x) ? input.x : fallback.x,
    y: Number.isFinite(input.y) ? input.y : fallback.y,
    z: Number.isFinite(input.z) ? input.z : fallback.z,
  };
}

function vec3FromArray(
  input: number[] | null | undefined,
  fallback: Vec3,
): Vec3 {
  if (!Array.isArray(input) || input.length < 3) return cloneVec3(fallback);
  return {
    x: Number.isFinite(input[0]) ? input[0] : fallback.x,
    y: Number.isFinite(input[1]) ? input[1] : fallback.y,
    z: Number.isFinite(input[2]) ? input[2] : fallback.z,
  };
}

function vec3FromArrayOrNull(input: number[] | null | undefined): Vec3 | null {
  if (!Array.isArray(input) || input.length < 3) return null;

  const [x, y, z] = input;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return { x, y, z };
}

function quatFrom(
  input: Partial<Quat4> | null | undefined,
  fallback: Quat4,
): Quat4 {
  if (!input) return cloneQuat4(fallback);

  return {
    x: Number.isFinite(input.x) ? input.x : fallback.x,
    y: Number.isFinite(input.y) ? input.y : fallback.y,
    z: Number.isFinite(input.z) ? input.z : fallback.z,
    w: Number.isFinite(input.w) ? input.w : fallback.w,
  };
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function formatVec3(value: Vec3, digits = 2): string {
  return `${formatNumber(value.x, digits)} × ${formatNumber(
    value.y,
    digits,
  )} × ${formatNumber(value.z, digits)}`;
}

class SceneEditor {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
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
  private currentFolder: string | null = null;

  setSelectionListener(listener: ((id: string | null) => void) | null): void {
    this.selectionListener = listener;
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
    this.scene.background = new THREE.Color(0x0d1117);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.getAspectRatio(),
      0.05,
      5000,
    );
    this.camera.position.set(0, 2, -8);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.zoomSpeed = 1.2;
    this.controls.rotateSpeed = 0.7;
    this.controls.panSpeed = 0.8;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 2000;
    this.controls.target.set(0, 1, 0);

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
    const ambient = new THREE.HemisphereLight(0xdde8ff, 0x253148, 1.2);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(6, 12, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xcfe0ff, 0.5);
    fillLight.position.set(-7, 5, -8);
    this.scene.add(fillLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({
        color: 0x111824,
        roughness: 1,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    ground.name = "ground";
    this.scene.add(ground);

    const grid = new THREE.GridHelper(1000, 50, 0x38506d, 0x1f2a3a);
    grid.position.y = 0.01;
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(2.5);
    axes.position.set(0, 0.02, 0);
    this.scene.add(axes);
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
    this.controls.update();
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
    let revealed = false;

    for (const entry of entries) {
      const fileName = entry.modelUrl.replace(/^\/models\//, "");
      const glbURL = `/data/${folder}/${encodeURIComponent(fileName)}`;

      try {
        await this.loadGLB(entry, glbURL);
        loaded += 1;
        this.updateLoadingProgress(`${loaded}/${entries.length} objects`);

        if (!revealed) {
          revealed = true;
          this.selectObject(entry.id);
          this.focusSelected();
          this.showLoading(false);
        }
      } catch (error) {
        console.warn(`Skipped ${entry.id}: ${(error as Error).message}`);
      }
    }

    if (!revealed) {
      this.showLoading(false);
    }
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
    this.applyEntryTransform(root, entry);
    this.refreshSelectionState(entry.id);
  }

  private applyEntryTransform(
    root: THREE.Object3D,
    entry: MetadataEntry,
  ): void {
    const position = vec3From(entry.position, DEFAULT_POSITION);
    const rotation = quatFrom(entry.rotation, DEFAULT_ROTATION);

    root.position.set(position.x, position.y, position.z);
    root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    root.updateMatrixWorld(true);
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
      color: 0xb8b8b8,
      roughness: 0.8,
      metalness: 0.05,
    });
    this.captureBaseMaterialState(fallback);
    return fallback;
  }

  private cloneSingleMaterial(
    material: THREE.Material,
    _id: string,
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

      if (typed.color && !typed.map && this.isWhiteColor(typed.color)) {
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

  updateEntry(id: string, patch: Partial<MetadataEntry>): void {
    const entry = this.metadataEntries.find((item) => item.id === id);
    if (!entry) return;

    if (patch.name !== undefined) entry.name = patch.name;
    if (patch.category !== undefined) entry.category = patch.category;
    if (patch.shape !== undefined) entry.shape = patch.shape;
    if (patch.size !== undefined) entry.size = [...patch.size];
    if (patch.placementType !== undefined)
      entry.placementType = patch.placementType;
    if (patch.price !== undefined) entry.price = patch.price;
    if (patch.color !== undefined) entry.color = patch.color;
    if (patch.modelUrl !== undefined) entry.modelUrl = patch.modelUrl;
    if (patch.position !== undefined)
      entry.position = cloneVec3(patch.position);
    if (patch.rotation !== undefined)
      entry.rotation = cloneVec3(patch.rotation);

    const root = this.loadedRoots.get(id);
    if (!root) return;

    if (patch.position !== undefined) {
      root.position.copy(
        new THREE.Vector3(entry.position.x, entry.position.y, entry.position.z),
      );
    }

    if (patch.rotation !== undefined) {
      const rotation = quatFrom(entry.rotation, DEFAULT_ROTATION);
      root.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }

    root.updateMatrixWorld(true);
  }

  getSnapshot(id: string): TransformSnapshot | null {
    const entry = this.getEntry(id);
    const root = this.loadedRoots.get(id);
    if (!entry || !root) return null;

    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());

    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      placementType: entry.placementType,
      price: entry.price,
      position: cloneVec3(entry.position),
      rotation: cloneQuat4(root.quaternion),
      worldSize: {
        x: size.x,
        y: size.y,
        z: size.z,
      },
      metadataSize: vec3FromArrayOrNull(entry.size),
    };
  }

  getSelectedSnapshot(): TransformSnapshot | null {
    if (!this.selectedId) return null;
    return this.getSnapshot(this.selectedId);
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

  focusSelected(): void {
    if (!this.selectedId) {
      this.focusCamera();
      return;
    }

    const root = this.loadedRoots.get(this.selectedId);
    if (!root) {
      this.focusCamera();
      return;
    }

    this.focusObject(root);
  }

  private focusObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
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

  private focusCamera(): void {
    if (this.loadedRoots.size === 0) {
      this.camera.position.set(0, 2, -8);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
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
      this.controls.target.set(0, 0, 0);
      this.controls.update();
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
    this.controls.target.copy(center);
    this.controls.update();
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

type VectorInputs = {
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
};

type QuaternionInputs = {
  x: HTMLInputElement;
  y: HTMLInputElement;
  z: HTMLInputElement;
  w: HTMLInputElement;
};

class EditorController {
  private viewer: SceneEditor;
  private folderSelect: HTMLSelectElement;
  private btnLoadFolder: HTMLButtonElement;
  private objectList: HTMLElement;
  private listCount: HTMLElement;
  private objectCount: HTMLElement;
  private btnResetCamera: HTMLButtonElement;
  private btnFocusSelected: HTMLButtonElement;
  private btnResetTransform: HTMLButtonElement;
  private btnClearScene: HTMLButtonElement;
  private btnSaveMetadata: HTMLButtonElement;
  private inspectorPanel: HTMLElement;
  private selectionTitle: HTMLElement;
  private selectionSubtitle: HTMLElement;
  private positionInputs: VectorInputs;
  private rotationInputs: QuaternionInputs;
  private boundsReadout: HTMLElement;
  private metadataSizeReadout: HTMLElement;
  private saveStatus: HTMLElement;
  private activeId: string | null = null;

  constructor() {
    this.viewer = new SceneEditor("render-canvas");

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
    this.btnFocusSelected = document.getElementById(
      "btn-focus-selected",
    ) as HTMLButtonElement;
    this.btnResetTransform = document.getElementById(
      "btn-reset-transform",
    ) as HTMLButtonElement;
    this.btnClearScene = document.getElementById(
      "btn-clear-scene",
    ) as HTMLButtonElement;
    this.btnSaveMetadata = document.getElementById(
      "btn-save-metadata",
    ) as HTMLButtonElement;
    this.inspectorPanel = document.getElementById(
      "inspector-panel",
    ) as HTMLElement;
    this.selectionTitle = document.getElementById(
      "selection-title",
    ) as HTMLElement;
    this.selectionSubtitle = document.getElementById(
      "selection-subtitle",
    ) as HTMLElement;
    this.positionInputs = {
      x: document.getElementById("position-x") as HTMLInputElement,
      y: document.getElementById("position-y") as HTMLInputElement,
      z: document.getElementById("position-z") as HTMLInputElement,
    };
    this.rotationInputs = {
      x: document.getElementById("rotation-x") as HTMLInputElement,
      y: document.getElementById("rotation-y") as HTMLInputElement,
      z: document.getElementById("rotation-z") as HTMLInputElement,
      w: document.getElementById("rotation-w") as HTMLInputElement,
    };
    this.boundsReadout = document.getElementById(
      "bounds-readout",
    ) as HTMLElement;
    this.metadataSizeReadout = document.getElementById(
      "metadata-size-readout",
    ) as HTMLElement;
    this.saveStatus = document.getElementById("save-status") as HTMLElement;

    this.viewer.setSelectionListener((id) => this.showSelection(id));
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

      if (folders.length > 0) {
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
      if (this.activeId) {
        this.showSelection(this.activeId);
      }
    } catch (error) {
      alert("Error loading folder: " + (error as Error).message);
    }
  }

  private setupEventListeners(): void {
    this.btnLoadFolder.addEventListener(
      "click",
      () => void this.loadSelectedFolder(),
    );

    this.btnResetCamera.addEventListener("click", () => {
      this.viewer.resetCamera();
    });

    this.btnFocusSelected.addEventListener("click", () => {
      this.viewer.focusSelected();
    });

    this.btnResetTransform.addEventListener("click", () => {
      if (!this.activeId) return;
      this.viewer.updateEntry(this.activeId, {
        position: cloneVec3(DEFAULT_POSITION),
        rotation: cloneQuat4(DEFAULT_ROTATION),
      });
      this.renderSelection(this.activeId, true);
    });

    this.btnClearScene.addEventListener("click", () => {
      if (confirm("Clear all objects from the scene?")) {
        this.viewer.clearScene();
        this.updateObjectList();
        this.updateObjectCount();
        this.showSelection(null);
      }
    });

    this.btnSaveMetadata.addEventListener(
      "click",
      () => void this.saveCurrentFolder(),
    );

    this.bindVectorInputs(this.positionInputs, () => this.commitTransform());
    this.bindQuaternionInputs(this.rotationInputs, () =>
      this.commitTransform(),
    );
  }

  private bindVectorInputs(inputs: VectorInputs, handler: () => void): void {
    inputs.x.addEventListener("input", handler);
    inputs.y.addEventListener("input", handler);
    inputs.z.addEventListener("input", handler);
  }

  private bindQuaternionInputs(
    inputs: QuaternionInputs,
    handler: () => void,
  ): void {
    inputs.x.addEventListener("input", handler);
    inputs.y.addEventListener("input", handler);
    inputs.z.addEventListener("input", handler);
    inputs.w.addEventListener("input", handler);
  }

  private readVectorInputs(inputs: VectorInputs, min = -Infinity): Vec3 {
    const values = [inputs.x, inputs.y, inputs.z].map(
      (input) => input.valueAsNumber,
    );
    return {
      x: Number.isFinite(values[0])
        ? Math.max(values[0]!, min)
        : min === -Infinity
          ? 0
          : min,
      y: Number.isFinite(values[1])
        ? Math.max(values[1]!, min)
        : min === -Infinity
          ? 0
          : min,
      z: Number.isFinite(values[2])
        ? Math.max(values[2]!, min)
        : min === -Infinity
          ? 0
          : min,
    };
  }

  private writeVectorInputs(inputs: VectorInputs, value: Vec3): void {
    inputs.x.value = formatNumber(value.x, 4);
    inputs.y.value = formatNumber(value.y, 4);
    inputs.z.value = formatNumber(value.z, 4);
  }

  private readQuaternionInputs(inputs: QuaternionInputs): Quat4 {
    const values = [inputs.x, inputs.y, inputs.z, inputs.w].map(
      (input) => input.valueAsNumber,
    );

    return {
      x: Number.isFinite(values[0]) ? values[0]! : 0,
      y: Number.isFinite(values[1]) ? values[1]! : 0,
      z: Number.isFinite(values[2]) ? values[2]! : 0,
      w: Number.isFinite(values[3]) ? values[3]! : 1,
    };
  }

  private writeQuaternionInputs(inputs: QuaternionInputs, value: Quat4): void {
    inputs.x.value = formatNumber(value.x, 6);
    inputs.y.value = formatNumber(value.y, 6);
    inputs.z.value = formatNumber(value.z, 6);
    inputs.w.value = formatNumber(value.w, 6);
  }

  private commitTransform(): void {
    if (!this.activeId) return;

    const position = this.readVectorInputs(this.positionInputs);
    const rotation = this.readQuaternionInputs(this.rotationInputs);

    this.viewer.updateEntry(this.activeId, {
      position,
      rotation,
    });
    this.renderSelection(this.activeId, true);
  }

  private syncSelectedListItem(id: string | null): void {
    this.objectList
      .querySelectorAll<HTMLElement>(".object-item")
      .forEach((row) => {
        row.classList.toggle("selected", row.dataset.objectId === id);
      });
  }

  private async saveCurrentFolder(): Promise<void> {
    const folder = this.viewer.getCurrentFolder();
    if (!folder) return;

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
        this.saveStatus.style.color = "#6fcf97";
      } else {
        const err = (await response.json()) as { error?: string };
        this.saveStatus.textContent = `Error: ${err.error ?? "Unknown error"}`;
        this.saveStatus.style.color = "#f87171";
      }
    } catch {
      this.saveStatus.textContent = "Network error";
      this.saveStatus.style.color = "#f87171";
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

  private showSelection(id: string | null): void {
    this.activeId = id;
    this.syncSelectedListItem(id);
    this.renderSelection(id, true);
  }

  private renderSelection(id: string | null, refreshInputs: boolean): void {
    const hasSelection = Boolean(id);
    this.inspectorPanel.classList.toggle("hidden", !hasSelection);
    this.btnFocusSelected.disabled = !hasSelection;
    this.btnResetTransform.disabled = !hasSelection;

    if (!id) {
      this.selectionTitle.textContent = "No object selected";
      this.selectionSubtitle.textContent = "Load a folder and click an object";
      this.writeQuaternionInputs(this.rotationInputs, DEFAULT_ROTATION);
      this.boundsReadout.textContent = "—";
      this.metadataSizeReadout.textContent = "—";
      return;
    }

    const snapshot = this.viewer.getSnapshot(id);
    if (!snapshot) {
      this.selectionTitle.textContent = "Selection unavailable";
      this.selectionSubtitle.textContent = id;
      this.writeQuaternionInputs(this.rotationInputs, DEFAULT_ROTATION);
      this.boundsReadout.textContent = "—";
      this.metadataSizeReadout.textContent = "—";
      return;
    }

    this.selectionTitle.textContent = snapshot.name || snapshot.id;
    this.selectionSubtitle.textContent = `${snapshot.id} · ${snapshot.category} · ${snapshot.placementType}`;

    if (refreshInputs) {
      this.writeVectorInputs(this.positionInputs, snapshot.position);
      this.writeQuaternionInputs(this.rotationInputs, snapshot.rotation);
    }

    this.boundsReadout.textContent = formatVec3(snapshot.worldSize, 2);
    this.metadataSizeReadout.textContent = snapshot.metadataSize
      ? formatVec3(snapshot.metadataSize, 2)
      : "—";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new EditorController();
});
