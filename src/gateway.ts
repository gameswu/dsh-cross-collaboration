// @ts-nocheck — gateway is an embedded plain-Node script; behavior is covered by smoke tests.
'use strict';
// dsh-cross-collaboration gateway (runs as a plain Node child process).
// Simplified P2P model (P7):
//   - peers are added by plain "ip:port" (Minecraft-style); identity (deviceId,
//     name, workspace label) is learned via a hello handshake
//   - mesh gossip: every hello carries the caller's known peer list; unknown
//     addresses are auto-connected, so a node added on one device propagates
//     to the whole mesh (A+B linked, A adds C -> B learns C and connects)
//   - no agent work status anywhere; summary is identity only
//   - relay adapter: WebSocket client to a relay hub; presence discovery +
//     AES-256-GCM encrypted envelopes for paired peers (E2E)
// argv: node -e <this script> <deviceId> <udpPort> <deviceName> <beaconMs> [rpcPort] [relayUrl] [pluginVersion]
// Protocol: JSON lines on stdout (events up), JSON lines on stdin (commands down).
// NOTE: no template literals / no ${ inside this file (kept simple for embedding).

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

// Wire-protocol compatibility number: bumped ONLY when a breaking change lands.
// Peers exchange it via beacon/hello; a peer with a different number is flagged
// as incompatible in the UI and in lan_peers (messaging still attempts).
const COMPAT = 1;

const deviceId = process.argv[1] || 'gw-' + Math.random().toString(36).slice(2, 8);
const udpPort = parseInt(process.argv[2] || '45231', 10);
let deviceName = process.argv[3] || '';
const beaconMs = parseInt(process.argv[4] || '3000', 10);
const rpcPort = parseInt(process.argv[5] || String(udpPort + 1), 10);
const relayUrl = process.argv[6] || '';
const pluginVersion = process.argv[7] || '0.1.0';
let selfSummary = null;

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ownAddress() {
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces);
  for (let i = 0; i < names.length; i++) {
    const list = ifaces[names[i]];
    if (!list) continue;
    for (let j = 0; j < list.length; j++) {
      const it = list[j];
      if (it.family === 'IPv4' && !it.internal) return it.address;
    }
  }
  return '0.0.0.0';
}

// every non-internal IPv4 the device owns (LAN, tailscale, virtual adapters…)
function ownAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  const names = Object.keys(ifaces);
  for (let i = 0; i < names.length; i++) {
    const list = ifaces[names[i]];
    if (!list) continue;
    for (let j = 0; j < list.length; j++) {
      const it = list[j];
      if (it.family === 'IPv4' && !it.internal && out.indexOf(it.address) < 0) out.push(it.address);
    }
  }
  if (out.length === 0) out.push('127.0.0.1');
  return out;
}

// ---------------- pairing secrets + E2E crypto ----------------
const secrets = new Map(); // deviceId -> user passphrase (raw)

function deriveKey(a, b, secret) {
  const ids = [a, b].sort();
  return crypto.createHash('sha256').update(ids.join('|') + '|' + secret, 'utf8').digest();
}

