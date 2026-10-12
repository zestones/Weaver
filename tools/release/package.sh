#!/usr/bin/env bash
# Builds what a release ships: package.sh <version> [<out folder>]
#
#   weaver-<version>.tar.gz   the command, the engine and what they depend on, built: it needs only Node to run
#   SHA256SUMS                the digest of the archive
#
# The tag decides the version: it is stamped in the copy that ships, and the sources keep their development default.
set -euo pipefail

version="${1:?usage: package.sh <version, as v1.2.3> [<out folder>]}"
out="$(realpath -m "${2:-dist}")"

if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "package.sh: \"$version\" is not a version: write it as v1.2.3" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

name="weaver-$version"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pnpm build
# A flat node_modules: the path of the hook, which a supervised project keeps, stays short and says nothing of the
# machine that built it.
pnpm --filter @weaver/cli deploy --prod --config.node-linker=hoisted "$work/$name"
rm -f "$work/$name/pnpm-workspace.yaml"
# The command says its version, and the engine writes it on each line of its journal.
node -e '
  const { readFileSync, writeFileSync } = require("node:fs")
  const [version, ...paths] = process.argv.slice(1)
  for (const path of paths) writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), version }, null, 2) + "\n")
' "${version#v}" "$work/$name/package.json" "$work/$name/node_modules/@weaver/engine/package.json"

# The copy is tried before it is packed: it says its version, and its hook starts.
said="$(node "$work/$name/dist/bin/weaver.js" version)"
if [[ "$said" != "weaver ${version#v}" ]]; then
  echo "package.sh: the copy says \"$said\", not \"weaver ${version#v}\"" >&2
  exit 1
fi
node "$work/$name/node_modules/@weaver/engine/dist/bin/hook.js" Ping </dev/null >/dev/null

mkdir -p "$out"
tar -C "$work" -czf "$out/$name.tar.gz" "$name"
(cd "$out" && sha256sum "$name.tar.gz" >SHA256SUMS)
echo "$out/$name.tar.gz"
