// Game Night server: serves the site (no-cache, so edits show on refresh) and the real-time game APIs.
// Usage: node server.js [port]          (default 5173; set HOST=127.0.0.1 to keep it on this machine only)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNameGameApi } from './server/name-game.js';
import { createImpostorApi } from './server/impostor.js';
import { createTeamEscapeApi } from './server/team-escape.js';

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
  '.mp3': 'audio/mpeg',
};

// never serve server code, dotfiles or the dev scripts
const PRIVATE = /^\/(server\/|test\/|server\.js$|\.)/;

const nameGame = createNameGameApi();
const impostor = createImpostorApi();
const teamEscape = createTeamEscapeApi();

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
      return sendFile(res, path.join(file, 'index.html'), req);
    }
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    sendFile(res, file, req, stat);
  });
}

// Range support matters for <audio>/<video>: Safari in particular issues a
// Range request before it will play a file, so without this the jazz track
// (and any other media) would silently fail to start there.
function sendFile(res, file, req, knownStat) {
  const contentType = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const respondFull = (stat) => {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, must-revalidate',
    });
    fs.createReadStream(file)
      .on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        } else {
          res.destroy();
        }
      })
      .pipe(res);
  };
  const respondRange = (stat, range) => {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      respondFull(stat);
      return;
    }
    let start = match[1] ? Number(match[1]) : stat.size - Number(match[2]);
    let end = match[2] && match[1] ? Number(match[2]) : stat.size - 1;
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      start > end ||
      start >= stat.size
    ) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    end = Math.min(end, stat.size - 1);
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, must-revalidate',
    });
    fs.createReadStream(file, { start, end })
      .on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        } else {
          res.destroy();
        }
      })
      .pipe(res);
  };
  const withStat = (stat) => {
    const range = req && req.headers && req.headers.range;
    if (range) {
      respondRange(stat, range);
    } else {
      respondFull(stat);
    }
  };
  if (knownStat) {
    withStat(knownStat);
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    withStat(stat);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/impostor/')) return impostor.handle(req, res, url);
  if (url.pathname.startsWith('/api/name-game/')) return nameGame.handle(req, res, url);
  if (url.pathname.startsWith('/api/team-escape/')) return teamEscape.handle(req, res, url);
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
