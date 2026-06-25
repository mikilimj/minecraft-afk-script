class MicrosoftAuthQueue {
  constructor({ broadcastActive = () => {}, onSkip = () => {} } = {}) {
    this._broadcastActive = broadcastActive;
    this._onSkip = onSkip;
    this._queue = [];        // [{ accountId, name, verification_uri, user_code }]
    this._activeId = null;
  }

  get activeId() { return this._activeId; }

  request(accountId, name, msaData) {
    if (this._queue.some((e) => e.accountId === accountId) || this._activeId === accountId) return;
    this._queue.push({ accountId, name, ...msaData });
    if (!this._activeId) this._activate();
  }

  _activate() {
    const next = this._queue.shift() || null;
    this._activeId = next ? next.accountId : null;
    this._broadcastActive(next);
  }

  complete(accountId) {
    if (this._activeId === accountId) this._activate();
    else this._queue = this._queue.filter((e) => e.accountId !== accountId);
  }

  remove(accountId) {
    if (this._activeId === accountId) this._activate();
    else this._queue = this._queue.filter((e) => e.accountId !== accountId);
  }

  skip() {
    if (!this._activeId) return;
    const skipped = this._activeId;
    this._activate();          // advance first so remove() in stop() is a no-op
    this._onSkip(skipped);   // stop() → remove() → else branch → filter (no-op)
  }
}

module.exports = { MicrosoftAuthQueue };
