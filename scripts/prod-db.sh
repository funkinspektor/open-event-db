#!/usr/bin/env zsh
# Runs a command against the production database, e.g. migrations or the admin CLI:
#   scripts/prod-db.sh pnpm db:migrate
#   scripts/prod-db.sh pnpm db:cli create-publisher "Name" slug someone@example.org
# Host, port, user and database come from PROD_DB_* in the repo-root .env (kept out of the public repo).
# The password is asked for on every run and only lives in this process' environment.
set -euo pipefail
cd "${0:A:h}/.."

for line in "${(@f)$(grep -E '^PROD_DB_(HOST|PORT|USER|NAME)=' .env 2>/dev/null)}"; do
  [[ -n "$line" ]] && export "$line"
done
for var in PROD_DB_HOST PROD_DB_PORT PROD_DB_USER PROD_DB_NAME; do
  [[ -n "${(P)var:-}" ]] || { print -u2 "$var missing in .env (see .env.example)"; exit 1; }
done
(( $# )) || { print -u2 "usage: scripts/prod-db.sh <command> [args...]"; exit 1; }

read -rs "pw?Password for $PROD_DB_USER@$PROD_DB_HOST: "
print
encoded=$(PW="$pw" node -e 'process.stdout.write(encodeURIComponent(process.env.PW))')
unset pw
export DATABASE_URL="postgres://$PROD_DB_USER:$encoded@$PROD_DB_HOST:$PROD_DB_PORT/$PROD_DB_NAME?sslmode=require"
unset encoded
"$@"
