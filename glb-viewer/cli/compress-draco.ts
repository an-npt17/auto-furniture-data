// cli/compress-draco.ts
// Usage: bun cli/compress-draco.ts <input-folder> [output-folder] [options]
import path from 'node:path';
import { readdir, mkdir, stat } from 'node:fs/promises';

type DracoOptions = {
  method: 'edgebreaker' | 'sequential';
  quantizationVolume: 'mesh' | 'scene';
  quantizeColor: number;
  quantizeGeneric: number;
  quantizeNormal: number;
  quantizePosition: number;
  quantizeTexcoord: number;
  encodeSpeed: number;
  decodeSpeed: number;
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
    '  --method <name>                  Draco method: edgebreaker|sequential (default: edgebreaker)',
    '  --quantization-volume <name>      mesh|scene (default: mesh)',
    '  --quantize-position <n>           POSITION bits, 1-16 (default: 10)',
    '  --quantize-normal <n>             NORMAL bits, 1-16 (default: 8)',
    '  --quantize-texcoord <n>           TEXCOORD bits, 1-16 (default: 10)',
    '  --quantize-color <n>              COLOR bits, 1-16 (default: 8)',
    '  --quantize-generic <n>            Generic attribute bits, 1-16 (default: 8)',
    '  --encode-speed <n>                Encoding speed, 0-10 (default: 0)',
    '  --decode-speed <n>                Decoding speed, 0-10 (default: 0)',
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
const dracoOptions: DracoOptions = {
  method: parseChoiceFlag(
    typeof flags.get('--method') === 'string' ? flags.get('--method') : undefined,
    'edgebreaker',
    '--method',
    ['edgebreaker', 'sequential'],
  ),
  quantizationVolume: parseChoiceFlag(
    typeof flags.get('--quantization-volume') === 'string' ? flags.get('--quantization-volume') : undefined,
    'mesh',
    '--quantization-volume',
    ['mesh', 'scene'],
  ),
  quantizeColor: parseIntegerFlag(
    typeof flags.get('--quantize-color') === 'string' ? flags.get('--quantize-color') : undefined,
    8,
    '--quantize-color',
  ),
  quantizeGeneric: parseIntegerFlag(
    typeof flags.get('--quantize-generic') === 'string' ? flags.get('--quantize-generic') : undefined,
    8,
    '--quantize-generic',
  ),
  quantizeNormal: parseIntegerFlag(
    typeof flags.get('--quantize-normal') === 'string' ? flags.get('--quantize-normal') : undefined,
    8,
    '--quantize-normal',
  ),
  quantizePosition: parseIntegerFlag(
    typeof flags.get('--quantize-position') === 'string' ? flags.get('--quantize-position') : undefined,
    10,
    '--quantize-position',
  ),
  quantizeTexcoord: parseIntegerFlag(
    typeof flags.get('--quantize-texcoord') === 'string' ? flags.get('--quantize-texcoord') : undefined,
    10,
    '--quantize-texcoord',
  ),
  encodeSpeed: parseIntegerFlag(
    typeof flags.get('--encode-speed') === 'string' ? flags.get('--encode-speed') : undefined,
    0,
    '--encode-speed',
  ),
  decodeSpeed: parseIntegerFlag(
    typeof flags.get('--decode-speed') === 'string' ? flags.get('--decode-speed') : undefined,
    0,
    '--decode-speed',
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

async function compressFile(inputPath: string, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const command = Bun.$`bunx @gltf-transform/cli draco ${inputPath} ${outputPath} --method ${dracoOptions.method} --quantization-volume ${dracoOptions.quantizationVolume} --quantize-color ${dracoOptions.quantizeColor} --quantize-generic ${dracoOptions.quantizeGeneric} --quantize-normal ${dracoOptions.quantizeNormal} --quantize-position ${dracoOptions.quantizePosition} --quantize-texcoord ${dracoOptions.quantizeTexcoord} --encode-speed ${dracoOptions.encodeSpeed} --decode-speed ${dracoOptions.decodeSpeed}`;
  const result = await command;
  if (result.exitCode !== 0) {
    throw new Error(`gltf-transform draco failed for ${inputPath}`);
  }
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

  console.log(`Found ${models.length} model(s)`);

  let failedCount = 0;
  for (const [index, inputPath] of models.entries()) {
    const relative = path.relative(inputDir, inputPath);
    const outputPath = resolveOutputPath(inputPath);
    process.stdout.write(`\r[${index + 1}/${models.length}] ${relative}             `);
    try {
      await compressFile(inputPath, outputPath);
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
