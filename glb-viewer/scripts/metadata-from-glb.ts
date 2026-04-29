import { readdir } from "node:fs/promises";
import { basename, join, parse, resolve } from "node:path";
import { NodeIO, type Node, type Scene } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

type Vec3 = { x: number; y: number; z: number };
type Quat4 = { x: number; y: number; z: number; w: number };

type MetadataEntry = {
  id: string;
  name: string;
  category: string;
  objectRole?: "window" | "door" | null;
  shape: "model";
  size: [number, number, number];
  placementType: string;
  color: string;
  modelUrl: string;
  position: Vec3;
  rotation: Quat4;
};

type RawMetadataEntry = {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  placementType?: unknown;
  color?: unknown;
  modelUrl?: unknown;
  objectRole?: unknown;
  position?: unknown;
  rotation?: unknown;
  [key: string]: unknown;
};

type RawMetadataDocument = {
  objects?: RawMetadataEntry[];
  [key: string]: unknown;
};

const DEFAULT_POSITION: Vec3 = { x: 0, y: 0, z: 0 };
const DEFAULT_ROTATION: Quat4 = { x: 0, y: 0, z: 0, w: 1 };

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const [key, inlineValue] = token.split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, true);
    }
  }

  return args;
}

function normalizeBoundsToSize(bounds: { min: number[]; max: number[] }): [number, number, number] {
  const size = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  return [round6(size[0]), round6(size[1]), round6(size[2])];
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeVec3(input: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(input)) {
    return {
      x: toNumber(input[0], fallback.x),
      y: toNumber(input[1], fallback.y),
      z: toNumber(input[2], fallback.z),
    };
  }

  if (input && typeof input === "object") {
    const obj = input as { x?: unknown; y?: unknown; z?: unknown };
    return {
      x: toNumber(obj.x, fallback.x),
      y: toNumber(obj.y, fallback.y),
      z: toNumber(obj.z, fallback.z),
    };
  }

  return { ...fallback };
}

function scaleVec3(value: Vec3, scale: number): Vec3 {
  return {
    x: round6(value.x * scale),
    y: round6(value.y * scale),
    z: round6(value.z * scale),
  };
}

function detectLinearScale(value: Vec3): number {
  const maxAbs = Math.max(Math.abs(value.x), Math.abs(value.y), Math.abs(value.z));
  return maxAbs > 50 ? 0.001 : 1;
}

