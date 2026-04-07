// src/viewer.ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class GLBViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private loader: GLTFLoader;
  private currentModel: THREE.Object3D | null = null;
  private frameCallbacks: Array<() => void> = [];
  private modelLoadCallbacks: Array<(scene: THREE.Group) => void> = [];

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2a2a);

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(2, 2, 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(5, 10, 5);
    dir1.castShadow = true;
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dir2.position.set(-5, 5, -5);
    this.scene.add(dir2);

    this.scene.add(new THREE.GridHelper(10, 10));

    this.loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(dracoLoader);

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();
  }

  getScene(): THREE.Scene { return this.scene; }
  getCamera(): THREE.PerspectiveCamera { return this.camera; }
  getRenderer(): THREE.WebGLRenderer { return this.renderer; }
  getCanvas(): HTMLCanvasElement { return this.renderer.domElement; }
  getOrbitControls(): OrbitControls { return this.controls; }

  /** Register a callback invoked every animation frame (for live panel updates). */
  onFrame(cb: () => void): void {
    this.frameCallbacks.push(cb);
  }

  /** Register a callback invoked after a model loads successfully. */
  onModelLoad(cb: (scene: THREE.Group) => void): void {
    this.modelLoadCallbacks.push(cb);
  }

  loadModel(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.currentModel) {
        this.scene.remove(this.currentModel);
        this.currentModel = null;
      }

      const loadingEl = document.getElementById('loading-indicator');
      const progressEl = document.getElementById('loading-progress');
      loadingEl?.classList.add('active');

      this.loader.load(
        url,
        (gltf) => {
          this.currentModel = gltf.scene;

          this.currentModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              // Tag so selector can distinguish model meshes from gizmos
              mesh.userData.isSceneMesh = true;
              if (!mesh.material) {
                mesh.material = new THREE.MeshStandardMaterial({ color: 0x808080 });
              }
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });

          this.scene.add(this.currentModel);

          const box = new THREE.Box3().setFromObject(this.currentModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          if (size.x === 0 && size.y === 0 && size.z === 0) {
            loadingEl?.classList.remove('active');
            reject(new Error('Model has no geometry'));
            return;
          }

          this.currentModel.position.sub(center);
          const maxDim = Math.max(size.x, size.y, size.z);
          this.currentModel.scale.multiplyScalar(2 / maxDim);

          const distance = maxDim * 1.5;
          this.camera.position.set(distance, distance, distance);
          this.controls.target.set(0, 0, 0);
          this.controls.update();

          loadingEl?.classList.remove('active');
          this.modelLoadCallbacks.forEach(cb => cb(gltf.scene));
          resolve();
        },
        (progress) => {
          if (progress.total > 0 && progressEl) {
            progressEl.textContent = `${((progress.loaded / progress.total) * 100).toFixed(1)}%`;
          }
        },
        (error) => {
          loadingEl?.classList.remove('active');
          reject(error);
        }
      );
    });
  }

  private onWindowResize(): void {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.frameCallbacks.forEach(cb => cb());
    this.renderer.render(this.scene, this.camera);
  }
}
