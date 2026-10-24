// Cat PDF — safe bridge between the renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('catpdf', {
  /** @returns {Promise<{url: string, token: string, ready: boolean, error: string|null}>} */
  getBackend: () => ipcRenderer.invoke('backend:get'),
  getBackendLog: () => ipcRenderer.invoke('backend:log'),
  /** Starts a fresh backend process if the previous one is gone. */
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  onBackendReady: (cb) => ipcRenderer.on('backend:ready', () => cb()),
  onBackendError: (cb) => ipcRenderer.on('backend:error', (_e, msg) => cb(msg)),

  /** kind: 'pdf' | 'images' | 'docx' | 'md' | 'mergeable'. Resolves to an array of absolute paths ([] if cancelled). */
  openFiles: (opts) => ipcRenderer.invoke('dialog:open', opts),
  /** Resolves to an absolute path or null if cancelled. */
  saveFile: (opts) => ipcRenderer.invoke('dialog:save', opts),

  openPath: (p) => ipcRenderer.invoke('shell:open', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  /** Absolute path of a File from drag & drop / <input type=file>. */
  pathForFile: (file) => webUtils.getPathForFile(file),
});
