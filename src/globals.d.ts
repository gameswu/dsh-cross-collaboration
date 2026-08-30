/**
 * Ambient declarations for the dynamic Cordis plugin execution environment.
 * These globals are provided by the DSH harness at runtime (Host and Client);
 * this file is the compile-time contract, derived from the Inspect catalogs.
 *
 * Updated for DSH 0.1.2-alpha.2 (breaking-change migration):
 *  - tool schemas: `parameters` is now a per-property map DSL
 *    (requiredness per property via `required: true`), not a JSON-schema
 *    object root
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

declare const console: {
  log(...values: unknown[]): void;
  error(...values: unknown[]): void;
};

/** Node child-process script only (src/gateway.ts, runs as `node -e`). */
declare const require: (id: string) => any;
declare const process: {
  argv: string[];
  stdout: { write(data: string): void };
  stdin: { setEncoding(enc: string): void; on(event: string, listener: (chunk: string) => void): void };
  exit(code?: number): void;
};

declare const ctx: {
  get(name: string): unknown;
  on(name: string, listener: (...args: any[]) => unknown): () => void;
  effect(callback: () => void | (() => void), label?: string): () => void;
  /** timer mixin (requires inject: ['timer']) */
  timeout(delay: number): Promise<void>;
  timeout(callback: () => void, delay: number): () => void;
  interval(callback: () => void, delay: number): () => void;
};

declare const harness: {
  handle(method: string, handler: (args: any) => unknown | Promise<unknown>): void;
  defineTool(definition: ToolDefinition): ToolDefinition;
  registerTool(pluginCtx: unknown, tool: ToolDefinition): () => void;
};

declare const React: {
  createElement(type: any, props?: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T;
  createRoot(container: unknown): { render(el: unknown): void; unmount(): void };
};

declare const host: {
  call(method: string, args?: unknown): Promise<any>;
};

declare const styles: {
  insert(css: string): () => void;
};

/* ---------------- tool schema DSL (unified ValueSchemaSpec) ---------------- */

interface ValueSchemaAnnotations {
  description?: string;
  title?: string;
  default?: unknown;
  examples?: unknown;
}

type ValueSchema =
  | (ValueSchemaAnnotations & { type: 'string'; enum?: readonly string[]; const?: string })
  | (ValueSchemaAnnotations & { type: 'number' })
  | (ValueSchemaAnnotations & { type: 'integer' })
  | (ValueSchemaAnnotations & { type: 'boolean' })
  | (ValueSchemaAnnotations & { type: 'null' })
  | (ValueSchemaAnnotations & { type: 'array'; items?: ValueSchema })
  | (ValueSchemaAnnotations & { type: 'object'; properties?: ParameterSchema; additionalProperties: boolean })
  | (ValueSchemaAnnotations & { type: 'json' })
  | (ValueSchemaAnnotations & { oneOf: readonly [ValueSchema, ValueSchema, ...ValueSchema[]] });

/**
 * Tool parameter schema (DSH 0.1.2+): a per-property map over an implicit
 * open object root. Requiredness is the per-property `required: true`
 * annotation — there is no top-level `required`/`additionalProperties`.
 */
type ParameterSchema = {
  [name: string]: ValueSchema & { required?: true };
};

interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

interface ToolOutputDefinition {
  schema: Record<string, unknown>;
  render(args: unknown, value: any): ContentBlock[];
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParameterSchema;
  output: ToolOutputDefinition;
  execute(args: any, exec: { signal?: { aborted: boolean } | null }): Promise<unknown>;
  timeoutMs?: number;
}

/* ---------------- Host service surfaces used by this plugin ---------------- */

interface SubprocessOutcome {
  exitCode: number | null;
  signal: string | null;
}

interface SubprocessHandle {
  stdin?: {
    writable: boolean;
    write(data: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  /** raw stream — present ONLY when spawned with stdout: 'pipe' */
  stdout?: {
    setEncoding(enc: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  /** raw stream — present ONLY when spawned with stderr: 'pipe' */
  stderr?: {
    setEncoding(enc: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  /** offset-based readers for collect-mode streams ({maxBytes}) */
  collected?: {
    stdout?: { readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string } };
    stderr?: { readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean; spillPath?: string } };
  };
  done: Promise<SubprocessOutcome>;
  terminate(): void;
  waitForExit(signal?: { aborted: boolean }): Promise<boolean>;
}

interface SubprocessService {
  resolveExecutable(command: string, env?: Record<string, string>, signal?: { aborted: boolean }): Promise<string>;
  spawn(spec: {
    argv: readonly string[];
    cwd: string;
    stdio: {
      stdin: 'ignore' | 'pipe' | { data: string };
      stdout: 'pipe' | 'inherit' | { maxBytes: number };
      stderr: 'pipe' | 'inherit' | { maxBytes: number };
    };
    graceMs: number;
    signal?: { aborted: boolean };
    env?: Record<string, string | undefined>;
  }): SubprocessHandle;
}

interface FsService {
  resolve(path: string, opts?: { cwd?: string; signal?: { aborted: boolean } }): Promise<unknown>;
  readText(target: unknown): Promise<string>;
  processPath(target: unknown): string;
}

interface SandboxPolicyService {
  workspaceRoot?: string;
}

/** DSH 0.1.2+ live Agent (dsh-agent-loop face): id IS the session id. */
interface LiveAgent {
  id: string;
  session: {
    id: string;
    header?: { cwd?: string };
  };
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
}

interface AgentHandle {
  agent: LiveAgent;
  dispose(): Promise<void>;
}

interface AgentsService {
  roots(): LiveAgent[];
  list(): LiveAgent[];
  get(sessionId: string): LiveAgent | undefined;
  create(options: {
    sessionId: string;
    meta?: {
      cwd?: string;
      origin?: 'subagent';
      parentSession?: string;
      seedLength?: number;
      delegationDepth?: number;
      agentPreset?: string;
    };
    agentOptions?: { provider?: string; model?: string };
    setup?: (agentCtx: { get(name: string): unknown }) => Promise<void>;
  }): Promise<AgentHandle>;
}

interface WorkspaceRegistryService {
  /** synchronous ordered projection (DSH 0.1.2+) */
  list(): Array<{ title?: string; path?: string }>;
  resolveByPath(path: string): Promise<{ title?: string; path?: string } | undefined>;
}

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
