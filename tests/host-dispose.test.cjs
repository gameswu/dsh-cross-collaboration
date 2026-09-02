'use strict';
// Host mount/unmount-twice disposal test (QC-012). Imports the built host
// plugin (pretest builds it), feeds a minimal fake Context, and proves tool
// and webServer registrations are removed on cleanup so HMR/reapply cannot
// accumulate duplicates.
const { test } = require('node:test');
const assert = require('node:assert/strict');

let applyHost = null;

function fakeHandle() {
  return {
    stdin: { writable: true, write() {}, on() {} },
    stdout: { setEncoding() {}, on() {} },
    stderr: { setEncoding() {}, on() {} },
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: new Promise(() => {}),
    terminate() {},
    waitForExit: async () => true,
  };
}

function makeContext() {
  const activeTools = new Set();
  const activeRoutes = new Set();
  const cleanups = [];
  const subprocess = {
    resolveExecutable: async (command) => command,
    spawn: () => fakeHandle(),
  };
  const ctx = {
    webServer: {
      register(route) {
        assert.equal(activeRoutes.has(route.path), false, 'duplicate route ' + route.path);
        activeRoutes.add(route.path);
        return () => activeRoutes.delete(route.path);
      },
    },
    get(key) {
      switch (key) {
        case 'subprocess': return subprocess;
        case 'agents': return { roots: () => [], list: () => [], get: () => undefined };
        case 'settings': return undefined;
        case 'workspaceRegistry': return { list: () => [], resolveByPath: async () => undefined };
        case 'sandboxPolicy': return { workspaceRoot: process.cwd() };
        case 'fs': return { resolve: async (p) => p, readText: async () => JSON.stringify({ version: '0.4.0' }) };
        case 'tools':
          return {
            register(definition) {
              assert.equal(activeTools.has(definition.name), false, 'duplicate tool ' + definition.name);
              activeTools.add(definition.name);
              return () => activeTools.delete(definition.name);
            },
          };
        case 'notificationFrame': return undefined;
        case 'sessionTitle': return { get: () => ({ title: 'qc' }) };
        default: return undefined;
      }
    },
    on() { return () => {}; },
    effect(effect) {
      const cleanup = effect();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return () => {};
    },
    timeout(first, second) {
      if (typeof first === 'function') return () => {};
      return Promise.resolve();
    },
    interval() { return () => {}; },
    setTimeout() { return () => {}; },
  };
  return { ctx, activeTools, activeRoutes, cleanups };
}

(async () => {
  applyHost = (await import('../dist/host.js')).apply;

  test('mount applies exact tool/route sets; unmount clears them; remount does not duplicate', () => {
    const first = makeContext();
    applyHost(first.ctx, { udpPort: 45231 });
    assert.equal(first.activeTools.size, 2, 'two lan_* tools registered');
    assert.ok(first.activeRoutes.size >= 6, 'state + fenced post routes registered');
    for (const cleanup of first.cleanups.splice(0)) cleanup();
    assert.equal(first.activeTools.size, 0, 'tools removed on unmount');
    assert.equal(first.activeRoutes.size, 0, 'routes removed on unmount');

    const second = makeContext();
    applyHost(second.ctx, { udpPort: 45231 });
    assert.deepEqual([...second.activeTools].sort(), ['lan_message', 'lan_peers']);
    assert.equal(second.activeRoutes.has('/dshcc/api/state'), true, 'state route remounted exactly once');
    for (const cleanup of second.cleanups.splice(0)) cleanup();
    assert.equal(second.activeTools.size, 0);
    assert.equal(second.activeRoutes.size, 0);
  });
})();
