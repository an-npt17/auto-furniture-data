// cli/mesh-extractor.ts
import { Document, NodeIO, Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface MeshEntry {
  name: string;
  file: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export interface Manifest {
  source: string;
  meshes: MeshEntry[];
}

function sanitizeName(name: string, index: number): string {
  const base = name.trim() || `Mesh_${index}`;
  return base.replace(/[^\w\-. ]/g, '_').replace(/\s+/g, '_');
}

function quatToEulerDeg(q: [number, number, number, number]): { x: number; y: number; z: number } {
  const [x, y, z, w] = q;

  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const rx = Math.atan2(sinr_cosp, cosr_cosp);

  const sinp = 2 * (w * y - z * x);
  const ry = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const rz = Math.atan2(siny_cosp, cosy_cosp);

  const toDeg = (r: number) => Math.round(r * (180 / Math.PI) * 10000) / 10000;
  return { x: toDeg(rx), y: toDeg(ry), z: toDeg(rz) };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Collect all nodes that have a mesh attached, across all scenes. */
function collectMeshNodes(doc: Document): Node[] {
  const nodes: Node[] = [];
  for (const scene of doc.getRoot().listScenes()) {
    scene.traverse((node) => {
      if (node.getMesh()) nodes.push(node);
    });
  }
  return nodes;
}

/** Build a new single-mesh Document copying the given node's mesh geometry + material factors. */
function buildSingleMeshDocument(sourceNode: Node): Document {
  const out = new Document();
  const outBuffer = out.createBuffer();
  const outScene = out.createScene('Scene');

  const sourceMesh = sourceNode.getMesh()!;
  const outMesh = out.createMesh(sourceMesh.getName());

  for (const prim of sourceMesh.listPrimitives()) {
    const outPrim = out.createPrimitive();

    // Copy vertex attributes (POSITION, NORMAL, TEXCOORD_0, ...)
    for (const semantic of prim.listSemantics()) {
      const src = prim.getAttribute(semantic)!;
      const srcArray = src.getArray()!;
      const outAcc = out.createAccessor(src.getName())
        .setBuffer(outBuffer)
        .setType(src.getType())
        .setArray(srcArray.slice() as typeof srcArray);
      outPrim.setAttribute(semantic, outAcc);
    }

    // Copy indices
    const srcIdx = prim.getIndices();
    if (srcIdx) {
      const srcArray = srcIdx.getArray()!;
      const outIdx = out.createAccessor(srcIdx.getName())
        .setBuffer(outBuffer)
        .setType(srcIdx.getType())
        .setArray(srcArray.slice() as typeof srcArray);
      outPrim.setIndices(outIdx);
    }

    // Copy material factors (no textures — keeps output self-contained)
    const srcMat = prim.getMaterial();
    if (srcMat) {
      const outMat = out.createMaterial(srcMat.getName());
      const base = srcMat.getBaseColorFactor();
      outMat.setBaseColorFactor([...base] as [number, number, number, number]);
      outMat.setAlphaMode(srcMat.getAlphaMode());
      outMat.setDoubleSided(srcMat.getDoubleSided());
      outMat.setMetallicFactor(srcMat.getMetallicFactor());
      outMat.setRoughnessFactor(srcMat.getRoughnessFactor());
      outPrim.setMaterial(outMat);
    }

    outMesh.addPrimitive(outPrim);
  }

  const outNode = out.createNode(sourceNode.getName())
    .setMesh(outMesh)
    .setTranslation([...sourceNode.getTranslation()] as [number, number, number])
    .setRotation([...sourceNode.getRotation()] as [number, number, number, number])
    .setScale([...sourceNode.getScale()] as [number, number, number]);

  outScene.addChild(outNode);
  return out;
}

export async function extractMeshes(inputPath: string, outputDir: string): Promise<Manifest> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  console.log(`Reading: ${inputPath}`);
  const doc = await io.read(inputPath);

  const nodes = collectMeshNodes(doc);
  if (nodes.length === 0) {
    throw new Error('No meshes found in the input file.');
  }

  await mkdir(outputDir, { recursive: true });

  const usedNames = new Map<string, number>();
  const entries: MeshEntry[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const rawName = sanitizeName(node.getName() || node.getMesh()!.getName(), i);

    // Deduplicate filenames
    const count = usedNames.get(rawName) ?? 0;
    usedNames.set(rawName, count + 1);
    const uniqueName = count === 0 ? rawName : `${rawName}_${count}`;

    const fileName = `${uniqueName}.glb`;
    const filePath = path.join(outputDir, fileName);

    const meshDoc = buildSingleMeshDocument(node);
    const glbBuffer = await io.writeBinary(meshDoc);
    await writeFile(filePath, glbBuffer);

    const t = node.getTranslation();
    const r = node.getRotation() as [number, number, number, number];
    const s = node.getScale();
    const rot = quatToEulerDeg(r);

    entries.push({
      name: uniqueName,
      file: fileName,
      position: { x: round4(t[0]), y: round4(t[1]), z: round4(t[2]) },
      rotation: { x: rot.x, y: rot.y, z: rot.z },
      scale: { x: round4(s[0]), y: round4(s[1]), z: round4(s[2]) },
    });

    console.log(`  [${i + 1}/${nodes.length}] ${fileName}`);
  }

  const manifest: Manifest = {
    source: path.basename(inputPath),
    meshes: entries,
  };

  const manifestPath = path.join(outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  manifest.json`);

  return manifest;
}
