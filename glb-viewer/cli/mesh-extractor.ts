// cli/mesh-extractor.ts
import { Document, NodeIO, Node, Mesh } from '@gltf-transform/core';
import type { Texture, TextureInfo } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { computeGroupSize, detectCategory } from './wall-size';

export interface Manifest {
  [groupName: string]: {
    // [length, width, height] in meters — GLTF is Y-up, so X=length, Z=width, Y=height
    size: [number, number, number];
    category: 'wall' | 'furniture';
    file_name: string;
    location: { x: number; y: number; z: number };
  };
}

export interface WallEntry {
  id: string;
  name: string;
  size: [number, number, number];
  file_name: string;
}

export interface SceneObjectEntry {
  id: string;
  name: string;
  size: [number, number, number];
  file_name: string;
  category: 'furniture';
  location: { x: number; y: number; z: number };
}

export interface SceneLocationEntry {
  id: string;
  ox: number;
  oy: number;
  oz: number;
}

export interface RoomTemplateEntry {
  id: string;
  source_file: string;
  wall_ids: string[];
  scene_object_ids: string[];
  wall_count: number;
  scene_object_count: number;
}

export interface ExportMeshEntry {
  name: string;
  rootName: string;
  node: Node;
  location: { x: number; y: number; z: number };
}

