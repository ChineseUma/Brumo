// Only live events notify. Reconnection snapshots and outgoing messages are ignored.
(function (root) {
  class BrumaNotices {
    constructor() { this.seen = new Set(); this.unread = new Map(); }
    receive(message, room, own, visible) {
      if (!message?.id || own || this.seen.has(message.id)) return false;
      this.seen.add(message.id);
      if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
      if (visible) return false;
      this.unread.set(room, (this.unread.get(room) || 0) + 1);
      return true;
    }
    read(room) { this.unread.delete(room); }
    reset() { this.seen.clear(); this.unread.clear(); }
    count() { return [...this.unread.values()].reduce((a,b) => a+b,0); }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {BrumaNotices};
  else root.BrumaNotices = BrumaNotices;
})(globalThis);
