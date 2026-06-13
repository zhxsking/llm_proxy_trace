const path = require('path');
/** @type {import('tailwindcss').Config} */
module.exports = {
  // 不使用 Tailwind 暗色模式——主题通过 CSS Variables + data-theme 实现
  darkMode: 'class',
  content: [
    path.resolve(__dirname, 'index.html'),
    path.resolve(__dirname, 'components/**/*.{ts,tsx}'),
    path.resolve(__dirname, 'hooks/**/*.{ts,tsx}'),
    path.resolve(__dirname, 'App.tsx'),
    path.resolve(__dirname, 'main.tsx'),
  ],
  // 不覆盖颜色——颜色全由 index.css CSS Variables 管理
  theme: {},
  plugins: [],
};
