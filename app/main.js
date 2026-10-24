// Cat PDF — Electron main process.
// Spawns the local Python backend on a free 127.0.0.1 port, then opens the window.
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const ICON = path.join(ROOT, 'assets', 'icon.png');

let mainWindow = null;
let backendProc = null;
const backend = { url: null, token: null, ready: false, error: null, log: [] };

function findPython() {
  if (process.env.CATPDF_PYTHON) return process.env.CATPDF_PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe')]
    : [path.join(BACKEND_DIR, '.venv', 'bin', 'python')];
  return candidates.find((p) => fs.existsSync(p)) || (process.platform === 'win32' ? 'python' : 'python3');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function pushLog(line) {
  backend.log.push(line);
  if (backend.log.length > 200) backend.log.shift();
}

async function startBackend() {
  // Allow pointing at an already-running backend (e.g. `npm run backend` in --dev mode).
  if (process.env.CATPDF_BACKEND_URL) {
    backend.url = process.env.CATPDF_BACKEND_URL.replace(/\/$/, '');
    backend.token = process.env.CATPDF_TOKEN || '';
    backend.ready = true;
    return;
  }
  const port = await freePort();
  backend.token = crypto.randomBytes(24).toString('hex');
  backend.url = `http://127.0.0.1:${port}`;
  const python = findPython();
  const proc = spawn(python, ['-m', 'catpdf', '--port', String(port)], {
    cwd: BACKEND_DIR,
    env: { ...process.env, CATPDF_TOKEN: backend.token, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
  });
  backendProc = proc;
  proc.stdout.on('data', (buf) => {
    const text = buf.toString();
    text.split(/\r?\n/).filter(Boolean).forEach(pushLog);
    if (text.includes('CATPDF_READY')) {
      backend.ready = true;
      mainWindow?.webContents.send('backend:ready');
    }
  });
  proc.stderr.on('data', (buf) => buf.toString().split(/\r?\n/).filter(Boolean).forEach(pushLog));
  proc.on('error', (err) => {
    backend.error = `Could not start the Python backend (${python}): ${err.message}. Did you run scripts\\setup.ps1?`;
    mainWindow?.webContents.send('backend:error', backend.error);
  });
  proc.on('exit', (code) => {
    // Ignore the exit of a process we replaced via backend:restart.
    if (!app.isQuitting && proc === backendProc) {
      backend.ready = false;
      backend.error = `The backend stopped (exit code ${code}).\n${backend.log.slice(-8).join('\n')}`;
      mainWindow?.webContents.send('backend:error', backend.error);
    }
  });
}

function stopBackend() {
  if (backendProc && !backendProc.killed) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(backendProc.pid), '/f', '/t'], { windowsHide: true });
      else backendProc.kill();
    } catch { /* already gone */ }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1000,
    minHeight: 680,
    title: 'Cat PDF',
    icon: fs.existsSync(ICON) ? nativeImage.createFromPath(ICON) : undefined,
    backgroundColor: '#FFF8F0',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Open external links in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---------- IPC ----------
const FILTERS = {
  pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  images: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'] }],
  docx: [{ name: 'Word document', extensions: ['docx'] }],
  md: [{ name: 'Markdown', extensions: ['md'] }],
  mergeable: [{ name: 'PDF, images, DOCX', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp', 'docx'] }],
};

ipcMain.handle('backend:get', () => ({ url: backend.url, token: backend.token, ready: backend.ready, error: backend.error }));
ipcMain.handle('backend:log', () => backend.log.join('\n'));
ipcMain.handle('backend:restart', async () => {
  if (backend.ready) return true;
  stopBackend();
  Object.assign(backend, { url: null, token: null, ready: false, error: null, log: [] });
  await startBackend().catch((err) => { backend.error = err.message; });
  return !backend.error;
});

ipcMain.handle('dialog:open', async (_e, { kind = 'pdf', multiple = false, title } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose files',
    properties: ['openFile', ...(multiple ? ['multiSelections'] : [])],
    filters: [...(FILTERS[kind] || FILTERS.pdf), { name: 'All files', extensions: ['*'] }],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('dialog:save', async (_e, { kind = 'pdf', defaultPath, title } = {}) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: title || 'Save as',
    defaultPath,
    filters: FILTERS[kind] || FILTERS.pdf,
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:show', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  app.setAppUserModelId('com.catpdf.app');
  await startBackend().catch((err) => { backend.error = err.message; });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('exit', stopBackend);
