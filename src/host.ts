// dsh-cross-collaboration — Host plugin (persistent ESM form).
// Simplified P2P model (P7): workspace-level MAIN agents message each other.
// Peers are added by plain "ip:port" (Minecraft-style); identity summaries
// (device name / workspace label — no work status) ride discovery heartbeats;
// the gateway gossips peer addresses across the mesh. The only cross-device
// operation is msg.post: a message delivered into the peer main agent's inbox
// to wake it.

import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { enqueueItem, removeItem, itemsFor, flushDevice, QUEUE_CAP } from './queue.js';
import type { QueueItem } from './queue.js';

export const name = 'dsh-cross-collaboration';

export const inject = ['subprocess', 'timer', 'webServer'];

export const Config = z.object({
  udpPort: z.number().step(1).min(1024).max(65535).default(45231),
  deviceName: z.string().default(''),
  beaconMs: z.number().step(1).min(300).max(60000).default(3000),
  relayUrl: z.string().default(''),
});

type ResolvedConfig = { udpPort: number; deviceName: string; beaconMs: number; relayUrl: string };

const SETTINGS_NS = settingsNamespace('dsh-cross-collaboration');
const SettingsSchema = z.object({
  deviceName: z.string().default(''),
  workspaceLabel: z.string().default(''),
  pairs: z.array(z.object({ deviceId: z.string(), secret: z.string() })).default([]),
  // known mesh addresses; identity (deviceId/name) is learned at runtime
  peers: z.array(z.object({ address: z.string().default(''), source: z.string().default('manual') })).default([]),
  // offline message queue: flushed when the target device comes back online
  queue: z.array(z.object({
    id: z.string().default(''),
    deviceId: z.string().default(''),
    sessionId: z.string().default(''),
    content: z.string().default(''),
    at: z.number().step(1).default(0),
  })).default([]),
  // legacy field (kept for schema migration only)
  manualPeers: z.array(z.any()).default([]),
});

const GATEWAY_SOURCE_PATH = fileURLToPath(new URL('./gateway.js', import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL('./package.json', import.meta.url));
const NODE_CANDIDATES = ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', '/usr/local/opt/node/bin/node'];

// Wire-protocol compatibility number — bumped ONLY on breaking wire changes.
// Exchanged with peers so each side can check whether plugins can interoperate.
const PROTOCOL_COMPAT = 1;
const FALLBACK_VERSION = '0.1.0';

function mintId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* ---------------- address parsing ("ip:port" with optional defaults) ---------------- */
function parseAddress(raw: string, defaultPort: number): { host: string; port: number } | null {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//i, '');
  s = s.replace(/\/.*$/, '');
  let host = s;
  let port = defaultPort;
  // [v6] style brackets: [::1]:45232
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close < 0) return null;
    host = s.slice(1, close);
    const rest = s.slice(close + 1);
    if (rest.startsWith(':')) {
      const p = parseInt(rest.slice(1), 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) port = p;
    }
  } else {
    const idx = s.lastIndexOf(':');
    if (idx >= 0 && s.indexOf(':') === idx) {
      const p = parseInt(s.slice(idx + 1), 10);
      if (Number.isInteger(p) && p >= 1 && p <= 65535) {
        host = s.slice(0, idx);
        port = p;
      }
    }
  }
  if (!host) return null;
  return { host: host, port: port };
}

/* ---------------- fenced-route trust fence ---------------- */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'localhost.']);

function isTrustedRequest(req: { headers: Record<string, string | string[] | undefined> }, trustedHosts: string[]): boolean {
  const raw = req.headers.host;
  if (typeof raw !== 'string' || raw === '') return false;
  const hostname = raw.trim().replace(/:\d+$/, '').toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(hostname)) return true;
  return trustedHosts.some((entry) => entry.toLowerCase() === hostname);
}

function writeJson(res: any, status: number, payload: unknown): void {
  try {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch (e) {}
}

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    return null;
  }
}

/* ---------------- type surfaces ---------------- */
interface PeerRecord {
  deviceId: string;
  name: string;
  address: string;
  udpPort: number;
  rpcPort: number;
  relay: boolean;
  encrypted: boolean;
  source: string;
  connected: boolean;
  summary: Record<string, unknown> | null;
  version?: string;
  compat?: number;
  lastSeen: number;
  firstSeen: number;
}

interface ChatRecord {
  dir: 'in' | 'out';
  peer: string;
  name: string;
  content: string;
  at: number;
  sessionId?: string;
  sessionTitle?: string;
}

