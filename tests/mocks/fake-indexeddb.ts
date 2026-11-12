// Hand-written minimal IndexedDB fake for the vault registry/service tests
// (A2). No external dependency (kickoff rule: no new npm packages).
//
// FIDELITY BOUNDARY — read before trusting a green test:
//   - Single shared state per database NAME: multiple "connections" (what the
//     cross-instance "two tabs" tests open) see the same data, but no
//     versionchange/blocked negotiation is simulated — re-opening with the
//     same version just succeeds.
//   - Transactions are queued FIFO per database and activated one at a time,
//     approximating IDB's per-store writer serialization. Requests submitted
//     to a not-yet-activated transaction are deferred until activation, so a
//     check-then-act inside ONE transaction cannot interleave with another
//     transaction's writes IN THIS FAKE. Real cross-connection guarantees are
//     NOT proven here.
//   - Auto-commit approximation: when the last pending request of an active
//     transaction is delivered and no new request is submitted before the next
//     macrotask, the transaction completes. (Real IDB commits at the end of
//     the task; the macrotask grace keeps `await req; store.put(...)` patterns
//     alive while still committing transactions that go quiet.)
//   - Values are deep-cloned on put AND on get (JSON clone) — mirroring IDB
//     structured clone for the plain-JSON rows the registry stores, so
//     mutating a returned record never corrupts stored state.
//   - Not implemented: abort ROLLBACK (abort() fires onabort but keeps any
//     writes already applied — the abort() CALL itself is observable via the
//     handle's abortCount() so tests can still lock the "was aborted"
//     behavior; what the rollback would have undone is real-IDB territory),
//     IDBKeyRange, cursors, indexes, real version upgrades with data
//     migration, durable-storage/quirks of real browsers.
// Real multi-tab browser semantics (versionchange, true cross-connection
// serialization) are covered by the service's hard line (every operation
// re-reads the registry before trusting a session) and by later e2e tests.

type FakeKey = string | number;

interface FakeEvent<TTarget> {
  target: TTarget;
  type: 'success' | 'error' | 'upgradeneeded';
  oldVersion?: number;
}

interface FakeStoreDef {
  keyPath: string | undefined;
}

interface FakeDbState {
  version: number;
  upgrading: boolean;
  defs: Map<string, FakeStoreDef>;
  data: Map<string, Map<FakeKey, unknown>>;
  tail: Promise<void>;
}

function deepClone<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeIDBRequest<T = unknown> {
  result: T = undefined as unknown as T;
  error: Error | null = null;
  readyState: 'pending' | 'done' = 'pending';
  source: FakeObjectStore | null = null;
  transaction: FakeIDBTransaction | null = null;
  onsuccess: ((event: FakeEvent<FakeIDBRequest<T>>) => void) | null = null;
  onerror: ((event: FakeEvent<FakeIDBRequest<T>>) => void) | null = null;
  onupgradeneeded: ((event: FakeEvent<FakeIDBRequest<T>>) => void) | null = null;
  onblocked: (() => void) | null = null;
  onSettled: (() => void) | null = null;

  fulfill(result: T): void {
    this.result = result;
    this.readyState = 'done';
    queueMicrotask(() => {
      try {
        this.onsuccess?.({ target: this, type: 'success' });
      } finally {
        this.onSettled?.();
      }
    });
  }

  fail(error: Error): void {
    this.error = error;
    this.readyState = 'done';
    queueMicrotask(() => {
      try {
        this.onerror?.({ target: this, type: 'error' });
      } finally {
        this.onSettled?.();
      }
    });
  }
}

class FakeIDBTransaction {
  readonly db: FakeIDBDatabase;
  readonly mode: 'readonly' | 'readwrite' | 'versionchange';
  oncomplete: (() => void) | null = null;
  onerror: ((event: { target: FakeIDBTransaction }) => void) | null = null;
  onabort: (() => void) | null = null;

  private readonly storeNames: string[];
  private active = false;
  private finished = false;
  private pending = 0;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedOps: Array<{ request: FakeIDBRequest; run: () => void }> = [];
  private whenFinished: (() => void) | null = null;

