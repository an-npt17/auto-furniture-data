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
  objectRole?: "window" | "door" | null;
  shape: string;
  size: [number, number, number];
  placementType: string;
  color: string;
  modelUrl: string;
  position: Vec3;
  rotation?: Quat4;
}

interface MetadataDocument {
  objects: MetadataEntry[];
  [key: string]: unknown;
}

interface RawMetadataEntry {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  objectRole?: unknown;
  shape?: unknown;
  type?: unknown;
  size?: unknown;
  scale?: unknown;
  placementType?: unknown;
  color?: unknown;
  modelUrl?: unknown;
  position?: unknown;
  location?: unknown;
  rotation?: unknown;
  [key: string]: unknown;
}

interface RawMetadataDocument {
  objects?: RawMetadataEntry[];
  [key: string]: unknown;
}

type RawMetadata = RawMetadataEntry[] | RawMetadataDocument;

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
const DEFAULT_POSITION: Vec3 = { x: 0, y: 0, z: 0 };
const DEFAULT_ROTATION: Quat4 = { x: 0, y: 0, z: 0, w: 1 };
const DEFAULT_SIZE: Vec3 = { x: 0, y: 0, z: 0 };
const LINEAR_UNIT_SCALE = 0.001;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function readString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function vec3FromValue(input: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(input)) {
    return {
      x: toNumber(input[0], fallback.x),
      y: toNumber(input[1], fallback.y),
      z: toNumber(input[2], fallback.z),
    };
  }

  if (isObject(input)) {
    return {
      x: toNumber(input.x, fallback.x),
      y: toNumber(input.y, fallback.y),
      z: toNumber(input.z, fallback.z),
    };
  }

  return { ...fallback };
}

function quatFromValue(input: unknown, fallback: Quat4): Quat4 {
  if (Array.isArray(input) && input.length >= 4) {
    const quat = {
      x: toNumber(input[0], fallback.x),
      y: toNumber(input[1], fallback.y),
      z: toNumber(input[2], fallback.z),
      w: toNumber(input[3], fallback.w),
    };
    return normalizeQuat(quat, fallback);
  }

  if (isObject(input)) {
    const quat = {
      x: toNumber(input.x, fallback.x),
      y: toNumber(input.y, fallback.y),
      z: toNumber(input.z, fallback.z),
      w: toNumber(input.w, fallback.w),
    };
    return normalizeQuat(quat, fallback);
  }

  return { ...fallback };
}

