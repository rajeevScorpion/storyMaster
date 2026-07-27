import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(
  projectRoot,
  'Kissago_Learn_Prompt_Pack',
  'assets',
  'backgrounds'
);
const outputDirectory = path.join(projectRoot, 'public', 'learn', 'backgrounds');

const backgrounds = [
  ['ChatGPT Image Jul 27, 2026, 10_12_46 AM (1).png', 'bg-01-story-seed.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_47 AM (2).png', 'bg-02-fragmented-creation.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_48 AM (3).png', 'bg-03-calm-attention.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_49 AM (4).png', 'bg-04-story-convergence.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_50 AM (5).png', 'bg-05-character-continuity.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_51 AM (6).png', 'bg-06-episodic-world.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_52 AM (7).png', 'bg-07-create-invitation.webp'],
];

await mkdir(outputDirectory, { recursive: true });

for (const [sourceName, outputName] of backgrounds) {
  const sourcePath = path.join(sourceDirectory, sourceName);
  const outputPath = path.join(outputDirectory, outputName);

  await sharp(sourcePath)
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 84, effort: 6 })
    .toFile(outputPath);

  console.log(`Optimized ${outputName}`);
}
