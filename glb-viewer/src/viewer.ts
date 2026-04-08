// src/viewer.ts
import * as BABYLON from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export class GLBViewer {
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;
  private camera: BABYLON.ArcRotateCamera;
  private currentModel: BABYLON.AbstractMesh | null = null;
  private frameCallbacks: Array<() => void> = [];
  private modelLoadCallbacks: Array<(rootMesh: BABYLON.AbstractMesh) => void> = [];

  constructor(container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    container.appendChild(canvas);

    this.engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.16, 0.16, 0.16, 1.0);

    this.camera = new BABYLON.ArcRotateCamera(
      "camera",
      Math.PI / 4,
      Math.PI / 3,
      10,
      BABYLON.Vector3.Zero(),
      this.scene
    );
    this.camera.attachControl(canvas, true);
    this.camera.wheelPrecision = 50;
    this.camera.minZ = 0.1;

    const light1 = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    light1.intensity = 0.8;

    const light2 = new BABYLON.DirectionalLight("dir1", new BABYLON.Vector3(-1, -2, -1), this.scene);
    light2.position = new BABYLON.Vector3(5, 10, 5);
    light2.intensity = 0.6;

    const light3 = new BABYLON.DirectionalLight("dir2", new BABYLON.Vector3(1, -1, 1), this.scene);
    light3.position = new BABYLON.Vector3(-5, 5, -5);
    light3.intensity = 0.4;

    // Create a simple grid using lines
    const gridSize = 10;
    const gridDivisions = 10;
    const gridStep = gridSize / gridDivisions;
    const gridLines = [];

    for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
      // Lines parallel to X axis
      gridLines.push([
        new BABYLON.Vector3(-gridSize / 2, 0, i),
        new BABYLON.Vector3(gridSize / 2, 0, i)
      ]);
      // Lines parallel to Z axis
      gridLines.push([
        new BABYLON.Vector3(i, 0, -gridSize / 2),
        new BABYLON.Vector3(i, 0, gridSize / 2)
      ]);
    }

    gridLines.forEach((points, index) => {
      const line = BABYLON.MeshBuilder.CreateLines(`grid_${index}`, { points }, this.scene);
      line.color = new BABYLON.Color3(0.3, 0.3, 0.3);
      line.isPickable = false;
    });

    window.addEventListener('resize', () => this.onWindowResize());
    
    this.engine.runRenderLoop(() => {
      this.frameCallbacks.forEach(cb => cb());
      this.scene.render();
    });
  }

  getScene(): BABYLON.Scene { return this.scene; }
  getCamera(): BABYLON.ArcRotateCamera { return this.camera; }
  getEngine(): BABYLON.Engine { return this.engine; }
  getCanvas(): HTMLCanvasElement { return this.engine.getRenderingCanvas()!; }

  /** Register a callback invoked every animation frame (for live panel updates). */
  onFrame(cb: () => void): void {
    this.frameCallbacks.push(cb);
  }

  /** Register a callback invoked after a model loads successfully. */
  onModelLoad(cb: (rootMesh: BABYLON.AbstractMesh) => void): void {
    this.modelLoadCallbacks.push(cb);
  }

  async loadModel(url: string): Promise<void> {
    if (this.currentModel) {
      this.currentModel.dispose();
      this.currentModel = null;
    }

    const loadingEl = document.getElementById('loading-indicator');
    const progressEl = document.getElementById('loading-progress');
    loadingEl?.classList.add('active');

    try {
      let result: BABYLON.ISceneLoaderAsyncResult;

      if (url.startsWith('blob:')) {
        // For blob URLs, fetch the data and create a File object
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], 'model.glb', { type: 'model/gltf-binary' });
        
        result = await BABYLON.SceneLoader.ImportMeshAsync(
          "",
          "",
          file,
          this.scene,
          (event) => {
            if (event.lengthComputable && progressEl) {
              const progress = (event.loaded / event.total) * 100;
              progressEl.textContent = `${progress.toFixed(1)}%`;
            }
          }
        );
      } else {
        // For regular URLs, split into base path and filename
        const lastSlash = url.lastIndexOf('/');
        const basePath = url.substring(0, lastSlash + 1);
        const fileName = url.substring(lastSlash + 1);
        
        result = await BABYLON.SceneLoader.ImportMeshAsync(
          "",
          basePath,
          fileName,
          this.scene,
          (event) => {
            if (event.lengthComputable && progressEl) {
              const progress = (event.loaded / event.total) * 100;
              progressEl.textContent = `${progress.toFixed(1)}%`;
            }
          }
        );
      }

      this.processLoadedMeshes(result.meshes);
      loadingEl?.classList.remove('active');
    } catch (error) {
      loadingEl?.classList.remove('active');
      throw error;
    }
  }

  private processLoadedMeshes(meshes: BABYLON.AbstractMesh[]): void {
    if (meshes.length === 0) {
      throw new Error('No meshes found in model');
    }

    // Create a root transform node to hold all meshes
    const root = new BABYLON.TransformNode("modelRoot", this.scene);
    meshes.forEach(mesh => {
      if (mesh.parent === null) {
        mesh.parent = root;
      }
      // Tag meshes so selector can identify them
      mesh.metadata = { isSceneMesh: true };
    });

    this.currentModel = root as any;

    // Calculate bounding box and center the model
    let min = new BABYLON.Vector3(Infinity, Infinity, Infinity);
    let max = new BABYLON.Vector3(-Infinity, -Infinity, -Infinity);

    meshes.forEach(mesh => {
      const boundingInfo = mesh.getBoundingInfo();
      if (boundingInfo) {
        min = BABYLON.Vector3.Minimize(min, boundingInfo.boundingBox.minimumWorld);
        max = BABYLON.Vector3.Maximize(max, boundingInfo.boundingBox.maximumWorld);
      }
    });

    const center = BABYLON.Vector3.Center(min, max);
    const extendSize = max.subtract(min).scale(0.5);

    root.position = center.scale(-1);

    const maxDim = Math.max(extendSize.x, extendSize.y, extendSize.z) * 2;
    if (maxDim > 0) {
      const scale = 4 / maxDim;
      root.scaling = new BABYLON.Vector3(scale, scale, scale);
    }

    // Position camera
    this.camera.setTarget(BABYLON.Vector3.Zero());
    this.camera.radius = Math.max(maxDim * 0.75, 5);
    this.camera.alpha = Math.PI / 4;
    this.camera.beta = Math.PI / 3;

    this.modelLoadCallbacks.forEach(cb => { cb(root as any); });
  }

  private onWindowResize(): void {
    this.engine.resize();
  }
}
