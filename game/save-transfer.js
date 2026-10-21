/* User-triggered, offline save-file codec. It never reads or writes storage.
 * Browser: window.SideviewTransfer; Node: require('./save-transfer.js').
 * parse(text, {now}) -> {save, source:'transfer'|'legacy', exportedAt:number|null}
 * create(SaveStoreSnapshot, {now}) -> portable JSON text. Both throw a
 * TransferError with a fixed Thai message and machine-readable .code.
 * The UI must await saves.initialize(), confirm replacement, recheck state,
 * then replace energy/progress/roster inside saves.mutate(). The file's local
 * revision is never exported or returned, so the store assigns its next revision.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SideviewTransfer = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_BYTES = 64 * 1024;
  const FORMAT = 'little-rescue-save', FORMAT_VERSION = 1;
  const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const messages = {
    INPUT_TYPE: 'โปรดเลือกไฟล์เซฟ JSON ที่เป็นข้อความ',
    TOO_LARGE: 'ไฟล์เซฟมีขนาดเกิน 64 KiB',
    INVALID_JSON: 'อ่านไฟล์เซฟไม่ได้ โปรดใช้ไฟล์ JSON ที่สมบูรณ์',
    UNSAFE_KEY: 'ไฟล์เซฟมีชื่อข้อมูลที่ไม่อนุญาต',
    INVALID_STRUCTURE: 'โครงสร้างไฟล์เซฟไม่ถูกต้อง',
    UNEXPECTED_KEY: 'ไฟล์เซฟมีข้อมูลที่ไม่รองรับ',
    MISSING_FIELD: 'ไฟล์เซฟมีข้อมูลไม่ครบ',
    UNSUPPORTED_FORMAT: 'ไฟล์นี้ไม่ใช่ไฟล์เซฟ Little Rescue ที่รองรับ',
    UNSUPPORTED_VERSION: 'รุ่นของไฟล์เซฟนี้ยังไม่รองรับ',
    INVALID_NUMBER: 'ค่าตัวเลขในไฟล์เซฟไม่ถูกต้อง',
    INVALID_TIME: 'เวลาในไฟล์เซฟไม่ถูกต้อง หรืออยู่ในอนาคต',
    INVALID_ENERGY: 'คุกกี้ดาวในไฟล์เซฟต้องเป็นจำนวนเต็ม 0 ถึง 30',
    INVALID_PROGRESS: 'ข้อมูลเหรียญหรือเพื่อนที่ช่วยไม่ถูกต้อง',
    INVALID_ROSTER: 'ทีมในไฟล์เซฟต้องมีสมาชิกที่ไม่ซ้ำกัน 1 ถึง 5 ตัว'
  };

  class TransferError extends Error {
    constructor(code) {
      const safeCode = typeof code === 'string' && own(messages, code) ? code : 'INVALID_STRUCTURE';
      super(messages[safeCode]);
      this.name = 'TransferError';
      this.code = safeCode;
    }
  }
  const fail = code => { throw new TransferError(code); };
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  function clock(options) {
    const now = options && own(options, 'now') ? options.now : Date.now();
    if (!Number.isSafeInteger(now) || now < 0) fail('INVALID_TIME');
    return now;
  }

  // Count UTF-8 bytes without depending on TextEncoder/Buffer or loading a library.
  // Unpaired UTF-16 surrogates count as the 3-byte replacement character, as in UTF-8 encoding.
  function byteLength(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const n = text.charCodeAt(i);
      if (n < 0x80) bytes++;
      else if (n < 0x800) bytes += 2;
      else if (n >= 0xd800 && n <= 0xdbff && i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
      if (bytes > MAX_BYTES) return bytes;
    }
    return bytes;
  }

  function graph(value) {
    const stack = [{value, depth: 0}], seen = new Set();
    while (stack.length) {
      const item = stack.pop(), node = item.value;
      if (item.depth > 12) fail('INVALID_STRUCTURE');
      if (node === null || typeof node === 'string' || typeof node === 'boolean') continue;
      if (typeof node === 'number') { if (!Number.isFinite(node)) fail('INVALID_NUMBER'); continue; }
      if (typeof node !== 'object' || seen.has(node)) fail('INVALID_STRUCTURE');
      seen.add(node);
      const array = Array.isArray(node);
      if (!(array ? Object.getPrototypeOf(node) === Array.prototype : plain(node))) fail('INVALID_STRUCTURE');
      const descriptors = Object.getOwnPropertyDescriptors(node);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') fail('UNEXPECTED_KEY');
        if (UNSAFE_KEYS.has(key)) fail('UNSAFE_KEY');
        const descriptor = descriptors[key];
        if (!own(descriptor, 'value') || (!descriptor.enumerable && !(array && key === 'length'))) fail('INVALID_STRUCTURE');
        if (!(array && key === 'length')) stack.push({value: descriptor.value, depth: item.depth + 1});
      }
    }
  }

  function keys(value, required, optional = []) {
    if (!plain(value)) fail('INVALID_STRUCTURE');
    const allowed = new Set([...required, ...optional]);
    if (Object.keys(value).some(key => !allowed.has(key))) fail('UNEXPECTED_KEY');
    if (required.some(key => !own(value, key))) fail('MISSING_FIELD');
  }

  function timestamp(value, now) {
    if (!Number.isSafeInteger(value) || value < 0 || value > now) fail('INVALID_TIME');
    return value === 0 ? 0 : value;
  }

  function saveData(value, now, legacy) {
    keys(value, ['version', 'energy', 'progress', 'roster'], legacy ? ['revision'] : []);
    if (!(value.version === 2 || (legacy && value.version === 1))) fail('UNSUPPORTED_VERSION');
    if (own(value, 'revision') && (!Number.isSafeInteger(value.revision) || value.revision < 0)) fail('INVALID_NUMBER');
    keys(value.energy, ['value', 'anchor']);
    if (!Number.isSafeInteger(value.energy.value) || value.energy.value < 0 || value.energy.value > 30) fail('INVALID_ENERGY');
    const anchor = timestamp(value.energy.anchor, now);
    keys(value.progress, ['coins', 'rescued']);
    if (!Number.isSafeInteger(value.progress.coins) || value.progress.coins < 0 || value.progress.coins > 1000000000 ||
        typeof value.progress.rescued !== 'boolean') fail('INVALID_PROGRESS');
    if (!Array.isArray(value.roster) || value.roster.length < 1 || value.roster.length > 5 ||
        !Array.from(value.roster).every(n => Number.isInteger(n) && n >= 0 && n < 5) ||
        new Set(value.roster).size !== value.roster.length ||
        Object.keys(value.roster).length !== value.roster.length) fail('INVALID_ROSTER');
    return {version: 2,
      energy: {value: value.energy.value === 0 ? 0 : value.energy.value, anchor},
      progress: {coins: value.progress.coins === 0 ? 0 : value.progress.coins, rescued: value.progress.rescued},
      roster: value.roster.map(n => n === 0 ? 0 : n)};
  }

  function guarded(callback) {
    try { return callback(); }
    catch (error) { if (error instanceof TransferError) throw error; throw new TransferError('INVALID_STRUCTURE'); }
  }

  function parse(text, options) {
    return guarded(() => {
      if (typeof text !== 'string') fail('INPUT_TYPE');
      if (byteLength(text) > MAX_BYTES) fail('TOO_LARGE');
      const now = clock(options);
      // Windows text editors may prepend a UTF-8 BOM; it still counts toward the limit.
      const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
      let value;
      try { value = JSON.parse(source); } catch (_) { fail('INVALID_JSON'); }
      graph(value);
      if (!plain(value)) fail('INVALID_STRUCTURE');
      const transfer = ['format', 'formatVersion', 'exportedAt', 'save'].some(key => own(value, key));
      if (transfer) {
        keys(value, ['format', 'formatVersion', 'exportedAt', 'save']);
        if (value.format !== FORMAT) fail('UNSUPPORTED_FORMAT');
        if (value.formatVersion !== FORMAT_VERSION) fail('UNSUPPORTED_VERSION');
        const exportedAt = timestamp(value.exportedAt, now);
        return {save: saveData(value.save, now, false), source: 'transfer', exportedAt};
      }
      // Raw v1/v2 envelopes are accepted solely through this explicit file parser.
      return {save: saveData(value, now, true), source: 'legacy', exportedAt: null};
    });
  }

  function create(snapshot, options) {
    return guarded(() => {
      const now = clock(options);
      graph(snapshot);
      const save = saveData(snapshot, now, true);
      const text = JSON.stringify({format: FORMAT, formatVersion: FORMAT_VERSION, exportedAt: now, save}, null, 2) + '\n';
      if (byteLength(text) > MAX_BYTES) fail('TOO_LARGE');
      return text;
    });
  }

  function canImport(state, claimed = false) {
    return state === 'ready' || state === 'lost' || (state === 'won' && claimed === true);
  }

  return {parse, create, canImport, TransferError, MAX_BYTES, FORMAT, FORMAT_VERSION};
}));
