// `pnpm typecheck` — comprueba tipos y estilo sin escribir nada en disco.
import { compile, loadProject } from './tsc-project.mjs';

const project = loadProject(process.cwd(), { noEmit: true });
const result = compile(project, { emit: false });

if (!result.ok) {
  process.stderr.write(result.text);
  console.error(`\n✗ ${result.diagnostics.length} problema(s) de tipos.`);
  process.exit(1);
}

console.log(`✓ tipos · ${project.fileNames.length} archivos sin errores`);
