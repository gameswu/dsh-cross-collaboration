/**
 * Compile-time contract fixture (QC-007).
 *
 * Loads the real DSH alpha.5 Context augmentations and checks that the service
 * faces consumed by this plugin still resolve. The local aliases in
 * src/globals.d.ts point at the real exported service classes, so a source
 * change in {@link src/host.ts} or {@link src/client.ts} that relies on a
 * removed service/method fails both the normal typecheck and this fixture.
 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/cordis-plugin-timer';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-client-ui-renderer';
import type {} from '@deepseek-ai/dsh-fs';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import type {} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-settings';
import type {} from '@deepseek-ai/dsh-subprocess';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-workspace';

type Extends<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type Expect<T extends true> = T;

type AgentsContract = Expect<Extends<Context['agents'], AgentsService>>;
type SessionsContract = Expect<Extends<Context['sessions'], SessionsService>>;
type SettingsContract = Expect<Extends<Context['settings'], SettingsService>>;
type ToolsContract = Expect<Extends<Context['tools'], ToolsService>>;
type WebServerContract = Expect<Extends<Context['webServer'], WebServerService>>;
type SubprocessContract = Expect<Extends<Context['subprocess'], SubprocessService>>;
type WorkspaceContract = Expect<Extends<Context['workspaceRegistry'], WorkspaceRegistryService>>;
type FsContract = Expect<Extends<Context['fs'], FsService>>;
type SandboxContract = Expect<Extends<Context['sandboxPolicy'], SandboxPolicyService>>;

export type HostContract = [
  AgentsContract,
  SessionsContract,
  SettingsContract,
  ToolsContract,
  WebServerContract,
  SubprocessContract,
  WorkspaceContract,
  FsContract,
  SandboxContract,
];

// Keep the import of Context/each augmentation from being elided by a module
// transform; this declaration has no runtime counterpart.
declare const context: Context;
export type ContextShape = typeof context;
