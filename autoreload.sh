#!/usr/bin/env bash
set -euo pipefail

while true; do
  echo "Restarting ..."
  while ! go build -o /tmp/cgpt; do sleep 1; done
  /tmp/cgpt &
  inotifywait . -r -e modify -e move -e delete -e create || true
  kill -9 $(jobs -p) || true &>/dev/null
done
