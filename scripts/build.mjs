// `pnpm build` — compila src/*.ts a dist/ y copia los archivos estáticos.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { compile, loadProject } from './tsc-project.mjs';

const ASSETS = ['index.html', path.join('src', 'styles.css')];
const outDir = path.resolve('dist');

const started = performance.now();

const project = loadProject();
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = compile(project);
if (!result.ok) {
  process.stderr.write(result.text);
  console.error(`\n✗ build detenido: ${result.diagnostics.length} problema(s).`);
  process.exit(1);
}

for (const asset of ASSETS) {
  await cp(asset, path.join(outDir, path.basename(asset)));
}

const emitted = (await readdir(outDir, { recursive: true })).filter((file) =>
  String(file).endsWith('.js'),
).length;

const ms = Math.round(performance.now() - started);
console.log(`✓ build · ${emitted} módulos + ${ASSETS.length} estáticos · ${ms} ms`);
