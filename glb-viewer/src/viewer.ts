import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

class GLBViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private loader: GLTFLoader;
  private currentModel: THREE.Object3D | null = null;

  constructor(container: HTMLElement) {
    // Setup scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2a2a);

    // Setup camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(2, 2, 2);

    // Setup renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    // Setup controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Setup lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    this.scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(5, 10, 5);
    directionalLight1.castShadow = true;
    this.scene.add(directionalLight1);
    
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight2.position.set(-5, 5, -5);
    this.scene.add(directionalLight2);

    // Add grid helper
    const gridHelper = new THREE.GridHelper(10, 10);
    this.scene.add(gridHelper);

    // Setup loader
    this.loader = new GLTFLoader();
    
    // Setup Draco decoder for compressed models
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.loader.setDRACOLoader(dracoLoader);

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());

    // Start animation loop
    this.animate();
  }

  loadModel(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove previous model
      if (this.currentModel) {
        this.scene.remove(this.currentModel);
      }

      // Show loading indicator
      const loadingIndicator = document.getElementById('loading-indicator');
      const loadingProgress = document.getElementById('loading-progress');
      if (loadingIndicator) loadingIndicator.classList.add('active');

      this.loader.load(
        url,
        (gltf) => {
          console.log('GLTF loaded:', gltf);
          this.currentModel = gltf.scene;
          
          // Log scene structure
          console.log('Scene children:', this.currentModel.children.length);
          this.currentModel.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              console.log('Mesh found:', mesh.name, 'Geometry:', mesh.geometry);
              
              // Ensure mesh has material and is visible
              if (!mesh.material) {
                console.warn('Mesh has no material, adding default material');
                mesh.material = new THREE.MeshStandardMaterial({ color: 0x808080 });
              }
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          
          this.scene.add(this.currentModel);

          // Center and scale the model
          const box = new THREE.Box3().setFromObject(this.currentModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          console.log('Model size:', size);
          console.log('Model center:', center);

          // Check if model has valid dimensions
          if (size.x === 0 && size.y === 0 && size.z === 0) {
            console.error('Model has zero dimensions!');
            reject(new Error('Model has no geometry'));
            return;
          }

          // Center the model
          this.currentModel.position.sub(center);

          // Scale to fit in view
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 2 / maxDim;
          this.currentModel.scale.multiplyScalar(scale);

          console.log('Applied scale:', scale);

          // Adjust camera to look at the model
          const distance = Math.max(size.x, size.y, size.z) * 1.5;
          this.camera.position.set(distance, distance, distance);
          this.controls.target.set(0, 0, 0);
          this.controls.update();

          // Hide loading indicator
          if (loadingIndicator) loadingIndicator.classList.remove('active');

          resolve();
        },
        (progress) => {
          if (progress.total > 0) {
            const percent = (progress.loaded / progress.total) * 100;
            console.log(`Loading: ${percent.toFixed(2)}% (${(progress.loaded / 1024 / 1024).toFixed(2)}MB / ${(progress.total / 1024 / 1024).toFixed(2)}MB)`);
            if (loadingProgress) {
              loadingProgress.textContent = `${percent.toFixed(1)}% (${(progress.loaded / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB)`;
            }
          } else {
            console.log(`Loading: ${(progress.loaded / 1024 / 1024).toFixed(2)}MB`);
          }
        },
        (error) => {
          console.error('Error loading model:', error);
          // Hide loading indicator
          if (loadingIndicator) loadingIndicator.classList.remove('active');
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
    this.renderer.render(this.scene, this.camera);
  }

  setBackgroundColor(color: string): void {
    this.scene.background = new THREE.Color(color);
  }
}

// Initialize viewer when DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing viewer...');
  
  const container = document.getElementById('viewer-container');
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const urlInput = document.getElementById('url-input') as HTMLInputElement;
  const loadButton = document.getElementById('load-button') as HTMLButtonElement;
  const bgColorInput = document.getElementById('bg-color') as HTMLInputElement;

  if (!container) {
    console.error('Viewer container not found!');
    return;
  }

  console.log('Container dimensions:', container.clientWidth, 'x', container.clientHeight);
  
  const viewer = new GLBViewer(container);
  console.log('Viewer initialized successfully');

  // File upload handler
  fileInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      console.log('Loading file:', file.name, 'Size:', file.size, 'bytes');
      const url = URL.createObjectURL(file);
      try {
        await viewer.loadModel(url);
        console.log('Model loaded successfully!');
      } catch (error) {
        console.error('Error loading model:', error);
        alert('Error loading model: ' + error);
      }
    }
  });

  // URL load handler
  loadButton?.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (url) {
      try {
        await viewer.loadModel(url);
      } catch (error) {
        alert('Error loading model: ' + error);
      }
    }
  });

  // Background color handler
  bgColorInput?.addEventListener('input', (e) => {
    viewer.setBackgroundColor((e.target as HTMLInputElement).value);
  });

  // Load default model if available
  const defaultModel = '/models/sample.glb';
  fetch(defaultModel, { method: 'HEAD' })
    .then(() => viewer.loadModel(defaultModel))
    .catch(() => console.log('No default model found'));
});
