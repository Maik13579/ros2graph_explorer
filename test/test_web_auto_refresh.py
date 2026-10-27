"""Verify that ROS parameter overrides and runtime updates reach web requests."""

from unittest.mock import Mock

import pytest
import rclpy
from rclpy.parameter import Parameter
from ros2graph_explorer import ros2_graph_node


@pytest.mark.parametrize('enabled', [True, False])
def test_web_auto_refresh_ros_parameter(monkeypatch, enabled):
    """Read the current declared ROS parameter on every graph request."""
    server = Mock()
    monkeypatch.setattr(ros2_graph_node, 'GraphWebServer', server)
    monkeypatch.setattr(ros2_graph_node.GraphMonitor, 'start', lambda *args: None)
    rclpy.init(args=['--ros-args', '-p', f'web_auto_refresh:={str(enabled).lower()}'])
    node = None
    try:
        node = ros2_graph_node.Ros2GraphNode()
        handler = server.call_args.kwargs['auto_refresh_handler']
        assert handler() is enabled
        result = node.set_parameters([Parameter('web_auto_refresh', value=not enabled)])
        assert result[0].successful
        assert handler() is not enabled
    finally:
        if node is not None:
            node.destroy_node()
        rclpy.shutdown()