export function apply(ctx: any, config: any) {
  const cfg = (config || {}) as ResolvedConfig;
  const udpPort = typeof cfg.udpPort === 'number' ? cfg.udpPort : 45231;
  const rpcPort = udpPort + 1;
  const beaconMs = typeof cfg.beaconMs === 'number' ? cfg.beaconMs : 3000;
  const relayUrl = typeof cfg.relayUrl === 'string' ? cfg.relayUrl : '';

  const subprocess = ctx.get('subprocess') as any;
  const agents = ctx.get('agents') as any;
  const webRuntime = ctx.get('webRuntime') as any;

  const state = {
    gatewayReady: false,
    handle: null as any,
    nodePath: null as string | null,
    deviceId: 'dshcc-' + Math.random().toString(36).slice(2, 10),
    deviceName: (typeof cfg.deviceName === 'string' && cfg.deviceName) || 'dsh-' + Math.random().toString(36).slice(2, 6),
    workspaceLabel: '',
    pluginVersion: FALLBACK_VERSION,
    ownAddress: '',
    ownAddresses: [] as string[],
    workspaces: [] as Array<{ title: string; path: string }>,
    detectedWorkspace: null as string | null,
    peers: new Map<string, PeerRecord>(),
    knownPeers: new Map<string, { address: string; source: string }>(),
    messages: [] as ChatRecord[],
    queue: [] as QueueItem[],
    flushing: new Set<string>(),
    lastError: null as string | null,
    stderrText: '',
    pairs: new Map<string, string>(),
    relayConnected: false,
    notifEnv: null as { notify(payload: { title: string; body?: string; severity?: string }): void } | null,
    lastSummaryBroadcast: 0,
    pendingRpc: new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: () => void }>(),
  };

  // ---------------- settings persistence ----------------
  const settings = ctx.get('settings') as any;
  let settingsScope: any = null;
  let watchOff: (() => void) | null = null;
  if (settings && typeof settings.register === 'function') {
    try {
      settingsScope = settings.register(SETTINGS_NS, SettingsSchema);
      const current = settingsScope.get() as any;
      if (current && typeof current.deviceName === 'string' && current.deviceName) state.deviceName = current.deviceName;
      if (current && typeof current.workspaceLabel === 'string' && current.workspaceLabel) state.workspaceLabel = current.workspaceLabel;
      if (current && Array.isArray(current.pairs)) {
        for (const p of current.pairs) if (p && p.deviceId && p.secret) state.pairs.set(String(p.deviceId), String(p.secret));
      }
      const seen = new Set<string>();
      if (current && Array.isArray(current.peers)) {
        for (const p of current.peers) {
          if (p && typeof p.address === 'string' && p.address) {
            const key = p.address.trim();
            if (seen.has(key)) continue;
            seen.add(key);
            state.knownPeers.set(key, { address: key, source: typeof p.source === 'string' ? p.source : 'manual' });
          }
        }
      }
      // migrate legacy manualPeers entries (deviceId/address/rpcPort) to address form
      let migrated = false;
      if (current && Array.isArray(current.manualPeers)) {
        for (const p of current.manualPeers) {
          if (p && typeof p.address === 'string' && p.address && typeof p.rpcPort === 'number') {
            const key = p.address.trim() + ':' + p.rpcPort;
            if (seen.has(key)) continue;
            seen.add(key);
            state.knownPeers.set(key, { address: key, source: 'manual' });
            migrated = true;
          }
        }
      }
      if (migrated) {
        const list: Array<{ address: string; source: string }> = [];
        state.knownPeers.forEach((p) => list.push({ address: p.address, source: p.source }));
        persistSettingSafe({ peers: list, manualPeers: [] });
      }
      if (current && Array.isArray(current.queue)) {
        for (const q of current.queue) {
          if (q && typeof q.id === 'string' && q.id && typeof q.deviceId === 'string' && q.deviceId && typeof q.content === 'string') {
            state.queue = enqueueItem(state.queue, {
              id: q.id,
              deviceId: q.deviceId,
              sessionId: typeof q.sessionId === 'string' && q.sessionId ? q.sessionId : undefined,
              content: q.content,
              at: typeof q.at === 'number' ? q.at : Date.now(),
            });
          }
        }
      }
      watchOff = settingsScope.watch((next: any) => {
        if (next && typeof next.deviceName === 'string' && next.deviceName) { state.deviceName = next.deviceName; broadcastSummary(true); }
        if (next && typeof next.workspaceLabel === 'string') { state.workspaceLabel = next.workspaceLabel; broadcastSummary(true); }
        if (next && Array.isArray(next.pairs)) {
          state.pairs.clear();
          for (const p of next.pairs) if (p && p.deviceId && p.secret) state.pairs.set(String(p.deviceId), String(p.secret));
          applyPairsToGateway();
        }
        if (next && Array.isArray(next.peers)) {
          const incoming = new Map<string, { address: string; source: string }>();
          for (const p of next.peers) {
            if (p && typeof p.address === 'string' && p.address) {
              incoming.set(p.address.trim(), { address: p.address.trim(), source: typeof p.source === 'string' ? p.source : 'manual' });
            }
          }
          // remove addresses no longer known
          state.knownPeers.forEach((entry, key) => {
            if (!incoming.has(key)) gatewaySend({ cmd: 'remove-peer', address: entry.address });
          });
          state.knownPeers = incoming;
          applyKnownPeersToGateway();
        }
        if (next && Array.isArray(next.queue)) {
          const incoming: QueueItem[] = [];
          for (const q of next.queue) {
            if (q && typeof q.id === 'string' && q.id && typeof q.deviceId === 'string' && q.deviceId && typeof q.content === 'string') {
              incoming.push({
                id: q.id,
                deviceId: q.deviceId,
                sessionId: typeof q.sessionId === 'string' && q.sessionId ? q.sessionId : undefined,
                content: q.content,
                at: typeof q.at === 'number' ? q.at : Date.now(),
              });
            }
          }
          const same = incoming.length === state.queue.length && incoming.every((q, i) => q.id === state.queue[i].id);
          if (!same) state.queue = incoming;
        }
      });
    } catch (err) {
      console.error('dshcc: settings register failed:', String((err as Error) && (err as Error).message));
    }
  }

  function persistSettingSafe(patch: unknown): void {
    try {
      if (settingsScope && typeof settingsScope.update === 'function') settingsScope.update(patch);
    } catch (e) {}
  }

  function persistKnownPeers(): void {
    const list: Array<{ address: string; source: string }> = [];
    state.knownPeers.forEach((p) => list.push({ address: p.address, source: p.source }));
    persistSettingSafe({ peers: list });
  }

  function persistQueue(): void {
    const list: Array<{ id: string; deviceId: string; sessionId: string; content: string; at: number }> = [];
    state.queue.forEach((q) => list.push({ id: q.id, deviceId: q.deviceId, sessionId: q.sessionId || '', content: q.content, at: q.at }));
    persistSettingSafe({ queue: list });
  }

  function peerNameOf(deviceId: string): string {
    const p = state.peers.get(deviceId);
    return (p && p.name) || deviceId;
  }

  // ---------------- gateway ----------------
  function gatewaySend(obj: unknown): void {
    const handle = state.handle;
    if (handle && handle.stdin && handle.stdin.writable) {
      handle.stdin.write(JSON.stringify(obj) + '\n');
    }
  }

  function applyPairsToGateway(): void {
    state.pairs.forEach((secret, deviceId) => {
      gatewaySend({ cmd: 'pair-secret', deviceId: deviceId, secret: secret });
    });
  }

  function applyKnownPeersToGateway(): void {
    state.knownPeers.forEach((p) => {
      gatewaySend({ cmd: 'add-peer', address: p.address });
    });
  }

  function onGatewayMessage(msg: any): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'gateway-ready') {
      state.gatewayReady = true;
      if (msg.deviceName) state.deviceName = msg.deviceName;
      if (typeof msg.address === 'string' && msg.address) state.ownAddress = msg.address;
      if (Array.isArray(msg.addresses)) state.ownAddresses = msg.addresses.map(String);
      console.log('dshcc: gateway ready, rpc port', msg.rpcPort);
      broadcastSummary(true);
      applyKnownPeersToGateway();
      flushAllQueued();
    } else if (msg.type === 'relay-status') {
      state.relayConnected = !!msg.connected;
      if (msg.connected) flushAllQueued();
    } else if (msg.type === 'peer-up' && msg.peer) {
      state.peers.set(msg.peer.deviceId, msg.peer);
      if (msg.peer.connected) flushQueueFor(msg.peer.deviceId);
    } else if (msg.type === 'peer-down') {
      state.peers.delete(msg.deviceId);
    } else if (msg.type === 'peers' && Array.isArray(msg.peers)) {
      for (let i = 0; i < msg.peers.length; i++) state.peers.set(msg.peers[i].deviceId, msg.peers[i]);
    } else if (msg.type === 'gateway-error') {
      state.lastError = String(msg.message || 'gateway error');
      console.error('dshcc: gateway error:', state.lastError);
    } else if (msg.type === 'rpc-in') {
      handleRpcIn(msg);
    } else if (msg.type === 'rpc-out-result') {
      const p = state.pendingRpc.get(msg.id);
      if (p) { state.pendingRpc.delete(msg.id); p.timer(); p.resolve(msg.result); }
    } else if (msg.type === 'rpc-out-error') {
      const p = state.pendingRpc.get(msg.id);
      if (p) { state.pendingRpc.delete(msg.id); p.timer(); p.reject(new Error(String(msg.error || 'peer error'))); }
    }
  }

  // ---------------- outbound rpc ----------------
  function gatewayRpc(peer: PeerRecord, method: string, params: unknown, timeoutMs?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!state.handle || !state.gatewayReady) {
        reject(new Error('通信网关未运行，无法发送'));
        return;
      }
      const id = mintId('r');
      const timer = ctx.timeout(() => {
        const p = state.pendingRpc.get(id);
        if (p) {
          state.pendingRpc.delete(id);
          reject(new Error('等待对端响应超时（对端可能离线）'));
        }
      }, (timeoutMs || 15000) + 3000);
      state.pendingRpc.set(id, { resolve: resolve, reject: reject, timer: timer });
      gatewaySend({
        cmd: 'rpc',
        id: id,
        transport: peer.relay ? 'relay' : 'lan',
        to: peer.deviceId,
        address: peer.address,
        port: peer.rpcPort,
        method: method,
        params: params,
        timeoutMs: timeoutMs || 15000,
      });
    });
  }

  function findPeer(ref: string | undefined): PeerRecord | undefined {
    if (!ref) return undefined;
    let byName: PeerRecord | undefined;
    let byAddress: PeerRecord | undefined;
    const parsed = parseAddress(String(ref), rpcPort);
    state.peers.forEach((p) => {
      if (p.deviceId === ref) { byName = p; return; }
      if (!byName && typeof p.name === 'string' && p.name.toLowerCase() === String(ref).toLowerCase()) byName = p;
      if (!byAddress && parsed && p.address && !p.relay) {
        const pAddr = parseAddress(p.address, rpcPort);
        if (pAddr && pAddr.host.toLowerCase() === parsed.host.toLowerCase() && pAddr.port === parsed.port) byAddress = p;
      }
    });
    return byName || byAddress;
  }

  // ---------------- identity summary (identity only — no work status) ----------------
  // In DSH every agent IS a session: there is no workspace-level agent. Each
  // open root session is one "main agent", so the identity summary lists the
  // device's sessions (id + title) and messages may address one of them.
  function listRootSessions(): Array<{ id: string; title: string }> {
    const out: Array<{ id: string; title: string }> = [];
    try {
      if (!agents || typeof agents.roots !== 'function') return out;
      const sessionTitle = ctx.get('sessionTitle') as any;
      const roots = agents.roots() as any[];
      for (const r of roots) {
        if (!r) continue;
        const id = typeof r.sessionId === 'string' ? r.sessionId : '';
        if (!id) continue;
        let title = '';
        try {
          if (sessionTitle && typeof sessionTitle.get === 'function' && r.session) {
            const snap = sessionTitle.get(r.session);
            if (snap && typeof snap.title === 'string') title = snap.title;
          }
        } catch (e) {}
        out.push({ id: id, title: title || '会话 ' + id.slice(0, 8) });
      }
    } catch (e) {}
    return out.slice(0, 20);
  }

  function findRootAgent(sessionId?: string): any {
    try {
      if (!agents || typeof agents.roots !== 'function') return undefined;
      const roots = agents.roots() as any[];
      if (sessionId) {
        const hit = roots.find((r) => r && (r.sessionId === sessionId || (r.session && String(r.session.id) === String(sessionId))));
        if (hit) return hit;
        if (typeof agents.get === 'function') return agents.get(sessionId);
        return undefined;
      }
      return roots.length > 0 ? roots[0] : undefined;
    } catch (e) {}
    return undefined;
  }

  function firstRoot(): any {
    return findRootAgent(undefined);
  }

  function effectiveWorkspaceLabel(): string {
    return state.workspaceLabel || state.detectedWorkspace || '';
  }

  function buildSummary(): Record<string, unknown> {
    return {
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      workspace: effectiveWorkspaceLabel(),
      sessions: listRootSessions(),
    };
  }

  // ---------------- workspace detection (DSH durable workspace registry) ----------------
  async function refreshWorkspaces(): Promise<void> {
    const workspaceRegistry = ctx.get('workspaceRegistry') as any;
    if (workspaceRegistry && typeof workspaceRegistry.list === 'function') {
      try {
        const list = workspaceRegistry.list() as any[];
        const next: Array<{ title: string; path: string }> = [];
        for (const w of list) {
          if (!w) continue;
          const title = typeof w.title === 'string' ? w.title : '';
          const path = typeof w.path === 'string' ? w.path : '';
          if (title) next.push({ title: title, path: path });
        }
        state.workspaces = next;
      } catch (err) {
        console.error('dshcc: workspaceRegistry.list failed:', String((err as Error) && (err as Error).message));
      }
    }
    // current workspace: the main agent session's cwd, resolved against the registry
    let detected: string | null = null;
    let cwd: string | undefined;
    try {
      const root = firstRoot();
      cwd = root && root.session && root.session.meta && typeof root.session.meta.cwd === 'string' ? root.session.meta.cwd : undefined;
    } catch (e) {}
    if (!cwd) {
      const sandboxPolicy = ctx.get('sandboxPolicy') as any;
      if (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string') cwd = sandboxPolicy.workspaceRoot;
    }
    if (cwd && workspaceRegistry && typeof workspaceRegistry.resolveByPath === 'function') {
      try {
        const resolved = await workspaceRegistry.resolveByPath(cwd);
        if (resolved && typeof resolved.title === 'string' && resolved.title) detected = resolved.title;
      } catch (err) {
        detected = null;
      }
    }
    if (!detected && cwd) {
      const hit = state.workspaces.find((w) => w.path === cwd);
      if (hit) detected = hit.title;
    }
    if (detected !== state.detectedWorkspace) {
      state.detectedWorkspace = detected;
      broadcastSummary(true);
    }
  }

  function broadcastSummary(force: boolean): void {
    const now = Date.now();
    if (!force && now - state.lastSummaryBroadcast < 2000) return;
    state.lastSummaryBroadcast = now;
    gatewaySend({ cmd: 'set-summary', summary: buildSummary() });
  }

  // ---------------- inbound messaging ----------------
  function handleRpcIn(msg: any): void {
    if (msg.method !== 'msg.post') {
      gatewaySend({ cmd: 'rpc-err', id: msg.id, error: '不支持的方法：' + String(msg.method) });
      return;
    }
    const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};
    const content = String(params.content || '').trim().slice(0, 4000);
    if (!content) {
      gatewaySend({ cmd: 'rpc-err', id: msg.id, error: '消息内容为空' });
      return;
    }
    const sessionId = typeof params.sessionId === 'string' && params.sessionId ? params.sessionId : undefined;
    const peer = state.peers.get(msg.from);
    const peerName = (peer && peer.name) || String(msg.from);
    // session granularity: one session = one main agent; an explicit sessionId
    // addresses exactly that session, otherwise the first root session receives it
    const root = findRootAgent(sessionId);
    if (!root || typeof root.followup !== 'function') {
      gatewaySend({ cmd: 'rpc-err', id: msg.id, error: sessionId ? '目标会话不存在或已关闭：' + sessionId : '本机暂无可接收消息的主 Agent' });
      return;
    }
    let sessionTitle = '';
    try {
      const sessionTitleSvc = ctx.get('sessionTitle') as any;
      if (sessionTitleSvc && typeof sessionTitleSvc.get === 'function' && root.session) {
        const snap = sessionTitleSvc.get(root.session);
        if (snap && typeof snap.title === 'string') sessionTitle = snap.title;
      }
    } catch (e) {}
    const text = '【LAN 协作 · ' + peerName + (sessionTitle ? ' / ' + sessionTitle : '') + '】\n' + content;
    const message = {
      id: mintId('m'),
      role: 'user',
      content: [{ type: 'text', text: text }],
      source: { kind: 'user' },
    };
    try {
      root.followup(message);
    } catch (err) {
      gatewaySend({ cmd: 'rpc-err', id: msg.id, error: '投递失败：' + String((err as Error) && (err as Error).message) });
      return;
    }
    state.messages.unshift({
      dir: 'in',
      peer: msg.from,
      name: peerName,
      content: content,
      at: Date.now(),
      sessionId: sessionId || '',
      sessionTitle: sessionTitle || '',
    });
    if (state.messages.length > 50) state.messages.pop();
    notifyMessage(peerName, content);
    gatewaySend({ cmd: 'rpc-ok', id: msg.id, result: { delivered: true, summary: buildSummary() } });
  }

  function notifyMessage(peerName: string, content: string): void {
    if (state.notifEnv && typeof state.notifEnv.notify === 'function') {
      try {
        state.notifEnv.notify({
          title: 'LAN 协作 · 新消息',
          body: peerName + '：' + content.slice(0, 80),
          severity: 'info',
        });
      } catch (e) {}
    }
  }

  async function sendMessageTo(deviceId: string, content: string, allowDirectAddress?: boolean, sessionId?: string): Promise<Record<string, unknown>> {
    const text = String(content || '').trim().slice(0, 4000);
    if (!text) throw new Error('消息内容不能为空');
    let peer = findPeer(deviceId);
    let direct = false;
    if (!peer && allowDirectAddress) {
      // one-shot delivery to a raw ip:port that is not in the registry yet
      const parsed = parseAddress(String(deviceId), rpcPort);
      if (parsed) {
        peer = {
          deviceId: String(deviceId),
          name: parsed.host,
          address: parsed.host,
          udpPort: 0,
          rpcPort: parsed.port,
          relay: false,
          encrypted: false,
          source: 'direct',
          connected: false,
          summary: null,
          lastSeen: 0,
          firstSeen: Date.now(),
        };
        direct = true;
      }
    }
    if (!peer) throw new Error('未找到设备：' + deviceId + '（可用 lan_peers 查看组网内设备）');
    try {
      const res = await gatewayRpc(peer, 'msg.post', { content: text, sessionId: sessionId || undefined }, 15000);
      state.messages.unshift({
        dir: 'out',
        peer: peer.deviceId,
        name: peer.name,
        content: text,
        at: Date.now(),
        sessionId: sessionId || '',
        sessionTitle: '',
      });
      if (state.messages.length > 50) state.messages.pop();
      return { delivered: !!(res && res.delivered), summary: (res && res.summary) || null };
    } catch (err) {
      // direct one-shot to an unregistered address is not queueable: there is
      // no tracked device identity to key the queue on
      if (direct) throw err;
      // known peer unreachable (offline / gateway down / timeout): queue it,
      // it flushes automatically when the peer comes back online
      const item: QueueItem = {
        id: mintId('q'),
        deviceId: peer.deviceId,
        sessionId: sessionId || undefined,
        content: text,
        at: Date.now(),
      };
      state.queue = enqueueItem(state.queue, item);
      persistQueue();
      return { delivered: false, queued: true };
    }
  }

  // ---------------- offline queue flush ----------------
  function flushQueueFor(deviceId: string): void {
    if (state.flushing.has(deviceId)) return;
    if (itemsFor(state.queue, deviceId).length === 0) return;
    state.flushing.add(deviceId);
    flushDevice(state.queue, deviceId, async (item) => {
      const peer = findPeer(item.deviceId);
      if (!peer) return 'unreachable';
      try {
        const res = await gatewayRpc(peer, 'msg.post', { content: item.content, sessionId: item.sessionId || undefined }, 15000);
        return res && res.delivered ? 'delivered' : 'unreachable';
      } catch (err) {
        const message = String((err as Error) && (err as Error).message);
        if (message.indexOf('目标会话不存在') >= 0) return 'session-gone';
        return 'unreachable';
      }
    }).then(({ remaining, delivered, dropped }) => {
      state.queue = remaining;
      if (delivered.length > 0 || dropped.length > 0) persistQueue();
      for (const item of delivered) {
        state.messages.unshift({
          dir: 'out',
          peer: item.deviceId,
          name: peerNameOf(item.deviceId),
          content: item.content,
          at: item.at,
          sessionId: item.sessionId || '',
          sessionTitle: '',
        });
        if (state.messages.length > 50) state.messages.pop();
        notifyMessage('离线队列', '已自动投递 ' + (item.content.slice(0, 40)));
      }
      for (const item of dropped) {
        console.log('dshcc: dropped queued message (target session closed):', item.id);
      }
    }).catch((err) => {
      console.error('dshcc: queue flush failed:', String((err as Error) && (err as Error).message));
    }).finally(() => {
      state.flushing.delete(deviceId);
    });
  }

  function flushAllQueued(): void {
    if (state.queue.length === 0) return;
    const ids = new Set<string>();
    for (const q of state.queue) ids.add(q.deviceId);
    ids.forEach((id) => flushQueueFor(id));
  }

  // ---------------- gateway lifecycle ----------------
  async function resolveNodeExecutable(): Promise<string> {
    let lastErr: unknown = null;
    for (let i = 0; i < NODE_CANDIDATES.length; i++) {
      try {
        return await subprocess.resolveExecutable(NODE_CANDIDATES[i]);
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error('no node executable found (tried: ' + NODE_CANDIDATES.join(', ') + '): ' + String((lastErr as Error) && (lastErr as Error).message));
  }

  async function startGateway(): Promise<void> {
    let nodePath: string;
    try {
      nodePath = await resolveNodeExecutable();
    } catch (err) {
      state.lastError = String((err as Error) && (err as Error).message) || 'cannot resolve node executable';
      console.error('dshcc:', state.lastError);
      return;
    }
    const fs = ctx.get('fs') as any;
    let gatewaySource: string | null = null;
    if (fs && typeof fs.readText === 'function') {
      try {
        gatewaySource = await fs.readText(await fs.resolve(GATEWAY_SOURCE_PATH));
      } catch (err) {
        state.lastError = 'cannot load gateway source from ' + GATEWAY_SOURCE_PATH + ': ' + String((err as Error) && (err as Error).message);
        console.error('dshcc:', state.lastError);
        return;
      }
    }
    if (!gatewaySource) {
      state.lastError = 'gateway source missing: ' + GATEWAY_SOURCE_PATH;
      console.error('dshcc:', state.lastError);
      return;
    }
    state.nodePath = nodePath;
    const sandboxPolicy = ctx.get('sandboxPolicy') as any;
    const cwd = (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string' && sandboxPolicy.workspaceRoot) || '.';
    const handle = subprocess.spawn({
      argv: [nodePath, '-e', gatewaySource, state.deviceId, String(udpPort), state.deviceName, String(beaconMs), String(rpcPort), relayUrl, state.pluginVersion],
      cwd: cwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: 65536 },
      },
      graceMs: 2000,
    });
    state.handle = handle;
    applyPairsToGateway();

    let outBuf = '';
    if (handle.stdout && typeof handle.stdout.setEncoding === 'function') {
      handle.stdout.setEncoding('utf8');
      handle.stdout.on('data', (chunk: string) => {
        outBuf += chunk;
        let idx: number;
        while ((idx = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, idx).trim();
          outBuf = outBuf.slice(idx + 1);
          if (!line) continue;
          let msg: any;
          try { msg = JSON.parse(line); } catch (e) { continue; }
          onGatewayMessage(msg);
        }
      });
      handle.stdout.on('error', (err: Error) => {
        state.lastError = 'gateway stdout: ' + String(err && err.message);
      });
    }
    if (handle.stderr && typeof handle.stderr.setEncoding === 'function') {
      handle.stderr.setEncoding('utf8');
      handle.stderr.on('data', (chunk: string) => {
        state.stderrText = (state.stderrText + chunk).slice(-4096);
      });
    }
    handle.done.then((outcome: any) => {
      state.gatewayReady = false;
      if (state.handle === handle) state.handle = null;
      console.log('dshcc: gateway exited, code', outcome ? outcome.exitCode : null);
    }).catch((err: Error) => {
      state.gatewayReady = false;
      if (state.handle === handle) state.handle = null;
      state.lastError = 'gateway failed: ' + String(err && err.message);
      console.error('dshcc:', state.lastError);
    });
  }

  // ---------------- snapshot ----------------
  function peerList(): Array<Record<string, unknown>> {
    const now = Date.now();
    const out: Array<Record<string, unknown>> = [];
    state.peers.forEach((p) => {
      const compat = typeof p.compat === 'number' ? p.compat : 0;
      out.push({
        deviceId: p.deviceId,
        name: p.name,
        address: p.address,
        rpcPort: p.rpcPort,
        relay: !!p.relay,
        encrypted: !!p.encrypted,
        source: p.source,
        connected: !!p.connected,
        summary: p.summary || null,
        version: typeof p.version === 'string' ? p.version : '',
        compat: compat,
        // compat 0 = unknown (pre-version-check peers); null = unknown to the UI
        compatible: compat === 0 ? null : compat === PROTOCOL_COMPAT,
        ageMs: now - p.lastSeen,
      });
    });
    out.sort((a, b) => {
      const c = String(a.source).localeCompare(String(b.source));
      if (c !== 0) return c;
      return String(a.address) < String(b.address) ? -1 : 1;
    });
    return out;
  }

  function snapshot(): Record<string, unknown> {
    const pairs: Array<{ deviceId: string; paired: boolean }> = [];
    state.pairs.forEach((secret, deviceId) => pairs.push({ deviceId: deviceId, paired: !!secret }));
    return {
      deviceId: state.deviceId,
      deviceName: state.deviceName,
      workspaceLabel: effectiveWorkspaceLabel(),
      customWorkspace: state.workspaceLabel,
      detectedWorkspace: state.detectedWorkspace,
      workspaces: state.workspaces,
      pluginVersion: state.pluginVersion,
      protocolCompat: PROTOCOL_COMPAT,
      ownAddress: state.ownAddress,
      ownAddresses: state.ownAddresses,
      summary: buildSummary(),
      udpPort: udpPort,
      rpcPort: rpcPort,
      gatewayReady: state.gatewayReady,
      relayUrl: relayUrl,
      relayConnected: state.relayConnected,
      nodePath: state.nodePath,
      lastError: state.lastError,
      stderrTail: state.stderrText.slice(-2048),
      pairs: pairs,
      knownPeers: Array.from(state.knownPeers.values()),
      peers: peerList(),
      messages: state.messages,
      queue: state.queue.map((q) => ({
        id: q.id,
        deviceId: q.deviceId,
        name: peerNameOf(q.deviceId),
        sessionId: q.sessionId || '',
        content: q.content,
        at: q.at,
      })),
      now: Date.now(),
    };
  }

  // ---------------- fenced client routes ----------------
  function trustedHosts(): string[] {
    try {
      if (webRuntime && Array.isArray(webRuntime.trustedHosts)) return webRuntime.trustedHosts.map(String);
    } catch (e) {}
    return [];
  }

  if (ctx.webServer && typeof ctx.webServer.register === 'function') {
    ctx.webServer.register({
      kind: 'exact',
      path: '/dshcc/api/state',
      handler: async (req: any, res: any) => {
        if (!isTrustedRequest(req, trustedHosts())) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
        writeJson(res, 200, { ok: true, state: snapshot() });
      },
    });
    const postRoute = (path: string, action: (body: any) => Promise<unknown> | unknown) => {
      ctx.webServer.register({
        kind: 'exact',
        path: path,
        handler: async (req: any, res: any) => {
          if (!isTrustedRequest(req, trustedHosts())) return writeJson(res, 403, { ok: false, error: 'untrusted origin' });
          const body = await readJsonBody(req);
          try {
            const result = await action(body || {});
            writeJson(res, 200, { ok: true, result: result });
          } catch (err) {
            writeJson(res, 500, { ok: false, error: String((err as Error) && (err as Error).message) });
          }
        },
      });
    };
    postRoute('/dshcc/api/setName', (body) => {
      const n = String((body && body.name) || '').slice(0, 64);
      state.deviceName = n;
      gatewaySend({ cmd: 'set-name', name: n });
      persistSettingSafe({ deviceName: n });
      broadcastSummary(true);
      return snapshot();
    });
    postRoute('/dshcc/api/setWorkspace', (body) => {
      const w = String((body && body.workspace) || '').slice(0, 64);
      state.workspaceLabel = w;
      persistSettingSafe({ workspaceLabel: w });
      broadcastSummary(true);
      return snapshot();
    });
    postRoute('/dshcc/api/sendMessage', async (body) => {
      const deviceId = String((body && body.deviceId) || '');
      const content = String((body && body.content) || '').slice(0, 4000);
      const sessionId = (body && typeof body.sessionId === 'string' && body.sessionId) ? body.sessionId : undefined;
      if (!deviceId || !content) throw new Error('deviceId and content required');
      const res = await sendMessageTo(deviceId, content, false, sessionId);
      return Object.assign({ sent: true }, res, snapshot());
    });
    postRoute('/dshcc/api/addPeer', (body) => {
      const raw = String((body && body.address) || '').trim();
      const parsed = parseAddress(raw, rpcPort);
      if (!parsed) throw new Error('invalid address (expect ip:port)');
      const key = parsed.host + ':' + parsed.port;
      state.knownPeers.set(key, { address: key, source: 'manual' });
      gatewaySend({ cmd: 'add-peer', address: key });
      persistKnownPeers();
      return snapshot();
    });
    postRoute('/dshcc/api/removePeer', (body) => {
      const raw = String((body && body.address) || '').trim();
      const parsed = parseAddress(raw, rpcPort);
      if (!parsed) throw new Error('invalid address');
      const key = parsed.host + ':' + parsed.port;
      state.knownPeers.delete(key);
      gatewaySend({ cmd: 'remove-peer', address: key });
      persistKnownPeers();
      return snapshot();
    });
    postRoute('/dshcc/api/removeQueued', (body) => {
      const id = String((body && body.id) || '').trim();
      if (!id) throw new Error('id required');
      state.queue = removeItem(state.queue, id);
      persistQueue();
      return snapshot();
    });
    postRoute('/dshcc/api/pair', (body) => {
      const deviceId = String((body && body.deviceId) || '').trim();
      const secret = String((body && body.secret) || '').trim();
      if (!deviceId) throw new Error('deviceId required');
      if (!secret || secret.length < 8) throw new Error('secret too short (min 8 chars)');
      state.pairs.set(deviceId, secret);
      gatewaySend({ cmd: 'pair-secret', deviceId: deviceId, secret: secret });
      const list: Array<{ deviceId: string; secret: string }> = [];
      state.pairs.forEach((s, id) => list.push({ deviceId: id, secret: s }));
      persistSettingSafe({ pairs: list });
      return snapshot();
    });
    postRoute('/dshcc/api/unpair', (body) => {
      const deviceId = String((body && body.deviceId) || '');
      state.pairs.delete(deviceId);
      const list: Array<{ deviceId: string; secret: string }> = [];
      state.pairs.forEach((s, id) => list.push({ deviceId: id, secret: s }));
      persistSettingSafe({ pairs: list });
      return snapshot();
    });
    console.log('dshcc: fenced client routes registered under /dshcc/api/*');
  }

  // ---------------- model tools ----------------
  const tools = ctx.get('tools') as any;
  function defineTool(definition: any): void {
    if (tools && typeof tools.register === 'function') tools.register(definition);
  }

  defineTool({
    name: 'lan_peers',
    description:
      'List devices in this cross-device mesh (added by ip:port, auto-discovered on LAN, or learned via gossip), with their identity summaries (device name, workspace label), connection state, and the SESSIONS each device hosts. In DSH one session is one main agent — use the session ids listed here to pick the exact target for lan_message.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args: unknown, value: any) {
        const summary = value.summary || {};
        const lines = [
          '本机：' + summary.deviceName + '（' + summary.deviceId + '）· RPC 端口 ' + value.rpcPort,
          '组网节点：' + value.peers.length + ' 个',
        ];
        const sessions = Array.isArray(summary.sessions) ? summary.sessions : [];
        if (sessions.length > 0) {
          lines.push('本机会话（一个会话即一个主 Agent）：');
          for (let i = 0; i < sessions.length; i++) {
            lines.push('  - ' + sessions[i].id + '「' + (sessions[i].title || '') + '」');
          }
        }
        if (value.peers.length === 0) {
          lines.push('暂无节点。可用 lan_message 按 ip:port 直接发送到已知地址。');
        }
        if (Array.isArray(value.queue) && value.queue.length > 0) {
          lines.push('离线队列：' + value.queue.length + ' 条（对端上线后自动投递）');
        }
        for (let i = 0; i < value.peers.length; i++) {
          const p = value.peers[i];
          const s = p.summary || {};
          lines.push('- ' + (s.deviceName || p.name) + '（' + p.deviceId + '）' +
            ' · ' + (p.address ? p.address + ':' + p.rpcPort : '中继') +
            ' · 工作区 ' + (s.workspace || '未设置') +
            ' · ' + (p.connected ? '在线' : '离线') +
            ' · 来源：' + p.source +
            (p.version ? ' · 插件 v' + p.version : '') +
            (p.compat ? ' · 协议 v' + p.compat : '') +
            (p.compatible === false ? ' ⚠ 版本不兼容' : ''));
          const ps = Array.isArray(s.sessions) ? s.sessions : [];
          if (ps.length > 0) {
            for (let j = 0; j < ps.length; j++) {
              lines.push('    · 会话 ' + ps[j].id + '「' + (ps[j].title || '') + '」');
            }
          }
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    execute: async (args: any, exec: any) => {
      const snap = snapshot();
      return { summary: snap.summary, rpcPort: snap.rpcPort, peers: snap.peers, queue: snap.queue };
    },
  });

  defineTool({
    name: 'lan_message',
    description:
      'Send a message to a specific main agent on another device in the cross-device mesh. Identify the device by deviceId, device name, or ip:port (a bare ip:port works even when the address is not in the registry yet). Identify the target SESSION (one session = one main agent in DSH) by its session id via the optional "session" parameter — get session ids from lan_peers; omit "session" to address that device\'s first/only main agent. The message lands in the target agent\'s inbox and wakes it. Empty messages are rejected and content beyond 4000 chars is truncated. If the target device is offline, the message is queued and delivered automatically when it comes back online (queued messages to a closed session are dropped). This is the ONLY cross-device operation: pure communication.',
    parameters: {
      type: 'object',
      properties: {
        peer: { type: 'string', description: 'deviceId, device name, or ip:port of the target peer' },
        session: { type: 'string', description: 'optional target session id (from lan_peers); omit for the device\'s default main agent' },
        content: { type: 'string', description: 'message text (max 4000 chars)' },
      },
      required: ['peer', 'content'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(args: unknown, value: any) {
        if (!value.ok) return [{ type: 'text', text: '发送失败：' + value.error }];
        if (value.queued) return [{ type: 'text', text: '已排队：对端离线，上线后将自动投递（' + value.peer + '）' }];
        return [{ type: 'text', text: '已送达 ' + value.peer + (value.session ? '（会话 ' + value.session + '）' : '') }];
      },
    },
    execute: async (args: any, exec: any) => {
      const content = String(args.content || '').trim().slice(0, 4000);
      if (!content) return { ok: false, error: '消息内容不能为空' };
      const sessionId = typeof args.session === 'string' && args.session ? args.session : undefined;
      try {
        // allowDirectAddress: a bare ip:port that is not registered yet is attempted once
        const res = await sendMessageTo(String(args.peer), content, true, sessionId);
        return {
          ok: true,
          peer: String(args.peer),
          session: sessionId || '',
          delivered: !!res.delivered,
          queued: !!res.queued,
        };
      } catch (err) {
        return { ok: false, error: String((err as Error) && (err as Error).message) };
      }
    },
  });

  // ---------------- notification-frame integration ----------------
  let notifRegistered = false;
  let notifRetries = 0;
  const notifTimers = new Set<() => void>();
  function tryRegisterNotifFrame(): void {
    if (notifRegistered) return;
    const notificationFrame = ctx.get('notificationFrame') as any;
    if (notificationFrame && typeof notificationFrame.register === 'function') {
      try {
        const notifDisposer = notificationFrame.register({
          id: 'lan-message',
          title: 'LAN 协作 · 新消息',
          description: '其他设备的主 Agent 发来消息时发出通知。',
          severity: 'info',
          channels: ['web', 'system', 'log'],
          defaultChannels: ['web'],
          setup(env: any) {
            state.notifEnv = env;
            return () => {
              if (state.notifEnv === env) state.notifEnv = null;
            };
          },
        });
        ctx.effect(() => notifDisposer);
        notifRegistered = true;
        console.log('dshcc: notification item registered with dsh-notifacation-frame');
      } catch (err) {
        console.error('dshcc: notificationFrame register failed:', String((err as Error) && (err as Error).message));
      }
    } else if (notifRetries < 20) {
      notifRetries++;
      const timer = ctx.timeout(() => { notifTimers.delete(timer); tryRegisterNotifFrame(); }, 1000);
      notifTimers.add(timer);
    }
  }
  tryRegisterNotifFrame();

  // ---------------- lifecycle ----------------
  // read the package version once (single source of truth: package.json);
  // the gateway advertises it together with PROTOCOL_COMPAT for peer checks
  (async () => {
    const fsForVersion = ctx.get('fs') as any;
    if (fsForVersion && typeof fsForVersion.readText === 'function') {
      try {
        const raw = await fsForVersion.readText(await fsForVersion.resolve(PACKAGE_JSON_PATH));
        const pkg = JSON.parse(raw);
        if (pkg && typeof pkg.version === 'string' && pkg.version) state.pluginVersion = pkg.version;
      } catch (e) {}
    }
    startGateway();
  })();
  refreshWorkspaces();
  const workspacesTimer = ctx.interval(() => { refreshWorkspaces(); }, 30000);
  // the summary carries the session list (one session = one main agent);
  // re-broadcast periodically so peers learn session open/close changes
  const summaryTimer = ctx.interval(() => { broadcastSummary(true); }, 10000);
  // periodic retry for queued offline messages (peer-up events already flush
  // immediately; this catches stale connected flags)
  const queueTimer = ctx.interval(() => { flushAllQueued(); }, 15000);
  ctx.effect(() => () => {
    workspacesTimer();
    summaryTimer();
    queueTimer();
    for (const t of notifTimers) { try { t(); } catch (e) {} }
    notifTimers.clear();
    if (watchOff) { try { watchOff(); } catch (e) {} }
    if (state.handle) {
      try { gatewaySend({ cmd: 'quit' }); } catch (e) {}
      try { state.handle.terminate(); } catch (e) {}
    }
  });
}
