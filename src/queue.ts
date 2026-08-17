// Offline-message queue: pure logic, no DSH/network dependencies.
// Unit-tested by scripts/queue-mock.cjs (node --test, fully offline).

export interface QueueItem {
  id: string;
  deviceId: string;
  sessionId?: string;
  content: string;
  at: number;
}

export const QUEUE_CAP = 50;

/** Append, or replace in place by id (keeps queue position); drop the oldest items beyond the cap. */
export function enqueueItem(list: QueueItem[], item: QueueItem, cap: number = QUEUE_CAP): QueueItem[] {
  const idx = list.findIndex((q) => q.id === item.id);
  const next = list.slice();
  if (idx >= 0) next[idx] = item;
  else next.push(item);
  while (next.length > cap) next.shift();
  return next;
}

export function removeItem(list: QueueItem[], id: string): QueueItem[] {
  return list.filter((q) => q.id !== id);
}

/** FIFO items addressed to one device, preserving enqueue order. */
export function itemsFor(list: QueueItem[], deviceId: string): QueueItem[] {
  return list.filter((q) => q.deviceId === deviceId);
}

export type FlushSendResult = 'delivered' | 'unreachable' | 'session-gone';

/**
 * Flush one device's queue through an injected send function:
 * - 'delivered'    -> drop the item and continue with the next
 * - 'session-gone' -> drop the item (target session closed) and continue
 * - 'unreachable'  -> stop; this and the remaining items stay queued
 * Order of the untouched items is preserved; items for other devices are
 * never touched.
 */
export async function flushDevice(
  list: QueueItem[],
  deviceId: string,
  send: (item: QueueItem) => Promise<FlushSendResult>,
): Promise<{ remaining: QueueItem[]; delivered: QueueItem[]; dropped: QueueItem[] }> {
  const pending = itemsFor(list, deviceId);
  if (pending.length === 0) return { remaining: list, delivered: [], dropped: [] };
  const delivered: QueueItem[] = [];
  const dropped: QueueItem[] = [];
  for (const item of pending) {
    const result = await send(item);
    if (result === 'delivered') delivered.push(item);
    else if (result === 'session-gone') dropped.push(item);
    else break; // unreachable: keep this and everything after it
  }
  const goneIds = new Set<string>();
  for (const q of delivered) goneIds.add(q.id);
  for (const q of dropped) goneIds.add(q.id);
  const remaining = list.filter((q) => !goneIds.has(q.id));
  return { remaining, delivered, dropped };
}
