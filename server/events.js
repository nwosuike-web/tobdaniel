/**
 * Real-time fan-out hub using Server-Sent Events (SSE).
 * Public entities broadcast to everyone; private entities (cart, notifications)
 * are pushed only to the matching client channel.
 */
const clients = new Map(); // channel -> Set<res>

function subscribe(channel, res) {
  if (!clients.has(channel)) clients.set(channel, new Set());
  clients.get(channel).add(res);
}

function unsubscribe(channel, res) {
  const set = clients.get(channel);
  if (set) set.delete(res);
}

function publish(channel, data) {
  const set = clients.get(channel);
  if (!set || set.size === 0) return;
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* ignore */ }
  }
}

/** Convenience: notify the DB layer that a domain entity changed. */
function emitChange(channel, data) {
  publish(channel, { t: Date.now(), ...(data || {}) });
}

// Heartbeat so proxies don't close idle connections.
setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) {
      try { res.write(':ping\n\n'); } catch { /* ignore */ }
    }
  }
}, 25000).unref();

module.exports = { subscribe, unsubscribe, publish, emitChange };
