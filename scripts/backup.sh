#!/bin/sh
# Compressed logical backup of the kite database. Keeps KEEP_DAYS days of dumps in BACKUP_DIR.
# Uses the standard PG* environment variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
set -eu
DIR="${BACKUP_DIR:-/backups}"
KEEP="${KEEP_DAYS:-30}"
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$DIR/kite-$STAMP.dump"
pg_dump --format=custom --compress=9 --no-owner --file="$FILE.partial"
mv "$FILE.partial" "$FILE"
# Retention: remove only our own dump files older than KEEP days.
find "$DIR" -maxdepth 1 -type f -name 'kite-*.dump' -mtime +"$KEEP" -exec rm -f {} \;
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
