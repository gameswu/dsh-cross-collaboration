'use strict';
// Offline-message queue unit tests (node --test) — fully offline, no network,
// no DSH runtime: exercises the pure queue logic in dist/queue.js only.
// Usage: pnpm run build && pnpm test
const { test } = require('node:test');
const assert = require('node:assert');

let queue = null;
(async () => {
  queue = await import('../dist/queue.js');
  run();
})();

function run() {
  const { enqueueItem, removeItem, itemsFor, flushDevice, QUEUE_CAP } = queue;

  const item = (id, deviceId, content, sessionId) => ({ id, deviceId, content, at: Date.now(), ...(sessionId ? { sessionId } : {}) });

  test('enqueue: appends, replaces in place by id, caps at QUEUE_CAP dropping oldest', () => {
    let list = [];
    list = enqueueItem(list, item('a', 'dev1', 'hello a'));
    list = enqueueItem(list, item('b', 'dev1', 'hello b'));
    assert.deepStrictEqual(list.map((q) => q.id), ['a', 'b']);
    // replace by id keeps the position, updates content
    list = enqueueItem(list, item('a', 'dev1', 'hello a v2'));
    assert.strictEqual(list.length, 2);
    assert.deepStrictEqual(list.map((q) => q.id), ['a', 'b']);
    assert.strictEqual(list[0].content, 'hello a v2');
    assert.strictEqual(list[1].content, 'hello b');
    // cap
    for (let i = 0; i < QUEUE_CAP + 5; i++) list = enqueueItem(list, item('x' + i, 'dev1', 'm'));
    assert.strictEqual(list.length, QUEUE_CAP);
    assert.strictEqual(list[list.length - 1].id, 'x' + (QUEUE_CAP + 4));
  });

  test('itemsFor: per-device FIFO order preserved', () => {
    let list = [];
    list = enqueueItem(list, item('a', 'dev1', '1'));
    list = enqueueItem(list, item('b', 'dev2', '2'));
    list = enqueueItem(list, item('c', 'dev1', '3'));
    list = enqueueItem(list, item('d', 'dev1', '4'));
    assert.deepStrictEqual(itemsFor(list, 'dev1').map((q) => q.id), ['a', 'c', 'd']);
    assert.deepStrictEqual(itemsFor(list, 'dev2').map((q) => q.id), ['b']);
    assert.deepStrictEqual(itemsFor(list, 'dev3'), []);
  });

  test('removeItem: drops by id, keeps the rest', () => {
    let list = [];
    list = enqueueItem(list, item('a', 'dev1', '1'));
    list = enqueueItem(list, item('b', 'dev1', '2'));
    list = removeItem(list, 'a');
    assert.deepStrictEqual(list.map((q) => q.id), ['b']);
    assert.deepStrictEqual(removeItem(list, 'missing'), list);
  });

  test('flushDevice: delivers all when the peer is reachable', async () => {
    let list = [];
    list = enqueueItem(list, item('a', 'dev1', '1'));
    list = enqueueItem(list, item('b', 'dev1', '2'));
    list = enqueueItem(list, item('c', 'dev2', 'other'));
    const sent = [];
    const { remaining, delivered, dropped } = await flushDevice(list, 'dev1', async (q) => {
      sent.push(q.id);
      return 'delivered';
    });
    assert.deepStrictEqual(sent, ['a', 'b']);
    assert.deepStrictEqual(delivered.map((q) => q.id), ['a', 'b']);
    assert.deepStrictEqual(dropped, []);
    assert.deepStrictEqual(remaining.map((q) => q.id), ['c']);
  });

  test('flushDevice: stops at the first unreachable, keeps the tail in order', async () => {
    let list = [];
    list = enqueueItem(list, item('a', 'dev1', '1'));
    list = enqueueItem(list, item('b', 'dev1', '2'));
    list = enqueueItem(list, item('c', 'dev1', '3'));
    list = enqueueItem(list, item('d', 'dev1', '4'));
    const { remaining, delivered, dropped } = await flushDevice(list, 'dev1', async (q) => {
      if (q.id === 'a') return 'delivered';
      if (q.id === 'b') return 'unreachable';
      throw new Error('must not send past the unreachable item');
    });
    assert.deepStrictEqual(delivered.map((q) => q.id), ['a']);
    assert.deepStrictEqual(dropped, []);
    assert.deepStrictEqual(remaining.map((q) => q.id), ['b', 'c', 'd']);
  });

  test('flushDevice: drops session-gone items and continues', async () => {
    let list = [];
    list = enqueueItem(list, item('a', 'dev1', '1', 's-dead'));
    list = enqueueItem(list, item('b', 'dev1', '2'));
    const { remaining, delivered, dropped } = await flushDevice(list, 'dev1', async (q) => {
      return q.sessionId === 's-dead' ? 'session-gone' : 'delivered';
    });
    assert.deepStrictEqual(delivered.map((q) => q.id), ['b']);
    assert.deepStrictEqual(dropped.map((q) => q.id), ['a']);
    assert.deepStrictEqual(remaining, []);
  });

  test('flushDevice: no-op for a device with no queued items', async () => {
    const list = [item('a', 'dev1', '1')];
    let called = false;
    const out = await flushDevice(list, 'dev2', async () => { called = true; return 'delivered'; });
    assert.strictEqual(called, false);
    assert.deepStrictEqual(out.remaining, list);
    assert.deepStrictEqual(out.delivered, []);
  });
}
