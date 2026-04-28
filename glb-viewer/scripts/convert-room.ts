import * as fs from "fs";
import * as path from "path";

// ─── Input types ────────────────────────────────────────────────────────────

interface InputObject {
  id: string;
  name: string;
  category: string;
  shape: string;
  size: [number, number, number]; // mm
  placementType: string;
  color: string;
  modelUrl: string;
  position?: { x: number; y: number; z: number }; // mm
  rotation?: { x: number; y: number; z: number; w: number };
}

interface InputWall {
  id: string;
  startPoint: [number, number];
  endPoint: [number, number];
  thickness: number;
  height: number;
  color: string;
}

interface RoomInput {
  polygon: [number, number][];
  walls: InputWall[];
  objects: InputObject[];
}

// ─── Output types ────────────────────────────────────────────────────────────

interface ColorOption {
  name: string;
  hex: string;
}

interface SizeOption {
  label: string;
  size: [number, number, number];
}

interface CatalogEntry {
  brand: string;
  description: string;
  price: number;
  colorOptions: ColorOption[];
  sizeOptions: SizeOption[];
  materialOptions: unknown[];
}

interface ObjectEntry {
  id: string;
  name: string;
  category: string;
  shape: string;
  size: [number, number, number];
  placementType: string;
  color: string;
  modelUrl: string;
}

interface TemplateWall {
  id: string;
  startPoint: [number, number];
  endPoint: [number, number];
  thickness: number;
  height: number;
  color: string;
}

interface TemplateObject {
  name: string;
  type: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  color: string;
  size: [number, number, number];
  modelUrl: string;
  placementType: string;
}

interface RoomTemplate {
  id: string;
  name: string;
  description: string;
  polygon: [number, number][];
  walls: TemplateWall[];
  objects: TemplateObject[];
}

// ─── Config ──────────────────────────────────────────────────────────────────

