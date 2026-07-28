import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const backgroundSourceDirectory = path.join(
  projectRoot,
  'Kissago_Learn_Prompt_Pack',
  'assets',
  'backgrounds'
);
const backgroundOutputDirectory = path.join(projectRoot, 'public', 'learn', 'backgrounds');
const illustrationSourceDirectory = path.join(
  projectRoot,
  'Kissago_Learn_Prompt_Pack',
  'assets',
  'illustrations'
);
const illustrationOutputDirectory = path.join(projectRoot, 'public', 'learn', 'illustrations');

const backgrounds = [
  ['ChatGPT Image Jul 27, 2026, 10_12_46 AM (1).png', 'bg-01-story-seed.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_47 AM (2).png', 'bg-02-fragmented-creation.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_48 AM (3).png', 'bg-03-calm-attention.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_49 AM (4).png', 'bg-04-story-convergence.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_50 AM (5).png', 'bg-05-character-continuity.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_51 AM (6).png', 'bg-06-episodic-world.webp'],
  ['ChatGPT Image Jul 27, 2026, 10_12_52 AM (7).png', 'bg-07-create-invitation.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_33_08 PM (1).png', 'bg-08-prompt-to-story-world.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_33_08 PM (2).png', 'bg-09-product-experience.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_33_08 PM (3).png', 'bg-10-platform-pipeline.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_33_08 PM (4).png', 'bg-11-community-network.webp'],
];

const illustrations = [
  ['ChatGPT Image Jul 27, 2026, 12_27_35 PM (1).png', 'character-brass-companion.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_27_35 PM (2).png', 'character-starlight-creature.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_27_35 PM (3).png', 'character-community-storyteller.webp'],
  ['ChatGPT Image Jul 27, 2026, 12_27_35 PM (4).png', 'character-adventure-keeper.webp'],
];

await mkdir(backgroundOutputDirectory, { recursive: true });
await mkdir(illustrationOutputDirectory, { recursive: true });

for (const [sourceName, outputName] of backgrounds) {
  const sourcePath = path.join(backgroundSourceDirectory, sourceName);
  const outputPath = path.join(backgroundOutputDirectory, outputName);

  await sharp(sourcePath)
    .resize({ width: 1920, withoutEnlargement: true })
    .webp({ quality: 84, effort: 6 })
    .toFile(outputPath);

  console.log(`Optimized ${outputName}`);
}

for (const [sourceName, outputName] of illustrations) {
  const sourcePath = path.join(illustrationSourceDirectory, sourceName);
  const outputPath = path.join(illustrationOutputDirectory, outputName);

  await sharp(sourcePath)
    .resize({ width: 768, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(outputPath);

  console.log(`Optimized ${outputName}`);
}
