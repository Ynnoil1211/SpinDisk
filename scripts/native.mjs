// `npm run native` — compila la web y la mete dentro del proyecto Android.
//
// El APK no incluye ningún motor propio: `assets/www` es exactamente `dist/`,
// que se sirve desde `file:///android_asset/www/index.html`.
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { compile, loadProject } from './tsc-project.mjs';

const STATIC = ['index.html', path.join('src', 'styles.css')];
const dist = path.resolve('dist');
const www = path.resolve('android/app/src/main/assets/www');
const skipBuild = process.argv.includes('--no-build');

const human = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

if (skipBuild) {
  const built = await stat(path.join(dist, 'index.html')).catch(() => null);
  if (!built) {
    console.error('✗ falta dist/: corre `node scripts/native.mjs` sin --no-build');
    process.exit(1);
  }
  console.log('· se reutiliza dist/ existente');
} else {
  const project = loadProject();
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  const result = compile(project);
  if (!result.ok) {
    process.stderr.write(result.text);
    console.error(`\n✗ native detenido: ${result.diagnostics.length} problema(s).`);
    process.exit(1);
  }
  for (const asset of STATIC) {
    await cp(asset, path.join(dist, path.basename(asset)));
  }
  console.log('✓ web compilada');
}

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
await cp(dist, www, { recursive: true });

const entries = await readdir(www, { recursive: true, withFileTypes: true });
const files = entries.filter((entry) => entry.isFile());
let total = 0;
for (const entry of files) {
  const info = await stat(path.join(entry.parentPath ?? entry.path, entry.name));
  total += info.size;
}

const scripts = files.filter((file) => file.name.endsWith('.js')).length;
console.log(
  `✓ assets · ${files.length} archivos (${scripts} js) · ${human(total)} en android/app/src/main/assets/www`,
);

if (total > 15 * 1024 * 1024) {
  console.error('✗ la web supera los 15 MB del presupuesto');
  process.exit(1);
}
