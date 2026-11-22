#!/bin/sh
# Restore a backup into a database. DESTRUCTIVE for objects in the TARGET database.
# Restore into a NEW database first, verify, then switch DATABASE_URL.
#   PGHOST=... PGUSER=... PGPASSWORD=... ./scripts/restore.sh backups/kite-20270114T020000Z.dump kite_restore
set -eu
FILE="${1:?backup file required}"
TARGET="${2:?target database name required}"
echo "Restoring $FILE into database '$TARGET'."
createdb "$TARGET" 2>/dev/null || echo "(database $TARGET already exists — its objects will be replaced)"
pg_restore --clean --if-exists --no-owner --dbname="$TARGET" "$FILE"
psql -d "$TARGET" -c "SELECT count(*) AS invoices FROM invoices" -c "SELECT count(*) AS users FROM users"
echo "restore ok"
