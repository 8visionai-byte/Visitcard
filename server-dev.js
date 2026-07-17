// Lokalny serwer deweloperski: serwuje ./app jako statyki i podpina app/api/scan.js pod POST /api/scan
// (ta sama funkcja, którą Vercel uruchamia w chmurze). Uruchomienie: node server-dev.js [port]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8388;
const APP_DIR = path.join(__dirname, 'app');
const TEST_DIR = path.join(__dirname, 'test');
const API_HANDLERS = {
  '/api/scan': require('./app/api/scan.js'),
  '/api/register': require('./app/api/register.js'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(baseDir, relPath, res) {
  const filePath = path.normalize(path.join(baseDir, relPath));
  if (!filePath.startsWith(baseDir)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404: ' + relPath); }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (API_HANDLERS[p]) {
    // Shim zgodny z Vercel: res.status().json()
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
    return API_HANDLERS[p](req, res).catch((e) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Błąd serwera: ' + e.message }));
    });
  }

  if (p.startsWith('/test/')) return serveStatic(TEST_DIR, p.slice('/test/'.length), res);
  return serveStatic(APP_DIR, p === '/' ? 'index.html' : p.slice(1), res);
}).listen(PORT, () => console.log(`Skaner Wizytówek: http://localhost:${PORT} (API key w env: ${Boolean(process.env.ANTHROPIC_API_KEY)})`));
