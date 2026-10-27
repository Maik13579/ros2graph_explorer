"""Verify that TF topics retain usable ROS identities in the rqt layout."""

import shlex
import shutil
import subprocess

import pytest

from ros2graph_explorer.graph.layout import generate_graphviz_with_mode
from ros2graph_explorer.graph.snapshot import Edge, GraphSnapshot
from ros2graph_explorer.graph.visibility import filter_snapshot


@pytest.mark.parametrize('hidden', [None, '/tf', '/tf_static'])
def test_tf_topics_keep_separate_layout_ids(hidden):
    """Keep each visible TF topic addressable for info and hide actions."""
    pytest.importorskip('rqt_graph.dotcode')
    pytest.importorskip('qt_dotgraph.pydotfactory')
    dot = shutil.which('dot')
    if not dot:
        pytest.skip('Graphviz is an optional layout dependency')
    snapshot = GraphSnapshot(
        {'/broadcaster', '/listener'},
        {'/tf': ('tf2_msgs/msg/TFMessage',), '/tf_static': ('tf2_msgs/msg/TFMessage',)},
        [Edge('/broadcaster', '/tf'), Edge('/tf', '/listener'),
         Edge('/broadcaster', '/tf_static'), Edge('/tf_static', '/listener')],
    )
    visible = filter_snapshot(snapshot, {'topics': {hidden: False} if hidden else {}})
    source, ids, mode = generate_graphviz_with_mode(visible, 'rqt')
    assert mode == 'rqt'
    plain = subprocess.run(
        [dot, '-Tplain'], input=source, text=True, capture_output=True, check=True,
    ).stdout
    rows = [shlex.split(line) for line in plain.splitlines()]
    rendered = {row[1]: row[6] for row in rows if row[0] == 'node'}
    assert set(rendered) == set(ids.values())
    for name in visible.topics:
        assert rendered[ids[name]] == name
    if hidden:
        assert hidden not in ids
        assert hidden not in rendered.values()
