import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../ros2graph_explorer/web/static/js/ui/parameterTree.js', import.meta.url), 'utf8');
const { buildParameterTree, formatParameterValue, ParameterTree } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const parameters = [
  { name: 'controller.pid.ki', value: 0, type: 'double' },
  { name: 'use_sim_time', value: false, type: 'bool' },
  { name: 'controller.pid.kp', value: 1.5, type: 'double' },
  { name: 'camera.frame_id', value: 'FrontOpticalFrame', type: 'string' },
  { name: 'controller', value: 'enabled', type: 'string' },
];

test('dot-separated groups are sorted, retain full parameter identities, and count leaves', () => {
  const original = [...parameters];
  const tree = buildParameterTree(parameters);
  assert.equal(tree.count, 5);
  assert.deepEqual([...tree.children.keys()], ['camera.', 'controller', 'controller.', 'use_sim_time']);
  const controller = tree.children.get('controller.');
  assert.equal(controller.label, 'controller');
  assert.equal(controller.count, 2);
  const pid = controller.children.get('controller.pid.');
  assert.deepEqual([...pid.children.keys()], ['controller.pid.ki', 'controller.pid.kp']);
  assert.equal(pid.children.get('controller.pid.kp').parameter, parameters[2]);
  assert.equal(tree.children.get('controller').parameter, parameters[4]);
  assert.deepEqual(parameters, original);
});

test('search matches full names and groups case-insensitively, with ancestor context', () => {
  const tree = buildParameterTree(parameters, '  CONTROLLER.PID.KP  ');
  assert.equal(tree.count, 1);
  assert.deepEqual([...tree.children.keys()], ['controller.']);
  assert.equal(tree.children.get('controller.').children.get('controller.pid.').count, 1);
  assert.equal(buildParameterTree(parameters, 'controller.pid').count, 2);
});

test('search matches values including false, zero, and array contents', () => {
  assert.equal(buildParameterTree(parameters, 'opticalframe').count, 1);
  assert.equal(buildParameterTree(parameters, 'false').children.get('use_sim_time').parameter.value, false);
  assert.equal(buildParameterTree(parameters, '0').count, 1);
  const array = { name: 'camera.labels', value: ['x'.repeat(100), 'find_me'] };
  assert.equal(buildParameterTree([array], 'find_me').count, 1);
});

test('empty and unmatched lists have no branches; clearing search restores all entries', () => {
  assert.equal(buildParameterTree([]).count, 0);
  assert.equal(buildParameterTree(parameters, 'missing').children.size, 0);
  assert.equal(buildParameterTree(parameters, '').count, parameters.length);
  assert.equal(buildParameterTree([{ name: '__proto__.value', value: 1 }]).count, 1);
});

test('format values without truncation or losing false and zero', () => {
  assert.equal(formatParameterValue(false), 'false');
  assert.equal(formatParameterValue(0), '0');
  assert.equal(formatParameterValue(null), '');
  assert.equal(formatParameterValue(undefined), '');
  assert.equal(formatParameterValue([1, 2]), '[1,2]');
  assert.equal(formatParameterValue('a'.repeat(200)), 'a'.repeat(200));
});

test('search preserves expansion state and editing keeps full names after value refresh', () => {
  const previousDocument = globalThis.document;
  // A minimal DOM adapter exercises the view's event handlers without a browser.
  globalThis.document = { createElement: tag => ({
    tagName: tag.toUpperCase(), children: [], listeners: {}, value: '', scrollTop: 0,
    isConnected: true,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    addEventListener(event, handler) { this.listeners[event] = handler; },
  }) };
  const find = (node, predicate) => predicate(node) ? node : node.children
    .map(child => find(child, predicate)).find(Boolean);
  try {
    let edited;
    const view = new ParameterTree(parameter => { edited = parameter; });
    view.expanded.add('camera.');
    view.update(parameters);
    view.search.value = 'controller.pid.kp';
    view.search.listeners.input();
    const group = find(view.tree, node => node.className === 'parameter-tree__group');
    assert.equal(group.open, true);
    group.listeners.toggle();
    assert.deepEqual([...view.expanded], ['camera.']);
    find(view.tree, node => node.className === 'parameter-tree__row').listeners.click();
    assert.equal(edited.name, 'controller.pid.kp');
    view.update(parameters.map(parameter => parameter.name === edited.name ? { ...parameter, value: 9 } : parameter));
    assert.equal(view.search.value, 'controller.pid.kp');
    assert.equal(find(view.tree, node => node.className === 'parameter-tree__value').textContent, '9');
    view.search.value = '';
    view.search.listeners.input();
    const camera = find(view.tree, node => node.className === 'parameter-tree__group' && node.children[0].title === 'camera');
    const controller = find(view.tree, node => node.className === 'parameter-tree__group' && node.children[0].title === 'controller');
    assert.equal(camera.open, true);
    assert.equal(controller.open, false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
