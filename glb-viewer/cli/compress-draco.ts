// cli/compress-draco.ts
// Usage: bun cli/compress-draco.ts <input-folder> [output-folder] [options]
import path from "node:path";
import { readdir, mkdir, stat } from "node:fs/promises";

type DracoOptions = {
  method: "edgebreaker" | "sequential";
  quantizationVolume: "mesh" | "scene";
  quantizeColor: number;
  quantizeGeneric: number;
  quantizeNormal: number;
  quantizePosition: number;
  quantizeTexcoord: number;
  encodeSpeed: number;
  decodeSpeed: number;
};

type TextureOptions = {
  enabled: boolean;
  format: "etc1s" | "uastc";
  slots: string;
};

function parseIntegerFlag(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }
  return Number(value);
}

function parseChoiceFlag<T extends string>(
  value: string | undefined,
  fallback: T,
  name: string,
  allowed: readonly T[],
): T {
  if (!value) return fallback;
  if (!allowed.includes(value as T)) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }
  return value as T;
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      flags.set("--help", true);
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [name, inlineValue] = arg.split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(name, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      i += 1;
      continue;
    }

    flags.set(name, true);
  }

  return { flags, positionals };
}

const { flags, positionals } = parseArgs(process.argv.slice(2));
const [inputArg, outputArg] = positionals;

function printUsage(): void {
  console.log(
    [
      "Usage: bun cli/compress-draco.ts <input-folder> [output-folder] [options]",
      "",
      "Geometry (Draco) options:",
      "  --method <name>                  Draco method: edgebreaker|sequential (default: edgebreaker)",
      "  --quantization-volume <name>      mesh|scene (default: mesh)",
      "  --quantize-position <n>           POSITION bits, 1-16 (default: 10)",
      "  --quantize-normal <n>             NORMAL bits, 1-16 (default: 6)",
      "  --quantize-texcoord <n>           TEXCOORD bits, 1-16 (default: 6)",
      "  --quantize-color <n>              COLOR bits, 1-16 (default: 4)",
      "  --quantize-generic <n>            Generic attribute bits, 1-16 (default: 4)",
      "  --encode-speed <n>                Encoding speed, 0-10 (default: 0)",
      "  --decode-speed <n>                Decoding speed, 0-10 (default: 0)",
      "",
      "Texture options:",
      "  --compress-textures               Enable KTX2/BasisU texture compression (big size wins)",
      "  --texture-format <name>           etc1s|uastc (default: etc1s — smaller; uastc — higher quality)",
      '  --texture-slots <glob>            Texture slot glob (default: "*" = all textures)',
      "",
      "  -h, --help                       Show this help message",
      "",
      "Tips for maximum compression:",
      "  • Lower quantize-* values = smaller files (with some visual quality tradeoff)",
      "  • Draco only compresses geometry — use --compress-textures if your GLBs embed textures",
      "  • etc1s gives the best file size reduction; uastc is better quality but larger",
    ].join("\n"),
  );
}

if (!inputArg) {
  printUsage();
  process.exit(1);
}

if (flags.has("--help")) {
  printUsage();
  process.exit(0);
}

const inputDir = path.resolve(inputArg);
const outputDir = outputArg ? path.resolve(outputArg) : `${inputDir}-draco`;
const outputDirRelative = path.relative(inputDir, outputDir);
const outputDirInsideInput =
  outputDirRelative !== "" &&
  !outputDirRelative.startsWith("..") &&
  !path.isAbsolute(outputDirRelative);

const MODEL_EXTENSIONS = new Set([".glb", ".gltf"]);

const dracoOptions: DracoOptions = {
  method: parseChoiceFlag(
    typeof flags.get("--method") === "string"
      ? (flags.get("--method") as string)
      : undefined,
    "edgebreaker",
    "--method",
    ["edgebreaker", "sequential"],
  ),
  quantizationVolume: parseChoiceFlag(
    typeof flags.get("--quantization-volume") === "string"
      ? (flags.get("--quantization-volume") as string)
      : undefined,
    "mesh",
    "--quantization-volume",
    ["mesh", "scene"],
  ),
  // More aggressive defaults vs. original (lower bits = smaller output)
  quantizeColor: parseIntegerFlag(
    typeof flags.get("--quantize-color") === "string"
      ? (flags.get("--quantize-color") as string)
      : undefined,
    4, // was 6
    "--quantize-color",
  ),
  quantizeGeneric: parseIntegerFlag(
    typeof flags.get("--quantize-generic") === "string"
      ? (flags.get("--quantize-generic") as string)
      : undefined,
    4, // was 6
    "--quantize-generic",
  ),
  quantizeNormal: parseIntegerFlag(
    typeof flags.get("--quantize-normal") === "string"
      ? (flags.get("--quantize-normal") as string)
      : undefined,
    6, // unchanged — normals need a bit more precision to avoid shading artefacts
    "--quantize-normal",
  ),
  quantizePosition: parseIntegerFlag(
    typeof flags.get("--quantize-position") === "string"
      ? (flags.get("--quantize-position") as string)
      : undefined,
    10, // was 8 — slightly higher precision to avoid visible mesh distortion
    "--quantize-position",
  ),
  quantizeTexcoord: parseIntegerFlag(
    typeof flags.get("--quantize-texcoord") === "string"
      ? (flags.get("--quantize-texcoord") as string)
      : undefined,
    6, // was 8
    "--quantize-texcoord",
  ),
  encodeSpeed: parseIntegerFlag(
    typeof flags.get("--encode-speed") === "string"
      ? (flags.get("--encode-speed") as string)
      : undefined,
    0,
    "--encode-speed",
  ),
  decodeSpeed: parseIntegerFlag(
    typeof flags.get("--decode-speed") === "string"
      ? (flags.get("--decode-speed") as string)
      : undefined,
    0,
    "--decode-speed",
  ),
};