function normalizeQuat(input: unknown, fallback: Quat4): Quat4 {
  if (Array.isArray(input)) {
    return {
      x: toNumber(input[0], fallback.x),
      y: toNumber(input[1], fallback.y),
      z: toNumber(input[2], fallback.z),
      w: toNumber(input[3], fallback.w),
    };
  }

  if (input && typeof input === "object") {
    const obj = input as { x?: unknown; y?: unknown; z?: unknown; w?: unknown };
    return {
      x: toNumber(obj.x, fallback.x),
      y: toNumber(obj.y, fallback.y),
      z: toNumber(obj.z, fallback.z),
      w: toNumber(obj.w, fallback.w),
    };
  }

  return { ...fallback };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function buildEntryFromFile(
  fileName: string,
  size: [number, number, number],
  modelPrefix: string,
  overrides: Partial<MetadataEntry>,
): MetadataEntry {
  const id = overrides.id ?? parse(fileName).name;
  const modelUrl = `${modelPrefix.replace(/\/+$/, "")}/${fileName}`;

  return {
    id,
    name: overrides.name ?? id,
    category: overrides.category ?? "other",
    objectRole: overrides.objectRole ?? undefined,
    shape: "model",
    size,
    placementType: overrides.placementType ?? "floor",
    color: overrides.color ?? "#f0f0f0",
    modelUrl,
    position: overrides.position ?? DEFAULT_POSITION,
    rotation: overrides.rotation ?? DEFAULT_ROTATION,
  };
}

async function listGlbFiles(modelsDir: string): Promise<string[]> {
  const entries = await readdir(modelsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".glb"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function findFirstMeshNode(scene: Scene): Node | null {
  const children = scene.listChildren();
  for (const child of children) {
    let found: Node | null = null;
    child.traverse((node) => {
      if (found) return;
      if (node.getMesh()) found = node;
    });
    if (found) return found;
  }
  return null;
}

async function loadBaseMetadata(
  filePath: string,
): Promise<Map<string, RawMetadataEntry>> {
  const baseFile = Bun.file(filePath);
  if (!(await baseFile.exists())) return new Map();

  let raw: RawMetadataEntry[] | RawMetadataDocument;
  try {
    raw = (await baseFile.json()) as RawMetadataEntry[] | RawMetadataDocument;
  } catch (error) {
    console.warn(`Failed to parse base metadata: ${(error as Error).message}`);
    return new Map();
  }

  const entries = Array.isArray(raw) ? raw : raw.objects;
  if (!Array.isArray(entries)) return new Map();

  const map = new Map<string, RawMetadataEntry>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const modelUrl = typeof entry.modelUrl === "string" ? entry.modelUrl : "";
    if (!modelUrl) continue;
    const cleaned = modelUrl.split(/[?#]/, 1)[0] ?? modelUrl;
    map.set(basename(cleaned).toLowerCase(), entry);
  }
  return map;
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const modelsDir = resolve(String(args.get("--models") ?? "."));
  const output = resolve(String(args.get("--out") ?? join(modelsDir, "metadata-test.json")));
  const modelPrefix = String(args.get("--model-prefix") ?? "/models");
  const baseMetadataPath = resolve(
    String(args.get("--base-metadata") ?? join(modelsDir, "metadata.json")),
  );
  const zeroBase = !args.has("--no-zero-base");

  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  io.registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });
  const files = await listGlbFiles(modelsDir);

  if (!files.length) {
    throw new Error(`No .glb files found in ${modelsDir}`);
  }

  const entries: MetadataEntry[] = [];
  const baseEntries = await loadBaseMetadata(baseMetadataPath);
  const basePositions: Vec3[] = [];
  const baseOffset: Vec3 = { x: 0, y: 0, z: 0 };

  if (zeroBase && baseEntries.size) {
    for (const entry of baseEntries.values()) {
      const rawPos = normalizeVec3(entry.position, DEFAULT_POSITION);
      const scale = detectLinearScale(rawPos);
      basePositions.push(scaleVec3(rawPos, scale));
    }
  }

  if (zeroBase && basePositions.length) {
    baseOffset.x = Math.min(...basePositions.map((pos) => pos.x));
    baseOffset.z = Math.min(...basePositions.map((pos) => pos.z));
  }

  for (const fileName of files) {
    const filePath = join(modelsDir, fileName);
    try {
      const document = await io.read(filePath);
      const root = document.getRoot();
      const scene = root.getDefaultScene() ?? root.listScenes()[0];
      if (!scene) {
        console.warn(`No scene found in ${fileName}`);
        continue;
      }

      const bounds = getBounds(scene);
      const size = normalizeBoundsToSize(bounds);
      const primaryNode = findFirstMeshNode(scene);
      const worldRotation = primaryNode?.getWorldRotation();
      const rotation = worldRotation
        ? {
            x: round6(worldRotation[0]),
            y: round6(worldRotation[1]),
            z: round6(worldRotation[2]),
            w: round6(worldRotation[3]),
          }
        : DEFAULT_ROTATION;
      const baseEntry = baseEntries.get(fileName.toLowerCase());
      let positionOverride: Vec3 | undefined;
      if (baseEntry?.position) {
        const rawPos = normalizeVec3(baseEntry.position, DEFAULT_POSITION);
        const scale = detectLinearScale(rawPos);
        const pos = scaleVec3(rawPos, scale);
        positionOverride = zeroBase
          ? {
              x: round6(pos.x - baseOffset.x),
              y: pos.y,
              z: round6(pos.z - baseOffset.z),
            }
          : pos;
      }
      const overrides: Partial<MetadataEntry> = baseEntry
        ? {
            id: typeof baseEntry.id === "string" ? baseEntry.id : undefined,
            name: typeof baseEntry.name === "string" ? baseEntry.name : undefined,
            category:
              typeof baseEntry.category === "string" ? baseEntry.category : undefined,
            placementType:
              typeof baseEntry.placementType === "string"
                ? baseEntry.placementType
                : undefined,
            color: typeof baseEntry.color === "string" ? baseEntry.color : undefined,
            objectRole:
              baseEntry.objectRole === "window" || baseEntry.objectRole === "door"
                ? baseEntry.objectRole
                : baseEntry.objectRole === null
                  ? null
                  : undefined,
            position: positionOverride ?? DEFAULT_POSITION,
            rotation: normalizeQuat(baseEntry.rotation, DEFAULT_ROTATION),
          }
        : {};
      if (!overrides.rotation) {
        overrides.rotation = normalizeQuat(rotation, DEFAULT_ROTATION);
      }
      entries.push(buildEntryFromFile(fileName, size, modelPrefix, overrides));
    } catch (error) {
      console.warn(`Failed to read ${fileName}: ${(error as Error).message}`);
    }
  }

  const json = `${JSON.stringify({ objects: entries }, null, 2)}\n`;
  await Bun.write(output, json);
  console.log(
    JSON.stringify(
      {
        modelsDir,
        output,
        count: entries.length,
      },
      null,
      2,
    ),
  );
}

await main();
