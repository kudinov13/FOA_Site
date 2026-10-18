/* FOA — клиент API проектов (SQLite на сервере). */

const FOAStore = {
  _cache: null,

  async all() {
    if (!this._cache) {
      const r = await fetch('/api/projects');
      this._cache = await r.json();
    }
    return this._cache;
  },

  async get(id) {
    const list = await this.all();
    return list.find(p => p.id === id) || null;
  },

  invalidate() { this._cache = null; }
};