function encryptEnvelope(peerId, payload) {
  const secret = secrets.get(peerId);
  if (!secret) return null;
  const key = deriveKey(deviceId, peerId, secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { nonce: iv.toString('base64'), box: Buffer.concat([ct, tag]).toString('base64') };
}

function decryptEnvelope(from, nonce, box) {
  const secret = secrets.get(from);
  if (!secret) return null;
  try {
    const key = deriveKey(deviceId, from, secret);
    const iv = Buffer.from(nonce, 'base64');
    const data = Buffer.from(box, 'base64');
    if (data.length < 17) return null;
    const ct = data.subarray(0, data.length - 16);
    const tag = data.subarray(data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'));
  } catch (e) {
    return null;
  }
}

// ---------------- peer registry ----------------
// peer: { deviceId, name, address, udpPort, rpcPort, relay, encrypted, source,
//         connected, summary, lastSeen, firstSeen }
// source: 'lan' (UDP discovery) | 'manual' (user-added ip:port) |
//         'gossip' (learned from another peer) | 'relay'
// temp entries (added but not yet resolved) use deviceId 'addr:<host:port>'.
const peers = new Map();          // deviceId -> peer
const addressIndex = new Map();   // 'host:port' -> real deviceId
const wanted = new Map();         // 'host:port' -> source ('manual'|'gossip')
const removed = new Set();        // tombstoned addresses (user removed)
const lastPush = new Map();       // 'host:port' -> ts (push throttle)

function addrKey(host, port) {
  return String(host) + ':' + Number(port);
}

// parse "host:port" / "[v6]:port" / bare "host" (port 0 = unknown)
function parseAddr(raw) {
  const s = String(raw || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  if (!s) return null;
  if (s.indexOf('[') === 0) {
    const close = s.indexOf(']');
    if (close < 0) return null;
    const host = s.slice(1, close);
    const rest = s.slice(close + 1);
    let port = 0;
    if (rest.indexOf(':') === 0) {
      const p = parseInt(rest.slice(1), 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) port = p;
    }
    return { host: host, port: port };
  }
  const idx = s.lastIndexOf(':');
  if (idx >= 0 && s.indexOf(':') === idx) {
    const p = parseInt(s.slice(idx + 1), 10);
    if (Number.isInteger(p) && p >= 1 && p <= 65535) return { host: s.slice(0, idx), port: p };
  }
  return { host: s, port: 0 };
}

function emitPeerUp(peer) {
  send({ type: 'peer-up', peer: peer });
}

function dropPeer(id) {
  const p = peers.get(id);
  if (!p) return;
  if (p.address && p.rpcPort && addressIndex.get(addrKey(p.address, p.rpcPort)) === id) {
    addressIndex.delete(addrKey(p.address, p.rpcPort));
  }
  peers.delete(id);
  send({ type: 'peer-down', deviceId: id });
}

function exportPeerList() {
  const list = [];
  peers.forEach(function (p) {
    if (p.relay || !p.address || !p.rpcPort) return;
    if (p.deviceId.indexOf('addr:') === 0) return;
    list.push({ address: p.address, rpcPort: p.rpcPort, deviceId: p.deviceId, name: p.name });
  });
  return list;
}

function helloPayload() {
  return { v: 1, deviceId: deviceId, deviceName: deviceName, rpcPort: rpcPort, summary: selfSummary, version: pluginVersion, compat: COMPAT, peers: exportPeerList() };
}

// ---------------- outbound rpc correlation ----------------
const pendingOut = new Map(); // id -> { resolve, reject, timer }

function registerOut(id, resolve, reject, timeoutMs) {
  const timer = setTimeout(() => {
    if (pendingOut.has(id)) {
      pendingOut.delete(id);
      reject(new Error('rpc timeout'));
    }
  }, (timeoutMs || 15000) + 3000);
  pendingOut.set(id, { resolve: resolve, reject: reject, timer: timer });
}

// ---------------- LAN adapter: TCP JSON-RPC ----------------
function lanRpcOut(host, port, payload, timeoutMs, cb) {
  const body = JSON.stringify(payload);
  const req = http.request({
    host: host,
    port: port,
    path: '/rpc',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: timeoutMs || 15000,
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      if (!parsed) cb({ error: 'bad response from peer (status ' + res.statusCode + ')' });
      else if (parsed.ok) cb({ result: parsed.result });
      else cb({ error: String(parsed.error || 'peer error') });
    });
  });
  req.on('timeout', () => { req.destroy(new Error('rpc timeout')); });
  req.on('error', (err) => cb({ error: String(err && err.message) }));
  req.end(body);
}

// ---------------- mesh logic: hello merge + gossip ----------------
function mergeHello(address, info) {
  if (!info || typeof info !== 'object' || !info.deviceId || info.deviceId === deviceId) return null;
  const port = typeof info.rpcPort === 'number' ? info.rpcPort : rpcPort;
  const key = addrKey(address, port);
  const oldId = addressIndex.get(key);
  const oldPeer = oldId ? peers.get(oldId) : null;
  let source = wanted.get(key);
  if (!source && oldPeer) source = oldPeer.source;
  if (!source) source = 'gossip';
  let prev = peers.get(info.deviceId);
  if (oldId && oldId !== info.deviceId && oldPeer) {
    // same address, new identity (peer restarted with a fresh deviceId): replace
    peers.delete(oldId);
    send({ type: 'peer-down', deviceId: oldId });
    prev = oldPeer;
  }
  const peer = {
    deviceId: info.deviceId,
    name: info.deviceName || info.deviceId,
    address: address,
    udpPort: 0,
    rpcPort: port,
    relay: false,
    encrypted: secrets.has(info.deviceId),
    source: source,
    connected: true,
    summary: info.summary || null,
    version: typeof info.version === 'string' ? info.version : '',
    compat: typeof info.compat === 'number' ? info.compat : 0,
    lastSeen: Date.now(),
    firstSeen: (prev && prev.firstSeen) || Date.now(),
  };
  peers.set(info.deviceId, peer);
  addressIndex.set(key, info.deviceId);
  emitPeerUp(peer);
  // gossip merge: connect to addresses we did not know
  let added = 0;
  if (Array.isArray(info.peers)) {
    for (let i = 0; i < info.peers.length; i++) {
      const e = info.peers[i];
      if (!e || !e.address || e.deviceId === deviceId) continue;
      const eport = typeof e.rpcPort === 'number' ? e.rpcPort : rpcPort;
      if (addPeerByAddress(String(e.address), eport, 'gossip')) added++;
    }
  }
  if (added > 0) pushHelloToAll();
  return peer;
}

function addPeerByAddress(address, port, source) {
  const key = addrKey(address, port);
  if (addressIndex.has(key)) return false;
  if (wanted.has(key)) return false;
  if (removed.has(key) && source === 'gossip') return false;
  if (source === 'manual') removed.delete(key);
  wanted.set(key, source);
  const tempId = 'addr:' + key;
  const temp = {
    deviceId: tempId,
    name: address,
    address: address,
    udpPort: 0,
    rpcPort: port,
    relay: false,
    encrypted: false,
    source: source,
    connected: false,
    summary: null,
    lastSeen: 0,
    firstSeen: Date.now(),
  };
  peers.set(tempId, temp);
  emitPeerUp(temp);
  pingHello(address, port);
  return true;
}

function pingHello(address, port) {
  const id = 'hello-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  lanRpcOut(address, port, { id: id, from: deviceId, method: 'hello', params: helloPayload() }, 5000, (outcome) => {
    if (outcome.result) {
      const peer = mergeHello(address, outcome.result);
      const key = addrKey(address, port);
      const tempId = 'addr:' + key;
      if (peers.has(tempId)) {
        peers.delete(tempId);
        send({ type: 'peer-down', deviceId: tempId });
      }
      if (peer && !peer.address) peer.address = address;
    } else {
      const key = addrKey(address, port);
      const realId = addressIndex.get(key);
      const p = realId ? peers.get(realId) : peers.get('addr:' + key);
      if (p) {
        p.connected = false;
        p.lastSeen = 0;
        emitPeerUp(p);
      }
    }
  });
}

