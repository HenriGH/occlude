#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
node --version
npm --cache /tmp/occlude-npm-cache ci
npm --cache /tmp/occlude-npm-cache run build
TZ=Europe/Berlin npm --cache /tmp/occlude-npm-cache test
