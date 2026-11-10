const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const PAGE = path.join(__dirname, 'whisper-room.html');
const PUBLIC_ASSETS = new Map([
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const rooms = new Map();
const ttlFor = value => ({ '10 minutes': 600000, '1 hour': 3600000, '1 day': 86400000 }[value] || 0);

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { clients: new Map(), messages: [], timers: new Map(), theme: 'fern', closed: false, call: null, pinnedId: null, owner: null, moderators: new Set(), membersSeen: new Set(), banned: new Set(), name: '', description: '', avatar: '◌', maxMembers: 8, locked: false, inviteExpiresAt: 0 });
  return rooms.get(id);
}
function publicMessage(message, viewerId = '') {
  const { secret, senderId, ...safe } = message;
  if (secret) { safe.message = undefined; safe.data = undefined; safe.options = undefined; safe.votes = undefined; safe.locked = true; }
  safe.readBy = [...(message.readBy || [])];
  safe.mine = Boolean(senderId && senderId === viewerId);
  return safe;
}
function broadcast(room, type, data, except = '') {
  for (const [id, client] of room.clients) if (id !== except) {
    const payload = (type === 'message' || type === 'update') ? publicMessage(data, id) : data;
    client.res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}
function presenceData(room) {
  const members = [...room.clients.entries()].filter(([, client]) => !client.quiet).map(([id, client]) => ({ id, name: client.name || 'Guest', role: id === room.owner ? 'host' : room.moderators.has(id) ? 'moderator' : 'guest' }));
  return { count: members.length, members };
}
function roomInfoData(room, memberId) { return { name: room.name, description: room.description, avatar: room.avatar, locked: room.locked, maxMembers: room.maxMembers, inviteLifetime: room.inviteLifetime || 'never', isHost: room.owner === memberId }; }
function sendRoomInfo(room) { for (const [memberId, member] of room.clients) member.res.write(`event: roomInfo\ndata: ${JSON.stringify(roomInfoData(room, memberId))}\n\n`); }
function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
function validRoom(id) { return /^[A-Z0-9-]{3,32}$/.test(id); }
function expireMessage(room, item, except = '') {
  if (!room.messages.some(message => message.id === item.id)) return;
  room.messages = room.messages.filter(message => message.id !== item.id);
  const timer = room.timers.get(item.id); if (timer) clearTimeout(timer);
  room.timers.delete(item.id);
  broadcast(room, 'expire', { id: item.id }, except);
  if (room.pinnedId === item.id) { room.pinnedId = null; broadcast(room, 'pinned', null); }
}
function publish(room, item) {
  room.messages.push(item);
  if (item.expiresAt) room.timers.set(item.id, setTimeout(() => expireMessage(room, item), Math.max(0, item.expiresAt - Date.now())).unref());
  broadcast(room, 'message', item);
}
function cleanupExpired(room) {
  room.messages = room.messages.filter(item => !item.expiresAt || item.expiresAt > Date.now());
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/whisper-room.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    fs.createReadStream(PAGE).pipe(res); return;
  }
  if (req.method === 'GET' && PUBLIC_ASSETS.has(url.pathname)) {
    const [filename, contentType] = PUBLIC_ASSETS.get(url.pathname);
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache', ...(filename === 'sw.js' ? { 'service-worker-allowed': '/' } : {}) });
    fs.createReadStream(path.join(__dirname, filename)).pipe(res); return;
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    const id = (url.searchParams.get('room') || '').toUpperCase();
    const clientId = String(url.searchParams.get('client') || '').slice(0, 80);
    if (!validRoom(id) || !clientId) return json(res, 400, { error: 'Invalid room or guest.' });
    const room = getRoom(id); cleanupExpired(room);
    const knownMember = room.membersSeen.has(clientId);
    if (room.banned.has(clientId)) return json(res, 403, { error: 'You no longer have access to this room.' });
    if (room.inviteExpiresAt && room.inviteExpiresAt < Date.now() && !knownMember) return json(res, 410, { error: 'This room invite has expired.' });
    if (room.locked && !knownMember) return json(res, 423, { error: 'This room is locked to new guests.' });
    if (!knownMember && room.clients.size >= room.maxMembers) return json(res, 409, { error: 'This room has reached its guest limit.' });
    room.membersSeen.add(clientId);
    if (!room.owner) room.owner = clientId;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`event: history\ndata: ${JSON.stringify(room.messages.map(item => publicMessage(item, clientId)))}\n\n`);
    res.write(`event: theme\ndata: ${JSON.stringify({ theme: room.theme })}\n\n`);
    const pinned = room.messages.find(item => item.id === room.pinnedId);
    if (pinned) res.write(`event: pinned\ndata: ${JSON.stringify(publicMessage(pinned, clientId))}\n\n`);
    if (room.closed) res.write('event: closed\ndata: {}\n\n');
    const connection = { res, quiet: url.searchParams.get('quiet') === '1', name: String(url.searchParams.get('name') || 'Guest').slice(0, 24) };
    room.clients.set(clientId, connection);
    res.write(`event: roomInfo\ndata: ${JSON.stringify(roomInfoData(room, clientId))}\n\n`);
    if (room.call && room.call.from !== clientId && !room.call.to) res.write(`event: callInvite\ndata: ${JSON.stringify({ callId: room.call.id, from: room.call.from, name: room.call.name, type: room.call.type })}\n\n`);
    broadcast(room, 'presence', presenceData(room));
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 20000);
    req.on('close', () => { clearInterval(heartbeat); if (room.clients.get(clientId) === connection) { room.clients.delete(clientId); room.moderators.delete(clientId); if (room.owner === clientId) { room.owner = room.clients.keys().next().value || null; sendRoomInfo(room); } if (room.call && (room.call.from === clientId || room.call.to === clientId)) { broadcast(room, 'callEnded', { callId: room.call.id, reason: 'disconnected' }, clientId); room.call = null; } } broadcast(room, 'presence', presenceData(room)); });
    return;
  }
  if (req.method === 'POST' && ['/send', '/action', '/call', '/signal'].includes(url.pathname)) {
    const maxBytes = url.pathname === '/send' ? 2400000 : url.pathname === '/signal' ? 180000 : 12000;
    let body = '', tooLarge = false;
    req.on('data', chunk => { body += chunk; if (body.length > maxBytes) { tooLarge = true; req.destroy(); } });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        const input = JSON.parse(body);
        const id = String(input.room || '').toUpperCase();
        const room = getRoom(id);
        const clientId = String(input.client || '').slice(0, 80);
        if (!validRoom(id) || room.closed) return json(res, 410, { error: room.closed ? 'This room has been closed.' : 'Invalid room code.' });
        if (url.pathname === '/call') {
          if (!clientId || !room.clients.has(clientId)) return json(res, 409, { error: 'Reconnect to the room before calling.' });
          const action = input.action;
          if (action === 'start') {
            if (room.call) return json(res, 409, { error: 'This room is already in a call.' });
            if (![...room.clients.keys()].some(peer => peer !== clientId)) return json(res, 409, { error: 'Invite someone into this room before calling.' });
            if (!['audio','video'].includes(input.type)) return json(res, 400, { error: 'Choose a voice or video call.' });
            const call = room.call = { id: randomUUID(), from: clientId, name: String(input.name || 'Guest').slice(0, 24), type: input.type, to: null };
            broadcast(room, 'callInvite', { callId: call.id, from: clientId, name: call.name, type: call.type }, clientId);
            return json(res, 200, { ok: true, callId: call.id });
          }
          if (action === 'accept') {
            if (!room.call || room.call.id !== input.callId || room.call.from === clientId || room.call.to) return json(res, 409, { error: 'That call is no longer available.' });
            room.call.to = clientId;
            const peer = room.clients.get(room.call.from);
            peer?.res.write(`event: callAccepted\ndata: ${JSON.stringify({ callId: room.call.id, peerId: clientId, peerName: String(input.name || 'Guest').slice(0, 24) })}\n\n`);
            return json(res, 200, { ok: true, peerId: room.call.from, type: room.call.type });
          }
          if (action === 'decline' || action === 'end') {
            const invitedPeer = action === 'decline' && room.call?.to == null && room.call?.from !== clientId && room.clients.has(clientId);
            if (!room.call || room.call.id !== input.callId || (!invitedPeer && room.call.from !== clientId && room.call.to !== clientId)) return json(res, 404, { error: 'Call not found.' });
            const call = room.call; room.call = null;
            broadcast(room, action === 'decline' ? 'callDeclined' : 'callEnded', { callId: call.id, reason: action }, clientId);
            return json(res, 200, { ok: true });
          }
          return json(res, 400, { error: 'Unknown call action.' });
        }
        if (url.pathname === '/signal') {
          const call = room.call;
          if (!call || call.id !== input.callId || (call.from !== clientId && call.to !== clientId)) return json(res, 404, { error: 'Call is no longer active.' });
          const targetId = call.from === clientId ? call.to : call.from;
          const target = room.clients.get(targetId);
          if (!target || !input.signal || !['offer','answer','ice'].includes(input.signal.type)) return json(res, 400, { error: 'Could not relay the call connection.' });
          target.res.write(`event: callSignal\ndata: ${JSON.stringify({ callId: call.id, from: clientId, signal: input.signal })}\n\n`);
          return json(res, 200, { ok: true });
        }
        if (url.pathname === '/send') {
          const name = String(input.name || 'Guest').trim().slice(0, 24) || 'Guest';
          const item = { id: randomUUID(), name, senderId: clientId, time: new Date().toISOString(), expiresAt: ttlFor(input.expiry) ? Date.now() + ttlFor(input.expiry) : null, readBy: new Set() };
          if (input.reply && typeof input.reply === 'object') item.reply = { id: String(input.reply.id || '').slice(0, 80), name: String(input.reply.name || '').slice(0, 24), preview: String(input.reply.preview || '').slice(0, 120) };
          const scheduleAt = input.scheduleAt ? new Date(input.scheduleAt).getTime() : 0;
          if (scheduleAt && scheduleAt > Date.now()) {
            if (scheduleAt > Date.now() + 86400000) return json(res, 400, { error: 'Scheduled messages can be set up to 24 hours ahead.' });
            item.message = String(input.message || '').trim().slice(0, 2000);
            if (!item.message) return json(res, 400, { error: 'Add some message text first.' });
            item.secret = Boolean(input.oneTime); item.expiresAt = null;
            room.timers.set(`scheduled-${item.id}`, setTimeout(() => { room.timers.delete(`scheduled-${item.id}`); if (!room.closed) { item.time = new Date().toISOString(); item.expiresAt = ttlFor(input.expiry) ? Date.now() + ttlFor(input.expiry) : null; publish(room, item); } }, scheduleAt - Date.now()).unref());
            return json(res, 200, { ok: true, scheduled: true });
          }
          if (input.type === 'photo' || input.type === 'voice' || input.type === 'video') {
            if (typeof input.data !== 'string' || input.data.length > 1800000 || !/^data:(image\/(png|jpeg|webp|gif)|audio\/(webm|ogg|mp4|mpeg)|video\/(webm|mp4));base64,/.test(input.data)) return json(res, 400, { error: 'That file is too large or has an unsupported format.' });
            item.type = input.type; item.data = input.data;
            item.message = input.type === 'photo' ? ('Photo'+(String(input.caption||'').trim()?' · '+String(input.caption).trim().slice(0,160):'')) : input.type === 'video' ? ('Video clip'+(String(input.caption||'').trim()?' · '+String(input.caption).trim().slice(0,160):'')) : 'Voice note';
          } else if (input.type === 'poll') {
            if (input.oneTime) return json(res, 400, { error: 'Polls stay available so everyone can vote.' });
            const question = String(input.question || '').trim().slice(0, 140);
            const options = Array.isArray(input.options) ? input.options.map(value => String(value).trim().slice(0, 70)).filter(Boolean).slice(0, 5) : [];
            if (!question || options.length < 2) return json(res, 400, { error: 'A poll needs a question and at least two choices.' });
            item.type = 'poll'; item.message = question; item.options = options; item.votes = {}; item.secret = false;
          } else {
            item.message = String(input.message || '').trim().slice(0, 2000);
            if (!item.message) return json(res, 400, { error: 'Write a message first.' });
          }
          item.secret = Boolean(input.oneTime);
          publish(room, item);
          return json(res, 200, { ok: true });
        }
        if (!clientId || !room.clients.has(clientId)) return json(res, 403, { error: 'Join the room before changing it.' });
        const action = input.action;
        if (action === 'profile') { const member = room.clients.get(clientId); member.name = String(input.name || 'Guest').trim().slice(0, 24) || 'Guest'; broadcast(room, 'presence', presenceData(room)); return json(res, 200, { ok: true }); }
        if (action === 'room-settings') {
          if (room.owner !== clientId) return json(res, 403, { error: 'Only the room host can change room settings.' });
          const maxMembers = Number(input.maxMembers);
          if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 30) return json(res, 400, { error: 'Choose a guest limit between 2 and 30.' });
          if (maxMembers < room.clients.size) return json(res, 409, { error: 'The guest limit cannot be lower than the number of people here.' });
          room.name = String(input.name || '').trim().slice(0, 48); room.description = String(input.description || '').trim().slice(0, 180);
          room.avatar = [...String(input.avatar || '◌').trim()].slice(0, 4).join('') || '◌'; room.maxMembers = maxMembers; room.locked = Boolean(input.locked);
          const inviteMs = ({ '1 hour': 3600000, '1 day': 86400000, '7 days': 604800000, never: 0 })[input.inviteLifetime];
          if (inviteMs === undefined) return json(res, 400, { error: 'Choose an invite lifetime.' });
          room.inviteLifetime = input.inviteLifetime;
          room.inviteExpiresAt = inviteMs ? Date.now() + inviteMs : 0;
          sendRoomInfo(room);
          return json(res, 200, { ok: true });
        }
        if (action === 'role') {
          if (room.owner !== clientId) return json(res, 403, { error: 'Only the room host can assign moderators.' });
          const target = String(input.target || ''); if (!room.clients.has(target) || target === room.owner) return json(res, 404, { error: 'Choose another current room member.' });
          if (input.role === 'moderator') room.moderators.add(target); else room.moderators.delete(target);
          broadcast(room, 'presence', presenceData(room)); return json(res, 200, { ok: true });
        }
        if (action === 'remove-member') {
          if (room.owner !== clientId && !room.moderators.has(clientId)) return json(res, 403, { error: 'Only a host or moderator can remove a guest.' });
          const target = String(input.target || ''), member = room.clients.get(target);
          if (!member || target === room.owner || target === clientId) return json(res, 404, { error: 'Choose a guest who can be removed.' });
          member.res.write('event: removed\ndata: {}\n\n'); member.res.end(); room.clients.delete(target); room.moderators.delete(target); room.banned.add(target);
          broadcast(room, 'presence', presenceData(room)); return json(res, 200, { ok: true });
        }
        if (action === 'typing') { const sender = room.clients.get(clientId); if (!sender?.quiet) broadcast(room, 'typing', { name: String(input.name || 'Guest').slice(0, 24), typing: Boolean(input.typing) }, clientId); return json(res, 200, { ok: true }); }
        if (action === 'theme') {
          if (!['fern','ocean','plum','sunset'].includes(input.theme)) return json(res, 400, { error: 'Choose one of the available room themes.' });
          room.theme = input.theme; broadcast(room, 'theme', { theme: room.theme }); return json(res, 200, { ok: true });
        }
        if (action === 'pin') {
          const pinned = room.messages.find(message => message.id === input.messageId);
          if (!pinned || pinned.secret) return json(res, 404, { error: 'That message cannot be pinned.' });
          room.pinnedId = pinned.id;
          broadcast(room, 'pinned', publicMessage(pinned));
          return json(res, 200, { ok: true });
        }
        if (action === 'unpin') {
          if (room.pinnedId === input.messageId) room.pinnedId = null;
          broadcast(room, 'pinned', null);
          return json(res, 200, { ok: true });
        }
        if (action === 'quiet') {
          const current = room.clients.get(clientId);
          if (current) current.quiet = Boolean(input.quiet);
          broadcast(room, 'presence', presenceData(room));
          return json(res, 200, { ok: true });
        }
        if (action === 'panic') {
          if (room.call) { broadcast(room, 'callEnded', { callId: room.call.id, reason: 'room closed' }); room.call = null; }
          room.closed = true; room.messages = [];
          for (const timer of room.timers.values()) clearTimeout(timer);
          room.timers.clear(); broadcast(room, 'closed', {}); return json(res, 200, { ok: true });
        }
        const item = room.messages.find(message => message.id === input.messageId);
        if (action === 'open') {
          if (!item || !item.secret) return json(res, 404, { error: 'That one time message is no longer available.' });
          const message = { message: item.message, type: item.type, data: item.data, options: item.options, votes: item.votes, name: item.name, time: item.time };
          expireMessage(room, item, clientId); return json(res, 200, message);
        }
        if (!item) return json(res, 404, { error: 'Message not found.' });
        if (action === 'react') {
          const emoji = String(input.emoji || '').trim();
          if (!emoji || [...emoji].length > 12) return json(res, 400, { error: 'Choose a single emoji reaction.' });
          item.reactions ||= {};
          const reactors = new Set(item.reactions[emoji] || []);
          if (reactors.has(clientId)) reactors.delete(clientId); else reactors.add(clientId);
          item.reactions[emoji] = [...reactors]; broadcast(room, 'update', item); return json(res, 200, { ok: true });
        }
        if (action === 'vote') {
          const index = Number(input.option); if (!item.options || !Number.isInteger(index) || index < 0 || index >= item.options.length) return json(res, 400, { error: 'That poll choice is unavailable.' });
          item.votes ||= {}; item.votes[clientId] = index; broadcast(room, 'update', item); return json(res, 200, { ok: true });
        }
        if (action === 'read') {
          item.readBy ||= new Set(); item.readBy.add(String(input.name || 'Guest').slice(0, 24)); broadcast(room, 'update', item, clientId); return json(res, 200, { ok: true });
        }
        if (action === 'edit') {
          if (item.senderId !== clientId) return json(res, 403, { error: 'You can only edit your own messages.' });
          if (item.type || item.secret) return json(res, 400, { error: 'Only regular text messages can be edited.' });
          const message = String(input.message || '').trim().slice(0, 2000);
          if (!message) return json(res, 400, { error: 'Message cannot be empty.' });
          item.message = message; item.editedAt = new Date().toISOString(); broadcast(room, 'update', item); return json(res, 200, { ok: true });
        }
        if (action === 'unsend') {
          if (item.senderId !== clientId) return json(res, 403, { error: 'You can only unsend your own messages.' });
          expireMessage(room, item); return json(res, 200, { ok: true });
        }
        return json(res, 400, { error: 'Unknown action.' });
      } catch { return json(res, 400, { error: 'Invalid request.' }); }
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => console.log(`Whisper is ready at http://localhost:${PORT}`));
