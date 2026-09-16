#!/bin/bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" = 0 ]; then echo 'ALDER_ROOT: Run setup as your desktop user, without sudo.' >&2; exit 20; fi
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) TARGET=linux-x64; DEFAULT_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/alder-setup" ;;
  Darwin-arm64) TARGET=darwin-arm64; DEFAULT_STATE="$HOME/Library/Application Support/AlderSetup" ;;
  Darwin-x86_64) TARGET=darwin-x64; DEFAULT_STATE="$HOME/Library/Application Support/AlderSetup" ;;
  *) echo 'ALDER_TARGET: Unsupported OS/architecture.' >&2; exit 21 ;;
esac
if [ "$TARGET" = linux-x64 ] && ! getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
  echo 'ALDER_TARGET: This installer requires glibc Linux; musl/Alpine is not supported.' >&2
  exit 21
fi
STATE="${ALDER_SETUP_HOME:-$DEFAULT_STATE}"
OFFLINE=0
REPAIR=0
previous=''
for argument in "$@"; do
  if [ "$previous" = --state-dir ]; then STATE="$argument"; fi
  if [ "$argument" = --offline ]; then OFFLINE=1; fi
  if [ "$argument" = repair ]; then REPAIR=1; fi
  previous="$argument"
done
case "$STATE" in /*) ;; *) echo 'ALDER_PATH: --state-dir must be absolute.' >&2; exit 22 ;; esac
mkdir -p "$STATE"
STATE="$(cd "$STATE" && pwd)"
case "$STATE/" in "$SOURCE/"*|/) echo 'ALDER_PATH: Setup state must be outside the repository and not a filesystem root.' >&2; exit 22 ;; esac
export ALDER_SETUP_HOME="$STATE" PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
unset PYTHONHOME PYTHONPATH VIRTUAL_ENV CONDA_PREFIX || true
read -r _ URL HASH < <(awk -F '\t' -v target="$TARGET" '$1==target { print $1, $2, $3 }' "$SOURCE/resources/manifests/bootstrap.tsv")
if [ -z "${HASH:-}" ]; then echo 'ALDER_METADATA: Missing bootstrap record.' >&2; exit 23; fi
BASE="$STATE/bootstrap/$TARGET-$HASH"
if [ "$REPAIR" = 1 ] || [ ! -f "$BASE/.complete" ]; then
  mkdir -p "$STATE/bootstrap"
  LOCK="$STATE/bootstrap/.lock"
  if ! mkdir "$LOCK" 2>/dev/null; then echo 'ALDER_BUSY: Bootstrap is locked. Check for another setup process; if none exists remove the empty bootstrap/.lock directory.' >&2; exit 24; fi
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
  ARCHIVE="$STATE/bootstrap/$HASH.tar.gz"
  if [ ! -f "$ARCHIVE" ]; then
    if [ "$OFFLINE" = 1 ]; then echo 'ALDER_OFFLINE: Bootstrap archive is not cached.' >&2; exit 25; fi
    command -v curl >/dev/null || { echo 'ALDER_PREREQUISITE: Install curl.' >&2; exit 26; }
    curl --fail --location --retry 3 --output "$ARCHIVE.partial" "$URL"
    mv "$ARCHIVE.partial" "$ARCHIVE"
  fi
  if command -v sha256sum >/dev/null; then ACTUAL=$(sha256sum "$ARCHIVE" | cut -d' ' -f1); else ACTUAL=$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1); fi
  [ "$ACTUAL" = "$HASH" ] || { echo 'ALDER_HASH: Bootstrap checksum mismatch. Remove only the named cached archive and retry.' >&2; echo "$ARCHIVE" >&2; exit 27; }
  STAGE=$(mktemp -d "$STATE/bootstrap/stage.XXXXXXXX")
  tar -xzf "$ARCHIVE" -C "$STAGE" --strip-components=1
  "$STAGE/bin/python3" -I -c 'import ssl,sys; assert sys.version_info[:2] == (3,11)'
  touch "$STAGE/.complete"
  if [ -e "$BASE" ]; then mv "$BASE" "$BASE.incomplete.$(date +%s)"; fi
  mv "$STAGE" "$BASE"
  rmdir "$LOCK"
  trap - EXIT
fi
exec "$BASE/bin/python3" -B "$SOURCE/scripts/setup/cli.py" "$@"
