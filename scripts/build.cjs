const fs = require('node:fs/promises');
const path = require('node:path');
async function build() {
  const { packager } = await import('@electron/packager');
  const apps = await packager({
    dir: path.resolve(__dirname, '..'), out: 'dist', name: 'Frame',
    platform: 'darwin', arch: process.arch, overwrite: true,
    appBundleId: 'local.frame.youtube-presence', appCategoryType: 'public.app-category.social-networking',
    icon: 'assets/Frame.icns', asar: false,
    ignore: [/^\/dist($|\/)/, /^\/\.test-output($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/\.git($|\/)/, /^\/assets\/Frame\.iconset($|\/)/],
    prune: true, osxSign: false,
  });
  await fs.cp('extension', 'dist/Frame Chrome Extension', { recursive: true });
  await fs.copyFile('README.md', 'dist/START HERE.md');
  for (const app of apps) console.log(`Built ${app}/Frame.app`);
  console.log('Chrome extension: dist/Frame Chrome Extension');
}
build().catch(error => { console.error(error); process.exitCode = 1; });
