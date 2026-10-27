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

async function interactionFixture() {
  const { InteractionController } = await import(await browserModuleUrl(new URL('interaction/interactionController.js', jsRoot)));
  const { Store } = await import(await browserModuleUrl(new URL('state/store.js', jsRoot)));
  const { ViewController } = await import(await browserModuleUrl(new URL('interaction/viewController.js', jsRoot)));
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {}, releasePointerCapture() {},
  });
  const previousDocument = globalThis.document;
  globalThis.document = new EventTarget();
  const store = new Store();
  const view = new ViewController(store);
  const controller = new InteractionController(canvas, store, view);
  const geometry = x => ({ center: { x, y: 50 }, width: 30, height: 20 });
  store.setGraph({
    nodes: ['/publisher', '/subscriber', '/isolated'], topics: { '/data': [] },
    edges: [{ start: '/publisher', end: '/data' }, { start: '/data', end: '/subscriber' }],
  });
  store.setScene({
    nodes: new Map([['/publisher', geometry(40)], ['/subscriber', geometry(280)], ['/isolated', geometry(400)]]),
    topics: new Map([['/data', geometry(160)]]),
    edges: [{ tail: '/publisher', head: '/data', key: '/publisher->/data',
      points: [{ x: 60, y: 50 }, { x: 140, y: 50 }] },
    { tail: '/data', head: '/subscriber', key: '/data->/subscriber',
      points: [{ x: 180, y: 50 }, { x: 260, y: 50 }] }],
  });
  const event = (x, y = 50, modifiers = {}) => ({
    clientX: x, clientY: y, button: 0, pointerId: 1, preventDefault() {}, ...modifiers,
  });
  return { store, controller, view, event, close() {
    controller.destroy();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  } };
}

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

test('graph auto refresh defaults to enabled for existing saved preferences', async () => {
  const { GeneralSettingsManager } = await import(await browserModuleUrl(new URL('state/generalSettingsManager.js', jsRoot)));
  const settings = new GeneralSettingsManager({ storage: { getItem: () => '{"graphRefreshIntervalMs":1500}' } });
  settings.init();
  assert.equal(settings.getState().graphAutoRefresh, true);
  assert.equal(settings.getState().graphRefreshIntervalMs, 1500);
});

