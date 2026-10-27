const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
for (const folder of ['app', 'extension', 'scripts', 'tests']) {
  for (const entry of fs.readdirSync(folder, { recursive: true })) {
    const file = path.join(folder, entry);
    if (/\.(cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (/\.json$/.test(file)) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
const manifest = require('../extension/manifest.json');
for (const file of ['background.js', 'content.js', 'popup.html', 'popup.js', 'popup.css', ...Object.values(manifest.icons)]) {
  if (!fs.existsSync(path.join('extension', file))) throw new Error(`Missing extension file: ${file}`);
}
console.log('All JavaScript, JSON, and extension assets checked.');