function pushHelloToAll() {
  const now = Date.now();
  peers.forEach(function (p) {
    if (p.relay || !p.address || !p.rpcPort || !p.connected) return;
    const key = addrKey(p.address, p.rpcPort);
    if (lastPush.has(key) && now - lastPush.get(key) < 2000) return;
    lastPush.set(key, now);
    pingHello(p.address, p.rpcPort);
  });
}

// ---------------- LAN adapter: UDP discovery ----------------
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
socket.on('error', (err) => {
  send({ type: 'gateway-error', message: String(err && err.message) });
});
socket.on('message', (msg, rinfo) => {
  let m = null;
  try { m = JSON.parse(msg.toString('utf8')); } catch (e) { return; }
  if (!m || m.v !== 1 || !m.deviceId || m.deviceId === deviceId) return;
  const port = typeof m.rpcPort === 'number' ? m.rpcPort : udpPort + 1;
  const key = addrKey(rinfo.address, port);
  const oldId = addressIndex.get(key);
  let prev = peers.get(m.deviceId);
  if (oldId && oldId !== m.deviceId && peers.get(oldId)) {
    const oldPeer = peers.get(oldId);
    peers.delete(oldId);
    send({ type: 'peer-down', deviceId: oldId });
    prev = oldPeer;
  }
  const peer = {
    deviceId: m.deviceId,
    name: m.deviceName || m.deviceId,
    address: rinfo.address,
    udpPort: typeof m.udpPort === 'number' ? m.udpPort : rinfo.port,
    rpcPort: port,
    relay: false,
    encrypted: secrets.has(m.deviceId),
    source: (prev && prev.source) || 'lan',
    connected: true,
    summary: m.summary || null,
    version: typeof m.version === 'string' ? m.version : '',
    compat: typeof m.compat === 'number' ? m.compat : 0,
    lastSeen: Date.now(),
    firstSeen: (prev && prev.firstSeen) || Date.now(),
  };
  const changed = !prev ||
    prev.name !== peer.name ||
    prev.connected !== peer.connected ||
    prev.version !== peer.version ||
    prev.compat !== peer.compat ||
    JSON.stringify(prev.summary || null) !== JSON.stringify(peer.summary || null);
  peers.set(m.deviceId, peer);
  addressIndex.set(key, m.deviceId);
  if (changed) emitPeerUp(peer);
});