function toFileName(name: string, fallbackIdx: number): string {
  return (name.trim() || `${fallbackIdx}`).replace(/[/\\:*?"<>|]/g, '_');
}

function dedupeName(name: string, usedNames: Map<string, number>): string {
  const count = usedNames.get(name) ?? 0;
  usedNames.set(name, count + 1);
  return count === 0 ? name : `${name}_${count}`;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function cloneTextureInto(out: Document, srcTexture: Texture): Texture {
  const texture = out.createTexture(srcTexture.getName());
  const image = srcTexture.getImage();
  if (image) texture.setImage(image.slice());
  const mimeType = srcTexture.getMimeType();
  if (mimeType) texture.setMimeType(mimeType);
  const uri = srcTexture.getURI();
  if (uri) texture.setURI(uri);
  return texture;
}

function copyTextureInfo(srcInfo: TextureInfo | null, outInfo: TextureInfo | null): void {
  if (!srcInfo || !outInfo) return;
  outInfo.setTexCoord(srcInfo.getTexCoord());
  outInfo.setMagFilter(srcInfo.getMagFilter());
  outInfo.setMinFilter(srcInfo.getMinFilter());
  outInfo.setWrapS(srcInfo.getWrapS());
  outInfo.setWrapT(srcInfo.getWrapT());
}

// ---

/**
 * Resolve which nodes to treat as top-level groups.
 * Keep scene top-level nodes as exported roots so their transforms are preserved.
 */
export function resolveGroupNodes(doc: Document): Node[] {
  const groups: Node[] = [];

  for (const scene of doc.getRoot().listScenes()) {
    groups.push(...scene.listChildren());
  }
  return groups;
}

export function resolveMeshEntries(doc: Document): ExportMeshEntry[] {
  const entries: ExportMeshEntry[] = [];

  const walk = (node: Node, rootName: string, rootLocation: { x: number; y: number; z: number }): void => {
    if (node.getMesh()) {
      entries.push({
        name: node.getName(),
        rootName,
        node,
        location: rootLocation,
      });
    }

    for (const child of node.listChildren()) {
      walk(child, rootName, rootLocation);
    }
  };

  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) {
      const [x, y, z] = root.getTranslation();
      walk(root, root.getName(), { x: round4(x), y: round4(y), z: round4(z) });
    }
  }

  return entries;
}

/** Copy a mesh (geometry + material, including textures) into the output document. */
function copyMeshInto(out: Document, outBuffer: ReturnType<Document['createBuffer']>, src: Mesh): Mesh {
  const outMesh = out.createMesh(src.getName());
  for (const prim of src.listPrimitives()) {
    const outPrim = out.createPrimitive();
    for (const semantic of prim.listSemantics()) {
      const acc = prim.getAttribute(semantic)!;
      const arr = acc.getArray()!;
      outPrim.setAttribute(
        semantic,
        out.createAccessor(acc.getName()).setBuffer(outBuffer).setType(acc.getType()).setArray(arr.slice() as typeof arr),
      );
    }
    const srcIdx = prim.getIndices();
    if (srcIdx) {
      const arr = srcIdx.getArray()!;
      outPrim.setIndices(
        out.createAccessor(srcIdx.getName()).setBuffer(outBuffer).setType(srcIdx.getType()).setArray(arr.slice() as typeof arr),
      );
    }
    const srcMat = prim.getMaterial();
    if (srcMat) {
      const outMat = out.createMaterial(srcMat.getName());
      outMat.setBaseColorFactor([...srcMat.getBaseColorFactor()] as [number, number, number, number]);
      outMat.setAlphaMode(srcMat.getAlphaMode());
      outMat.setDoubleSided(srcMat.getDoubleSided());
      outMat.setMetallicFactor(srcMat.getMetallicFactor());
      outMat.setRoughnessFactor(srcMat.getRoughnessFactor());

      const baseColorTexture = srcMat.getBaseColorTexture();
      if (baseColorTexture) outMat.setBaseColorTexture(cloneTextureInto(out, baseColorTexture));

      const emissiveTexture = srcMat.getEmissiveTexture();
      if (emissiveTexture) outMat.setEmissiveTexture(cloneTextureInto(out, emissiveTexture));

      const normalTexture = srcMat.getNormalTexture();
      if (normalTexture) outMat.setNormalTexture(cloneTextureInto(out, normalTexture));

      const occlusionTexture = srcMat.getOcclusionTexture();
      if (occlusionTexture) outMat.setOcclusionTexture(cloneTextureInto(out, occlusionTexture));

      const metallicRoughnessTexture = srcMat.getMetallicRoughnessTexture();
      if (metallicRoughnessTexture) outMat.setMetallicRoughnessTexture(cloneTextureInto(out, metallicRoughnessTexture));

      outMat.setEmissiveFactor([...srcMat.getEmissiveFactor()] as [number, number, number]);
      outMat.setNormalScale(srcMat.getNormalScale());
      outMat.setOcclusionStrength(srcMat.getOcclusionStrength());

      copyTextureInfo(srcMat.getBaseColorTextureInfo(), outMat.getBaseColorTextureInfo());
      copyTextureInfo(srcMat.getEmissiveTextureInfo(), outMat.getEmissiveTextureInfo());
      copyTextureInfo(srcMat.getNormalTextureInfo(), outMat.getNormalTextureInfo());
      copyTextureInfo(srcMat.getOcclusionTextureInfo(), outMat.getOcclusionTextureInfo());
      copyTextureInfo(srcMat.getMetallicRoughnessTextureInfo(), outMat.getMetallicRoughnessTextureInfo());
      outPrim.setMaterial(outMat);
    }
    outMesh.addPrimitive(outPrim);
  }
  return outMesh;
}

/** Recursively copy a node and its entire subtree into the output document. */
function copyNodeTreeInto(
  out: Document,
  outBuffer: ReturnType<Document['createBuffer']>,
  src: Node,
  outParent: Node | ReturnType<Document['createScene']>,
): void {
  const outNode = out.createNode(src.getName())
    .setTranslation([...src.getTranslation()] as [number, number, number])
    .setRotation([...src.getRotation()] as [number, number, number, number])
    .setScale([...src.getScale()] as [number, number, number]);
  if (src.getMesh()) outNode.setMesh(copyMeshInto(out, outBuffer, src.getMesh()!));
  outParent.addChild(outNode);
  for (const child of src.listChildren()) copyNodeTreeInto(out, outBuffer, child, outNode);
}

/** Build a GLB Document for a single group node, preserving its internal hierarchy. */
export function buildGroupDocument(groupNode: Node): Document {
  const out = new Document();
  const outBuffer = out.createBuffer();
  const outScene = out.createScene('Scene');
  copyNodeTreeInto(out, outBuffer, groupNode, outScene);
  return out;
}

/** Build a GLB Document for a single mesh node. */
export function buildMeshDocument(meshNode: Node): Document {
  const out = new Document();
  const outBuffer = out.createBuffer();
  const outScene = out.createScene('Scene');
  const outNode = out.createNode(meshNode.getName())
    .setTranslation([...meshNode.getTranslation()] as [number, number, number])
    .setRotation([...meshNode.getRotation()] as [number, number, number, number])
    .setScale([...meshNode.getScale()] as [number, number, number]);
  outNode.setExtras({ mesh_name: meshNode.getName() });
  if (meshNode.getMesh()) outNode.setMesh(copyMeshInto(out, outBuffer, meshNode.getMesh()!));
  outScene.addChild(outNode);
  return out;
}

export async function extractMeshes(inputPath: string, outputDir: string): Promise<Manifest> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  console.log(`Reading: ${inputPath}`);
  const doc = await io.read(inputPath);

  const meshEntries = resolveMeshEntries(doc);
  if (meshEntries.length === 0) throw new Error('No mesh nodes found in the scene.');
  console.log(`Found ${meshEntries.length} mesh node(s)`);

  await mkdir(outputDir, { recursive: true });

  const manifest: Manifest = {};
  const walls: WallEntry[] = [];
  const sceneObjects: SceneObjectEntry[] = [];
  const sceneLocations: SceneLocationEntry[] = [];
  const roomTemplates: RoomTemplateEntry[] = [];
  const sourceFile = path.basename(inputPath);
  const roomId = path.basename(inputPath, path.extname(inputPath));
  const usedNames = new Map<string, number>();

  for (const [i, meshEntry] of meshEntries.entries()) {
    const groupKey = dedupeName(toFileName(meshEntry.name, i), usedNames);
    const fileName = `${groupKey}.glb`;
    const filePath = path.join(outputDir, fileName);
    const size = computeGroupSize(meshEntry.node);
    const location = meshEntry.location;

    const meshDoc = buildMeshDocument(meshEntry.node);
    const glbBuffer = await io.writeBinary(meshDoc);
    await writeFile(filePath, glbBuffer);

    manifest[groupKey] = {
      size,
      category: detectCategory(size),
      file_name: fileName,
      location,
    };

    if (manifest[groupKey].category === 'wall') {
      walls.push({
        id: groupKey,
        name: meshEntry.node.getName(),
        size,
        file_name: fileName,
      });
    } else {
      sceneObjects.push({
        id: groupKey,
        name: meshEntry.node.getName(),
        size,
        file_name: fileName,
        category: 'furniture',
        location,
      });
      sceneLocations.push({ id: groupKey, ox: location.x, oy: location.y, oz: location.z });
    }

    process.stdout.write(`\r  [${i + 1}/${meshEntries.length}] ${fileName}             `);
  }

  console.log();

  roomTemplates.push({
    id: roomId,
    source_file: sourceFile,
    wall_ids: walls.map(wall => wall.id),
    scene_object_ids: sceneObjects.map(object => object.id),
    wall_count: walls.length,
    scene_object_count: sceneObjects.length,
  });

  const manifestPath = path.join(outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`  → manifest.json written`);

  await writeFile(path.join(outputDir, 'walls.json'), JSON.stringify(walls, null, 2));
  await writeFile(path.join(outputDir, 'scene_objects.json'), JSON.stringify(sceneObjects, null, 2));
  await writeFile(path.join(outputDir, 'scene_locations.json'), JSON.stringify(sceneLocations, null, 2));
  await writeFile(path.join(outputDir, 'room_templates.json'), JSON.stringify(roomTemplates, null, 2));
  console.log(`  → walls.json, scene_objects.json, scene_locations.json, room_templates.json written`);

  return manifest;
}
