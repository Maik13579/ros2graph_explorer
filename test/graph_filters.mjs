import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Load browser ES modules without changing the Python package's Node module mode.
async function browserModuleUrl(path) {
  let source = await readFile(path, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)]) {
    const dependency = await browserModuleUrl(new URL(match[2], path));
    source = source.replace(match[0], `from '${dependency}'`);
  }
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const jsRoot = new URL('../ros2graph_explorer/web/static/js/', import.meta.url);
const { GraphFilters, isVisible, subscribedTopics } = await import(
  await browserModuleUrl(new URL('state/graphFilters.js', jsRoot)));

test('namespace rules cover new entries, with boundary-safe nested overrides', () => {
  const rules = { '/robot/': false, '/robot/nav/': true, '/robot/nav/hidden': false };
  assert.equal(isVisible('/robot/camera', rules), false);
  assert.equal(isVisible('/robot/new_node', rules), false);
  assert.equal(isVisible('/robot/nav/new_node', rules), true);
  assert.equal(isVisible('/robot/nav/hidden', rules), false);
  assert.equal(isVisible('/robot2/camera', rules), true);
  assert.equal(isVisible('/robot', rules), true);
});

test('namespace and bulk toggles clear descendant exceptions; kinds stay independent', () => {
  const filters = new GraphFilters(null);
  let updates = 0;
  filters.subscribe(() => updates++);
  filters.setVisible('nodes', '/robot/nav/planner', false);
  filters.setVisible('nodes', '/robot/nav/', true);
  assert.deepEqual(filters.getState().nodes, { '/robot/nav/': true });
  filters.setVisible('nodes', '/', false);
  assert.equal(isVisible('/new/node', filters.getState().nodes), false);
  assert.equal(isVisible('/new/topic', filters.getState().topics), true);
  filters.setVisible('nodes', '/robot/camera', true);
  assert.equal(isVisible('/robot/camera', filters.getState().nodes), true);
  filters.setVisible('nodes', '/', true);
  assert.deepEqual(filters.getState().nodes, { '/': true });
  assert.equal(updates, 5);
});

test('visibility persists and returned state cannot mutate the manager', () => {
  const storage = { value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  const filters = new GraphFilters(storage);
  filters.setVisible('topics', '/camera/', false);
  filters.setHideUnsubscribed(true);
  const restored = new GraphFilters(storage);
  assert.deepEqual(restored.getState(), filters.getState());
  restored.getState().topics['/camera/'] = true;
  assert.equal(isVisible('/camera/image', restored.getState().topics), false);
});

test('corrupt or unavailable storage still permits filtering', () => {
  const corrupt = new GraphFilters({ getItem() { return '{oops'; } });
  assert.deepEqual(corrupt.getState(), { nodes: {}, topics: {}, hideUnsubscribed: false });
  const blocked = new GraphFilters({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  blocked.setVisible('nodes', '/', false);
  assert.equal(isVisible('/node', blocked.getState().nodes), false);
});

test('subscriber detection ignores publisher edges and unknown endpoints', () => {
  const graph = { nodes: ['/publisher', '/subscriber'], topics: { '/data': [], '/idle': [] },
    edges: [{ start: '/publisher', end: '/idle' }, { start: '/data', end: '/subscriber' },
      { start: '/idle', end: '/unknown' }] };
  assert.deepEqual([...subscribedTopics(graph)], ['/data']);
});

test('the canvas uses the filtered layout while keeping the full graph inventory', async () => {
  const { buildScene } = await import(await browserModuleUrl(new URL('render/sceneBuilder.js', jsRoot)));
  const graph = {
    nodes: ['/shown', '/hidden'], topics: { '/rosout': [], '/hidden/topic': [] },
    graphviz: { ids: { '/shown': 'n1', '/rosout': 't1' }, plain: [
      'graph 1 4 2',
      'node n1 1 1 1 0.5 /shown solid ellipse black white',
      'node t1 3 1 1 0.5 /rosout solid box black white',
      'edge n1 t1 2 1.5 1 2.5 1 solid black',
      'stop',
    ].join('\n') },
  };
  const scene = buildScene(graph, 1200, 800);
  assert.deepEqual([...scene.nodes.keys()], ['/shown']);
  assert.deepEqual([...scene.topics.keys()], ['/rosout']);
  assert.equal(scene.edges.length, 1);
  assert.ok(Number.isFinite(scene.fitView.scale));
  assert.equal(buildScene({ ...graph, graphviz: { plain: 'graph 1 0 0\nstop' } }, 1200, 800).nodes.size, 0);
});

test('graph API sends filters in a POST body and preserves unfiltered GET requests', async () => {
  const { GraphApi } = await import(await browserModuleUrl(new URL('api/graphApi.js', jsRoot)));
  const requests = [];
  const api = new GraphApi({ request(path, options) { requests.push({ path, ...options }); } });
  const filters = { nodes: { '/robot/': false }, topics: {}, hideUnsubscribed: true };
  await api.fetchGraph({ layoutMode: 'simple', filters });
  await api.fetchGraph();
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, filters);
  assert.match(requests[0].path, /layout=simple/);
  assert.equal(requests[1].method, 'GET');
  assert.equal(requests[1].body, undefined);
});
