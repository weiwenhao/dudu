#!/bin/sh
set -eu

bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
dsh_cli=${DUDU_DSH_CLI:-}
if [ -z "$dsh_cli" ]; then
  for candidate in \
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
    "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"; do
    if [ -x "$candidate" ]; then
      dsh_cli=$candidate
      break
    fi
  done
fi
if [ -z "$dsh_cli" ]; then
  dsh_cli=$(command -v dsh || true)
fi
if [ -z "$dsh_cli" ] || [ ! -x "$dsh_cli" ]; then
  echo "DeepSeek Harness CLI was not found. Install DSH, or set DUDU_DSH_CLI to its CLI path." >&2
  exit 1
fi
set -- "$bundle_dir"/*.tgz
if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "Keep this installer next to the dudu .tgz file." >&2
  exit 1
fi
"$dsh_cli" plugin --profile desktop add "file:$1"
echo ""
echo "dudu installed. Keep DeepSeek Harness running."
echo "Open this address on your computer: http://127.0.0.1:3098/"
