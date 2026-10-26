// `pnpm dev` — compila, sirve dist/ y vuelve a compilar al guardar un archivo.
// Todo en el mismo proceso: no lanza tsc, ni vite, ni esbuild.
import { watch } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { compile, loadProject } from './tsc-project.mjs';
import { startServer } from './serve.mjs';

const PORT = Number(process.env.PORT ?? 5173);
const outDir = path.resolve('dist');
const assets = ['index.html', path.join('src', 'styles.css')];

const build = async () => {
  const project = loadProject(process.cwd(), { noEmit: false });
  const result = compile(project);
  if (!result.ok) {
    process.stderr.write(result.text);
    return false;
  }
  await mkdir(outDir, { recursive: true });
  for (const asset of assets) {
    await cp(asset, path.join(outDir, path.basename(asset)));
  }
  return true;
};

await rm(outDir, { recursive: true, force: true });
if (!(await build())) {
  console.error('✗ el primer build falló; el servidor arranca igual para ver el error.');
}

const server = await startServer({ root: outDir, port: PORT, liveReload: true });
console.log(`\n  SpinDisk · ${server.url}\n  F2 abre el panel de pruebas · Ctrl+C para salir\n`);

let timer;
let running = false;
let pending = false;

const rebuild = async () => {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const started = performance.now();
  const ok = await build();
  running = false;
  if (ok) {
    const ms = Math.round(performance.now() - started);
    console.log(`✓ ${new Date().toLocaleTimeString('es-CO')} · recompilado en ${ms} ms`);
    server.notify();
  }
  if (pending) {
    pending = false;
    void rebuild();
  }
};

const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 140);
};

watch('src', { recursive: true }, schedule);
watch('index.html', schedule);

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
