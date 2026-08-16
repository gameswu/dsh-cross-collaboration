'use strict';
// Relay transport smoke test (P6):
// 1. in-process relay hub on 127.0.0.1
// 2. two gateways (distinct UDP ports so LAN discovery is inert) connect via relay
// 3. mutual presence discovery -> peer-up with relay:true
// 4. BEFORE pairing: relay rpc fails with "no pairing secret"
// 5. after pair-secret on both sides: relay rpc round-trips through the hub
//    (E2E encrypted; the hub only forwards envelopes)
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const RELAY_PORT = 18799;
const gwSource = fs.readFileSync(path.join(__dirname, '..', 'dist', 'gateway.js'), 'utf8');
const idA = 'relay-a-' + Math.random().toString(36).slice(2, 8);
const idB = 'relay-b-' + Math.random().toString(36).slice(2, 8);
const SECRET = 'smoke-secret-1234';

// ---- in-process relay hub (same logic as scripts/relay.cjs) ----
const clients = new Map();
const wss = new WebSocketServer({ port: RELAY_PORT, host: '127.0.0.1' });
function rsend(ws, obj) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} } }
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let m = null;
    try { m = JSON.parse(String(data)); } catch (e) { return; }
    if (!m) return;
    if (m.type === 'hello') {
      const prev = clients.get(m.deviceId);
      if (prev && prev !== ws) { try { prev.close(); } catch (e) {} clients.delete(m.deviceId); }
      clients.set(m.deviceId, ws);
      ws.deviceId = m.deviceId;
      rsend(ws, { type: 'hello-ack' });
      for (const [id, other] of clients) {
        if (id === m.deviceId) continue;
        rsend(other, { type: 'presence', deviceId: m.deviceId, name: m.deviceName || m.deviceId, joined: true });
        rsend(ws, { type: 'presence', deviceId: id, name: '', joined: true });
      }
      return;
    }
    if (m.type === 'relay' && typeof m.to === 'string' && ws.deviceId) {
      const target = clients.get(m.to);
      if (!target) { rsend(ws, { type: 'relay-fail', id: m.id, to: m.to, error: 'offline' }); return; }
      rsend(target, Object.assign({}, m, { from: ws.deviceId }));
    }
  });
  ws.on('close', () => {
    if (!ws.deviceId) return;
    if (clients.get(ws.deviceId) === ws) clients.delete(ws.deviceId);
  });
});

// ---- two gateways ----
function spawnGw(id, name, udpPort, rpcPort) {
  return spawn(process.execPath, ['-e', gwSource, id, String(udpPort), name, '500', String(rpcPort), 'ws://127.0.0.1:' + RELAY_PORT], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}
const a = spawnGw(idA, 'gw-A', 45231, 45232);
const b = spawnGw(idB, 'gw-B', 46231, 46232);

const state = { aUp: false, bUp: false, aConn: false, bConn: false, unpairedRejected: false, pairedOk: false };
let finished = false;
let pairedSent = false;

function finish(code, note) {
  if (finished) return;
  finished = true;
  console.log((code === 0 ? 'PASS' : 'FAIL') + ': ' + note);
  for (const k of [a, b]) { try { k.kill('SIGKILL'); } catch (e) {} }
  try { wss.close(); } catch (e) {}
  process.exit(code);
}
const deadline = setTimeout(() => finish(1, 'timeout: ' + JSON.stringify(state)), 25000);

function attach(child, which) {
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.type === 'relay-status') {
        if (which === 'a') state.aConn = msg.connected;
        else state.bConn = msg.connected;
        console.log('  [' + which + '] relay ' + (msg.connected ? 'connected' : 'disconnected'));
      } else if (msg.type === 'peer-up' && msg.peer && msg.peer.relay) {
        if (which === 'a' && msg.peer.deviceId === idB) state.aUp = true;
        if (which === 'b' && msg.peer.deviceId === idA) state.bUp = true;
        console.log('  [' + which + '] relay peer-up:', msg.peer.deviceId, 'encrypted=' + msg.peer.encrypted);
      } else if (msg.type === 'rpc-in') {
        // test acts as the host: echo back
        child.stdin.write(JSON.stringify({ cmd: 'rpc-ok', id: msg.id, result: { echo: msg.params } }) + '\n');
      } else if (msg.type === 'rpc-out-error') {
        if (msg.id === 'unpaired-test') {
          state.unpairedRejected = /no pairing secret/.test(String(msg.error));
          console.log('  [b] unpaired rpc rejected:', msg.error);
        } else if (msg.id === 'paired-test') {
          console.log('  [b] paired rpc error:', msg.error);
        }
      } else if (msg.type === 'rpc-out-result' && msg.id === 'paired-test') {
        state.pairedOk = !!(msg.result && msg.result.echo && msg.result.echo.x === 42);
        console.log('  [b] paired rpc result:', JSON.stringify(msg.result));
      }
      if (state.aUp && state.bUp && !pairedSent) {
        pairedSent = true;
        // phase 1: unpaired send (expect rejection)
        b.stdin.write(JSON.stringify({ cmd: 'rpc', id: 'unpaired-test', transport: 'relay', to: idA, method: 'echo', params: { x: 1 }, timeoutMs: 5000 }) + '\n');
      }
      if (state.unpairedRejected && !state.secretsSent) {
        state.secretsSent = true;
        console.log('  [*] pairing both sides...');
        a.stdin.write(JSON.stringify({ cmd: 'pair-secret', deviceId: idB, secret: SECRET }) + '\n');
        b.stdin.write(JSON.stringify({ cmd: 'pair-secret', deviceId: idA, secret: SECRET }) + '\n');
        setTimeout(() => {
          b.stdin.write(JSON.stringify({ cmd: 'rpc', id: 'paired-test', transport: 'relay', to: idA, method: 'echo', params: { x: 42 }, timeoutMs: 8000 }) + '\n');
        }, 500);
      }
      if (state.pairedOk) {
        clearTimeout(deadline);
        finish(0, 'relay presence + E2E rpc round-trip verified');
      }
    }
  });
}
attach(a, 'a');
attach(b, 'b');
