/**
 * Ambient declarations for the dynamic Cordis plugin execution environment.
 * These globals are provided by the DSH harness at runtime (Host and Client);
 * this file is the compile-time contract, derived from the Inspect catalogs.
 *
 * Updated for DSH 0.1.2-alpha.5 (keeping the 0.1.2-alpha.2 migration;
 * alpha.3–alpha.5 left the host tool/settings/subprocess surfaces used here
 * unchanged — the Session.events removal does not affect this plugin):
 *  - model tools: the host registers explicit root JSON Schemas through
 *    ctx.tools.register (the raw path; not the defineTool property-map sugar)
 *  - service faces below alias the real alpha.5 classes; the compile-time
 *    fixture tests/contract-types.ts asserts every augmentation is present
 *  - ctx.agents: roots()/get() return live Agents carrying `id` (the
 *    session id) and `session` (dsh-session Session) — no `sessionId` field
 *  - session creation metadata lives on `session.header.cwd`, not
 *    `session.meta.cwd`
 *  - ctx.workspaceRegistry.list() is synchronous; resolveByPath() resolves a
 *    Workspace whose `title`/`path` are the display facts
 *  - subprocess collect-mode ({maxBytes}) streams are exposed as
 *    offset-based readers on `handle.collected`, NOT as raw streams —
 *    raw `stderr` exists only for `stderr: 'pipe'`
 *  - ctx.webRuntime is gone: the host webserver has no origin policy of its
 *    own and each route owner enforces its own
 *  - ctx.settings.register(namespace, schema) → SettingsScope with
 *    get()/watch()/update() (update is async); namespaces are plain
 *    lowercase-hyphenated literals (the settingsNamespace() helper is gone)
 *  - browser kernel: `slots` service is provided by dsh-client-ui-renderer,
 *    `timer` by dsh-cordis-client-runner (ClientTimerService)
 */

declare const ctx: {
  get(name: string): unknown;
  on(name: string, listener: (...args: any[]) => unknown): () => void;
  effect(callback: () => void | (() => void), label?: string): () => void;
  /** timer mixin (requires inject: ['timer']) */
  timeout(delay: number): Promise<void>;
  timeout(callback: () => void, delay: number): () => void;
  interval(callback: () => void, delay: number): () => void;
};

/* ---------------- Host service surfaces used by this plugin ---------------- */

type SubprocessOutcome = import('@deepseek-ai/dsh-subprocess').SubprocessOutcome;
type SubprocessHandle = import('@deepseek-ai/dsh-subprocess').SubprocessHandle;
type SubprocessService = import('@deepseek-ai/dsh-subprocess').SubprocessRuntime;

type FsService = import('@deepseek-ai/dsh-fs').FileSystem;
type SandboxPolicyService = import('@deepseek-ai/dsh-sandbox-policy').SandboxPolicyService;

type LiveAgent = import('@deepseek-ai/dsh-agent').Agent;
type AgentsService = import('@deepseek-ai/dsh-agent').AgentRegistry;
type SessionsService = import('@deepseek-ai/dsh-session').SessionStore;
type SettingsService = import('@deepseek-ai/dsh-settings').SettingsProvider;
type ToolsService = import('@deepseek-ai/dsh-tools').ToolRuntime;
type WebServerService = import('@deepseek-ai/dsh-host-webserver').WebServer;

type WorkspaceRegistryService = import('@deepseek-ai/dsh-workspace').WorkspaceRegistry;

interface NotificationFrameService {
  register(definition: {
    id: string;
    title: string;
    description: string;
    severity: 'info' | 'success' | 'warning' | 'error';
    channels: string[];
    defaultChannels: string[];
    setup(env: {
      notify(payload: { title: string; body?: string; severity?: string }): void;
      config: Record<string, unknown>;
    }): void | (() => void);
  }): () => void;
}

/* ---------------- optional client-side third-party services ---------------- */

interface VscodeSidebarService {
  registerTab(descriptor: {
    id: string;
    title: string | (() => string);
    icon?: unknown | ((size: number) => unknown);
    single?: boolean;
    order?: number;
    component: (props: any) => unknown;
  }): () => void;
}
