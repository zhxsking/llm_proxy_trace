#!/usr/bin/env bash
set -e
[ ! -d node_modules ] && npm install
[ ! -f dist/web/index.html ] && npm run build
node dist/index.js
