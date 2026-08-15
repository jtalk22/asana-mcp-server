#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${1:-@jtalk22/asana-mcp}"

PUBLISH_USER="$(npm whoami)"
echo "Authenticated npm user: ${PUBLISH_USER}"

if ! OWNER_LIST="$(npm owner ls "${PACKAGE_NAME}" 2>/dev/null)"; then
  echo "Package ${PACKAGE_NAME} not on the registry yet (first publish) — whoami check passed, owner check skipped."
  exit 0
fi
printf '%s\n' "${OWNER_LIST}"

if ! printf '%s\n' "${OWNER_LIST}" | grep -Eq "^${PUBLISH_USER}[[:space:]]+<"; then
  echo "Authenticated npm user '${PUBLISH_USER}' is not listed as an owner for ${PACKAGE_NAME}." >&2
  exit 1
fi

echo "npm publish auth check passed for ${PACKAGE_NAME}."