  constructor(db: FakeIDBDatabase, storeNames: string[], mode: 'readonly' | 'readwrite' | 'versionchange') {
    this.db = db;
    this.storeNames = storeNames;
    this.mode = mode;
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.storeNames.includes(name)) {
      throw new Error(`InvalidAccessError: store "${name}" is not in this transaction`);
    }
    return new FakeObjectStore(this, this.db.state, name);
  }

  abort(): void {
    if (this.finished) return;
    abortedTransactions += 1; // observable for "was aborted" regression tests
    this.finished = true;
    this.active = false;
    queueMicrotask(() => {
      this.onabort?.();
      this.whenFinished?.();
    });
  }

  /** Internal: register the tx in its queue slot and start it. */
  _begin(resolveWhenFinished: () => void): void {
    this.whenFinished = resolveWhenFinished;
    this._activate();
  }

  private _activate(): void {
    if (this.finished) {
      this.whenFinished?.();
      return;
    }
    this.active = true;
    const ops = this.queuedOps;
    this.queuedOps = [];
    for (const op of ops) {
      this._run(op.request, op.run);
    }
    if (this.pending === 0) {
      this._scheduleCompletion();
    }
  }

  /** Internal: submit a request's work into this transaction. */
  _submit(request: FakeIDBRequest, run: () => void): void {
    if (this.finished) {
      throw new Error('TransactionInactiveError: the transaction has already completed');
    }
    if (!this.active) {
      this.queuedOps.push({ request, run });
      return;
    }
    this._cancelCompletion();
    this._run(request, run);
    // A synchronous burst of requests keeps the tx alive until all settle.
  }

  private _run(request: FakeIDBRequest, run: () => void): void {
    this.pending += 1;
    request.onSettled = () => {
      this.pending -= 1;
      if (this.pending === 0 && this.active) {
        this._scheduleCompletion();
      }
    };
    try {
      run();
    } catch (error) {
      request.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private _scheduleCompletion(): void {
    if (this.completionTimer !== null || !this.active || this.finished) return;
    this.completionTimer = setTimeout(() => {
      this.completionTimer = null;
      if (this.pending > 0) {
        this._scheduleCompletion();
        return;
      }
      this._finish('complete');
    }, 0);
  }

  private _cancelCompletion(): void {
    if (this.completionTimer !== null) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
  }

  private _finish(kind: 'complete' | 'error'): void {
    this.finished = true;
    this.active = false;
    this._cancelCompletion();
    if (kind === 'complete') {
      this.oncomplete?.();
    } else {
      this.onerror?.({ target: this });
    }
    this.whenFinished?.();
  }
}

class FakeObjectStore {
  readonly name: string;
  private readonly tx: FakeIDBTransaction;
  private readonly state: FakeDbState;
  private readonly def: FakeStoreDef;

  constructor(tx: FakeIDBTransaction, state: FakeDbState, name: string) {
    this.tx = tx;
    this.state = state;
    this.name = name;
    const def = state.defs.get(name);
    if (!def) {
      throw new Error(`NotFoundError: no such object store "${name}"`);
    }
    this.def = def;
  }

  get keyPath(): string | null {
    return this.def.keyPath ?? null;
  }

  private data(): Map<FakeKey, unknown> {
    return this.state.data.get(this.name) ?? new Map<FakeKey, unknown>();
  }

  get(key: FakeKey): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.tx._submit(request, () => {
      const value = this.data().get(key);
      request.fulfill(value === undefined ? null : deepClone(value));
    });
    return request;
  }

  getAll(): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.tx._submit(request, () => {
      request.fulfill(deepClone([...this.data().values()]));
    });
    return request;
  }

  /**
   * Primary keys in the same order as getAll() (both read the same Map,
   * mirroring real IDB's index-aligned getAll/getAllKeys contract; the
   * registry's invalid-record scan relies on that alignment).
   */
  getAllKeys(): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.tx._submit(request, () => {
      request.fulfill([...this.data().keys()]);
    });
    return request;
  }

  put(value: unknown, key?: FakeKey): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.tx._submit(request, () => {
      let effectiveKey: FakeKey;
      if (this.def.keyPath !== undefined) {
        const recordKey = (value as Record<string, unknown>)[this.def.keyPath];
        if (typeof recordKey !== 'string' && typeof recordKey !== 'number') {
          throw new Error('DataError: in-line key could not be derived from the keyPath');
        }
        effectiveKey = recordKey;
      } else if (typeof key === 'string' || typeof key === 'number') {
        effectiveKey = key;
      } else {
        throw new Error('DataError: out-of-line put requires a key');
      }
      this.data().set(effectiveKey, deepClone(value));
      request.fulfill(effectiveKey);
    });
    return request;
  }

  delete(key: FakeKey): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.tx._submit(request, () => {
      this.data().delete(key);
      request.fulfill(undefined);
    });
    return request;
  }
}

class FakeIDBDatabase {
  readonly name: string;
  readonly version: number;
  readonly state: FakeDbState;
  private closed = false;

  constructor(name: string, version: number, state: FakeDbState) {
    this.name = name;
    this.version = version;
    this.state = state;
  }

