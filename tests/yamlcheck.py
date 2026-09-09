#!/usr/bin/env python3
"""Parse YAML with a loader that rejects duplicate mapping keys.

PyYAML's safe_load keeps the last of a repeated key and reports success.
GitHub's workflow parser refuses the file outright, before any job is created,
so a local safe_load check is not evidence that a workflow will run at all.

One file, copied verbatim into pkghaus/action-debian-build, pkghaus/buildinfos
and pkghaus/infrastructure. There is no public home the estate's repos can
share code through; it is small and stable enough for a copy to be the cheaper
trade. Its tests live in pkghaus/action-debian-build
(tests/test-yamlcheck.sh); change it there and copy the file to the other two.
"""

import sys

import yaml

USAGE = "Usage: yamlcheck.py <file> [<file> ...]"


class StrictLoader(yaml.SafeLoader):
    """SafeLoader that treats a repeated mapping key as an error."""


def _reject_duplicate_keys(loader, node, deep=False):
    mapping = {}

    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)

        # ConstructorError rather than ValueError: it carries the mark, so the
        # failure names the line instead of only the key.
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                None,
                None,
                f"duplicate key {key!r}",
                key_node.start_mark,
            )

        mapping[key] = loader.construct_object(value_node, deep=deep)

    return mapping


StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _reject_duplicate_keys,
)


def main(paths):
    # Checking nothing is not passing. A glob that matches no file would
    # otherwise report success having read nothing.
    if not paths:
        print(USAGE, file=sys.stderr)
        return 2

    failed = False

    for path in paths:
        try:
            with open(path, encoding="utf-8") as handle:
                yaml.load(handle, Loader=StrictLoader)
        except (OSError, yaml.YAMLError) as exc:
            print(f"FAIL {path}: {exc}", file=sys.stderr)
            failed = True
        else:
            print(f"ok   {path}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
