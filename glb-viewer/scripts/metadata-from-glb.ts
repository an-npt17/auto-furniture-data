import { readdir } from "node:fs/promises";
import { basename, join, parse, resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";

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
  return [round6(size[0] * 1000), round6(size[1] * 1000), round6(size[2] * 1000)];
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

async function main() {
  const args = parseArgs(Bun.argv.slice(2));
  const modelsDir = resolve(String(args.get("--models") ?? "."));
  const output = resolve(String(args.get("--out") ?? join(modelsDir, "metadata-test.json")));
  const modelPrefix = String(args.get("--model-prefix") ?? "/models");

  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const files = await listGlbFiles(modelsDir);

  if (!files.length) {
    throw new Error(`No .glb files found in ${modelsDir}`);
  }

  const entries: MetadataEntry[] = [];

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
      entries.push(buildEntryFromFile(fileName, size, modelPrefix, {}));
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
