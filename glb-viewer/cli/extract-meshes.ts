// cli/extract-meshes.ts
// Usage: bun cli/extract-meshes.ts <input.glb> [output-dir]
import path from 'node:path';
import { extractMeshes } from './mesh-extractor';

const [,, inputArg, outputArg] = process.argv;

if (!inputArg) {
  console.error('Usage: bun cli/extract-meshes.ts <input.glb> [output-dir]');
  process.exit(1);
}

const inputPath = path.resolve(inputArg);
const baseName = path.basename(inputPath, path.extname(inputPath));
const outputDir = outputArg ? path.resolve(outputArg) : path.join(path.dirname(inputPath), `${baseName}_meshes`);

console.log(`Output: ${outputDir}`);

extractMeshes(inputPath, outputDir)
  .then((manifest) => {
    console.log(`\nDone — ${manifest.meshes.length} mesh(es) exported to: ${outputDir}`);
  })
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
