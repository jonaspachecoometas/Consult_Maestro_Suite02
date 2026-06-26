#!/bin/bash
set -e
npm install
# db:push is best-effort. drizzle-kit may prompt interactively for create-vs-
# rename ambiguities (e.g. when a new table is added that resembles a renamed
# one) and inquirer can hang in the non-TTY post-merge context even with
# --force. Cap with a hard timeout and continue regardless.
timeout 30s bash -c "yes '' | npm run db:push -- --force" \
    || echo "[post-merge] db:push skipped or timed out (non-fatal)"
