#!/bin/sh
# Run this before every release (git push). It sets a new VERSION in sw.js,
# which makes every user's browser download the new version of the app.
cd "$(dirname "$0")" || exit 1
NEW=$(date +%Y-%m-%d-%H%M)
sed -i '' "s/^const VERSION = \".*\";/const VERSION = \"$NEW\";/" sw.js
grep -q "const VERSION = \"$NEW\";" sw.js || { echo "Could not update sw.js"; exit 1; }
echo "sw.js VERSION is now $NEW"
