// A small stand-in for Cloudflare D1 (prepare/bind/first/all/run/batch) on node:sqlite, for the server tests.
const {DatabaseSync} = require('node:sqlite');

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  _stmt() { return this.db.sqlite.prepare(this.sql); }
  async first() { return this._stmt().get(...this.args) ?? null; }
  async all() { return {results: this._stmt().all(...this.args)}; }
  async run() { const r = this._stmt().run(...this.args); return {meta: {changes: r.changes}}; }
  _exec() { return /\bRETURNING\b|^\s*SELECT/i.test(this.sql) ? {results: this._stmt().all(...this.args)} : (this._stmt().run(...this.args), {results: []}); }
}

class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const out = statements.map(s => s._exec()); this.sqlite.exec('COMMIT'); return out; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
module.exports = {D1};
