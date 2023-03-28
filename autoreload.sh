#!/usr/bin/env bash
set -euo pipefail

air --build.cmd "go build -o /tmp/cgp *.go" --build.bin "/tmp/cgp"
