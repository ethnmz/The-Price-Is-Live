// Registers the stage fonts (Bungee, Lilita One) if their .ttf files sit in src/stage/assets/fonts.
// If they are missing we do nothing: theme.FONTS already lists system fallbacks.
// TO VERIFY ON THE REAL LINE: the font files were not downloaded (no network in the build run);
// drop Bungee-Regular.ttf and LilitaOne-Regular.ttf (OFL) into src/stage/assets/fonts to get the real look.
import { GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const FILES: { file: string; family: string }[] = [
  { file: 'Bungee-Regular.ttf', family: 'Bungee' },
  { file: 'LilitaOne-Regular.ttf', family: 'Lilita One' },
];

let done = false;

export function registerFonts(): void {
  if (done) return;
  done = true;
  const dir = fileURLToPath(new URL('./assets/fonts/', import.meta.url));
  for (const f of FILES) {
    const path = join(dir, f.file);
    if (existsSync(path) && !GlobalFonts.has(f.family)) GlobalFonts.registerFromPath(path, f.family);
  }
}