  get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: (name: string) => this.state.defs.has(name) };
  }

  createObjectStore(name: string, options?: { keyPath?: string }): FakeObjectStore {
    if (!this.state.upgrading) {
      throw new Error('InvalidStateError: createObjectStore is only allowed during an upgrade');
    }
    if (this.state.defs.has(name)) {
      throw new Error(`ConstraintError: object store "${name}" already exists`);
    }
    this.state.defs.set(name, { keyPath: options?.keyPath });
    this.state.data.set(name, new Map());
    const tx = new FakeIDBTransaction(this, [name], 'versionchange');
    return new FakeObjectStore(tx, this.state, name);
  }

  transaction(
    storeNames: string | string[],
    mode?: 'readonly' | 'readwrite',
  ): FakeIDBTransaction {
    if (this.closed) {
      throw new Error('InvalidStateError: database connection is closed');
    }
    const names = typeof storeNames === 'string' ? [storeNames] : [...storeNames];
    for (const name of names) {
      if (!this.state.defs.has(name)) {
        throw new Error(`NotFoundError: no such object store "${name}"`);
      }
    }
    const tx = new FakeIDBTransaction(this, names, mode ?? 'readonly');
    const previous = this.state.tail;
    this.state.tail = previous.then(
      () =>
        new Promise<void>((resolve) => {
          tx._begin(resolve);
        }),
    );
    return tx;
  }

  close(): void {
    this.closed = true;
  }
}

const databaseStates = new Map<string, FakeDbState>();

/**
 * Total transactions aborted so far (monotonic across installs). The fake
 * does not roll back writes on abort — this counter is the observable for
 * tests that lock "the transaction WAS aborted" behavior. Read it as a
 * delta around the act under test.
 */
let abortedTransactions = 0;

function freshState(): FakeDbState {
  return {
    version: 0,
    upgrading: false,
    defs: new Map(),
    data: new Map(),
    tail: Promise.resolve(),
  };
}

class FakeIDBFactory {
  open(name: string, version?: number): FakeIDBRequest<FakeIDBDatabase> {
    const request = new FakeIDBRequest<FakeIDBDatabase>();
    setTimeout(() => {
      let state = databaseStates.get(name);
      if (!state) {
        state = freshState();
        databaseStates.set(name, state);
      }
      const requestedVersion = version ?? Math.max(1, state.version);
      if (version !== undefined && version < state.version) {
        request.fail(new Error('VersionError: requested version is lower than the existing version'));
        return;
      }
      const oldVersion = state.version;
      const needsUpgrade = requestedVersion > state.version;
      state.version = requestedVersion;
      const db = new FakeIDBDatabase(name, requestedVersion, state);
      if (needsUpgrade) {
        // The open request's result is available inside onupgradeneeded, and
        // createObjectStore is legal only for its duration — same as real IDB.
        state.upgrading = true;
        request.result = db;
        try {
          request.onupgradeneeded?.({ target: request, type: 'upgradeneeded', oldVersion });
        } finally {
          state.upgrading = false;
        }
      }
      request.fulfill(db);
    }, 0);
    return request;
  }
}

export interface FakeIndexedDBHandle {
  /**
   * Test-only: seed a row directly, bypassing the registry (used to pre-build
   * vault records from the fixed test vectors without paying PBKDF2 costs).
   * The database must already have been opened once (stores must exist).
   */
  seed(databaseName: string, storeName: string, value: unknown, key?: string | number): void;
  /** Test-only: wipe every database (open connections become stale — re-open). */
  reset(): void;
  /**
   * Test-only: number of transactions aborted so far (monotonic across
   * installs). The fake does not roll back on abort; this counter is how
   * tests assert that an abort was issued at all.
   */
  abortCount(): number;
  uninstall(): void;
}

/**
 * Install a fresh fake as the global `indexedDB` (any state left behind by a
 * previous install is dropped — uninstall followed by install never silently
 * inherits an old database). Returns a handle for seeding, resetting and
 * uninstalling (restores the original descriptor).
 */
export function installFakeIndexedDB(): FakeIndexedDBHandle {
  databaseStates.clear();
  const factory = new FakeIDBFactory();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {
    value: factory,
    writable: true,
    configurable: true,
  });
  return {
    seed(databaseName, storeName, value, key) {
      const state = databaseStates.get(databaseName);
      if (!state) {
        throw new Error(`fake indexeddb: database "${databaseName}" has not been opened yet`);
      }
      const def = state.defs.get(storeName);
      if (!def) {
        throw new Error(`fake indexeddb: store "${storeName}" does not exist`);
      }
      let effectiveKey = key;
      if (def.keyPath !== undefined) {
        const recordKey = (value as Record<string, unknown>)[def.keyPath];
        if (typeof recordKey !== 'string' && typeof recordKey !== 'number') {
          throw new Error('fake indexeddb: seeded row is missing its in-line key');
        }
        effectiveKey = recordKey;
      }
      if (effectiveKey === undefined) {
        throw new Error('fake indexeddb: seed requires a key for out-of-line stores');
      }
      state.data.get(storeName)?.set(effectiveKey, deepClone(value));
    },
    reset() {
      databaseStates.clear();
    },
    abortCount() {
      return abortedTransactions;
    },
    uninstall() {
      if (original) {
        Object.defineProperty(globalThis, 'indexedDB', original);
      } else {
        delete (globalThis as { indexedDB?: unknown }).indexedDB;
      }
    },
  };
}
