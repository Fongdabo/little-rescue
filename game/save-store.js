/* Offline progress store. Every durable mutation rereads under one Web Lock.
 * initialize() protects a validated legacy snapshot before UI actions begin.
 * No timer or unload handler writes stale snapshots or default progress.
 * Browser: window.SideviewSave.SaveStore; Node: require('./save-store.js').SaveStore.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.SideviewSave = factory(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DEFAULT_KEY = 'little-rescue-sideview-save-v1';
  const LEGACY_ENERGY_KEY = 'little-rescue-sideview-energy-v1';
  const MAX_ENERGY = 30, MAX_COINS = 1000000000;
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const rosterOK = value => Array.isArray(value) && value.length > 0 && value.length <= 5 &&
    Array.from(value).every(n => Number.isInteger(n) && n >= 0 && n < 5) && new Set(value).size === value.length;

  function validData(value, now) {
    if (!object(value) || !object(value.energy) || !object(value.progress) ||
        !Number.isFinite(value.energy.value) || !Number.isFinite(value.energy.anchor) ||
        value.energy.anchor < 0 || !Number.isSafeInteger(value.progress.coins) ||
        value.progress.coins < 0 || value.progress.coins > MAX_COINS ||
        typeof value.progress.rescued !== 'boolean' || !rosterOK(value.roster)) return null;
    return {
      energy: {value: Math.max(0, Math.min(MAX_ENERGY, Math.floor(value.energy.value))),
        anchor: Math.min(now, value.energy.anchor)},
      progress: {coins: value.progress.coins, rescued: value.progress.rescued},
      roster: [...value.roster]
    };
  }

  function envelope(value, now) {
    if (!object(value) || (value.version !== 1 && value.version !== 2)) return null;
    if (value.version === 2 && (!Number.isSafeInteger(value.revision) || value.revision < 0)) return null;
    const data = validData(value, now);
    return data ? {version: 2, revision: value.version === 2 ? value.revision : 0, ...data} : null;
  }

  class SaveStore {
    constructor(options = {}) {
      this.key = typeof options.key === 'string' && options.key ? options.key : DEFAULT_KEY;
      // A separate primary key isolates this build from older tabs that still
      // write their original key without participating in Web Locks.
      this.legacyKey = typeof options.legacyKey === 'string' && options.legacyKey &&
        options.legacyKey !== this.key ? options.legacyKey : null;
      this.lockName = this.key + ':write';
      this._now = typeof options.now === 'function' ? options.now : () => Date.now();
      this._listeners = new Set();
      this._queue = Promise.resolve();
      this._initialization = null;
      this._legacySnapshot = null;
      this.initialized = false;
      this._storage = null;
      this._locks = null;
      this._target = null;
      this.available = false;
      this.writable = false;
      this.reason = 'storage-unavailable';
      const now = this._time();
      const defaults = {energy: {value: MAX_ENERGY, anchor: now},
        progress: {coins: 0, rescued: false}, roster: [0, 1, 2, 3, 4]};
      const initial = object(options.initial) ? options.initial : {};
      const candidate = {
        energy: object(initial.energy) ? initial.energy : defaults.energy,
        progress: object(initial.progress) ? initial.progress : defaults.progress,
        roster: initial.roster === undefined ? defaults.roster : initial.roster
      };
      this._initial = {version: 2, revision: 0, ...(validData(candidate, now) || defaults)};
      this._session = clone(this._initial);
      try {
        this._storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : root.localStorage;
        if (!this._storage || typeof this._storage.getItem !== 'function' ||
            typeof this._storage.setItem !== 'function' || typeof this._storage.removeItem !== 'function') {
          this._storage = null;
        }
      } catch (_) { this._storage = null; }
      try { this._locks = Object.prototype.hasOwnProperty.call(options, 'locks') ? options.locks : root.navigator && root.navigator.locks; }
      catch (_) { this._locks = null; }
      try { this._target = Object.prototype.hasOwnProperty.call(options, 'eventTarget') ? options.eventTarget : root; }
      catch (_) { this._target = null; }

      if (this._storage) {
        // Probe a fresh, separate key; never replace a user save to test storage.
        const probe = this.key + ':probe:' + Math.random().toString(36).slice(2);
        try {
          this._storage.getItem(this.key);
          this._storage.setItem(probe, '1');
          this._storage.removeItem(probe);
          this.available = true;
          this.writable = !!(this._locks && typeof this._locks.request === 'function');
          this.reason = this.writable ? null : 'locks-unavailable';
          // Legacy is read once only. Old builds may still overwrite their key
          // while initialize() is waiting for this build's primary lock.
          this._session = this._load(true);
        } catch (_) { this._disable('storage-unavailable', false); }
      }
      this._onStorage = event => {
        if (!this.writable || (event && event.key !== null && event.key !== this.key &&
            !(this.key === DEFAULT_KEY && event.key === LEGACY_ENERGY_KEY))) return;
        if (event && event.storageArea && event.storageArea !== this._storage) return;
        // Event.newValue may already be stale by delivery time: read the key now.
        this._notify(this.read());
      };
      if (this._target && typeof this._target.addEventListener === 'function') {
        this._target.addEventListener('storage', this._onStorage);
      }
      // Enqueue immediately so a later-created tab cannot jump ahead merely
      // because this caller is still loading artwork before awaiting readiness.
      this.initialize();
    }

    _time() {
      let value;
      try { value = this._now(); } catch (_) { value = Date.now(); }
      return Number.isFinite(value) && value >= 0 ? value : Date.now();
    }

    _disable(reason, available = this.available) {
      this.available = available;
      this.writable = false;
      this.reason = reason;
    }

    _readPrimary() {
      try {
        const text = this._storage.getItem(this.key);
        if (text !== null) {
          const data = envelope(JSON.parse(text), this._time());
          if (!data) throw new TypeError('Invalid save schema');
          return {found: true, snapshot: data};
        }
        return {found: false};
      } catch (error) {
        this._readError(error);
        return {found: false, failed: true};
      }
    }

    _readError(error) {
      // Keep the last known good snapshot; never erase unreadable raw data.
      const schemaError = error instanceof SyntaxError || error instanceof TypeError;
      this._disable(schemaError ? 'corrupt-save' : 'storage-read-failed', schemaError ? this.available : false);
    }

    _load(includeLegacy = false) {
      const primary = this._readPrimary();
      if (primary.found) {
        this._legacySnapshot = null;
        return primary.snapshot;
      }
      if (primary.failed || !includeLegacy) return clone(this._session);
      try {
        // Import a prior full envelope only when the new primary key is absent.
        // Once committed, the primary always wins over old-tab heartbeats.
        if (this.legacyKey) {
          const previous = this._storage.getItem(this.legacyKey);
          if (previous !== null) {
            const migrated = envelope(JSON.parse(previous), this._time());
            if (!migrated) throw new TypeError('Invalid legacy save schema');
            this._legacySnapshot = clone(migrated);
            return migrated;
          }
        }
        // Old energy-only saves are migrated only when both full keys are absent.
        const legacy = this.key === DEFAULT_KEY || this.legacyKey ? this._storage.getItem(LEGACY_ENERGY_KEY) : null;
        if (legacy !== null) {
          const data = JSON.parse(legacy);
          const energy = typeof data === 'number' ? {value: data, anchor: this._time()} : data;
          const migrated = validData({energy: {...energy, anchor: energy && energy.anchor === undefined ? this._time() : energy && energy.anchor},
            progress: {coins: 0, rescued: false}, roster: [0, 1, 2, 3, 4]}, this._time());
          if (!migrated) throw new TypeError('Invalid legacy save schema');
          this._legacySnapshot = {version: 2, revision: 0, ...migrated};
          return clone(this._legacySnapshot);
        }
        return clone(this._session);
      } catch (error) {
        this._readError(error);
        return clone(this._session);
      }
    }

    read() {
      if (this.writable) this._session = this._load();
      return clone(this._session);
    }

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Save listener must be a function');
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    }

    _notify(snapshot) {
      this._listeners.forEach(listener => { try { listener(clone(snapshot)); } catch (_) { /* UI listeners cannot break saving. */ } });
    }

    _receipt(committed, snapshot = this._session) {
      const receipt = {committed, snapshot: clone(snapshot)};
      if (!committed && this.reason) receipt.reason = this.reason;
      return receipt;
    }

    initialize() {
      if (this._initialization) return this._initialization;
      // Constructor calls this before any mutation can be queued. Register the
      // primary lock now, then share its promise as the mutation queue barrier.
      // This avoids a microtask gap and an initialize/mutate self-wait cycle.
      const operation = this._initialize();
      this._initialization = operation;
      this._queue = operation.then(() => undefined, () => undefined);
      return operation;
    }

    async _initialize() {
      let entered = false;
      try {
        if (!this.writable) return this._receipt(false);
        return await this._locks.request(this.lockName, {mode: 'exclusive'}, () => {
          entered = true;
          // Only the primary is reread here. The constructor's validated legacy
          // snapshot is protected from an older tab's intervening heartbeat.
          const primary = this._readPrimary();
          if (primary.found) {
            this._session = primary.snapshot;
            this._legacySnapshot = null;
            this._notify(this._session);
            return this._receipt(false);
          }
          if (primary.failed || !this.writable || !this._legacySnapshot) return this._receipt(false);
          if (this._legacySnapshot.revision >= Number.MAX_SAFE_INTEGER) {
            this._disable('revision-exhausted');
            return this._receipt(false);
          }
          const next = {...clone(this._legacySnapshot), version: 2, revision: this._legacySnapshot.revision + 1};
          try { this._storage.setItem(this.key, JSON.stringify(next)); }
          catch (_) { this._disable('storage-write-failed', false); return this._receipt(false); }
          this._session = next;
          this._legacySnapshot = null;
          this._notify(next);
          return this._receipt(true);
        });
      } catch (_) {
        this._disable(entered ? 'initialization-failed' : 'lock-failed');
        return this._receipt(false);
      } finally { this.initialized = true; }
    }

    mutate(callback, options = {}) {
      if (typeof callback !== 'function') return Promise.reject(new TypeError('Save mutation must be a function'));
      // Imports opt into durable-only atomic replacement. Ordinary gameplay
      // keeps its existing session-only fallback when persistence is unavailable.
      const requireDurable = options.requireDurable === true;
      this.initialize();
      const operation = this._queue.then(() => this._exclusive(callback, requireDurable));
      this._queue = operation.then(() => undefined, () => undefined);
      return operation;
    }

    async _exclusive(callback, requireDurable = false) {
      if (!this.writable) return requireDurable ? this._receipt(false) : this._apply(callback, false);
      let entered = false;
      try {
        return await this._locks.request(this.lockName, {mode: 'exclusive'}, async () => {
          entered = true;
          return this._apply(callback, true, requireDurable);
        });
      } catch (error) {
        if (entered) throw error; // A thrown callback must not be retried or written.
        this._disable('lock-failed');
        return requireDurable ? this._receipt(false) : this._apply(callback, false);
      }
    }

    async _apply(callback, durable, requireDurable = false) {
      // Read a strict transaction's candidate without publishing it to the
      // session. Only a successful setItem may publish an imported snapshot.
      const latest = durable ? (requireDurable ? this._load() : this.read()) : clone(this._session);
      if (requireDurable && (!durable || !this.writable)) return this._receipt(false);
      const draft = clone(latest);
      const result = await callback(draft);
      if (result === false) {
        const receipt = {committed: false, snapshot: requireDurable ? clone(this._session) : this.read()};
        if (this.reason) receipt.reason = this.reason;
        return receipt;
      }
      const data = validData(result === undefined ? draft : result, this._time());
      if (!data) throw new TypeError('Mutation must return a valid complete save envelope, false, or undefined');
      if (latest.revision >= Number.MAX_SAFE_INTEGER) {
        this._disable('revision-exhausted');
        return {committed: false, snapshot: clone(latest), reason: this.reason};
      }
      const next = {version: 2, revision: latest.revision + 1, ...data};
      let committed = false;
      if (durable && this.writable) {
        try { this._storage.setItem(this.key, JSON.stringify(next)); committed = true; }
        catch (_) { this._disable('storage-write-failed', false); }
      }
      // A failed import must leave session data, revision and subscribers intact.
      // No session-only retry is permitted for an explicitly durable replacement.
      if (requireDurable && !committed) return this._receipt(false);
      this._session = next;
      this._notify(next);
      const receipt = {committed, snapshot: clone(next)};
      if (!committed) receipt.reason = this.reason || 'session-only';
      return receipt;
    }

    destroy() {
      if (this._target && typeof this._target.removeEventListener === 'function') {
        this._target.removeEventListener('storage', this._onStorage);
      }
      this._listeners.clear();
    }
  }

  return {SaveStore};
}));
