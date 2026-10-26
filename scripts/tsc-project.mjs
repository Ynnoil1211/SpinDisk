// Carga el proyecto TypeScript y compila sin lanzar subprocesos: tsc se usa
// como biblioteca. Así el build funciona incluso en entornos donde no se puede
// arrancar `tsc.exe` (sandbox sin spawn) y no hace falta ningún bundler.
import path from 'node:path';
import ts from 'typescript';

const formatHost = {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => process.cwd(),
  getNewLine: () => '\n',
};

/** Lee tsconfig.json y devuelve { fileNames, options }. */
export function loadProject(root = process.cwd(), overrides = {}) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error(`No encuentro tsconfig.json en ${root}`);

  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
    overrides,
    configPath,
  );
  if (parsed.errors.length) {
    throw new Error(ts.formatDiagnostics(parsed.errors, formatHost));
  }
  return parsed;
}

/** Compila el proyecto. Devuelve { ok, text, diagnostics, files }. */
export function compile(project, { emit = true } = {}) {
  const program = ts.createProgram(project.fileNames, project.options);
  const result = emit
    ? program.emit()
    : { diagnostics: [], emittedFiles: undefined };

  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics];
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    text: diagnostics.length ? ts.formatDiagnostics(diagnostics, formatHost) : '',
    files: result.emittedFiles?.length ?? 0,
  };
}
