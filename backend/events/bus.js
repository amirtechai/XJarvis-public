const { EventEmitter } = require('events');
const { EVENT_TYPES } = require('./types');

const VALID_EVENTS = new Set(Object.values(EVENT_TYPES));

class JarvisEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
    this.subscribers = new Map();
  }

  registerClient(ws) {
    this.subscribers.set(ws, new Set());
  }

  unregisterClient(ws) {
    this.subscribers.delete(ws);
  }

  setSubscriptions(ws, events) {
    if (!this.subscribers.has(ws)) return;
    const filtered = new Set(events.filter((e) => VALID_EVENTS.has(e) || e === '*'));
    this.subscribers.set(ws, filtered);
  }

  emit(eventType, payload = {}, source = 'system') {
    if (!VALID_EVENTS.has(eventType)) {
      console.warn(`[bus] unknown event: ${eventType}`);
      return false;
    }

    const envelope = {
      type: 'event',
      event: eventType,
      timestamp: Date.now(),
      source,
      payload,
    };

    const json = JSON.stringify(envelope);
    for (const [ws, subs] of this.subscribers) {
      if (ws.readyState !== ws.OPEN) continue;
      if (subs.has('*') || subs.has(eventType)) {
        try {
          ws.send(json);
        } catch (err) {
          console.error('[bus] send failed:', err.message);
        }
      }
    }

    super.emit(eventType, envelope);
    super.emit('*', envelope);
    return true;
  }
}

const bus = new JarvisEventBus();

module.exports = { bus, EVENT_TYPES };
