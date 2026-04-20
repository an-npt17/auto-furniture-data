// src/main.ts
import { GLBViewer } from "./viewer";
import { createStore } from "./store";
import { Selector } from "./selector";
import { Transformer } from "./transformer";
import { Exporter } from "./exporter";
import { Panel } from "./panel";

window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("viewer-container") as HTMLElement;
  const treeEl = document.getElementById("object-tree") as HTMLElement;
  const posEl = document.getElementById("position-panel") as HTMLElement;
  const fileInput = document.getElementById("file-input") as HTMLInputElement;
  const btnTranslate = document.getElementById(
    "btn-translate",
  ) as HTMLButtonElement;
  const btnRotate = document.getElementById("btn-rotate") as HTMLButtonElement;
  const btnExportGlb = document.getElementById(
    "btn-export-glb",
  ) as HTMLButtonElement;
  const btnExportJson = document.getElementById(
    "btn-export-json",
  ) as HTMLButtonElement;

  const store = createStore();
  const viewer = new GLBViewer(container);
  const selector = new Selector(viewer, store);
  const transformer = new Transformer(viewer);
  const exporter = new Exporter(viewer.getScene(), store);
  const panel = new Panel(treeEl, posEl, store, selector, viewer.getScene());

  // Viewport/tree selection → attach gizmo + highlight tree row
  selector.onSelect((mesh) => {
    if (mesh) {
      const uuid = mesh.uniqueId.toString();
      transformer.attachTo(uuid);
      panel.setActiveRow(uuid);
    } else {
      transformer.detach();
      panel.setActiveRow(null);
    }
  });

  // Model loaded → rebuild sidebar tree, reset export buttons
  viewer.onModelLoad((rootMesh) => {
    panel.buildTree(rootMesh);
    btnExportGlb.disabled = true;
    btnExportJson.disabled = true;
  });

  // Every frame → refresh position/rotation display
  viewer.onFrame(() => panel.refreshPosition());

  // Toolbar: mode buttons
  btnTranslate.addEventListener("click", () => {
    transformer.setMode("translate");
    btnTranslate.classList.add("active");
    btnRotate.classList.remove("active");
  });

  btnRotate.addEventListener("click", () => {
    transformer.setMode("rotate");
    btnRotate.classList.add("active");
    btnTranslate.classList.remove("active");
  });

  // Toolbar: export buttons
  btnExportGlb.addEventListener("click", () => exporter.exportGLB());
  btnExportJson.addEventListener("click", () => exporter.exportJSON());

  // File input
  fileInput.addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      await viewer.loadModel(url);
    } catch (err) {
      alert("Error loading model: " + err);
    }
  });

  // Auto-load sample model if present
  fetch("/models/sample.glb", { method: "HEAD" })
    .then(() => viewer.loadModel("/models/sample.glb"))
    .catch(() => {});
});