socket.bind(udpPort, () => {
  socket.setBroadcast(true);
  send({ type: 'gateway-ready', deviceId: deviceId, deviceName: deviceName, udpPort: udpPort, rpcPort: rpcPort, address: ownAddress(), addresses: ownAddresses(), version: pluginVersion, compat: COMPAT });
});

function beacon() {
  const msg = JSON.stringify({ v: 1, t: 'beacon', deviceId: deviceId, deviceName: deviceName, udpPort: udpPort, rpcPort: rpcPort, summary: selfSummary, version: pluginVersion, compat: COMPAT });
  socket.send(msg, udpPort, '255.255.255.255');
}
setInterval(beacon, beaconMs);
beacon();

// staleness sweep: offline flag; ephemeral lan peers drop after silence
setInterval(() => {
  const now = Date.now();
  const gone = [];
  peers.forEach((peer, id) => {
    if (peer.relay) return;
    if (now - peer.lastSeen > 10000 && peer.connected) {
      peer.connected = false;
      emitPeerUp(peer);
    }
    if (peer.source === 'lan' && now - peer.lastSeen > 20000) gone.push(id);
  });
  for (let i = 0; i < gone.length; i++) dropPeer(gone[i]);
}, 1000);

// liveness: re-hello manual/gossip peers (also re-exchanges peer lists = gossip refresh)
setInterval(() => {
  peers.forEach(function (peer) {
    if (peer.relay || !peer.address || !peer.rpcPort) return;
    if (peer.source === 'lan') return;
    pingHello(peer.address, peer.rpcPort);
  });
}, 7000);

// ---------------- inbound TCP rpc ----------------
const pendingIn = new Map(); // rpc id -> { kind: 'http'|'relay', res?, to?, timer }
const IN_TIMEOUT_MS = 10 * 60 * 1000;

function answerPending(id, payload, status) {
  const entry = pendingIn.get(id);
  if (!entry) return;
  pendingIn.delete(id);
  clearTimeout(entry.timer);
  if (entry.kind === 'http') {
    try {
      entry.res.writeHead(status, { 'content-type': 'application/json' });
      entry.res.end(JSON.stringify(payload));
    } catch (e) {}
  } else if (entry.kind === 'relay') {
    relaySendEnvelope(entry.to, { kind: 'rpc-resp', id: id, payload: payload });
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/rpc') {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let m = null;
    try { m = JSON.parse(body); } catch (e) {}
    if (!m || typeof m.id !== 'string' || !m.method) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'bad rpc envelope' }));
      return;
    }
    let remoteAddress = '';
    try { remoteAddress = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : ''; } catch (e) {}
    if (m.method === 'hello') {
      // answer immediately; also merge the caller's identity + peer list (bidirectional gossip)
      const info = m.params && typeof m.params === 'object' ? m.params : {};
      if (info && info.v === 1 && info.deviceId && remoteAddress) {
        mergeHello(remoteAddress, info);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: Object.assign({}, helloPayload(), { caps: ['message'] }) }));
      return;
    }
    const id = m.id;
    const timer = setTimeout(() => answerPending(id, { ok: false, error: 'host timeout' }, 200), IN_TIMEOUT_MS);
    pendingIn.set(id, { kind: 'http', res: res, timer: timer });
    send({ type: 'rpc-in', id: id, from: m.from || null, address: remoteAddress, transport: 'lan', method: m.method, params: m.params || null });
  });
});

