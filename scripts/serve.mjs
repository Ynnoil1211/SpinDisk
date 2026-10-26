// Servidor estático mínimo para dist/. Sin dependencias, sin frameworks.
// En modo `--reload` inyecta un cliente SSE para recargar el navegador solo.
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

const RELOAD_CLIENT = `<script>
  (() => {
    const events = new EventSource('/__reload');
    events.onmessage = () => location.reload();
  })();
</script>`;

/**
 * Arranca el servidor. Devuelve { url, notify, close }.
 * `notify()` avisa a los navegadores conectados de que recarguen.
 */
export async function startServer({ root = 'dist', port = 5173, liveReload = false } = {}) {
  const base = path.resolve(root);
  const clients = new Set();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (liveReload && url.pathname === '/__reload') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      response.write('retry: 900\n\n');
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(base, relative);
    const inside = target === base || target.startsWith(base + path.sep);

    if (!inside) {
      response.writeHead(403).end('fuera del directorio servido');
      return;
    }

    let file = target;
    try {
      const info = await stat(file);
      if (info.isDirectory()) file = path.join(file, 'index.html');
    } catch {
      // Una ruta que parece un archivo inexistente es un 404, no una página.
      if (/\/[^/]*\.[a-z0-9]{1,6}$/i.test(url.pathname)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('404');
        return;
      }
      file = path.join(base, 'index.html');
    }

    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('no es un archivo');
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';

      response.writeHead(200, {
        'Content-Type': type,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      });

      if (liveReload && type.startsWith('text/html')) {
        const html = await readFile(file, 'utf8');
        const injected = html.includes('</body>')
          ? html.replace('</body>', `${RELOAD_CLIENT}\n  </body>`)
          : html + RELOAD_CLIENT;
        response.end(injected);
        return;
      }

      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('404');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    notify() {
      for (const client of clients) client.write('data: reload\n\n');
    },
    close() {
      for (const client of clients) client.end();
      clients.clear();
      server.close();
    },
  };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const server = await startServer({
    root: 'dist',
    port: Number(process.env.PORT ?? 5173),
  });
  console.log(`SpinDisk servido en ${server.url}`);
}
