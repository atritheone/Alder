#!/bin/bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SOURCE/setup.sh" update "$@"