function normalizeQuat(value: Quat4, fallback: Quat4): Quat4 {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  if (!Number.isFinite(length) || length === 0) return { ...fallback };
  if (Math.abs(length - 1) < 1e-4) return value;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

function scaleVec3(value: Vec3, scale: number): Vec3 {
  return {
    x: value.x * scale,
    y: value.y * scale,
    z: value.z * scale,
  };
}

function normalizeObjectRole(
  value: unknown,
): MetadataEntry["objectRole"] | undefined {
  if (value === null || value === "null") return null;
  if (value === "window" || value === "door") return value;
  return undefined;
}

function normalizeMetadata(
  raw: RawMetadata,
): { entries: MetadataEntry[]; document: MetadataDocument | null } {
  const rawEntries = Array.isArray(raw) ? raw : raw.objects;
  if (!Array.isArray(rawEntries)) {
    throw new Error("Unsupported metadata.json structure");
  }

  const entries = rawEntries
    .map((entry, index) => normalizeMetadataEntry(entry, index))
    .filter((entry): entry is MetadataEntry => Boolean(entry));

  return {
    entries,
    document: Array.isArray(raw) ? null : (raw as MetadataDocument),
  };
}

function normalizeMetadataEntry(
  entry: RawMetadataEntry,
  index: number,
): MetadataEntry | null {
  const modelUrl = readString(entry.modelUrl, "").trim();
  if (!modelUrl) return null;

  const id = readString(entry.id, "").trim() || `object-${index + 1}`;
  const name = readString(entry.name, id);
  const category = readString(entry.category, "");
  const shape = readString(entry.shape ?? entry.type, "model");
  const sizeValue = scaleVec3(
    vec3FromValue(entry.size ?? entry.scale, DEFAULT_SIZE),
    LINEAR_UNIT_SCALE,
  );
  const placementType = readString(entry.placementType, "floor");
  const color = readString(entry.color, "#ffffff");
  const position = scaleVec3(
    vec3FromValue(entry.position ?? entry.location, DEFAULT_POSITION),
    LINEAR_UNIT_SCALE,
  );
  const rotation = quatFromValue(entry.rotation, DEFAULT_ROTATION);

  return {
    id,
    name,
    category,
    objectRole: normalizeObjectRole(entry.objectRole),
    shape,
    size: [sizeValue.x, sizeValue.y, sizeValue.z],
    placementType,
    color,
    modelUrl,
    position,
    rotation,
  };
}

class SceneViewer {
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
  private metadataDocument: MetadataDocument | null = null;
  private selectedId: string | null = null;
  private selectionListener: ((id: string | null) => void) | null = null;
  private usePresetColors = false;
  private currentFolder: string | null = null;
  private normalizeMetadata = false;

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

  getMetadataDocument(): MetadataDocument | null {
    return this.metadataDocument;
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

  constructor(
    canvasId: string,
    options?: { normalizeMetadata?: boolean },
  ) {
    this.normalizeMetadata = options?.normalizeMetadata ?? false;
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
      15,
      90,
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

    const raw = (await response.json()) as RawMetadata;
    let entries: MetadataEntry[];
    let document: MetadataDocument | null;

    if (this.normalizeMetadata) {
      const normalized = normalizeMetadata(raw);
      entries = normalized.entries;
      document = normalized.document;
    } else {
      const legacy = raw as MetadataEntry[] | MetadataDocument;
      const extracted = Array.isArray(legacy) ? legacy : legacy.objects;
      if (!Array.isArray(extracted)) {
        throw new Error("Unsupported metadata.json structure");
      }
      entries = extracted;
      document = Array.isArray(legacy) ? null : legacy;
    }

    this.metadataEntries = entries;
    this.metadataDocument = document;

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
    if (this.normalizeMetadata) {
      this.applyEntryTransform(root, entry);
    }
    this.refreshSelectionState(entry.id);
  }

  private applyEntryTransform(
    root: THREE.Object3D,
    entry: MetadataEntry,
  ): void {
    const position = entry.position ?? DEFAULT_POSITION;
    const rotation = entry.rotation
      ? normalizeQuat(entry.rotation, DEFAULT_ROTATION)
      : DEFAULT_ROTATION;

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
    this.metadataDocument = null;
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
  private sidebar: HTMLElement;
  private fieldName: HTMLInputElement;
  private fieldCategory: HTMLSelectElement;
  private fieldObjectRole: HTMLSelectElement;
  private fieldPlacementType: HTMLSelectElement;
  private btnSaveMetadata: HTMLButtonElement;
  private saveStatus: HTMLElement;
  private activeId: string | null = null;

  constructor() {
    const path = window.location.pathname.replace(/\/+$/, "");
    const normalizeMetadata =
      path === "/scene-viewer" || path === "/scene-viewer.html";
    this.viewer = new SceneViewer("render-canvas", {
      normalizeMetadata,
    });

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
    this.sidebar = document.getElementById("sidebar") as HTMLElement;
    this.detailsPanel = document.getElementById("details-panel") as HTMLElement;
    this.fieldName = document.getElementById("field-name") as HTMLInputElement;
    this.fieldCategory = document.getElementById(
      "field-category",
    ) as HTMLSelectElement;
    this.fieldObjectRole = document.getElementById(
      "field-object-role",
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

    [this.fieldCategory, this.fieldObjectRole, this.fieldPlacementType].forEach(
      (select) => {
        select.addEventListener("focus", () => this.setDropdownOpen(true));
        select.addEventListener("pointerdown", () =>
          this.setDropdownOpen(true),
        );
        select.addEventListener("blur", () => this.setDropdownOpen(false));
        select.addEventListener("change", () => this.setDropdownOpen(false));
        select.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            this.setDropdownOpen(false);
          }
        });
      },
    );
  }

  private setDropdownOpen(isOpen: boolean): void {
    this.sidebar.classList.toggle("dropdown-open", isOpen);
    this.detailsPanel.classList.toggle("dropdown-open", isOpen);
  }

  private syncSelectedListItem(id: string | null): void {
    this.objectList.querySelectorAll(".object-item").forEach((element) => {
      const item = element as HTMLElement;
      item.classList.toggle("selected", item.dataset.objectId === id);
    });
  }

  private setSelectValuePreservingUnknown(
    select: HTMLSelectElement,
    value: string,
  ): void {
    if (!Array.from(select.options).some((option) => option.value === value)) {
      select.add(new Option(value, value), 1);
    }

    select.value = value;
  }

  private async saveCurrentEntry(): Promise<void> {
    if (!this.activeId) return;

    const folder = this.viewer.getCurrentFolder();
    if (!folder) return;

    this.viewer.updateEntry(this.activeId, {
      name: this.fieldName.value.trim(),
      category: this.fieldCategory.value,
      objectRole: this.fieldObjectRole.value
        ? this.fieldObjectRole.value === "null"
          ? null
          : (this.fieldObjectRole.value as "window" | "door")
        : undefined,
      placementType: this.fieldPlacementType.value,
    });

    try {
      const data = this.viewer.getMetadataEntries();
      const payload = this.viewer.getMetadataDocument()
        ? { ...(this.viewer.getMetadataDocument() as MetadataDocument), objects: data }
        : data;

      const response = await fetch("/api/save-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder,
          data: payload,
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
    this.setSelectValuePreservingUnknown(this.fieldCategory, entry.category);
    this.fieldObjectRole.value =
      entry.objectRole === null
        ? "null"
        : entry.objectRole ?? "";
    this.fieldPlacementType.value = entry.placementType;
    this.saveStatus.textContent = "";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new UIController();
});
