// Cat PDF — Electron main process.
// Opens the window, then starts the local Python backend on a free 127.0.0.1 port
// (retrying on another port if one turns out to be busy).
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const ICON = path.join(ROOT, 'assets', 'icon.png');

const START_ATTEMPTS = 8;          // ports tried before giving up
const READY_TIMEOUT_MS = 60000;    // first launch of the bundled backend can be slow (antivirus scan)
const EXIT_PORT_BUSY = 3;          // backend exit code when it can't bind its port

let mainWindow = null;
let backendProc = null;
let starting = null;
// url/token are only published once the backend answered an authenticated request.
const backend = { url: null, token: null, ready: false, error: null, log: [] };

function findPython() {
  if (process.env.CATPDF_PYTHON) return process.env.CATPDF_PYTHON;
  const candidates = process.platform === 'win32'
    ? [path.join(BACKEND_DIR, '.venv', 'Scripts', 'python.exe')]
    : [path.join(BACKEND_DIR, '.venv', 'bin', 'python')];
  return candidates.find((p) => fs.existsSync(p)) || (process.platform === 'win32' ? 'python' : 'python3');
}

/** Installed app: the PyInstaller-built exe shipped in resources/. Dev: the venv's Python. */
function backendCommand(port) {
  const args = ['--port', String(port), '--exit-with-stdin'];
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'catpdf-backend.exe' : 'catpdf-backend');
    return { cmd: exe, args, cwd: path.dirname(exe) };
  }
  return { cmd: findPython(), args: ['-m', 'catpdf', ...args], cwd: BACKEND_DIR };
}

/** Ask the OS for a currently free 127.0.0.1 port (0 = let the backend pick one itself). */
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(0));
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let logFile = null;
function pushLog(line) {
  backend.log.push(line);
  if (backend.log.length > 200) backend.log.shift();
  try {
    if (!logFile) {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, 'backend.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.rmSync(logFile);
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never break the app */ }
}

/** True once the backend answers a token-protected endpoint, i.e. it's ours and reachable. */
async function handshake(url, token) {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${url}/convert/docx/engines`, { headers: { 'X-CatPDF-Token': token } });
      if (res.ok) return true;
    } catch { /* not reachable yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Start one backend process on `port`. Resolves with {proc, port} once it printed
 * CATPDF_READY and passed the handshake; rejects with {busy, message} otherwise.
 */
function launchOnce(port, token) {
  return new Promise((resolve, reject) => {
    const { cmd, args, cwd } = backendCommand(port);
    pushLog(`starting backend on port ${port || 'auto'}: ${cmd}`);
    let proc;
    try {
      proc = spawn(cmd, args, {
        cwd,
        env: { ...process.env, CATPDF_TOKEN: token, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
        stdio: ['pipe', 'pipe', 'pipe'],  // stdin stays open: the backend exits when we disappear
        windowsHide: true,
      });
    } catch (err) {
      reject({ busy: false, message: `Could not start the backend (${cmd}): ${err.message}` });
      return;
    }
    let settled = false;
    let buffer = '';
    let bindError = false;
    const fail = (busy, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* gone */ }
      reject({ busy, message });
    };
    const timer = setTimeout(() => fail(false, 'The backend took too long to start.'), READY_TIMEOUT_MS);

    proc.stdout.on('data', (buf) => {
      buffer += buf.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines.filter(Boolean)) {
        pushLog(line);
        const m = /^CATPDF_READY (\d+)/.exec(line);
        if (m && !settled) {
          const realPort = Number(m[1]);  // the backend's word wins (matters for port 0)
          handshake(`http://127.0.0.1:${realPort}`, token).then((ok) => {
            if (!ok) return fail(true, `Port ${realPort} answered, but not as Cat PDF.`);
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ proc, port: realPort });
          });
        }
      }
    });
    proc.stderr.on('data', (buf) => buf.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
      pushLog(line);
      if (/10048|10013|address already in use|attempting to bind/i.test(line)) bindError = true;
    }));
    proc.on('error', (err) => fail(false, `Could not start the backend (${cmd}): ${err.message}.${app.isPackaged ? '' : ' Did you run scripts\\setup.ps1?'}`));
    proc.on('exit', (code) => {
      fail(code === EXIT_PORT_BUSY || bindError, `The backend stopped while starting (exit code ${code}).`);
    });
  });
}

async function startBackend() {
  // Allow pointing at an already-running backend (e.g. `npm run backend` in --dev mode).
  if (process.env.CATPDF_BACKEND_URL) {
    backend.url = process.env.CATPDF_BACKEND_URL.replace(/\/$/, '');
    backend.token = process.env.CATPDF_TOKEN || '';
    backend.ready = true;
    return;
  }
  const token = crypto.randomBytes(24).toString('hex');
  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt++) {
    // Normally a port the OS just reported free; if something grabs it first we try another.
    // The last attempt lets the backend bind any free port itself and report it.
    // CATPDF_TEST_PORTS ("5000,5001,...") forces the ports tried, to test the busy-port path.
    const port = process.env.CATPDF_TEST_PORTS
      ? Number(process.env.CATPDF_TEST_PORTS.split(',')[attempt - 1] || 0)
      : attempt === START_ATTEMPTS ? 0 : await freePort();
    try {
      const { proc, port: realPort } = await launchOnce(port, token);
      backendProc = proc;
      Object.assign(backend, { url: `http://127.0.0.1:${realPort}`, token, ready: true, error: null });
      pushLog(`backend ready on port ${realPort} (attempt ${attempt})`);
      proc.on('exit', (code) => {
        // Ignore the exit of a process we replaced via backend:restart.
        if (app.isQuitting || proc !== backendProc) return;
        backend.ready = false;
        backend.error = `The backend stopped (exit code ${code}).\n${backend.log.slice(-8).join('\n')}`;
        mainWindow?.webContents.send('backend:error', backend.error);
      });
      mainWindow?.webContents.send('backend:ready');
      return;
    } catch (err) {
      lastError = err.message;
      pushLog(`attempt ${attempt} failed: ${err.message}`);
      if (!err.busy) break;  // only a busy port is worth retrying
    }
  }
  backend.error = `${lastError}\n${backend.log.slice(-8).join('\n')}`;
  mainWindow?.webContents.send('backend:error', backend.error);
}

function ensureBackend() {
  if (!starting) starting = startBackend().finally(() => { starting = null; });
  return starting;
}

function stopBackend() {
  const proc = backendProc;
  if (proc && proc.exitCode === null) {
    try {
      proc.stdin.end();  // the backend exits on its own when stdin closes
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { windowsHide: true });
      else proc.kill();
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
  if (!starting) {
    stopBackend();
    Object.assign(backend, { url: null, token: null, ready: false, error: null, log: [] });
  }
  await ensureBackend();
  return backend.ready;
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
// One Cat PDF at a time: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.catpdf.app');
    createWindow();  // shows the "waking up the cat" splash while the backend starts
    ensureBackend();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('before-quit', () => { app.isQuitting = true; stopBackend(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('exit', stopBackend);
