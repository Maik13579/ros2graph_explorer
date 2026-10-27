"""Verify namespace filtering and the browser/server layout contract."""

import json
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from ros2graph_explorer.graph.snapshot import Edge, GraphSnapshot
from ros2graph_explorer.graph.visibility import filter_snapshot, is_visible, validate_filters
from ros2graph_explorer.web.server import GraphWebServer


@pytest.fixture
def snapshot():
    """Provide publishing, subscribed, and subscriber-only topics."""
    return GraphSnapshot(
        {'/robot/camera', '/robot/nav/planner', '/robot2/listener'},
        {'/robot/image': ('sensor_msgs/msg/Image',), '/debug': ('std_msgs/msg/String',),
         '/commands': ('std_msgs/msg/String',), '/orphan': ()},
        [Edge('/robot/camera', '/robot/image'),
         Edge('/robot/image', '/robot2/listener'),
         Edge('/robot/nav/planner', '/debug'),
         Edge('/commands', '/robot2/listener')],
    )


@pytest.mark.parametrize('name,expected', [
    ('/robot/camera', False), ('/robot/nav/planner', True),
    ('/robot/nav/new_node', True), ('/robot/nav/hidden', False),
    ('/robot/new_node', False), ('/robot2/listener', True),
    ('/robot', True),
])
def test_namespace_boundaries_and_overrides(name, expected):
    """Use nearest namespaces and exact exceptions without prefix collisions."""
    rules = {'/robot/': False, '/robot/nav/': True, '/robot/nav/hidden': False}
    assert is_visible(name, rules) is expected


def test_hide_all_with_one_included_node(snapshot):
    """Root rules affect present and future entries, with exact exceptions."""
    filtered = filter_snapshot(snapshot, {'nodes': {'/': False, '/robot/camera': True}})
    assert filtered.nodes == {'/robot/camera'}
    assert filtered.edges == (Edge('/robot/camera', '/robot/image'),)
    assert not is_visible('/new/node', {'/': False})


def test_topics_are_independent_and_snapshot_is_unchanged(snapshot):
    """Filter topic branches and incident edges without mutating discovery data."""
    before = snapshot.to_dict()
    filtered = filter_snapshot(snapshot, {'topics': {'/robot/': False}})
    assert '/robot/image' not in filtered.topics
    assert filtered.nodes == snapshot.nodes
    assert not any('/robot/image' in (edge.start, edge.end) for edge in filtered.edges)
    assert snapshot.to_dict() == before


def test_subscribers_count_even_when_hidden(snapshot):
    """The no-subscriber rule checks actual connections, not visible nodes."""
    filtered = filter_snapshot(snapshot, {
        'nodes': {'/robot2/listener': False}, 'hideUnsubscribed': True,
    })
    assert set(filtered.topics) == {'/robot/image', '/commands'}
    assert filtered.edges == (Edge('/robot/camera', '/robot/image'),)


def test_empty_and_default_filters(snapshot):
    """Defaults include everything and hiding all yields an empty graph."""
    assert filter_snapshot(snapshot, {}).to_dict() == snapshot.to_dict()
    filtered = filter_snapshot(snapshot, {'nodes': {'/': False}, 'topics': {'/': False}})
    assert filtered.to_dict() == {'nodes': [], 'topics': {}, 'edges': []}


@pytest.mark.parametrize('filters', [
    [], None, {'nodes': []}, {'topics': {'/topic': 'false'}},
    {'nodes': {'relative': False}}, {'hideUnsubscribed': 'false'},
])
def test_invalid_filters(filters):
    """Reject malformed requests instead of silently changing their meaning."""
    with pytest.raises(ValueError):
        validate_filters(filters)


def test_filtered_http_layout_preserves_inventory(snapshot):
    """Serve a compact filtered layout and full inventory to independent clients."""
    settings = {'auto_refresh': False}
    server = GraphWebServer(
        '127.0.0.1', 0, Mock(), auto_refresh_handler=lambda: settings['auto_refresh'],
    )
    server.publish(snapshot, snapshot.fingerprint())
    server.start()
    base_url = f'http://127.0.0.1:{server._server.server_port}'
    try:
        filters = {'nodes': {'/robot/': False}, 'topics': {'/debug': False}}
        request = Request(
            base_url + '/graph?layout=simple', data=json.dumps(filters).encode(),
            headers={'Content-Type': 'application/json'},
        )
        with urlopen(request, timeout=5) as response:
            filtered = json.load(response)
        graph = filtered['graph']
        assert filtered['web_auto_refresh'] is False
        assert graph['nodes'] == sorted(snapshot.nodes)
        assert graph['topics'] == snapshot.to_dict()['topics']
        assert '/robot/camera' not in graph['graphviz']['ids']
        assert '/robot2/listener' in graph['graphviz']['ids']
        assert '/debug' not in graph['graphviz']['ids']
        assert filtered['visible_counts'] == {'nodes': 1, 'topics': 3, 'edges': 2}
        if server._dot_path:
            assert 'plain' in graph['graphviz']
            assert '/robot/camera' not in graph['graphviz']['plain']
        settings['auto_refresh'] = True
        with urlopen(base_url + '/graph?layout=simple', timeout=5) as response:
            full = json.load(response)
        assert full['web_auto_refresh'] is True
        assert '/robot/camera' in full['graph']['graphviz']['ids']
        assert full['fingerprint'] == snapshot.fingerprint()
        assert filtered['fingerprint'] != full['fingerprint']
        with pytest.raises(HTTPError) as error:
            urlopen(Request(base_url + '/graph', data=b'{"nodes": []}'), timeout=5)
        assert error.value.code == 400
    finally:
        server.stop()
