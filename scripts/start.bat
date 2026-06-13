@echo off
if not exist node_modules npm install
if not exist dist\web\index.html npm run build
node dist/index.js