server.on('error', (err) => {
  send({ type: 'gateway-error', message: 'rpc server: ' + String(err && err.message) });
});
server.listen(rpcPort, '0.0.0.0', () => {
  send({ type: 'rpc-listening', rpcPort: rpcPort });
});

// ---------------- relay adapter ----------------
let relayWs = null;
let relayConnected = false;

function relayHello() {
  if (relayWs && relayWs.readyState === 1) {
    relayWs.send(JSON.stringify({ type: 'hello', deviceId: deviceId, deviceName: deviceName, summary: selfSummary, version: pluginVersion, compat: COMPAT }));
  }
}

function relaySendEnvelope(to, encryptedPayload) {
  if (!relayWs || relayWs.readyState !== 1) return 'relay not connected';
  const env = encryptEnvelope(to, encryptedPayload);
  if (env === null) return 'relay: no pairing secret for ' + to;
  relayWs.send(JSON.stringify({ type: 'relay', to: to, id: encryptedPayload.id, nonce: env.nonce, box: env.box }));
  return null;
}

function relayConnect() {
  if (relayUrl === '') return;
  if (typeof WebSocket === 'undefined') {
    send({ type: 'gateway-error', message: 'relay transport requires Node >= 22 (global WebSocket)' });
    return;
  }
  if (relayWs && (relayWs.readyState === 0 || relayWs.readyState === 1)) return;
  try {
    relayWs = new WebSocket(relayUrl);
  } catch (e) {
    relayWs = null;
    send({ type: 'gateway-error', message: 'relay connect failed: ' + String(e && e.message) });
    return;
  }
  relayWs.onopen = () => {
    relayConnected = true;
    relayHello();
    send({ type: 'relay-status', connected: true });
  };
  relayWs.onmessage = (ev) => {
    let m = null;
    try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'hello-ack') return;
    if (m.type === 'presence') {
      if (m.joined) {
        const prev = peers.get(m.deviceId);
        const peer = {
          deviceId: m.deviceId,
          name: m.name || m.deviceId,
          address: '',
          udpPort: 0,
          rpcPort: 0,
          relay: true,
          encrypted: secrets.has(m.deviceId),
          source: 'relay',
          connected: true,
          summary: m.summary || null,
          version: typeof m.version === 'string' ? m.version : '',
          compat: typeof m.compat === 'number' ? m.compat : 0,
          lastSeen: Date.now(),
          firstSeen: prev ? prev.firstSeen : Date.now(),
        };
        peers.set(m.deviceId, peer);
        const changed = !prev || !prev.relay || prev.name !== peer.name ||
          prev.version !== peer.version || prev.compat !== peer.compat ||
          JSON.stringify(prev.summary || null) !== JSON.stringify(peer.summary || null);
        if (changed) emitPeerUp(peer);
      } else {
        const prev = peers.get(m.deviceId);
        if (prev && prev.relay) dropPeer(m.deviceId);
      }
      return;
    }
    if (m.type === 'relay-fail') {
      const p = pendingOut.get(m.id);
      if (p) {
        pendingOut.delete(m.id);
        clearTimeout(p.timer);
        p.reject(new Error('relay: ' + String(m.error || 'offline')));
      }
      return;
    }
    if (m.type === 'relay' && typeof m.from === 'string') {
      const payload = decryptEnvelope(m.from, m.nonce, m.box);
      if (payload === null) {
        send({ type: 'crypto-error', from: m.from, message: 'relay: undecryptable envelope (not paired)' });
        return;
      }
      if (payload.kind === 'rpc') {
        const id = payload.id;
        const timer = setTimeout(() => answerPending(id, { ok: false, error: 'host timeout' }, 200), IN_TIMEOUT_MS);
        pendingIn.set(id, { kind: 'relay', to: m.from, timer: timer });
        send({ type: 'rpc-in', id: id, from: m.from, address: '', transport: 'relay', method: payload.method, params: payload.params || null });
      } else if (payload.kind === 'rpc-resp') {
        const p = pendingOut.get(payload.id);
        if (p) {
          pendingOut.delete(payload.id);
          clearTimeout(p.timer);
          const r = payload.payload || {};
          if (r.ok) p.resolve(r.result);
          else p.reject(new Error(String(r.error || 'peer error')));
        }
      }
      return;
    }
  };
  relayWs.onclose = () => {
    relayConnected = false;
    send({ type: 'relay-status', connected: false });
    relayWs = null;
  };
  relayWs.onerror = () => {};
}

