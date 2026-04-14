// cli/compress-draco.ts
// Usage: bun cli/compress-draco.ts <input-folder> [output-folder]
import path from 'node:path';
import { readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression, KHRMaterialsTransmission, KHRTextureTransform } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const [,, inputArg, outputArg] = process.argv;

if (!inputArg) {
  console.error('Usage: bun cli/compress-draco.ts <input-folder> [output-folder]');
  process.exit(1);
}

const inputDir = path.resolve(inputArg);
const outputDir = outputArg ? path.resolve(outputArg) : `${inputDir}-draco`;
const outputDirRelative = path.relative(inputDir, outputDir);
const outputDirInsideInput = outputDirRelative !== '' && !outputDirRelative.startsWith('..') && !path.isAbsolute(outputDirRelative);

const MODEL_EXTENSIONS = new Set(['.glb', '.gltf']);

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
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      encodeSpeed: 5,
      decodeSpeed: 5,
      quantizationBits: {
        POSITION: 14,
        NORMAL: 10,
        TEX_COORD: 12,
      },
      quantizationVolume: 'mesh',
    });

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
