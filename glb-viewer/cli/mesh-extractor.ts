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

export interface ResolvedMeshEntry extends ExportMeshEntry {
  size: [number, number, number];
  category: 'wall' | 'furniture';
}

export interface FurnitureCluster {
  id: string;
  members: ResolvedMeshEntry[];
  location: { x: number; y: number; z: number };
}

function toFileName(name: string, fallbackIdx: number): string {
  return (name.trim() || `${fallbackIdx}`).replace(/[/\\:*?"<>|]/g, '_');
}

function resolveNodeName(node: Node): string {
  const name = node.getName().trim();
  if (name) return name;

  const queue = [...node.listChildren()];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentName = current.getName().trim();
    if (currentName) return currentName;
    queue.push(...current.listChildren());
  }

  return '';
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

export function resolveRootEntries(doc: Document): ExportMeshEntry[] {
  const entries: ExportMeshEntry[] = [];

  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) {
      const [x, y, z] = root.getTranslation();
      entries.push({
        name: resolveNodeName(root),
        rootName: root.getName(),
        node: root,
        location: { x: round4(x), y: round4(y), z: round4(z) },
      });
    }
  }

  return entries;
}

function shouldClusterTogether(a: ResolvedMeshEntry, b: ResolvedMeshEntry): boolean {
  const dx = a.location.x - b.location.x;
  const dy = a.location.y - b.location.y;
  const dz = a.location.z - b.location.z;

  const horizontalDistance = Math.hypot(dx, dz);
  const sizeBoost = Math.max(a.size[0], a.size[1], b.size[0], b.size[1]);
  const horizontalLimit = Math.min(4, Math.max(2.5, 2.5 + sizeBoost * 0.35));
  const verticalLimit = Math.min(2, Math.max(1.2, 1.2 + Math.max(a.size[2], b.size[2]) * 0.25));

  return horizontalDistance <= horizontalLimit && Math.abs(dy) <= verticalLimit;
}

function averageLocation(entries: ResolvedMeshEntry[]): { x: number; y: number; z: number } {
  const total = entries.reduce(
    (acc, entry) => {
      acc.x += entry.location.x;
      acc.y += entry.location.y;
      acc.z += entry.location.z;
      return acc;
    },
    { x: 0, y: 0, z: 0 },
  );

  const count = entries.length || 1;
  return {
    x: round4(total.x / count),
    y: round4(total.y / count),
    z: round4(total.z / count),
  };
}

function unionFindClusters(entries: ResolvedMeshEntry[]): ResolvedMeshEntry[][] {
  const parent = entries.map((_, i) => i);

  const find = (i: number): number => {
    while (parent[i] !== i) {
      const next = parent[i]!;
      parent[i] = parent[next]!;
      i = next;
    }
    return i;
  };

  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (shouldClusterTogether(entries[i]!, entries[j]!)) unite(i, j);
    }
  }

  const buckets = new Map<number, ResolvedMeshEntry[]>();
  for (let i = 0; i < entries.length; i++) {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(entries[i]!);
    else buckets.set(root, [entries[i]!]);
  }

  return [...buckets.values()].map(group =>
    group.slice().sort((a, b) => a.location.y - b.location.y || a.location.x - b.location.x || a.location.z - b.location.z),
  );
}

export function clusterFurnitureEntries(entries: ResolvedMeshEntry[]): FurnitureCluster[] {
  const furnitureEntries = entries.filter(entry => entry.category === 'furniture');
  const clusters = unionFindClusters(furnitureEntries);

  return clusters.map((members, index) => ({
    id: `furniture_set_${String(index + 1).padStart(3, '0')}`,
    members,
    location: averageLocation(members),
  }));
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

/** Build a GLB Document for a furniture cluster, preserving each member subtree. */
export function buildClusterDocument(clusterId: string, clusterNodes: Node[]): Document {
  const out = new Document();
  const outBuffer = out.createBuffer();
  const outScene = out.createScene('Scene');
  const clusterRoot = out.createNode(clusterId);
  clusterRoot.setExtras({ cluster_id: clusterId });
  outScene.addChild(clusterRoot);
  for (const node of clusterNodes) copyNodeTreeInto(out, outBuffer, node, clusterRoot);
  return out;
}

export function buildFurnitureClusterDocument(cluster: FurnitureCluster): Document {
  return buildClusterDocument(cluster.id, cluster.members.map(member => member.node));
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

  const rootEntries = resolveRootEntries(doc);
  if (rootEntries.length === 0) throw new Error('No scene root nodes found.');
  console.log(`Found ${rootEntries.length} root node(s)`);

  await mkdir(outputDir, { recursive: true });

  const manifest: Manifest = {};
  const walls: WallEntry[] = [];
  const sceneObjects: SceneObjectEntry[] = [];
  const sceneLocations: SceneLocationEntry[] = [];
  const roomTemplates: RoomTemplateEntry[] = [];
  const sourceFile = path.basename(inputPath);
  const roomId = path.basename(inputPath, path.extname(inputPath));
  const usedNames = new Map<string, number>();
  const resolvedEntries: ResolvedMeshEntry[] = rootEntries.map((rootEntry, i) => {
    const size = computeGroupSize(rootEntry.node);
    return {
      ...rootEntry,
      name: toFileName(rootEntry.name, i),
      size,
      category: detectCategory(size),
    };
  });

  const wallEntries = resolvedEntries.filter(entry => entry.category === 'wall');
  const furnitureClusters = clusterFurnitureEntries(resolvedEntries);

  for (const [i, wallEntry] of wallEntries.entries()) {
    const groupKey = dedupeName(wallEntry.name, usedNames);
    const fileName = `${groupKey}.glb`;
    const filePath = path.join(outputDir, fileName);
    const location = wallEntry.location;

    const wallDoc = buildGroupDocument(wallEntry.node);
    const glbBuffer = await io.writeBinary(wallDoc);
    await writeFile(filePath, glbBuffer);

    manifest[groupKey] = {
      size: wallEntry.size,
      category: 'wall',
      file_name: fileName,
      location,
    };

    walls.push({
      id: groupKey,
      name: wallEntry.name,
      size: wallEntry.size,
      file_name: fileName,
    });

    process.stdout.write(`\r  [${i + 1}/${wallEntries.length}] ${fileName}             `);
  }

  if (wallEntries.length > 0) console.log();

  for (const [i, cluster] of furnitureClusters.entries()) {
    const fileName = `${cluster.id}.glb`;
    const filePath = path.join(outputDir, fileName);
    const clusterDoc = buildFurnitureClusterDocument(cluster);
    const size = computeGroupSize(clusterDoc.getRoot().listScenes()[0]!.listChildren()[0]!);
    const location = cluster.location;

    const glbBuffer = await io.writeBinary(clusterDoc);
    await writeFile(filePath, glbBuffer);

    manifest[cluster.id] = {
      size,
      category: 'furniture',
      file_name: fileName,
      location,
    };

    sceneObjects.push({
      id: cluster.id,
      name: cluster.members[0]?.name ?? cluster.id,
      size,
      file_name: fileName,
      category: 'furniture',
      location,
    });
    sceneLocations.push({ id: cluster.id, ox: location.x, oy: location.y, oz: location.z });

    process.stdout.write(`\r  [${i + 1}/${furnitureClusters.length}] ${fileName}             `);
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
