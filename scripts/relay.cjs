'use strict';
// dsh-cross-collaboration relay hub — minimal WebSocket presence + envelope router.
// Every device opens ONE outbound socket (NAT-friendly, no inbound ports).
// The relay only sees routing headers; payloads are opaque ciphertext when
// peers are paired (AES-256-GCM envelopes built by the gateway).
// Usage: node scripts/relay.cjs [port]   (default 8799; bind 0.0.0.0)
const { WebSocketServer } = require('ws');

const port = Number(process.argv[2] || 8799);
const wss = new WebSocketServer({ port: port, host: '0.0.0.0' });

/** deviceId -> { ws, name } */
const clients = new Map();

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

function broadcastPresence(deviceId, name, joined) {
  for (const [id, c] of clients) {
    if (id === deviceId) continue;
    send(c.ws, { type: 'presence', deviceId: deviceId, name: name, joined: joined });
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let m = null;
    try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.type === 'hello') {
      if (!m.deviceId) return;
      const prev = clients.get(m.deviceId);
      if (prev && prev.ws !== ws) {
        try { prev.ws.close(); } catch (e) {}
        clients.delete(m.deviceId);
        broadcastPresence(m.deviceId, m.deviceName || m.deviceId, false);
      }
      const name = String(m.deviceName || m.deviceId).slice(0, 64);
      clients.set(m.deviceId, { ws: ws, name: name });
      ws.deviceId = m.deviceId;
      send(ws, { type: 'hello-ack' });
      broadcastPresence(m.deviceId, name, true);
      for (const [id, c] of clients) {
        if (id === m.deviceId) continue;
        send(ws, { type: 'presence', deviceId: id, name: c.name, joined: true });
      }
      console.log('[relay] join', m.deviceId, name, '| online:', clients.size);
      return;
    }

    if (m.type === 'relay' && typeof m.to === 'string' && ws.deviceId) {
      const target = clients.get(m.to);
      if (!target) {
        send(ws, { type: 'relay-fail', id: m.id, to: m.to, error: 'offline' });
        return;
      }
      send(target.ws, Object.assign({}, m, { from: ws.deviceId }));
      return;
    }

    // keepalive / unknown — ignore
  });

  ws.on('close', () => {
    const id = ws.deviceId;
    if (!id) return;
    if (clients.get(id) && clients.get(id).ws === ws) {
      clients.delete(id);
      broadcastPresence(id, '', false);
      console.log('[relay] leave', id, '| online:', clients.size);
    }
  });

  ws.on('error', () => {});
});

console.log('[relay] listening on 0.0.0.0:' + port);
