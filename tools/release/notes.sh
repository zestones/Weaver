#!/usr/bin/env bash
# Writes the notes of a release, from the commits since the release before: notes.sh <version>
#
# The commits follow Conventional Commits, so a subject says where it goes: a `feat` under Features, a `fix` under
# Fixes, and whatever carries a `!` under Breaking changes, whatever its type.
set -euo pipefail

version="${1:?usage: notes.sh <version, as v1.2.3>}"
repository="${GITHUB_REPOSITORY:-zestones/Weaver}"

cd "$(git rev-parse --show-toplevel)"

# On a rehearsal the tag does not exist yet: the commit at hand stands for it.
head="$(git rev-parse --quiet --verify "refs/tags/$version^{commit}" || git rev-parse HEAD)"
previous="$(git describe --tags --abbrev=0 --match 'v[0-9]*' "$head^" 2>/dev/null || true)"
heading="What this first release holds"
[[ -n "$previous" ]] && heading="What changed since $previous"

cat <<NOTES
## Install

Weaver needs Node.js 24.13 or later.

\`\`\`sh
gh release download $version --repo $repository --dir weaver-$version && cd weaver-$version
sha256sum --check --ignore-missing SHA256SUMS
bash install.sh weaver-$version.tar.gz
\`\`\`

The release goes to \`~/.local/share/weaver/$version/\`, and \`~/.local/bin/weaver\` points at it.

## Upgrade notes

From a release that has it, \`weaver update\` does the three commands above. In a supervised project it then applies the migrations the configuration lacks, naming each, and wires the hooks to this release.

A supervised project runs the release that wired it until \`weaver update\` is run in it, and \`weaver doctor\` says when one is behind. \`weaver update --dry-run\` shows what would change and writes nothing: what a later release says changed, and what it would change in the project.

## $heading

NOTES

git log --no-merges --reverse --format='%h%x09%s' "${previous:+$previous..}$head" | awk -F'\t' '
  BEGIN {
    count = split("breaking feat fix perf refactor test docs build other", order, " ")
    title["breaking"] = "Breaking changes"; title["feat"] = "Features"; title["fix"] = "Fixes"
    title["perf"] = "Performance"; title["refactor"] = "Refactoring"; title["test"] = "Tests"
    title["docs"] = "Documentation"; title["build"] = "Build and CI"; title["other"] = "Other"
  }
  {
    subject = $2; kind = "other"
    if (match(subject, /^[a-z]+(\([^)]*\))?!?: /)) {
      prefix = substr(subject, 1, RLENGTH - 2); subject = substr(subject, RLENGTH + 1)
      kind = prefix; sub(/[(!].*$/, "", kind)
      if (match(prefix, /\([^)]*\)/)) subject = substr(prefix, RSTART + 1, RLENGTH - 2) ": " subject
      if (kind == "ci") kind = "build"
      if (!(kind in title)) kind = "other"
      if (prefix ~ /!$/) kind = "breaking"
    }
    lines[kind] = lines[kind] "- " subject " (" $1 ")\n"
  }
  END {
    for (at = 1; at <= count; at++) if (order[at] in lines) printf "### %s\n\n%s\n", title[order[at]], lines[order[at]]
  }
'

if [[ -n "$previous" ]]; then
  echo "**Every commit:** https://github.com/$repository/compare/$previous...$version"
fi