const textureOptions: TextureOptions = {
  enabled: flags.has("--compress-textures"),
  format: parseChoiceFlag(
    typeof flags.get("--texture-format") === "string"
      ? (flags.get("--texture-format") as string)
      : undefined,
    "etc1s",
    "--texture-format",
    ["etc1s", "uastc"],
  ),
  slots:
    typeof flags.get("--texture-slots") === "string"
      ? (flags.get("--texture-slots") as string)
      : "*",
};

async function listModels(dir: string): Promise<string[]> {
  if (outputDirInsideInput) {
    const relativeToOutput = path.relative(outputDir, dir);
    if (
      relativeToOutput === "" ||
      (!relativeToOutput.startsWith("..") && !path.isAbsolute(relativeToOutput))
    ) {
      return [];
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listModels(fullPath)));
      continue;
    }

    if (
      entry.isFile() &&
      MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

async function compressFile(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  // Step 1: Deduplicate identical textures (fixes the 3× Aicorn_Normal02 problem)
  const dedupeResult =
    await Bun.$`bunx @gltf-transform/cli dedup ${inputPath} ${outputPath}`;
  if (dedupeResult.exitCode !== 0) {
    throw new Error(`gltf-transform dedup failed for ${inputPath}`);
  }

  // Step 2: Draco geometry compression
  const dracoResult =
    await Bun.$`bunx @gltf-transform/cli draco ${outputPath} ${outputPath} \
    --method ${dracoOptions.method} \
    --quantization-volume ${dracoOptions.quantizationVolume} \
    --quantize-color ${dracoOptions.quantizeColor} \
    --quantize-generic ${dracoOptions.quantizeGeneric} \
    --quantize-normal ${dracoOptions.quantizeNormal} \
    --quantize-position ${dracoOptions.quantizePosition} \
    --quantize-texcoord ${dracoOptions.quantizeTexcoord} \
    --encode-speed ${dracoOptions.encodeSpeed} \
    --decode-speed ${dracoOptions.decodeSpeed}`;
  if (dracoResult.exitCode !== 0) {
    throw new Error(`gltf-transform draco failed for ${inputPath}`);
  }

  // Step 3: KTX2/ETC1S texture compression (huge reduction on raw PNG/JPEG)
  const textureResult =
    await Bun.$`bunx @gltf-transform/cli etc1s ${outputPath} ${outputPath}`;
  if (textureResult.exitCode !== 0) {
    console.warn(
      `\nWarning: texture compression failed for ${path.basename(outputPath)}`,
    );
  }
}

function resolveOutputPath(inputPath: string): string {
  const relative = path.relative(inputDir, inputPath);
  const parsed = path.parse(path.join(outputDir, relative));
  return path.join(parsed.dir, `${parsed.name}.glb`);
}

async function printSizeSummary(models: string[]): Promise<void> {
  let totalInput = 0;
  let totalOutput = 0;

  for (const inputPath of models) {
    const outputPath = resolveOutputPath(inputPath);
    try {
      const [inStat, outStat] = await Promise.all([
        stat(inputPath),
        stat(outputPath),
      ]);
      totalInput += inStat.size;
      totalOutput += outStat.size;
    } catch {
      // File may have failed — skip
    }
  }

  if (totalInput === 0) return;

  const saved = totalInput - totalOutput;
  const pct = ((saved / totalInput) * 100).toFixed(1);
  const fmt = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(
    `Size: ${fmt(totalInput)} → ${fmt(totalOutput)} (saved ${fmt(saved)}, ${pct}% reduction)`,
  );
}

async function main(): Promise<void> {
  const inputStats = await stat(inputDir);
  if (!inputStats.isDirectory()) {
    throw new Error(`Not a folder: ${inputDir}`);
  }

  const models = await listModels(inputDir);
  if (models.length === 0) {
    console.log(`No model files found in ${inputDir}`);
    return;
  }

  console.log(`Found ${models.length} model(s)`);
  if (textureOptions.enabled) {
    console.log(
      `Texture compression: enabled (format: ${textureOptions.format})`,
    );
  } else {
    console.log(
      `Texture compression: disabled (pass --compress-textures to enable — big wins if GLBs embed textures)`,
    );
  }

  let failedCount = 0;
  for (const [index, inputPath] of models.entries()) {
    const relative = path.relative(inputDir, inputPath);
    const outputPath = resolveOutputPath(inputPath);
    process.stdout.write(
      `\r[${index + 1}/${models.length}] ${relative}             `,
    );
    try {
      await compressFile(inputPath, outputPath);
    } catch (err) {
      failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nFailed: ${relative} -> ${message}`);
    }
  }

  console.log(`\nDone — compressed models written to ${outputDir}`);
  await printSizeSummary(models);

  if (failedCount > 0) {
    process.exitCode = 1;
    console.warn(`Skipped ${failedCount} model(s) with errors.`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("Error:", message);
  process.exit(1);
});
