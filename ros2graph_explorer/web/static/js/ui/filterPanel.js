import { isVisible, subscribedTopics } from '../state/graphFilters.js';

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export class FilterPanel {
  constructor({ filters, store, button, dialog }) {
    this.filters = filters;
    this.store = store;
    this.button = button;
    this.dialog = dialog;
    this.sections = new Map();
    button.addEventListener('click', () => {
      this.render();
      dialog.showModal();
      button.setAttribute('aria-expanded', 'true');
    });
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      }
    });
    // Keep Escape inside this dialog instead of closing graph overlays as well.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    this.hideUnsubscribed = dialog.querySelector('#hideUnsubscribed');
    this.hideUnsubscribed.addEventListener('change', () => {
      filters.setHideUnsubscribed(this.hideUnsubscribed.checked);
    });
    for (const kind of ['nodes', 'topics']) this.createSection(kind);
    const tabs = [...dialog.querySelectorAll('[data-filter-tab]')];
    const activateTab = tab => {
      tabs.forEach(button => {
        const selected = button === tab;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle('settings-tabs__tab--active', selected);
        dialog.querySelector(`[data-filter-kind="${button.dataset.filterTab}"]`).hidden = !selected;
      });
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateTab(tab));
      tab.addEventListener('keydown', event => {
        let next;
        if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
        else if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length];
        else if (event.key === 'Home') next = tabs[0];
        else if (event.key === 'End') next = tabs[tabs.length - 1];
        if (next) {
          event.preventDefault();
          activateTab(next);
          next.focus();
        }
      });
    });
    activateTab(tabs[0]);
    filters.subscribe(() => this.render());
    store.subscribe('graph', ({ changed }) => {
      if (changed) this.render();
    });
    this.render();
  }

  createSection(kind) {
    const section = this.dialog.querySelector(`[data-filter-kind="${kind}"]`);
    const search = section.querySelector('input[type="search"]');
    const columns = section.querySelector('.filter-columns');
    const lists = new Map();
    for (const visible of [true, false]) {
      const column = element('div', undefined, 'filter-column');
      const heading = element('h4');
      const tree = element('div', undefined, 'filter-tree');
      tree.setAttribute('aria-label', `${visible ? 'Included' : 'Hidden'} ${kind}`);
      column.append(heading, tree);
      columns.append(column);
      lists.set(visible, { heading, tree, expanded: new Set() });
    }
    this.sections.set(kind, { search, lists });
    search.addEventListener('input', () => this.render());
    section.querySelector('[data-include-all]').addEventListener('click', () => {
      this.filters.setVisible(kind, '/', true);
    });
    section.querySelector('[data-hide-all]').addEventListener('click', () => {
      this.filters.setVisible(kind, '/', false);
    });
  }

  render() {
    const active = this.dialog.contains(document.activeElement) ? document.activeElement : null;
    const activePath = active?.dataset.path;
    const activeKind = active?.dataset.kind;
    const graph = this.store.getGraph();
    const state = this.filters.getState();
    const subscribed = subscribedTopics(graph);
    let hiddenCount = 0;
    this.hideUnsubscribed.checked = state.hideUnsubscribed;
    for (const [kind, { search, lists }] of this.sections) {
      const names = [...new Set(kind === 'nodes' ? graph?.nodes || [] : Object.keys(graph?.topics || {}))]
        .sort((a, b) => a.localeCompare(b));
      const query = search.value.trim().toLowerCase();
      const visible = name => isVisible(name, state[kind]) &&
        (kind !== 'topics' || !state.hideUnsubscribed || subscribed.has(name));
      hiddenCount += names.filter(name => !visible(name)).length;
      for (const [included, list] of lists) {
        const members = names.filter(name => visible(name) === included);
        const matches = members.filter(name => name.toLowerCase().includes(query));
        list.heading.textContent = `${included ? 'Included' : 'Hidden'} (${matches.length}${query ? ` / ${members.length}` : ''})`;
        const scroll = list.tree.scrollTop;
        list.tree.replaceChildren();
        if (!matches.length) {
          list.tree.append(element('p', query ? 'No matches' : 'None', 'filter-empty'));
        } else {
          const root = { children: new Map(), path: '/' };
          for (const name of matches) {
            let branch = root;
            const parts = name.split('/').filter(Boolean);
            parts.forEach((part, index) => {
              const leaf = index === parts.length - 1;
              const path = `/${parts.slice(0, index + 1).join('/')}${leaf ? '' : '/'}`;
              if (!branch.children.has(path)) {
                branch.children.set(path, { label: leaf ? part : `${part}/`, path,
                  leaf, children: new Map() });
              }
              branch = branch.children.get(path);
            });
          }
          this.renderBranches(root, list.tree, { kind, included, list, query, state, subscribed });
        }
        list.tree.scrollTop = scroll;
      }
    }
    if (activePath) {
      const target = [...this.dialog.querySelectorAll('input[data-path]')]
        .find(input => input.dataset.path === activePath && input.dataset.kind === activeKind);
      // A toggled leaf moves columns; open its new ancestors for keyboard users.
      if (target) {
        let ancestor = target.parentElement;
        while (ancestor && ancestor !== this.dialog) {
          if (ancestor.tagName === 'DETAILS') ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
      }
      (target || this.sections.get(activeKind)?.search)?.focus({ preventScroll: true });
    }
    this.button.textContent = hiddenCount ? `Filters · ${hiddenCount} hidden` : 'Filters';
  }

  renderBranches(branch, container, options) {
    const { kind, included, list, query, state, subscribed } = options;
    for (const child of branch.children.values()) {
      const label = element('label', undefined, 'filter-entry');
      label.title = child.path;
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = included;
      checkbox.dataset.path = child.path;
      checkbox.dataset.kind = kind;
      checkbox.setAttribute('aria-label', `Include ${kind === 'nodes' ? 'node' : 'topic'} ${child.path}`);
      const automatic = child.leaf && kind === 'topics' && state.hideUnsubscribed && !subscribed.has(child.path);
      checkbox.disabled = automatic;
      if (automatic) label.title += ' — no subscribers; disable the option above to include';
      checkbox.addEventListener('change', () => this.filters.setVisible(kind, child.path, checkbox.checked));
      label.append(checkbox, element('span', child.label));
      if (automatic) label.append(element('small', 'no subscribers'));
      if (child.leaf) {
        container.append(label);
      } else {
        const details = element('details');
        details.open = Boolean(query) || list.expanded.has(child.path);
        const summary = element('summary');
        summary.append(label);
        details.append(summary);
        const nested = element('div', undefined, 'filter-branch');
        this.renderBranches(child, nested, options);
        details.append(nested);
        details.addEventListener('toggle', () => {
          if (query || !details.isConnected) return;
          if (details.open) list.expanded.add(child.path);
          else list.expanded.delete(child.path);
        });
        container.append(details);
      }
    }
  }
}
