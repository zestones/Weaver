#!/usr/bin/env bash
# Installs a release of Weaver for the current user: install.sh <weaver-vX.Y.Z.tar.gz>
#
#   ~/.local/share/weaver/<version>/   the release, as it was published
#   ~/.local/bin/weaver                the command, linked to that version
#
# Versions stay side by side. A supervised project runs the one it was wired with until `weaver install` is run in
# it again, so an older version is removed by hand, once no project points at it.
set -euo pipefail

archive="${1:?usage: install.sh <weaver-vX.Y.Z.tar.gz>}"
home="${WEAVER_HOME:-$HOME/.local/share/weaver}"
bin="${WEAVER_BIN:-$HOME/.local/bin}"

if [[ ! -f "$archive" ]]; then
  echo "install.sh: $archive is not a file" >&2
  exit 2
fi

name="$(basename "$archive" .tar.gz)"
version="${name#weaver-}"
sums="$(dirname "$archive")/SHA256SUMS"

if [[ "$name" != weaver-v* ]]; then
  echo "install.sh: $archive is not an archive of Weaver: its name is weaver-<version>.tar.gz" >&2
  exit 2
fi

# The registry of the cards is kept with the SQLite that ships in Node.
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || (major === 24 && minor >= 13) ? 0 : 1)'; then
  echo "install.sh: Weaver needs Node.js 24.13 or later, and this is $(node --version 2>/dev/null || echo 'no Node.js at all')" >&2
  exit 1
fi

if [[ -f "$sums" ]]; then
  if ! (cd "$(dirname "$archive")" && sha256sum --check --ignore-missing --quiet SHA256SUMS) 2>/dev/null; then
    echo "install.sh: $archive does not match the SHA256SUMS beside it: nothing is installed" >&2
    exit 1
  fi
else
  echo "install.sh: no SHA256SUMS beside the archive: it is installed unchecked" >&2
fi

rm -rf "${home:?}/$version"
mkdir -p "$home/$version" "$bin"
tar -xzf "$archive" -C "$home/$version" --strip-components=1
ln -sfn "$home/$version/dist/bin/weaver.js" "$bin/weaver"

echo "$("$bin/weaver" version) is installed in $home/$version, and $bin/weaver points at it."
echo "Run weaver install in each supervised project: its hooks still point at the version it was wired with."
