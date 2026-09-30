// Dev-only: boot the built game in Electron offscreen and capture PNGs
// (idle menu + mid-gameplay) so the visuals can be inspected headlessly.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const root = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(root, rel));
    const safe = file === root || file.startsWith(root + path.sep);
    const target = safe ? file : path.join(root, 'index.html');
    return net.fetch(pathToFileURL(target).toString());
  });

  const win = new BrowserWindow({
    width: 1060,
    height: 1040,
    show: false,
    backgroundColor: '#0a0118',
    webPreferences: { offscreen: false },
  });
  win.webContents.setBackgroundThrottling(false);

  try {
    await win.loadURL('app://-/index.html');
    await wait(3000);

    let img = await win.webContents.capturePage();
    if (img.isEmpty()) {
      win.show();
      await wait(500);
      img = await win.webContents.capturePage();
    }
    fs.writeFileSync(path.join(__dirname, '..', 'shot-idle.png'), img.toPNG());

    await win.webContents.executeJavaScript(
      `(() => { const b = document.querySelector('.btn-primary'); if (b) b.click(); return !!b; })()`,
    );
    await win.webContents.executeJavaScript(
      `(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); return true; })()`,
    );
    await wait(2600);
    img = await win.webContents.capturePage();
    if (img.isEmpty()) {
      await wait(400);
      img = await win.webContents.capturePage();
    }
    fs.writeFileSync(path.join(__dirname, '..', 'shot-playing.png'), img.toPNG());

    console.log('screenshots written');
  } catch (err) {
    console.error('screenshot failed:', err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});