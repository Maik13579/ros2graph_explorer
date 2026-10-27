const STORAGE_KEY = 'ros2graph_explorer.filters';

export function isVisible(name, rules = {}) {
  if (Object.hasOwn(rules, name)) return rules[name];
  const parts = name.split('/').filter(Boolean);
  parts.pop();
  while (parts.length) {
    const namespace = `/${parts.join('/')}/`;
    if (Object.hasOwn(rules, namespace)) return rules[namespace];
    parts.pop();
  }
  return rules['/'] ?? true;
}

export function subscribedTopics(graph) {
  const nodes = new Set(graph?.nodes || []);
  const topics = graph?.topics || {};
  return new Set((graph?.edges || [])
    .filter(edge => Object.hasOwn(topics, edge.start) && nodes.has(edge.end))
    .map(edge => edge.start));
}

export class GraphFilters {
  constructor(storage) {
    this.state = { nodes: {}, topics: {}, hideUnsubscribed: false };
    this.listeners = new Set();
    try {
      this.storage = storage === undefined ? window.localStorage : storage;
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (const kind of ['nodes', 'topics']) {
          this.state[kind] = Object.fromEntries(Object.entries(saved[kind] || {})
            .filter(([path, visible]) => path.startsWith('/') && typeof visible === 'boolean'));
        }
        this.state.hideUnsubscribed = saved.hideUnsubscribed === true;
      }
    } catch {
      // Filtering still works when browser storage is unavailable or corrupted.
    }
  }

  getState() {
    return { nodes: { ...this.state.nodes }, topics: { ...this.state.topics },
      hideUnsubscribed: this.state.hideUnsubscribed };
  }

  subscribe(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  setVisible(kind, path, visible) {
    if (!['nodes', 'topics'].includes(kind) || typeof path !== 'string' ||
        !path.startsWith('/') || typeof visible !== 'boolean') return false;
    const rules = this.state[kind];
    // A namespace toggle also clears overrides underneath it.
    if (path.endsWith('/')) {
      for (const key of Object.keys(rules)) {
        if (key.startsWith(path)) delete rules[key];
      }
    }
    rules[path] = visible;
    this.notify();
    return true;
  }

  setHideUnsubscribed(value) {
    this.state.hideUnsubscribed = value;
    this.notify();
  }

  notify() {
    const state = this.getState();
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private browsing or a full storage quota must not block filtering.
    }
    this.listeners.forEach(handler => handler(state));
  }
}
