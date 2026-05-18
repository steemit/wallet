export interface SteemHistoryItem {
  op: [string, Record<string, unknown>];
  timestamp: string;
  block: number;
  trx_id: string;
  /** Account history index (when known); required for older-than pagination. */
  index?: number;
}

type RawHistoryTuple = [
  unknown,
  { op: SteemHistoryItem['op']; timestamp: string; block: number; trx_id: string },
];

/** Normalize API history entries (tuple or flat object) to a single shape. */
export function normalizeSteemHistoryEntry(item: unknown): SteemHistoryItem | null {
  if (typeof item !== 'object' || item === null) return null;

  if ('op' in item && Array.isArray((item as SteemHistoryItem).op)) {
    const flat = item as SteemHistoryItem;
    if (!flat.timestamp) return null;
    return flat;
  }

  const tuple = item as RawHistoryTuple;
  const entry = tuple[1];
  if (!entry?.op || !entry.timestamp) return null;

  const rawIndex = tuple[0];
  const index = typeof rawIndex === 'number' ? rawIndex : undefined;

  return {
    op: entry.op,
    timestamp: entry.timestamp,
    block: entry.block,
    trx_id: entry.trx_id,
    ...(index !== undefined ? { index } : {}),
  };
}

export function normalizeSteemHistoryList(history: unknown[]): SteemHistoryItem[] {
  const out: SteemHistoryItem[] = [];
  for (const item of history) {
    const normalized = normalizeSteemHistoryEntry(item);
    if (normalized) out.push(normalized);
  }
  return out;
}
