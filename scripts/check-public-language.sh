#!/usr/bin/env bash
# Public-wording discipline for user-facing surfaces (README, docs, package.json,
# server.json, smithery.yaml). Two classes:
#   1) estate leaks — workspace-specific names/GIDs must never ship
#   2) banned framing — words every competing listing leans on
set -euo pipefail
cd "$(dirname "$0")/.."
FILES=(README.md package.json server.json smithery.yaml docs/*.md src/*.js lib/*.js)
fail=0
# 1) estate leaks (case-sensitive where it matters)
if grep -nE '\b1[0-9]{15}\b' "${FILES[@]}" 2>/dev/null; then
  echo "ERROR: 16-digit GID literal in a public surface" >&2; fail=1
fi
if grep -niE 'gwen|revasser|dispute board|disputes board' "${FILES[@]}" 2>/dev/null; then
  echo "ERROR: estate name in a public surface" >&2; fail=1
fi
# 2) banned framing (README + manifests only — docs may quote them when comparing)
if grep -niE '\b(seamless|game.chang|revolutioniz)\w*' README.md package.json server.json smithery.yaml 2>/dev/null; then
  echo "ERROR: banned marketing framing" >&2; fail=1
fi
[ "$fail" -eq 0 ] && echo "public-language check OK"
exit "$fail"
