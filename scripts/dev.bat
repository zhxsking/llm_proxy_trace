@echo off
start "LPT Backend"  cmd /k "npx tsx watch src/index.ts"
start "LPT Frontend" cmd /k "npx vite --config src/web/vite.config.ts"