if (relayUrl !== '') {
  relayConnect();
  setInterval(() => {
    if (!relayConnected) relayConnect();
  }, 5000);
}

// ---------------- stdin commands ----------------
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch (e) { continue; }
    if (!cmd) continue;
    if (cmd.cmd === 'set-name') {
      deviceName = String(cmd.name || '').slice(0, 64);
      send({ type: 'name-changed', deviceName: deviceName });
      relayHello();
      pushHelloToAll();
    } else if (cmd.cmd === 'add-peer') {
      // { address: 'ip:port' } — identity learned via hello
      const parsed = parseAddr(String(cmd.address || ''));
      if (!parsed) continue;
      const port = Number(cmd.rpcPort) || parsed.port || rpcPort;
      addPeerByAddress(parsed.host, port, 'manual');
    } else if (cmd.cmd === 'remove-peer') {
      const target = String(cmd.deviceId || '');
      const addrRaw = String(cmd.address || '');
      if (target) {
        // tombstone the known address so mesh gossip cannot re-add it
        const p = peers.get(target);
        if (p && p.address && p.rpcPort) {
          const tkey = addrKey(p.address, p.rpcPort);
          removed.add(tkey);
          wanted.delete(tkey);
        }
        dropPeer(target);
      } else if (addrRaw) {
        const parsed = parseAddr(addrRaw);
        const host = parsed ? parsed.host : addrRaw;
        const port = Number(cmd.rpcPort) || (parsed && parsed.port) || rpcPort;
        const key = addrKey(host, port);
        removed.add(key);
        wanted.delete(key);
        const id = addressIndex.get(key);
        if (id) dropPeer(id);
        const tempId = 'addr:' + key;
        if (peers.has(tempId)) dropPeer(tempId);
      }
    } else if (cmd.cmd === 'list') {
      const list = [];
      peers.forEach((p) => list.push(p));
      send({ type: 'peers', peers: list });
    } else if (cmd.cmd === 'set-summary') {
      selfSummary = cmd.summary || null;
      relayHello();
      pushHelloToAll();
    } else if (cmd.cmd === 'pair-secret') {
      const id = String(cmd.deviceId || '');
      const secret = String(cmd.secret || '');
      if (!id || !secret) continue;
      secrets.set(id, secret);
      const p = peers.get(id);
      if (p) { p.encrypted = true; emitPeerUp(p); }
      send({ type: 'pair-secret-ok', deviceId: id });
    } else if (cmd.cmd === 'rpc-ok') {
      answerPending(cmd.id, { ok: true, result: cmd.result }, 200);
    } else if (cmd.cmd === 'rpc-err') {
      answerPending(cmd.id, { ok: false, error: String(cmd.error || 'host error') }, 200);
    } else if (cmd.cmd === 'rpc') {
      const id = cmd.id;
      if (cmd.transport === 'relay') {
        registerOut(id,
          (v) => send({ type: 'rpc-out-result', id: id, result: v }),
          (e) => send({ type: 'rpc-out-error', id: id, error: String(e && e.message) }),
          cmd.timeoutMs || 15000);
        const sendErr = relaySendEnvelope(cmd.to, { kind: 'rpc', id: id, method: cmd.method, params: cmd.params });
        if (sendErr !== null) {
          const p = pendingOut.get(id);
          if (p) { pendingOut.delete(id); clearTimeout(p.timer); }
          send({ type: 'rpc-out-error', id: id, error: sendErr });
        }
      } else {
        lanRpcOut(cmd.address, cmd.port, { id: id, from: deviceId, method: cmd.method, params: cmd.params }, cmd.timeoutMs, (outcome) => {
          if (outcome.result !== undefined) send({ type: 'rpc-out-result', id: id, result: outcome.result });
          else send({ type: 'rpc-out-error', id: id, error: outcome.error });
        });
      }
    } else if (cmd.cmd === 'quit') {
      process.exit(0);
    }
  }
});
