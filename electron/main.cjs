// PAC-UwU — Electron main process.
// In dev it loads the Vite dev server; in production it serves the built
// `dist/` folder over a custom privileged `app://` protocol (the recommended
// way to load Vite's ES-module bundles, which are blocked over file://).
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = DEV_URL.length > 0;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1060,
    height: 1040,
    minWidth: 720,
    minHeight: 780,
    backgroundColor: '#05060f',
    autoHideMenuBar: true,
    title: 'PAC-UwU',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadURL('app://-/index.html');
  }

  win.webContents.on('did-finish-load', () => {
    console.log('[pac-uwu] renderer loaded:', win.webContents.getURL());
  });
  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[pac-uwu] load failed:', code, desc, url);
  });
}

app.whenReady().then(() => {
  if (!isDev) {
    const root = path.join(__dirname, '..', 'dist');
    protocol.handle('app', (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.normalize(path.join(root, rel));
      // Guard against path traversal outside the dist folder.
      const safe = file === root || file.startsWith(root + path.sep);
      const target = safe ? file : path.join(root, 'index.html');
      return net.fetch(pathToFileURL(target).toString());
    });
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
