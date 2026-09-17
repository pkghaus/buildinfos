#!/usr/bin/env python3
"""Check a workflow the way GitHub will, plus two estate conventions.

Three checks, all on files this repo already hands it:

1. Parse with a loader that rejects duplicate mapping keys.
2. Every `actions/checkout` step sets `persist-credentials: false`.
3. Every third-party `uses:` is pinned to a full commit SHA.

On (1): PyYAML's safe_load keeps the last of a repeated key and reports success.
GitHub's workflow parser refuses the file outright, before any job is created,
so a local safe_load check is not evidence that a workflow will run at all.

On (2): checkout writes the job token into .git/config unless told not to, and
the next thing these workflows do is build an upstream project from source.
That is third-party code with read access to the same filesystem.

On (3): a tag can be moved by whoever compromises the action's repository, and
every consumer picks it up on the next run. actions/* and pkghaus/* stay on
major tags deliberately: GitHub owns both the tag and the content a SHA would
pin, so pinning there moves trust from GitHub to GitHub.

Both conventions are checked by walking each step's OWN `with:` and `uses:`. A
fixed grep window cannot do it - measured across this estate, -A1 through -A4
each gave a different wrong answer, because a `with:` block may carry other
keys or a comment before the setting, and a wider window reaches into the next
step.

One file, copied verbatim into pkghaus/action-debian-build, pkghaus/buildinfos
and pkghaus/infrastructure. There is no public home the estate's repos can
share code through; it is small and stable enough for a copy to be the cheaper
trade. Its tests live in pkghaus/action-debian-build
(tests/test-yamlcheck.sh); change it there and copy the file to the other two.
"""

import re
import sys

import yaml

USAGE = "Usage: yamlcheck.py <file> [<file> ...]"

# Owned by us or by GitHub; see the module docstring for why these are exempt.
FIRST_PARTY = ("actions/", "pkghaus/")
SHA = re.compile(r"[0-9a-f]{40}\Z")


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


def _steps(doc):
    """Every step in a workflow or a composite action, wherever it is declared."""
    if not isinstance(doc, dict):
        return

    for job in (doc.get("jobs") or {}).values():
        if isinstance(job, dict):
            for step in job.get("steps") or []:
                if isinstance(step, dict):
                    yield step

    runs = doc.get("runs")
    if isinstance(runs, dict):
        for step in runs.get("steps") or []:
            if isinstance(step, dict):
                yield step


def _conventions(doc):
    """Names of the conventions this document breaks, if any."""
    problems = []

    for step in _steps(doc):
        uses = str(step.get("uses") or "")
        if not uses:
            continue

        if uses.split("@")[0] == "actions/checkout":
            # The step's OWN with:, never a nearby one.
            with_ = step.get("with") or {}
            if with_.get("persist-credentials") is not False:
                problems.append(
                    f"checkout without persist-credentials: false "
                    f"({step.get('name') or 'unnamed step'})"
                )

        if uses.startswith("./") or uses.startswith(FIRST_PARTY):
            continue

        ref = uses.rpartition("@")[2]
        if not SHA.match(ref):
            problems.append(f"third-party action not pinned to a SHA: {uses}")

    return problems


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
                doc = yaml.load(handle, Loader=StrictLoader)
        except (OSError, yaml.YAMLError) as exc:
            print(f"FAIL {path}: {exc}", file=sys.stderr)
            failed = True
            continue

        problems = _conventions(doc)
        for problem in problems:
            print(f"FAIL {path}: {problem}", file=sys.stderr)
        if problems:
            failed = True
        else:
            print(f"ok   {path}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