test('manual graph refresh preference persists independently of echo and plot settings', async () => {
  const { GeneralSettingsManager } = await import(await browserModuleUrl(new URL('state/generalSettingsManager.js', jsRoot)));
  const storage = { value: null, getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  const settings = new GeneralSettingsManager({ storage });
  settings.update({ graphAutoRefresh: false });
  const restored = new GeneralSettingsManager({ storage });
  restored.init();
  assert.equal(restored.getState().graphAutoRefresh, false);
  assert.equal(restored.getState().streamAutoRefresh, true);
  restored.update({ graphRefreshIntervalMs: 3000 });
  assert.equal(restored.getState().graphAutoRefresh, false);
});

test('graph refresh toggle notifies subscribers on disable and re-enable', async () => {
  const { GeneralSettingsManager } = await import(await browserModuleUrl(new URL('state/generalSettingsManager.js', jsRoot)));
  const settings = new GeneralSettingsManager({ storage: {} });
  const changes = [];
  settings.subscribe(state => changes.push(state.graphAutoRefresh));
  settings.update({ graphAutoRefresh: false });
  settings.update({ graphAutoRefresh: false });
  settings.update({ graphAutoRefresh: true });
  assert.deepEqual(changes, [false, true]);
});

test('panning preserves selection and the selected item toggles off at its new position', async () => {
  const { store, controller, view, event, close } = await interactionFixture();
  try {
    controller.handlePointerDown(event(40));
    const selection = store.getSelection();
    assert.ok(selection.nodes.has('/publisher'));
    controller.handlePointerDown(event(500, 400));
    controller.handlePointerMove(event(600, 450));
    controller.handlePointerUp(event(600, 450));
    assert.equal(view.isPanning(), false);
    assert.equal(store.getView().offsetX, 100);
    assert.deepEqual(store.getSelection(), selection);
    controller.handlePointerDown(event(140, 100));
    assert.equal(store.getSelection().nodes.size, 0);
    assert.equal(store.getSelection().topics.size, 0);
    assert.equal(store.getSelection().edges.size, 0);
  } finally { close(); }
});

test('a second plain click deselects topic bubbles and topic edges', async () => {
  const { store, controller, event, close } = await interactionFixture();
  try {
    for (const x of [160, 100]) {
      controller.handlePointerDown(event(x));
      assert.ok(store.getSelection().topics.has('/data'));
      controller.handlePointerDown(event(x));
      assert.equal(store.getSelection().topics.size, 0);
      assert.equal(store.getSelection().edges.size, 0);
    }
  } finally { close(); }
});

test('background clicks and zoom retain selection; modifier clicks still add and toggle', async () => {
  const { store, controller, event, close } = await interactionFixture();
  try {
    controller.handlePointerDown(event(40));
    const initial = store.getSelection();
    controller.handlePointerDown(event(500, 400));
    controller.handlePointerUp(event(500, 400));
    assert.deepEqual(store.getSelection(), initial);
    controller.handlePointerDown(event(400, 50, { shiftKey: true }));
    assert.ok(store.getSelection().nodes.has('/isolated'));
    controller.handlePointerDown(event(400, 50, { ctrlKey: true }));
    assert.deepEqual(store.getSelection(), initial);
    controller.handleWheel(event(500, 400, { deltaY: -100 }));
    assert.deepEqual(store.getSelection(), initial);
  } finally { close(); }
});

test('synthetic layout IDs cannot poison topic filters, and old invalid rules are discarded', () => {
  const storage = { value: JSON.stringify({ nodes: {}, topics: { n_n__tf: false, '/tf_static': false } }),
    getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  const filters = new GraphFilters(storage);
  assert.deepEqual(filters.getState().topics, { '/tf_static': false });
  let updates = 0;
  filters.subscribe(() => updates++);
  assert.equal(filters.setVisible('topics', 'n_n__tf', false), false);
  assert.equal(filters.setVisible('topics', undefined, false), false);
  assert.equal(filters.setVisible('topics', '/tf', 'false'), false);
  assert.equal(updates, 0);
  assert.equal(filters.setVisible('topics', '/tf', false), true);
  assert.deepEqual(filters.getState().topics, { '/tf_static': false, '/tf': false });
  assert.deepEqual(new GraphFilters(storage).getState(), filters.getState());
});

test('TF topics resolve to real ROS names for info and context-menu hiding', async () => {
  const { buildScene } = await import(await browserModuleUrl(new URL('render/sceneBuilder.js', jsRoot)));
  const { getTopicSummary } = await import(await browserModuleUrl(new URL('data/graphSelectors.js', jsRoot)));
  const { store, controller, event, close } = await interactionFixture();
  const graph = {
    nodes: ['/broadcaster', '/listener'],
    topics: { '/tf': ['tf2_msgs/msg/TFMessage'], '/tf_static': ['tf2_msgs/msg/TFMessage'] },
    edges: [{ start: '/broadcaster', end: '/tf' }, { start: '/tf', end: '/listener' },
      { start: '/broadcaster', end: '/tf_static' }, { start: '/tf_static', end: '/listener' }],
    graphviz: {
      ids: { '/broadcaster': 'n___broadcaster', '/listener': 'n___listener', '/tf': 't___tf', '/tf_static': 't___tf_static' },
      plain: [
        'graph 1 5 3',
        'node n___broadcaster 0.5 1.5 0.75 0.5 /broadcaster solid ellipse black white',
        'node n___listener 4 1.5 0.75 0.5 /listener solid ellipse black white',
        'node t___tf 2 2 0.75 0.5 /tf solid box black white',
        'node t___tf_static 2 1 0.75 0.5 /tf_static solid box black white',
        'edge n___broadcaster t___tf 2 0.875 1.5 1.625 2 solid black',
        'edge t___tf n___listener 2 2.375 2 3.625 1.5 solid black',
        'edge n___broadcaster t___tf_static 2 0.875 1.5 1.625 1 solid black',
        'edge t___tf_static n___listener 2 2.375 1 3.625 1.5 solid black',
        'stop',
      ].join('\n'),
    },
  };
  try {
    const scene = buildScene(graph, 1200, 800);
    store.setGraph(graph);
    store.setScene(scene);
    assert.deepEqual([...scene.topics.keys()], ['/tf', '/tf_static']);
    assert.equal(scene.edges.length, 4);
    const filters = new GraphFilters(null);
    let menuTarget;
    controller.options.contextMenu = { toggle(open, point, target) { menuTarget = target; } };
    for (const topic of ['/tf', '/tf_static']) {
      const { center } = scene.topics.get(topic);
      controller.handleContextMenu(event(center.x, center.y));
      assert.equal(menuTarget.topicName, topic);
      const info = getTopicSummary(graph, menuTarget.topicName);
      assert.deepEqual(info.types, ['tf2_msgs/msg/TFMessage']);
      assert.equal(info.publishers[0].name, '/broadcaster');
      assert.equal(info.subscribers[0].name, '/listener');
      assert.equal(filters.setVisible('topics', menuTarget.topicName, false), true);
    }
    assert.deepEqual(filters.getState().topics, { '/tf': false, '/tf_static': false });
  } finally { close(); }
});
