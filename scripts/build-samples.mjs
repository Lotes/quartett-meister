/**
 * Builds static sample ZIP files into the public/samples directory.
 * Run via: npm run build:samples
 *
 * Each subdirectory under samples/ is zipped and placed in public/samples/<name>.zip.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const samplesDir = path.join(root, 'samples');
const outputDir = path.join(root, 'public', 'samples');

fs.mkdirSync(outputDir, { recursive: true });

const entries = fs.readdirSync(samplesDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const name = entry.name;
  const dir = path.join(samplesDir, name);
  const zip = new JSZip();

  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isFile()) {
      zip.file(file, fs.readFileSync(filePath));
    }
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const outFile = path.join(outputDir, `${name}.zip`);
  fs.writeFileSync(outFile, buffer);
  console.log(`Built public/samples/${name}.zip`);
}
