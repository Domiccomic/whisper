const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PAGE = path.join(__dirname, 'whisper-room.html');
const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { clients: new Set(), messages: [] });
  return rooms.get(id);
}
function broadcast(room, type, data) {
  const packet = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of room.clients) client.write(packet);
}
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/whisper-room.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    fs.createReadStream(PAGE).pipe(res);
    return;
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    const id = (url.searchParams.get('room') || '').toUpperCase();
    if (!/^[A-Z0-9-]{3,32}$/.test(id)) return json(res, 400, { error: 'Invalid room code' });
    const room = getRoom(id);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`event: history\ndata: ${JSON.stringify(room.messages)}\n\n`);
    room.clients.add(res);
    broadcast(room, 'presence', { count: room.clients.size });
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      room.clients.delete(res);
      broadcast(room, 'presence', { count: room.clients.size });
    });
    return;
  }
  if (url.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 5000) req.destroy(); });
    req.on('end', () => {
      try {
        const input = JSON.parse(body);
        const id = String(input.room || '').toUpperCase();
        const name = String(input.name || 'Guest').trim().slice(0, 24) || 'Guest';
        const message = String(input.message || '').trim();
        if (!/^[A-Z0-9-]{3,32}$/.test(id) || !message || message.length > 2000) return json(res, 400, { error: 'Check the room code and message (up to 2,000 characters).' });
        const ttl = { '10 minutes': 600000, '1 hour': 3600000, '1 day': 86400000 }[input.expiry] || 0;
        const item = { id: randomUUID(), name, message, time: new Date().toISOString(), expiresAt: ttl ? Date.now() + ttl : null };
        const room = getRoom(id);
        room.messages = room.messages.filter(m => !m.expiresAt || m.expiresAt > Date.now());
        room.messages.push(item);
        if (ttl) setTimeout(() => {
          room.messages = room.messages.filter(m => m.id !== item.id);
          broadcast(room, 'expire', { id: item.id });
        }, ttl).unref();
        broadcast(room, 'message', item);
        return json(res, 200, { ok: true });
      } catch { return json(res, 400, { error: 'Invalid message data.' }); }
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`Whisper is ready at http://localhost:${PORT}`));
