// cli/compress-draco.ts
// Usage: bun cli/compress-draco.ts <input-folder> [output-folder] [options]
import path from 'node:path';
import { readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, KHRMaterialsTransmission, KHRTextureTransform } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

type CompressionOptions = {
  method: typeof KHRDracoMeshCompression.EncoderMethod[keyof typeof KHRDracoMeshCompression.EncoderMethod];
  encodeSpeed: number;
  decodeSpeed: number;
  quantizationBits: {
    POSITION: number;
    NORMAL: number;
    TEX_COORD: number;
    GENERIC?: number;
    JOINT?: number;
    WEIGHT?: number;
  };
  quantizationVolume: 'mesh' | 'scene' | 'bbox';
};

function parseIntegerFlag(value: string | undefined, fallback: number, name: string): number {
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
    if (arg === '-h' || arg === '--help') {
      flags.set('--help', true);
      continue;
    }

    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [name, inlineValue] = arg.split('=', 2);
    if (inlineValue !== undefined) {
      flags.set(name, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
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
  console.log([
    'Usage: bun cli/compress-draco.ts <input-folder> [output-folder] [options]',
    '',
    'Options:',
    '  --method edgebreaker|sequential  Draco method (default: edgebreaker)',
    '  --encode-speed <n>               Lower is smaller, slower (default: 0)',
    '  --decode-speed <n>               Lower is smaller, slower (default: 0)',
    '  --position-bits <n>              Position quantization bits (default: 12)',
    '  --normal-bits <n>                Normal quantization bits (default: 8)',
    '  --uv-bits <n>                    UV quantization bits (default: 10)',
    '  --joint-bits <n>                 Joint quantization bits (default: 8)',
    '  --weight-bits <n>                Weight quantization bits (default: 8)',
    '  --volume mesh|scene|bbox         Quantization volume (default: mesh)',
    '  -h, --help                       Show this help message',
  ].join('\n'));
}

if (!inputArg) {
  printUsage();
  process.exit(1);
}

if (flags.has('--help')) {
  printUsage();
  process.exit(0);
}

const inputDir = path.resolve(inputArg);
const outputDir = outputArg ? path.resolve(outputArg) : `${inputDir}-draco`;
const outputDirRelative = path.relative(inputDir, outputDir);
const outputDirInsideInput = outputDirRelative !== '' && !outputDirRelative.startsWith('..') && !path.isAbsolute(outputDirRelative);

const MODEL_EXTENSIONS = new Set(['.glb', '.gltf']);
const compressionOptions: Parameters<InstanceType<typeof KHRDracoMeshCompression>['setEncoderOptions']>[0] = {
  method: parseChoiceFlag(
    typeof flags.get('--method') === 'string' ? flags.get('--method') : undefined,
    'edgebreaker',
    '--method',
    ['edgebreaker', 'sequential'],
  ) === 'sequential'
    ? KHRDracoMeshCompression.EncoderMethod.SEQUENTIAL
    : KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
  encodeSpeed: parseIntegerFlag(typeof flags.get('--encode-speed') === 'string' ? flags.get('--encode-speed') : undefined, 0, '--encode-speed'),
  decodeSpeed: parseIntegerFlag(typeof flags.get('--decode-speed') === 'string' ? flags.get('--decode-speed') : undefined, 0, '--decode-speed'),
  quantizationBits: {
    POSITION: parseIntegerFlag(typeof flags.get('--position-bits') === 'string' ? flags.get('--position-bits') : undefined, 12, '--position-bits'),
    NORMAL: parseIntegerFlag(typeof flags.get('--normal-bits') === 'string' ? flags.get('--normal-bits') : undefined, 8, '--normal-bits'),
    TEX_COORD: parseIntegerFlag(typeof flags.get('--uv-bits') === 'string' ? flags.get('--uv-bits') : undefined, 10, '--uv-bits'),
    JOINT: parseIntegerFlag(typeof flags.get('--joint-bits') === 'string' ? flags.get('--joint-bits') : undefined, 8, '--joint-bits'),
    WEIGHT: parseIntegerFlag(typeof flags.get('--weight-bits') === 'string' ? flags.get('--weight-bits') : undefined, 8, '--weight-bits'),
  },
  quantizationVolume: parseChoiceFlag(
    typeof flags.get('--volume') === 'string' ? flags.get('--volume') : undefined,
    'mesh',
    '--volume',
    ['mesh', 'scene', 'bbox'],
  ),
};

async function listModels(dir: string): Promise<string[]> {
  if (outputDirInsideInput) {
    const relativeToOutput = path.relative(outputDir, dir);
    if (relativeToOutput === '' || (!relativeToOutput.startsWith('..') && !path.isAbsolute(relativeToOutput))) {
      return [];
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listModels(fullPath));
      continue;
    }

    if (entry.isFile() && MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function compressFile(io: NodeIO, inputPath: string, outputPath: string): Promise<void> {
  const doc = await io.read(inputPath);
  doc.createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions(compressionOptions);

  const output = await io.writeBinary(doc);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
}

function resolveOutputPath(inputPath: string): string {
  const relative = path.relative(inputDir, inputPath);
  const parsed = path.parse(path.join(outputDir, relative));
  return path.join(parsed.dir, `${parsed.name}.glb`);
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

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression, KHRMaterialsTransmission, KHRTextureTransform])
    .registerDependencies({
      'draco3d.encoder': await draco3d.createEncoderModule({}),
      'draco3d.decoder': await draco3d.createDecoderModule({}),
    });
  console.log(`Found ${models.length} model(s)`);

  let failedCount = 0;
  for (const [index, inputPath] of models.entries()) {
    const relative = path.relative(inputDir, inputPath);
    const outputPath = resolveOutputPath(inputPath);
    process.stdout.write(`\r[${index + 1}/${models.length}] ${relative}             `);
    try {
      await compressFile(io, inputPath, outputPath);
    } catch (err) {
      failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nFailed: ${relative} -> ${message}`);
    }
  }

  console.log(`\nDone — compressed models written to ${outputDir}`);
  if (failedCount > 0) {
    process.exitCode = 1;
    console.warn(`Skipped ${failedCount} model(s) with errors.`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Error:', message);
  process.exit(1);
});
