#!/usr/bin/env bash
# make-env.sh — create .env for the Joplin Notebook Map from the host Joplin settings.
# Run from the repo root BEFORE `docker compose up -d`. Writes .env with 0600 perms.
# The token is never committed (see .gitignore).
set -euo pipefail

SETTINGS="${JOPLIN_SETTINGS:-$HOME/.config/joplin/settings.json}"
# NOTE: in agent/container environments HOME may be redirected (e.g. a Hermes
# profile home) — if the token comes out wrong (Joplin answers HTTP 403), point
# JOPLIN_SETTINGS at the real config, e.g.:
#   JOPLIN_SETTINGS=/home/<user>/.config/joplin/settings.json ./scripts/make-env.sh
if [[ ! -f "$SETTINGS" ]]; then
    echo "error: Joplin settings not found at $SETTINGS (set JOPLIN_SETTINGS to override)" >&2
    exit 1
fi

TOKEN="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['api.token'])" "$SETTINGS")"
umask 077
cat > .env <<EOF
JOPLIN_API_TOKEN=${TOKEN}
JOPLIN_API_BASE=http://127.0.0.1:41184
CACHE_TTL=60
NOTE_CACHE_TTL=30
EOF
chmod 600 .env  # explicit — umask only guards newly created files
echo ".env written (perms $(stat -c %a .env)) — token never committed."