interface ConvertConfig {
  /** Source JSON file path */
  inputFile: string;
  /** Output directory (will be created if absent) */
  outputDir: string;
  /** Target model folder prefix, e.g. "/models/flora-master/" */
  modelPrefix: string;
  /** Human-readable room name */
  roomName: string;
  /** Unit scale: divide mm values by this to get metres (default 1000) */
  scale?: number;
  /**
   * Local folder containing .glb files.
   * When provided, any object whose modelUrl filename is NOT found in this
   * folder is silently dropped from all three output files.
   */
  modelsDir?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_COLORS: ColorOption[] = [
  { name: "Trắng", hex: "#FFFFFF" },
  { name: "Đen", hex: "#000000" },
  { name: "Gỗ sồi tự nhiên", hex: "#D2B48C" },
  { name: "Óc chó", hex: "#6D4C41" },
  { name: "Xám", hex: "#9E9E9E" },
  { name: "Xanh hải quân", hex: "#1A237E" },
  { name: "Xanh rừng", hex: "#1B5E20" },
  { name: "Đồng cổ", hex: "#C9A227" },
];

function mm2m(v: number, scale: number): number {
  return parseFloat((v / scale).toFixed(6));
}

function scaleSize(
  size: [number, number, number],
  scale: number,
): [number, number, number] {
  return [mm2m(size[0], scale), mm2m(size[1], scale), mm2m(size[2], scale)];
}

function getFilename(modelUrl: string): string {
  return path.posix.basename(modelUrl);
}

function buildModelPath(filename: string, prefix: string): string {
  return prefix.replace(/\/$/, "") + "/" + filename;
}

function slugify(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/**
 * Returns a Set of filenames (e.g. "Group001.glb") that exist in the given
 * local folder, or null when no folder was specified (= keep everything).
 */
function loadAvailableModels(
  modelsDir: string | undefined,
): Set<string> | null {
  if (!modelsDir) return null;

  if (!fs.existsSync(modelsDir)) {
    console.warn(
      `Warning: --models folder not found → ${modelsDir} (skipping filter)`,
    );
    return null;
  }

  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => f.toLowerCase().endsWith(".glb"));
  console.log(`  found ${files.length} .glb file(s) in ${modelsDir}`);
  return new Set(files);
}

function categoryToVi(cat: string): string {
  const c = (cat ?? "").toLowerCase().replace(/\s/g, "");
  if (c.includes("ngu")) return "Phòng ngủ";
  if (c.includes("bep") || c.includes("bếp")) return "Phòng bếp";
  if (c.includes("khach") || c.includes("khách")) return "Phòng khách";
  if (c.includes("tam") || c.includes("tắm")) return "Phòng tắm";
  return "Phòng ngủ";
}

// ─── Core converter ──────────────────────────────────────────────────────────

function convert(
  input: RoomInput,
  config: ConvertConfig,
): {
  catalog: Record<string, CatalogEntry>;
  objects: ObjectEntry[];
  roomTemplate: RoomTemplate;
} {
  const scale = config.scale ?? 1000;
  const { modelPrefix, roomName } = config;
  const { walls } = input;

  // ── Filter objects by available model files ────────────────────
  const available = loadAvailableModels(config.modelsDir);
  const skipped: string[] = [];

  const objects = available
    ? input.objects.filter((obj) => {
        const filename = getFilename(obj.modelUrl);
        if (available.has(filename)) return true;
        skipped.push(
          `  skipped  ${obj.name}  (${filename} not in models folder)`,
        );
        return false;
      })
    : input.objects;

  if (skipped.length) {
    console.log("\nFiltered out (model file missing):");
    skipped.forEach((s) => console.log(s));
  }

  // ── catalog.json ──────────────────────────────────────────────
  const catalog: Record<string, CatalogEntry> = {};

  for (const obj of objects) {
    const filename = getFilename(obj.modelUrl);
    const key = buildModelPath(filename, modelPrefix);
    const sizeM = scaleSize(obj.size, scale);

    catalog[key] = {
      brand: "XHome",
      description: `${obj.name} `,
      price: 0,
      colorOptions: [
        { name: obj.name, hex: obj.color ?? "#000000" },
        ...DEFAULT_COLORS,
      ],
      sizeOptions: [{ label: obj.name, size: sizeM }],
      materialOptions: [],
    };
  }

  // ── objects.json ──────────────────────────────────────────────
  const objectList: ObjectEntry[] = objects.map((obj) => {
    const filename = getFilename(obj.modelUrl);
    return {
      id: `flora-master-${slugify(obj.id ?? obj.name)}`,
      name: obj.name,
      category: categoryToVi(obj.category),
      shape: obj.shape ?? "model",
      size: scaleSize(obj.size, scale),
      placementType: obj.placementType ?? "floor",
      color: "#000000",
      modelUrl: buildModelPath(filename, modelPrefix),
    };
  });

  // ── roomTemplate.json ─────────────────────────────────────────
  // Normalise positions so the room origin starts near [0, 0, 0]
  const xs = objects.map((o) => o.position?.x ?? 0);
  const zs = objects.map((o) => o.position?.z ?? 0);
  const originX = xs.length ? Math.min(...xs) : 0;
  const originZ = zs.length ? Math.min(...zs) : 0;

  const templateWalls: TemplateWall[] = walls.map((w) => ({
    id: w.id,
    startPoint: [mm2m(w.startPoint[0], scale), mm2m(w.startPoint[1], scale)],
    endPoint: [mm2m(w.endPoint[0], scale), mm2m(w.endPoint[1], scale)],
    thickness: w.thickness,
    height: w.height,
    color: w.color,
  }));

  const templateObjects: TemplateObject[] = objects.map((obj) => {
    const filename = getFilename(obj.modelUrl);
    const pos = obj.position
      ? ([
          mm2m(obj.position.x - originX, scale),
          mm2m(obj.position.y, scale),
          mm2m(obj.position.z - originZ, scale),
        ] as [number, number, number])
      : ([0, 0, 0] as [number, number, number]);

    const rot: [number, number, number, number] = obj.rotation
      ? [obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.w]
      : [0, 1, 0, 0];

    return {
      name: obj.name,
      type: "model",
      position: pos,
      rotation: rot,
      color: "#000000",
      size: scaleSize(obj.size, scale),
      modelUrl: buildModelPath(filename, modelPrefix),
      placementType: obj.placementType ?? "floor",
    };
  });

  const roomTemplate: RoomTemplate = {
    id: `custom-${Date.now()}`,
    name: roomName,
    description: `Mẫu thiết kế ${roomName.toLowerCase()} từ bộ sưu tập từ XHome`,
    polygon: [],
    walls: templateWalls,
    objects: templateObjects,
  };

  return { catalog, objects: objectList, roomTemplate };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  // Quick --help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  npx ts-node convert-room.ts \\
    --input  <input.json>        \\
    --output <output-dir>        \\
    --prefix <model-prefix>      \\
    --name   <room-name>         \\
    [--models <glb-folder>]      \\
    [--scale  <mm-per-metre>]

Options:
  --models  Local folder of .glb files. Objects whose modelUrl filename is
            NOT found in this folder are removed from all three output files.

Defaults:
  --prefix  /models/flora-master/
  --name    Phòng ngủ Flora
  --scale   1000
    `);
    process.exit(0);
  }

  // Parse named args
  function getArg(flag: string, fallback: string): string {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  }

  function getOptionalArg(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  }

  const config: ConvertConfig = {
    inputFile: getArg("--input", "room.json"),
    outputDir: getArg("--output", "output"),
    modelPrefix: getArg("--prefix", "/models/flora-master/"),
    roomName: getArg("--name", "Phòng ngủ Flora"),
    scale: parseFloat(getArg("--scale", "1000")),
    modelsDir: getOptionalArg("--models"),
  };

  // Read input
  if (!fs.existsSync(config.inputFile)) {
    console.error(`Error: input file not found → ${config.inputFile}`);
    process.exit(1);
  }

  let input: RoomInput;
  try {
    input = JSON.parse(fs.readFileSync(config.inputFile, "utf-8"));
  } catch (e) {
    console.error("Error: failed to parse input JSON:", (e as Error).message);
    process.exit(1);
  }

  // Convert
  const { catalog, objects, roomTemplate } = convert(input, config);

  // Write outputs
  fs.mkdirSync(config.outputDir, { recursive: true });

  const write = (filename: string, data: unknown): void => {
    const outPath = path.join(config.outputDir, filename);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(
      `  wrote  ${outPath}  (${Object.keys(data as object).length} entries)`,
    );
  };

  console.log("\nConverting…");
  write("catalog.json", catalog);
  write("objects.json", objects);
  write("roomTemplate.json", roomTemplate);
  console.log("\nDone.");
}

main();
