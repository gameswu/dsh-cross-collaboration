'use strict';
// Smoke test for the LAN gateway mesh (P7), standalone (no DSH plugin needed).
// Spawns THREE gateways on DISTINCT UDP ports (no auto-discovery) and expects:
//  1. A adds B by "ip:port" -> identity learned via hello, both sides see each other
//  2. A adds C by "ip:port"
//  3. mesh gossip: B learns C from A's hello and auto-connects (C also sees B)
//  4. msg.post routing: B -> C round-trips (smoke acts as the host on C)
// Usage: node scripts/gateway-smoke.cjs [baseUdpPort]
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = parseInt(process.argv[2] || '45231', 10);
const gwSource = fs.readFileSync(path.join(__dirname, '..', 'dist', 'gateway.js'), 'utf8');
const idA = 'smoke-a-' + Math.random().toString(36).slice(2, 8);
const idB = 'smoke-b-' + Math.random().toString(36).slice(2, 8);
const idC = 'smoke-c-' + Math.random().toString(36).slice(2, 8);

const A = { udp: base, rpc: base + 100, host: '127.0.0.1' };
const B = { udp: base + 10, rpc: base + 110, host: '127.0.0.1' };
const C = { udp: base + 20, rpc: base + 120, host: '127.0.0.1' };

function spawnGateway(deviceId, deviceName, cfg) {
  return spawn(process.execPath, ['-e', gwSource, deviceId, String(cfg.udp), deviceName, '400', String(cfg.rpc)], {
    cwd: path.join(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

const a = spawnGateway(idA, 'gw-A', A);
const b = spawnGateway(idB, 'gw-B', B);
const c = spawnGateway(idC, 'gw-C', C);
const kids = [a, b, c];

const state = {
  ready: { a: false, b: false, c: false },
  aSeesB: false, bSeesA: false,   // step 1
  aSeesC: false,                   // step 2
  bSeesC: false, cSeesB: false,   // step 3 (gossip)
  msgOk: false,                    // step 4
  compatOk: false,                 // version/compat exchange
};
let finished = false;
let step2Sent = false;
let msgSent = false;

function finish(code, note) {
  if (finished) return;
  finished = true;
  console.log((code === 0 ? 'PASS' : 'FAIL') + ': ' + note);
  for (const k of kids) { try { k.kill('SIGKILL'); } catch (e) {} }
  process.exit(code);
}
const deadline = setTimeout(() => finish(1, 'timeout: ' + JSON.stringify(state)), 20000);

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
      if (msg.type === 'gateway-ready') {
        state.ready[which] = true;
        console.log('  [' + which + '] ready: rpc=' + msg.rpcPort);
        if (state.ready.a && state.ready.b && state.ready.c && !step2Sent) {
          // step 1: A adds B by ip:port
          console.log('  [*] A add-peer ' + B.host + ':' + B.rpc);
          a.stdin.write(JSON.stringify({ cmd: 'add-peer', address: B.host + ':' + B.rpc }) + '\n');
        }
      } else if (msg.type === 'peer-up' && msg.peer) {
        console.log('  [' + which + '] peer-up:', msg.peer.name, msg.peer.deviceId,
          '@ ' + (msg.peer.address || 'relay') + ':' + msg.peer.rpcPort,
          'src=' + msg.peer.source, 'connected=' + msg.peer.connected,
          'version=' + msg.peer.version, 'compat=' + msg.peer.compat);
        if (msg.peer.compat === 1 && typeof msg.peer.version === 'string' && msg.peer.version) state.compatOk = true;
        if (which === 'a' && msg.peer.deviceId === idB && msg.peer.connected) state.aSeesB = true;
        if (which === 'b' && msg.peer.deviceId === idA && msg.peer.connected) state.bSeesA = true;
        if (which === 'a' && msg.peer.deviceId === idC && msg.peer.connected) state.aSeesC = true;
        if (which === 'b' && msg.peer.deviceId === idC && msg.peer.connected) state.bSeesC = true;
        if (which === 'c' && msg.peer.deviceId === idB && msg.peer.connected) state.cSeesB = true;
        // step 2: once A<->B are up, A adds C
        if (which === 'a' && state.aSeesB && !step2Sent) {
          step2Sent = true;
          console.log('  [*] A add-peer ' + C.host + ':' + C.rpc);
          a.stdin.write(JSON.stringify({ cmd: 'add-peer', address: C.host + ':' + C.rpc }) + '\n');
        }
      } else if (msg.type === 'peer-down') {
        console.log('  [' + which + '] peer-down:', msg.deviceId);
      } else if (msg.type === 'rpc-in' && which === 'c' && msg.method === 'msg.post') {
        // smoke acts as the host on C: deliver + answer
        console.log('  [c] msg.post from', msg.from, '->', JSON.stringify(msg.params));
        c.stdin.write(JSON.stringify({ cmd: 'rpc-ok', id: msg.id, result: { delivered: true, summary: { deviceName: 'gw-C' } } }) + '\n');
      } else if (msg.type === 'rpc-out-result' && msg.id === 'msg-test') {
        state.msgOk = !!(msg.result && msg.result.delivered === true);
        console.log('  [b] msg.post result:', JSON.stringify(msg.result));
      } else if (msg.type === 'rpc-out-error') {
        console.log('  [' + which + '] rpc error:', msg.id, msg.error);
      }

      // step 4: after B knows C, send a message B -> C
      if (which === 'b' && state.bSeesC && !msgSent) {
        msgSent = true;
        console.log('  [*] B msg.post -> C');
        b.stdin.write(JSON.stringify({ cmd: 'rpc', id: 'msg-test', address: C.host, port: C.rpc, method: 'msg.post', params: { content: 'hello from B' }, timeoutMs: 8000 }) + '\n');
      }

      if (state.aSeesB && state.bSeesA && state.aSeesC && state.bSeesC && state.cSeesB && state.msgOk && state.compatOk) {
        clearTimeout(deadline);
        finish(0, 'ip:port add + mesh gossip + version/compat exchange + msg.post verified (' + idA + ' <-> ' + idB + ' <-> ' + idC + ')');
      }
    }
  });
  child.on('exit', () => {
    if (!finished) {
      clearTimeout(deadline);
      finish(1, '[' + which + '] exited early: ' + JSON.stringify(state));
    }
  });
}

attach(a, 'a');
attach(b, 'b');
attach(c, 'c');
