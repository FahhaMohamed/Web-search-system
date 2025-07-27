#!/bin/sh

FILE="$1"
shift
TIMEOUT=60
INTERVAL=1

echo "Waiting for $FILE..."

for i in $(seq 1 $TIMEOUT); do
  if [ -f "$FILE" ]; then
    echo "Found $FILE"
    exec "$@"
    exit 0
  fi
  sleep $INTERVAL
done

echo "Timed out waiting for $FILE"
exit 1
