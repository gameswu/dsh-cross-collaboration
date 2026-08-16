/**
 * Ambient declarations for the dynamic Cordis plugin execution environment.
 * These globals are provided by the DSH harness at runtime (Host and Client);
 * this file is the compile-time contract, derived from the Inspect catalogs.
 */

declare const console: {
  log(...values: unknown[]): void;
  error(...values: unknown[]): void;
};

/** Node child-process script only (src/ts/gateway.ts, runs as `node -e`). */
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

interface ValueSchemaBase {
  description?: string;
  title?: string;
  default?: unknown;
  examples?: unknown;
}

type ValueSchema =
  | (ValueSchemaBase & { type: 'string'; enum?: readonly string[]; const?: string })
  | (ValueSchemaBase & { type: 'number' })
  | (ValueSchemaBase & { type: 'integer' })
  | (ValueSchemaBase & { type: 'boolean' })
  | (ValueSchemaBase & { type: 'null' })
  | (ValueSchemaBase & { type: 'array'; items?: ValueSchema })
  | (ValueSchemaBase & { type: 'object'; properties?: Record<string, ValueSchema>; additionalProperties?: boolean })
  | (ValueSchemaBase & { type: 'json' })
  | (ValueSchemaBase & { oneOf: readonly ValueSchema[] });

interface ParameterSchema {
  type?: 'object';
  properties?: Record<string, ValueSchema>;
  /** raw object root: array of declared property names */
  required?: readonly string[];
  additionalProperties?: boolean;
}

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
  stdin?: { writable: boolean; write(data: string): void };
  stdout?: {
    setEncoding(enc: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  stderr?: {
    setEncoding(enc: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
  };
  done: Promise<SubprocessOutcome>;
  terminate(): void;
}

interface SubprocessService {
  resolveExecutable(command: string): Promise<string>;
  spawn(spec: {
    argv: readonly string[];
    cwd: string;
    stdio: {
      stdin: 'ignore' | 'pipe' | { data: string };
      stdout: 'pipe' | 'inherit' | { maxBytes: number };
      stderr: 'pipe' | 'inherit' | { maxBytes: number };
    };
    graceMs: number;
  }): SubprocessHandle;
}

interface FsService {
  resolve(path: string, opts?: { cwd?: string }): Promise<unknown>;
  readText(target: unknown): Promise<string>;
}

interface SandboxPolicyService {
  workspaceRoot?: string;
}

interface RemoteAgent {
  id: string;
  options?: { provider?: string; model?: string };
  followup(message: unknown): void;
  whenIdle(): Promise<void>;
}

interface AgentHandle {
  agent: RemoteAgent;
  dispose(): Promise<void>;
}

interface AgentsService {
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

interface SessionQueryService {
  readSession(sessionId: string): Promise<{ events: Array<Record<string, any>> }>;
}

interface SubagentsService {
  registerProvider(provider: unknown): () => void;
}

interface WorkspaceRegistryService {
  list(): Promise<Array<{ path?: string }>>;
}

interface AgentDefaultModelService {
  currentSelection(): { provider?: string; model?: string } | undefined;
}

interface SystemPromptService {
  section(section: { name: string; order: number; text: string }): () => void;
  variable(name: string, provider: (context: any) => string | undefined): () => void;
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
