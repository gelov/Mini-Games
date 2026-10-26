// Game Night server: serves the site (no-cache, so edits show on refresh) and the real-time game APIs.
// Usage: node server.js [port]          (default 5173; set HOST=127.0.0.1 to keep it on this machine only)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNameGameApi } from './server/name-game.js';
import { createImpostorApi } from './server/impostor.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// never serve server code, dotfiles or the dev scripts
const PRIVATE = /^\/(server\/|server\.js$|\.)/;

const nameGame = createNameGameApi();
const impostor = createImpostorApi();

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (PRIVATE.test(rel) || rel.split('/').some((seg) => seg.startsWith('.'))) {
    res.writeHead(404).end('Not found');
    return;
  }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      // directories need a trailing slash so pages' relative links resolve
      if (!rel.endsWith('/')) {
        res.writeHead(301, { Location: `${rel}/${url.search}` }).end();
        return;
      }
      return sendFile(res, path.join(file, 'index.html'));
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    sendFile(res, file);
  });
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/impostor/')) return impostor.handle(req, res, url);
  if (url.pathname.startsWith('/api/name-game/')) return nameGame.handle(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`Game Night running at http://localhost:${PORT}/`);
  if (HOST === '0.0.0.0') {
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter((a) => a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${PORT}/`);
    if (lan.length) console.log(`Same Wi-Fi/network: ${lan.join('  ')}`);
  }
});
