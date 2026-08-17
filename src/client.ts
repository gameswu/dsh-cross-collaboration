// dsh-cross-collaboration — Client plugin (persistent ESM form).
// Simplified P2P model (P7): peers added by "ip:port" (Minecraft-style), mesh
// gossip syncs the address list, and the UI shows ONLY inter-agent
// communication messages (plus connection state) — no agent work status.
// Client↔host bridge: fenced routes /dshcc/api/* (same-origin fetch).
// Integrations:
//   - settings page: slot "settings.section" (same mechanism as
//     dsh-notifacation-frame) + settings-nav icon swap
//   - dsh-plugin-vscode-sidebar: registerTab({ component, single }); the
//     panel scrolls itself because the sidebar pane clips overflow
//   - dsh-notifacation-frame: notification registration lives in the Host half

export const name = 'dsh-cross-collaboration';

export const inject = ['slots', 'timer'];

export function apply(ctx: any) {

  // ---------------- DSH-style glyphs ----------------
  function LanGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 16;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('circle', { cx: 4, cy: 8, r: 2.2 }),
      React.createElement('circle', { cx: 12, cy: 4.5, r: 2.2 }),
      React.createElement('circle', { cx: 12, cy: 11.5, r: 2.2 }),
      React.createElement('path', { d: 'M5.9 7.1l4.3-1.9M5.9 8.9l4.3 1.9' }),
    );
  }

  function SendGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 14;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M2 8L14 3l-2.2 10L8.5 10 6 14z' }),
    );
  }

  function PlusGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 12;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M8 3.5v9M3.5 8h9' }),
    );
  }

  function CheckGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 12;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M3 8.5l3.2 3.2L13 5' }),
    );
  }

  function XGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 12;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' }),
    );
  }

  function ChatGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 16;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M2.5 4.5a1.5 1.5 0 011.5-1.5h8a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-1.5 1.5H7l-3.2 2.4c-.4.3-.8 0-.8-.4V4.5z' }),
    );
  }

  function DeviceGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 16;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('rect', { x: 2, y: 2.75, width: 12, height: 8.5, rx: 1.5 }),
      React.createElement('path', { d: 'M6 13.5h4M8 11.25v2.25' }),
    );
  }

  function FolderGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 12;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M1.75 4.25a1.5 1.5 0 011.5-1.5h3l1.5 2h4.5a1.5 1.5 0 011.5 1.5v5.5a1.5 1.5 0 01-1.5 1.5H3.25a1.5 1.5 0 01-1.5-1.5v-7.5z' }),
    );
  }

  function KeyGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 12;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('circle', { cx: 5.5, cy: 5.5, r: 2.75 }),
      React.createElement('path', { d: 'M7.4 7.4l5.85 5.85M11 11l2-2' }),
    );
  }

  function BookmarkGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 16;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('path', { d: 'M4 2.75h8v10.5L8 10.9l-4 2.35V2.75z' }),
    );
  }

  function ClockGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 16;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('circle', { cx: 8, cy: 8, r: 5.5 }),
      React.createElement('path', { d: 'M8 4.75V8l2.25 1.5' }),
    );
  }

  function PlusNodeGlyph(props: { size?: number } | undefined): unknown {
    const size = (props && props.size) || 16;
    return React.createElement('svg', {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
    },
      React.createElement('circle', { cx: 4.5, cy: 8, r: 2.2 }),
      React.createElement('circle', { cx: 11.5, cy: 4.5, r: 2.2 }),
      React.createElement('path', { d: 'M11.5 2.4v4.2M9.4 4.5h4.2M6.2 7.1l3.2-1.9' }),
    );
  }

  // svg string for the settings-nav icon swap (same shape as LanGlyph)
  const LAN_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" width="16" height="16"><circle cx="4" cy="8" r="2.2"/><circle cx="12" cy="4.5" r="2.2"/><circle cx="12" cy="11.5" r="2.2"/><path d="M5.9 7.1l4.3-1.9M5.9 8.9l4.3 1.9"/></svg>';

  // ---------------- api ----------------
  async function api(path: string, body?: unknown): Promise<any> {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(String((json && json.error) || 'request failed'));
    // GET /state responds { ok, state }; POST routes respond { ok, result }
    return json.result !== undefined ? json.result : json.state;
  }

  function fmtTime(t: number): string {
    const d = new Date(t);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? hm : pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
  }

  const SOURCE_LABEL: Record<string, string> = {
    manual: '手动添加',
    gossip: '组网同步',
    lan: '局域网发现',
    relay: '中继',
  };

  // ---------------- styles ----------------
  function mountStyles(): (() => void) | undefined {
    if (typeof document === 'undefined') return undefined;
    const styleId = 'dshcc-client-style';
    if (document.getElementById(styleId)) return undefined;
    const css = `
#dshcc-panel {
  display: flex; flex-direction: column; gap: 12px; padding: 14px;
  /* sidebar pane: fill the pane and scroll itself (the pane clips overflow);
     settings page: parent auto-height, these props are no-ops there */
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  scrollbar-width: thin;
}
#dshcc-panel::-webkit-scrollbar { width: 8px; }
#dshcc-panel::-webkit-scrollbar-thumb { background: var(--dsw-alias-line-stroke); border-radius: 4px; }
#dshcc-panel, #dshcc-panel * { box-sizing: border-box; }
.dshcc-card {
  border: 1px solid var(--dsw-alias-line-stroke);
  border-radius: 10px;
  background: var(--dsw-alias-bg-panel);
  box-shadow: var(--dsw-shadow-lv3);
  overflow: hidden;
  /* never shrink below content: overflow:hidden zeroes the flex automatic
     minimum, which would squeeze every card into the pane height and
     silently clip content (no scrollbar ever appears) */
  flex: none;
}
.dshcc-card-body { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 8px; }
.dshcc-h {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--dsw-alias-line-divider);
  margin-bottom: 12px;
  background: var(--dsw-alias-bg-elevated);
}
.dshcc-title { font: var(--dsw-font-h3); color: var(--dsw-alias-text-primary); display: flex; align-items: center; gap: 9px; }
.dshcc-icon-bubble {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 7px; flex: none;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-bg-input);
  border: 1px solid var(--dsw-alias-line-stroke);
}
.dshcc-count {
  min-width: 22px; text-align: center; padding: 1px 8px; border-radius: 999px;
  background: var(--dsw-alias-bg-input); border: 1px solid var(--dsw-alias-line-divider);
  font: var(--dsw-font-body-s); color: var(--dsw-alias-text-secondary);
}
.dshcc-desc { font: var(--dsw-font-body-s); color: var(--dsw-alias-text-tertiary); margin: -2px 0 2px; }
.dshcc-sub { font: var(--dsw-font-body-s); color: var(--dsw-alias-text-tertiary); }
.dshcc-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px; border-top: 1px solid var(--dsw-alias-line-divider); }
.dshcc-row:first-of-type { border-top: none; }
.dshcc-row-click { cursor: pointer; border-radius: 8px; margin: 0 -6px; padding: 8px 6px; }
.dshcc-row-click:hover { background: var(--dsw-alias-bg-elevated); }
.dshcc-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dshcc-dot-online { background: #59b96f; }
.dshcc-dot-offline { background: #8b909c; }
.dshcc-status-online { color: #59b96f; }
.dshcc-status-offline { color: #8b909c; }
.dshcc-status-warn { color: #e0b64c; }
.dshcc-peer-name { font: var(--dsw-font-body-m); color: var(--dsw-alias-text-primary); display: flex; align-items: center; gap: 8px; }
.dshcc-peer-meta { font: var(--dsw-font-body-s); color: var(--dsw-alias-text-tertiary); margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dshcc-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font: var(--dsw-font-body-s); color: var(--dsw-alias-text-secondary); background: var(--dsw-alias-bg-elevated); border: 1px solid var(--dsw-alias-line-divider); }
.dshcc-chip-btn { cursor: pointer; }
.dshcc-chip-btn:hover { color: var(--dsw-alias-text-primary); border-color: var(--dsw-alias-brand-primary); }
.dshcc-chip-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dshcc-chip-warn { color: #e0b64c; border-color: #e0b64c; }
.dshcc-btn {
  appearance: none; border: 1px solid var(--dsw-alias-line-stroke);
  background: var(--dsw-alias-button-bg-default); color: var(--dsw-alias-button-text-default);
  border-radius: 8px; padding: 6px 12px; cursor: pointer; font: var(--dsw-font-body-s);
  display: inline-flex; align-items: center; gap: 6px;
}
.dshcc-btn:hover { background: var(--dsw-alias-button-bg-hover); }
.dshcc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dshcc-btn-primary { background: var(--dsw-alias-button-bg-primary); color: var(--dsw-alias-button-text-primary); border-color: transparent; }
.dshcc-btn-primary:hover { background: var(--dsw-alias-button-bg-primary-hover); }
.dshcc-btn-danger { background: transparent; color: var(--dsw-alias-text-danger); border-color: var(--dsw-alias-text-danger); }
.dshcc-btn-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-text-secondary); padding: 4px 8px; }
.dshcc-btn-ghost:hover { background: var(--dsw-alias-bg-elevated); }
.dshcc-input, .dshcc-textarea {
  width: 100%; border: 1px solid var(--dsw-alias-line-stroke); border-radius: 8px;
  background: var(--dsw-alias-bg-input); color: var(--dsw-alias-text-primary);
  padding: 7px 10px; font: var(--dsw-font-body-m); outline: none;
}
.dshcc-input:focus, .dshcc-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.dshcc-textarea { resize: vertical; min-height: 64px; }
.dshcc-msg { padding: 8px 2px; border-top: 1px solid var(--dsw-alias-line-divider); }
.dshcc-msg:first-child { border-top: none; }
.dshcc-msg-head { font: var(--dsw-font-body-s); color: var(--dsw-alias-text-tertiary); display: flex; align-items: center; gap: 8px; }
.dshcc-msg-body { font: var(--dsw-font-body-m); color: var(--dsw-alias-text-primary); white-space: pre-wrap; word-break: break-word; margin-top: 2px; }
.dshcc-msg-in .dshcc-msg-head { color: var(--dsw-alias-brand-primary); }
.dshcc-dir {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-bg-input); border: 1px solid var(--dsw-alias-line-stroke);
  font-size: 11px; line-height: 1;
}
.dshcc-section-gap { display: flex; flex-direction: column; gap: 8px; }
.dshcc-error { color: var(--dsw-alias-text-danger); font: var(--dsw-font-body-s); }
.dshcc-scroll { max-height: 260px; overflow-y: auto; scrollbar-width: thin; }
.dshcc-nowrap { white-space: nowrap; }
.dshcc-kv { display: flex; justify-content: space-between; gap: 12px; font: var(--dsw-font-body-s); padding: 2px 0; }
.dshcc-kv .k { color: var(--dsw-alias-text-tertiary); flex: none; }
.dshcc-kv .v { color: var(--dsw-alias-text-primary); word-break: break-all; text-align: right; }
.dshcc-form { display: flex; flex-direction: column; gap: 8px; }
.dshcc-form-line { display: flex; gap: 8px; align-items: center; }
.dshcc-form-line .dshcc-input { flex: 1; }
.dshcc-form-note { font: var(--dsw-font-body-s); color: var(--dsw-alias-text-tertiary); }
.dshcc-workspaces { display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
.dshcc-chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
.dshcc-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 20px 8px; color: var(--dsw-alias-text-tertiary);
  font: var(--dsw-font-body-s);
}
.dshcc-empty svg { opacity: 0.55; }
.dshcc-status-row { display: flex; align-items: center; gap: 6px; font: var(--dsw-font-body-s); }
.dshcc-mono { font-family: var(--dsw-font-mono, ui-monospace, monospace); }
`;
    const el = document.createElement('style');
    el.id = styleId;
    el.textContent = css;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }

  // ---------------- main panel ----------------
  function CardHeader(title: string, icon: unknown, right?: unknown): unknown {
    return React.createElement('div', { className: 'dshcc-h' },
      React.createElement('div', { className: 'dshcc-title' },
        React.createElement('span', { className: 'dshcc-icon-bubble' }, icon),
        React.createElement('span', {}, title)),
      right || null);
  }

  function Card(title: string, icon: unknown, right: unknown | undefined, ...children: unknown[]): unknown {
    return React.createElement('div', { className: 'dshcc-card' },
      CardHeader(title, icon, right),
      React.createElement('div', { className: 'dshcc-card-body' }, ...children));
  }

  function CountPill(n: number): unknown {
    return React.createElement('span', { className: 'dshcc-count' }, String(n));
  }

  function EmptyState(icon: unknown, text: string): unknown {
    return React.createElement('div', { className: 'dshcc-empty' }, icon, React.createElement('span', {}, text));
  }

  function MainPanel(props: { onClose?: () => void }): unknown {
    // per-instance snapshot state: the panel polls the host itself and owns
    // its re-render via useState (no shared store, no useSyncExternalStore)
    const [snap, setSnap] = React.useState<any>({ snapshot: null, loading: true, error: null, selectedPeer: null, selectedSession: null, draft: '', sending: false });
    const patchSnap = (patch: any) => setSnap((prev: any) => Object.assign({}, prev, patch));
    React.useEffect(() => {
      let alive = true;
      const tick = () => {
        api('/dshcc/api/state').then((v) => {
          if (!alive) return;
          patchSnap({ snapshot: v, loading: false, error: null });
        }).catch((err) => {
          if (!alive) return;
          patchSnap({ error: String((err as Error) && (err as Error).message) });
        });
      };
      tick();
      const t = setInterval(tick, 2000);
      return () => { alive = false; clearInterval(t); };
    }, []);
    const [nameDraft, setNameDraft] = React.useState('');
    const [wsDraft, setWsDraft] = React.useState('');
    const [addrDraft, setAddrDraft] = React.useState('');
    const [pairForm, setPairForm] = React.useState({ deviceId: '', secret: '' });
    const [busy, setBusy] = React.useState('' as string);

    const doApi = async (path: string, body: unknown, ok?: (r: any) => void) => {
      setBusy(path);
      try {
        const r = await api(path, body);
        patchSnap({ snapshot: r });
        if (ok) ok(r);
      } catch (err) {
        patchSnap({ error: String((err as Error) && (err as Error).message) });
      } finally {
        setBusy('');
      }
    };

    const s = snap.snapshot;
    const summary = (s && s.summary) || {};
    // display order: online first, then by display name
    const peers = ((s && s.peers) || []).slice().sort((a: any, b: any) => {
      if (!!a.connected !== !!b.connected) return a.connected ? -1 : 1;
      const an = String((a.summary && a.summary.deviceName) || a.name || '');
      const bn = String((b.summary && b.summary.deviceName) || b.name || '');
      return an.localeCompare(bn);
    });
    const messages = (s && s.messages) || [];
    const sel = snap.selectedPeer || (peers.length > 0 ? peers[0].deviceId : null);
    const selPeer = peers.find((p: any) => p.deviceId === sel) || null;
    const selSessions = (selPeer && selPeer.summary && Array.isArray(selPeer.summary.sessions)) ? selPeer.summary.sessions : [];

    const pick = (id: string) => patchSnap({ selectedPeer: id, selectedSession: null });
    const pickSession = (id: string) => patchSnap({ selectedSession: id || null });
    const send = () => {
      if (!sel || !snap.draft.trim()) return;
      patchSnap({ sending: true });
      api('/dshcc/api/sendMessage', {
        deviceId: sel,
        content: snap.draft.trim(),
        sessionId: snap.selectedSession || undefined,
      }).then((r) => {
        patchSnap({ snapshot: r, draft: '', sending: false });
      }).catch((err) => {
        patchSnap({ error: String((err as Error) && (err as Error).message), sending: false });
      });
    };

    const peerAddr = (p: any) => (p.address ? p.address + ':' + p.rpcPort : 'relay');
    const defaultPort = s ? s.rpcPort : '45232';

    return React.createElement('div', { id: 'dshcc-panel' },
      // ---------------- 本机信息 ----------------
      Card('本机信息', React.createElement(DeviceGlyph, { size: 15 }),
        props.onClose
          ? React.createElement('button', { className: 'dshcc-btn dshcc-btn-ghost', onClick: props.onClose }, React.createElement(XGlyph, { size: 13 }))
          : null,
        snap.error ? React.createElement('div', { className: 'dshcc-error' }, snap.error) : null,
        s && s.gatewayReady === false ? React.createElement('div', { className: 'dshcc-error' }, '通信网关未运行：' + ((s && s.lastError) || '未知错误')) : null,
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '设备名称'),
          React.createElement('span', { className: 'v' }, summary.deviceName || '-')),
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '设备 ID'),
          React.createElement('span', { className: 'v dshcc-mono' }, (summary.deviceId || (s && s.deviceId) || '') || '-')),
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '工作区'),
          React.createElement('span', { className: 'v' }, summary.workspace || '自动检测')),
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '本机地址'),
          React.createElement('span', {
            className: 'v dshcc-mono',
            title: s && s.ownAddresses ? (s.ownAddresses as any[]).join('\n') : '',
          }, s && s.ownAddress ? s.ownAddress + ':' + s.rpcPort : '-')),
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '端口'),
          React.createElement('span', { className: 'v dshcc-mono' }, s ? s.rpcPort : '-')),
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '插件版本'),
          React.createElement('span', { className: 'v dshcc-mono' },
            (s && s.pluginVersion ? s.pluginVersion : '-') + (s && s.protocolCompat ? ' · 协议 v' + s.protocolCompat : ''))),
        React.createElement('div', { className: 'dshcc-kv' },
          React.createElement('span', { className: 'k' }, '中继'),
          React.createElement('span', {
            className: 'v dshcc-status-row' + (s && s.relayUrl ? (s.relayConnected ? ' dshcc-status-online' : ' dshcc-status-warn') : ''),
          },
            s && s.relayUrl ? (s.relayConnected ? '已连接' : '连接中断，自动重连中') : '未配置')),
        React.createElement('div', { className: 'dshcc-form-line' },
          React.createElement('input', {
            className: 'dshcc-input',
            placeholder: '设备名称',
            value: nameDraft,
            onChange: (e: any) => setNameDraft(e.target.value),
          }),
          React.createElement('button', {
            className: 'dshcc-btn',
            disabled: busy !== '' || !nameDraft.trim(),
            onClick: () => doApi('/dshcc/api/setName', { name: nameDraft.trim() }, () => setNameDraft('')),
          }, React.createElement(CheckGlyph, { size: 12 }), '保存')),
        (s && s.workspaces && s.workspaces.length > 0)
          ? React.createElement('div', { className: 'dshcc-workspaces' },
            React.createElement('span', { className: 'dshcc-form-note' }, '已检测到的工作区（点击设为标签）：'),
            React.createElement('div', { className: 'dshcc-chip-row' },
              (s.workspaces as any[]).map((w: any, i: number) =>
                React.createElement('button', {
                  key: (w.path || 'w') + i,
                  className: 'dshcc-chip dshcc-chip-btn',
                  title: w.path || w.title,
                  disabled: busy !== '',
                  onClick: () => doApi('/dshcc/api/setWorkspace', { workspace: w.title }, () => setWsDraft('')),
                }, React.createElement(FolderGlyph, { size: 12 }), w.title))),
          )
          : null,
        React.createElement('div', { className: 'dshcc-form-line' },
          React.createElement('input', {
            className: 'dshcc-input',
            placeholder: '自定义工作区标签（留空保存则恢复自动检测）',
            value: wsDraft,
            onChange: (e: any) => setWsDraft(e.target.value),
          }),
          React.createElement('button', {
            className: 'dshcc-btn',
            disabled: busy !== '',
            onClick: () => doApi('/dshcc/api/setWorkspace', { workspace: wsDraft.trim() }, () => setWsDraft('')),
          }, React.createElement(CheckGlyph, { size: 12 }), '保存')),
      ),

      // ---------------- 添加节点 ----------------
      Card('添加节点', React.createElement(PlusNodeGlyph, { size: 15 }), undefined,
        React.createElement('div', { className: 'dshcc-desc' }, '输入对端地址（ip:port），省略端口时使用默认端口。'),
        React.createElement('div', { className: 'dshcc-form' },
          React.createElement('div', { className: 'dshcc-form-line' },
            React.createElement('input', {
              className: 'dshcc-input dshcc-mono',
              placeholder: '例如 192.168.1.100:' + defaultPort,
              value: addrDraft,
              onChange: (e: any) => setAddrDraft(e.target.value),
              onKeyDown: (e: any) => {
                if (e.key === 'Enter' && addrDraft.trim()) {
                  doApi('/dshcc/api/addPeer', { address: addrDraft.trim() }, () => setAddrDraft(''));
                }
              },
            }),
            React.createElement('button', {
              className: 'dshcc-btn dshcc-btn-primary',
              disabled: busy !== '' || !addrDraft.trim(),
              onClick: () => doApi('/dshcc/api/addPeer', { address: addrDraft.trim() }, () => setAddrDraft('')),
            }, React.createElement(PlusGlyph, { size: 12 }), '添加')),
          React.createElement('div', { className: 'dshcc-form-note' }, '新节点会通过组网自动同步给其他设备。'),
        ),
      ),

      // ---------------- 组网节点 ----------------
      Card('组网节点', React.createElement(LanGlyph, { size: 15 }), CountPill(peers.length),
        peers.length === 0
          ? EmptyState(React.createElement(LanGlyph, { size: 26 }), '暂无节点。同一局域网内的设备会自动发现，其他设备请通过「添加节点」加入。')
          : React.createElement('div', { className: 'dshcc-scroll' },
            peers.map((p: any) => {
              const ps = p.summary || {};
              return React.createElement('div', {
                key: p.deviceId,
                className: 'dshcc-row dshcc-row-click',
                style: sel === p.deviceId ? { background: 'var(--dsw-alias-bg-elevated)' } : undefined,
                onClick: () => pick(p.deviceId),
              },
                React.createElement('div', {},
                  React.createElement('div', { className: 'dshcc-peer-name' },
                    React.createElement('span', { className: 'dshcc-dot ' + (p.connected ? 'dshcc-dot-online' : 'dshcc-dot-offline') }),
                    ps.deviceName || p.name),
                  React.createElement('div', { className: 'dshcc-peer-meta' },
                    React.createElement('span', { className: 'dshcc-chip dshcc-mono' }, peerAddr(p)),
                    ps.workspace ? React.createElement('span', { className: 'dshcc-chip' }, React.createElement(FolderGlyph, { size: 11 }), ' ' + ps.workspace) : null,
                    (Array.isArray(ps.sessions) && ps.sessions.length > 0)
                      ? React.createElement('span', { className: 'dshcc-chip' }, ps.sessions.length + ' 个会话')
                      : null,
                    p.compatible === false
                      ? React.createElement('span', { className: 'dshcc-chip dshcc-chip-warn', title: p.version ? '对端插件版本 v' + p.version + '，协议 v' + p.compat + '，与本机不兼容' : '对端协议与本机不兼容' }, '⚠ 版本不兼容')
                      : null,
                    React.createElement('span', { className: 'dshcc-chip' }, SOURCE_LABEL[p.source] || p.source))),
                React.createElement('span', { className: p.connected ? 'dshcc-status-online dshcc-nowrap' : 'dshcc-status-offline dshcc-nowrap' }, p.connected ? '在线' : '离线'),
              );
            })),
      ),

      // ---------------- 发送消息 ----------------
      Card('发送消息', React.createElement(SendGlyph, { size: 15 }),
        sel ? React.createElement('span', { className: 'dshcc-sub dshcc-mono' }, '→ ' + sel.slice(0, 14)) : undefined,
        sel
          ? React.createElement('div', { className: 'dshcc-form' },
            selSessions.length > 0
              ? React.createElement('div', { className: 'dshcc-form-line' },
                React.createElement('span', { className: 'dshcc-form-note dshcc-nowrap' }, '目标会话'),
                React.createElement('select', {
                  className: 'dshcc-input',
                  value: snap.selectedSession || '',
                  onChange: (e: any) => pickSession(e.target.value),
                },
                  React.createElement('option', { value: '' }, '默认（' + (selSessions[0] && selSessions[0].title ? selSessions[0].title : '主会话') + '）'),
                  selSessions.map((ss: any) =>
                    React.createElement('option', { key: ss.id, value: ss.id }, ss.title || ss.id.slice(0, 10))),
                ))
              : React.createElement('div', { className: 'dshcc-form-note' },
                  (selPeer && selPeer.summary && Array.isArray(selPeer.summary.sessions))
                    ? '对端当前没有打开的会话，消息将投递给其默认主 Agent。'
                    : '对端插件版本较旧或尚未上报会话列表（等数秒或升级对端后重启），消息将投递给其默认主 Agent。'),
            React.createElement('textarea', {
              className: 'dshcc-textarea',
              placeholder: '输入消息内容',
              value: snap.draft,
              onChange: (e: any) => patchSnap({ draft: e.target.value }),
              onKeyDown: (e: any) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
              },
            }),
            React.createElement('div', { className: 'dshcc-form-note' }, '消息将发送到所选会话的主 Agent 收件箱，并唤醒它开始新的对话。对端离线时消息会自动排队，上线后补投。'),
            React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
              React.createElement('button', {
                className: 'dshcc-btn dshcc-btn-primary',
                disabled: snap.sending || !snap.draft.trim(),
                onClick: send,
              }, React.createElement(SendGlyph, { size: 13 }), snap.sending ? '发送中…' : '发送')),
          )
          : EmptyState(React.createElement(LanGlyph, { size: 26 }), '请先在「组网节点」中选择一台设备。'),
      ),

      // ---------------- 通信消息 ----------------
      Card('通信消息', React.createElement(ChatGlyph, { size: 15 }), CountPill(messages.length),
        messages.length === 0
          ? EmptyState(React.createElement(ChatGlyph, { size: 26 }), '暂无消息。')
          : React.createElement('div', { className: 'dshcc-scroll' },
            messages.map((m: any, i: number) =>
              React.createElement('div', { key: String(m.at) + '-' + i, className: 'dshcc-msg' + (m.dir === 'in' ? ' dshcc-msg-in' : '') },
                React.createElement('div', { className: 'dshcc-msg-head' },
                  React.createElement('span', { className: 'dshcc-dir' }, m.dir === 'in' ? '←' : '→'),
                  React.createElement('span', {}, m.name + (m.sessionTitle ? ' · ' + m.sessionTitle : '')),
                  React.createElement('span', { style: { marginLeft: 'auto' } }, fmtTime(m.at))),
                React.createElement('div', { className: 'dshcc-msg-body' }, m.content),
              ))),
      ),

      // ---------------- 离线队列 ----------------
      Card('离线队列', React.createElement(ClockGlyph, { size: 15 }), CountPill((s && s.queue && s.queue.length) || 0),
        (s && s.queue && s.queue.length > 0)
          ? React.createElement('div', {},
            React.createElement('div', { className: 'dshcc-form-note' }, '对端离线时消息暂存在这里，上线后自动补投。'),
            s.queue.map((q: any) =>
              React.createElement('div', { key: q.id, className: 'dshcc-row' },
                React.createElement('div', {},
                  React.createElement('div', { className: 'dshcc-peer-name' },
                    React.createElement('span', { className: 'dshcc-dot dshcc-dot-offline' }),
                    q.name),
                  React.createElement('div', { className: 'dshcc-msg-body' }, (q.content || '').slice(0, 80))),
                React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  React.createElement('span', { className: 'dshcc-sub dshcc-nowrap' }, fmtTime(q.at)),
                  React.createElement('button', {
                    className: 'dshcc-btn dshcc-btn-danger',
                    onClick: () => doApi('/dshcc/api/removeQueued', { id: q.id }),
                  }, React.createElement(XGlyph, { size: 12 }), '移除')))))
          : EmptyState(React.createElement(ClockGlyph, { size: 26 }), '队列为空。对端离线时发送的消息会自动进入这里。'),
      ),

      // ---------------- 已保存节点 ----------------
      Card('已保存节点', React.createElement(BookmarkGlyph, { size: 15 }),
        CountPill((s && s.knownPeers && s.knownPeers.length) || 0),
        (s && s.knownPeers && s.knownPeers.length > 0)
          ? React.createElement('div', {},
            s.knownPeers.map((p: any) =>
              React.createElement('div', { key: p.address, className: 'dshcc-row' },
                React.createElement('div', { className: 'dshcc-peer-name' },
                  React.createElement('span', { className: 'dshcc-mono' }, p.address)),
                React.createElement('button', {
                  className: 'dshcc-btn dshcc-btn-danger',
                  onClick: () => doApi('/dshcc/api/removePeer', { address: p.address }),
                }, React.createElement(XGlyph, { size: 12 }), '移除'))))
          : EmptyState(React.createElement(BookmarkGlyph, { size: 26 }), '暂无已保存的节点。'),
      ),

      // ---------------- 中继配对 ----------------
      Card('中继配对', React.createElement(KeyGlyph, { size: 15 }), undefined,
        React.createElement('div', { className: 'dshcc-desc' }, '通过中继服务器跨网络通信，消息端到端加密。'),
        React.createElement('div', { className: 'dshcc-form' },
          React.createElement('div', { className: 'dshcc-form-line' },
            React.createElement('input', {
              className: 'dshcc-input dshcc-mono', placeholder: '对端设备 ID',
              value: pairForm.deviceId,
              onChange: (e: any) => setPairForm({ ...pairForm, deviceId: e.target.value }),
            }),
            React.createElement('input', {
              className: 'dshcc-input', placeholder: '共享密钥（至少 8 位）',
              value: pairForm.secret,
              onChange: (e: any) => setPairForm({ ...pairForm, secret: e.target.value }),
            })),
          React.createElement('div', { className: 'dshcc-form-note' }, '两台设备需填写相同的设备 ID 与共享密钥；中继服务器无法读取消息内容。'),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
            React.createElement('button', {
              className: 'dshcc-btn',
              disabled: busy !== '' || !pairForm.deviceId.trim() || pairForm.secret.trim().length < 8,
              onClick: () => doApi('/dshcc/api/pair', {
                deviceId: pairForm.deviceId.trim(), secret: pairForm.secret.trim(),
              }, () => setPairForm({ deviceId: '', secret: '' })),
            }, React.createElement(KeyGlyph, { size: 12 }), '配对')),
        ),
        (s && s.pairs && s.pairs.length > 0)
          ? React.createElement('div', {},
            s.pairs.map((p: any) =>
              React.createElement('div', { key: p.deviceId, className: 'dshcc-row' },
                React.createElement('div', { className: 'dshcc-peer-name dshcc-mono' }, p.deviceId.slice(0, 14)),
                React.createElement('button', {
                  className: 'dshcc-btn dshcc-btn-danger',
                  onClick: () => doApi('/dshcc/api/unpair', { deviceId: p.deviceId }),
                }, React.createElement(XGlyph, { size: 12 }), '取消配对'))))
          : null,
      ),
    );
  }

  // ---------------- styles (mount once) ----------------
  const stylesDisposer = mountStyles();
  if (stylesDisposer) ctx.effect(() => stylesDisposer);

  // ---------------- settings page: "settings.section" slot ----------------
  // Same mechanism as dsh-notifacation-frame: lazy slot registration with a
  // label + component; the settings shell renders us inside the settings page.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-cross-collaboration',
    order: 80,
    label: () => 'LAN 协作',
  }, (props: any) => {
    return React.createElement(MainPanel, {
      onClose: props && typeof props.close === 'function' ? props.close : undefined,
    });
  }));

  // ---------------- vscode-sidebar tab ----------------
  // Entries activate concurrently, so the sidebar service may appear after
  // this plugin: bounded retry (20 × 1.5s), then give up gracefully.
  let sidebarRegistered = false;
  let sidebarRetries = 0;
  const sidebarTimers = new Set<() => void>();
  function tryRegisterSidebarTab(): void {
    if (sidebarRegistered) return;
    const vscodeSidebar = ctx.get('vscodeSidebar') as any;
    if (vscodeSidebar && typeof vscodeSidebar.registerTab === 'function') {
      try {
        const tabDisposer = vscodeSidebar.registerTab({
          id: 'lan-collaboration',
          title: 'LAN 协作',
          icon: React.createElement(LanGlyph, { size: 15 }),
          single: true,
          component: (tabProps: any) => {
            // Inline-styled scroll container: the sidebar pane clips overflow
            // and gives us a flex column with a computed height — this wrapper
            // fills it and scrolls, independent of the injected stylesheet.
            return React.createElement('div', {
              style: {
                display: 'flex',
                flexDirection: 'column',
                flex: '1 1 auto',
                minHeight: 0,
                minWidth: 0,
                overflowY: 'auto',
                scrollbarWidth: 'thin',
              },
            }, React.createElement(MainPanel, { onClose: undefined }));
          },
        });
        ctx.effect(() => tabDisposer);
        sidebarRegistered = true;
        console.log('dshcc: vscode-sidebar tab registered');
      } catch (err) {
        console.error('dshcc: vscodeSidebar registerTab failed:', String((err as Error) && (err as Error).message));
      }
    } else if (sidebarRetries < 20) {
      sidebarRetries++;
      const timer = ctx.setTimeout(() => { sidebarTimers.delete(timer); tryRegisterSidebarTab(); }, 1500);
      sidebarTimers.add(timer);
    }
  }
  tryRegisterSidebarTab();
  ctx.effect(() => () => {
    for (const t of sidebarTimers) { try { t(); } catch (e) {} }
    sidebarTimers.clear();
  });

  // ---------------- settings-nav icon swap (LAN glyph for our section) ----------------
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined;
    const NAV_LIST_SELECTOR = '[class*="navList"]';
    const NAV_ICON_SELECTOR = '[class*="navIcon"]';
    const NAV_LABEL_SELECTOR = '[class*="navLabel"]';
    const SECTION_LABEL = 'LAN 协作';
    const MARKER = 'data-dshcc-nav-icon';
    const swap = () => {
      try {
        const list = document.querySelector(NAV_LIST_SELECTOR);
        if (list === null) return;
        list.querySelectorAll('button').forEach((cell: HTMLButtonElement) => {
          const label = cell.querySelector(NAV_LABEL_SELECTOR);
          if (label === null || label.textContent !== SECTION_LABEL) return;
          const icon = cell.querySelector(NAV_ICON_SELECTOR);
          if (icon === null || icon.getAttribute(MARKER) === '1') return;
          const className = icon.getAttribute('class') ?? '';
          icon.outerHTML = LAN_SVG.replace('<svg ', '<svg ' + MARKER + '="1" class="' + className + '" ');
        });
      } catch (err) {
        console.error('dshcc: settings-nav icon swap failed:', String((err as Error) && (err as Error).message));
      }
    };
    swap();
    const observer = new MutationObserver(swap);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); };
  });
}
