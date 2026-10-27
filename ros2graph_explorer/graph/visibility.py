"""Browser-specific visibility rules applied before graph layout."""

from .snapshot import GraphSnapshot


def is_visible(name, rules):
    """Resolve exact names before their nearest namespace rule."""
    if name in rules:
        return rules[name]
    parts = name.strip('/').split('/')[:-1]
    while parts:
        namespace = '/' + '/'.join(parts) + '/'
        if namespace in rules:
            return rules[namespace]
        parts.pop()
    return rules.get('/', True)


def validate_filters(filters):
    """Validate the JSON filter contract without coercing invalid values."""
    if not isinstance(filters, dict):
        raise ValueError('filters must be an object')
    for kind in ('nodes', 'topics'):
        rules = filters.get(kind, {})
        if not isinstance(rules, dict) or any(
            not isinstance(path, str) or not path.startswith('/')
            or not isinstance(visible, bool)
            for path, visible in rules.items()
        ):
            raise ValueError(f'{kind} must map absolute names or namespaces to booleans')
    if not isinstance(filters.get('hideUnsubscribed', False), bool):
        raise ValueError('hideUnsubscribed must be a boolean')
    return filters


def filter_snapshot(snapshot, filters):
    """Keep visible endpoints; count subscribers in the full known graph."""
    validate_filters(filters)
    nodes = {name for name in snapshot.nodes if is_visible(name, filters.get('nodes', {}))}
    subscribed = {
        edge.start for edge in snapshot.edges
        if edge.start in snapshot.topics and edge.end in snapshot.nodes
    }
    topics = {
        name: types for name, types in snapshot.topics.items()
        if is_visible(name, filters.get('topics', {}))
        and (not filters.get('hideUnsubscribed', False) or name in subscribed)
    }
    edges = [
        edge for edge in snapshot.edges
        if (edge.start in nodes and edge.end in topics)
        or (edge.start in topics and edge.end in nodes)
    ]
    return GraphSnapshot(nodes, topics, edges)
