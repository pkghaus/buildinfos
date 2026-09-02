#!/usr/bin/env python3
"""Parse YAML with a loader that rejects duplicate mapping keys.

PyYAML's safe_load takes the last of a repeated key and says nothing. GitHub's
workflow parser refuses the file outright, before any job is created, so a
local safe_load check is not evidence that a workflow will run at all.
"""
import sys

import yaml


class StrictLoader(yaml.SafeLoader):
    pass


def no_duplicates(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError(f"duplicate key: {key!r}")
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, no_duplicates
)

status = 0
for path in sys.argv[1:]:
    try:
        with open(path, "rb") as handle:
            yaml.load(handle, StrictLoader)
    except (ValueError, yaml.YAMLError) as exc:
        print(f"FAIL {path}: {exc}", file=sys.stderr)
        status = 1
    else:
        print(f"ok   {path}")
sys.exit(status)
