export function formatParameterValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function buildParameterTree(parameters, query = '') {
  const root = { children: new Map(), count: 0 };
  const search = query.trim().toLowerCase();
  const entries = parameters.filter(entry => typeof entry?.name === 'string' && entry.name)
    .filter(entry => !search || `${entry.name}\n${formatParameterValue(entry.value)}`.toLowerCase().includes(search))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const parameter of entries) {
    let branch = root;
    root.count++;
    const parts = parameter.name.split('.');
    parts.forEach((label, index) => {
      const group = index < parts.length - 1;
      // Distinguish a parameter named "camera" from the "camera." group.
      const path = parts.slice(0, index + 1).join('.') + (group ? '.' : '');
      if (!branch.children.has(path)) {
        branch.children.set(path, { label, path, group, count: 0, children: new Map() });
      }
      branch = branch.children.get(path);
      branch.count++;
      if (!group) branch.parameter = parameter;
    });
  }
  return root;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ParameterTree {
  constructor(onEdit) {
    this.onEdit = onEdit;
    this.parameters = [];
    this.expanded = new Set();
    this.root = element('div', 'parameter-browser');
    this.search = element('input', 'parameter-browser__search');
    this.search.type = 'search';
    this.search.placeholder = 'Search parameters or values…';
    this.search.setAttribute('aria-label', 'Search parameters or values');
    this.search.addEventListener('input', () => this.render());
    this.count = element('div', 'parameter-browser__count');
    this.count.setAttribute('role', 'status');
    this.tree = element('div', 'parameter-tree');
    this.tree.setAttribute('aria-label', 'Parameters');
    this.root.append(this.search, this.count, this.tree);
  }

  update(parameters) {
    this.parameters = parameters;
    this.render();
  }

  render() {
    const query = this.search.value.trim();
    const root = buildParameterTree(this.parameters, query);
    const scrollTop = this.tree.scrollTop;
    this.count.textContent = `${root.count} of ${this.parameters.length} parameters · Click a value to edit`;
    this.tree.replaceChildren();
    if (!root.count) {
      this.tree.append(element('p', 'parameter-browser__empty',
        query ? 'No parameters match your search.' : 'No parameters declared.'));
    } else {
      this.renderBranch(root, this.tree, Boolean(query));
    }
    this.tree.scrollTop = scrollTop;
  }

  renderBranch(branch, container, searching) {
    for (const child of branch.children.values()) {
      if (child.group) {
        const details = element('details', 'parameter-tree__group');
        details.open = searching || this.expanded.has(child.path);
        const summary = element('summary', 'parameter-tree__heading');
        summary.title = child.path.slice(0, -1);
        summary.append(element('span', '', child.label || '(empty)'),
          element('small', 'parameter-tree__group-count', ` ${child.count}`));
        const children = element('div', 'parameter-tree__children');
        this.renderBranch(child, children, searching);
        details.append(summary, children);
        details.addEventListener('toggle', () => {
          if (searching || !details.isConnected) return;
          if (details.open) this.expanded.add(child.path);
          else this.expanded.delete(child.path);
        });
        container.append(details);
      } else {
        const parameter = child.parameter;
        const value = formatParameterValue(parameter.value);
        const row = element('button', 'parameter-tree__row');
        row.type = 'button';
        row.title = `${parameter.name}\n${value}`;
        row.setAttribute('aria-label', `Edit parameter ${parameter.name}`);
        const name = element('span', 'parameter-tree__name', child.label || '(empty)');
        if (parameter.type) name.append(element('small', 'parameter-tree__type', parameter.type));
        row.append(name, element('code', 'parameter-tree__value', value));
        row.addEventListener('click', () => this.onEdit(parameter));
        container.append(row);
      }
    }
  }
}
