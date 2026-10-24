// Cat PDF — backend client. Every request carries the X-CatPDF-Token header.

const bridge = window.catpdf;
const backend = { url: null, token: '', ready: false };

export class ApiError extends Error {
  constructor(detail, status = 0) {
    super(detail);
    this.detail = detail;
    this.status = status;
  }
}

export function backendInfo() {
  return { ...backend };
}

/**
 * Wait until the backend answers /health.
 * hooks.onWaiting() — called once if we need to wait (show splash).
 * hooks.onError(message) — backend failed to start / crashed.
 * Resolves once healthy.
 */
export function connectBackend(hooks = {}) {
  return new Promise((resolve) => {
    let done = false;
    let waitingShown = false;
    let timer = null;

    const showWaiting = () => {
      if (!waitingShown) { waitingShown = true; hooks.onWaiting?.(); }
    };

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      backend.ready = true;
      resolve(backendInfo());
    };

    const refresh = async () => {
      try {
        const b = await bridge.getBackend();
        if (b.url) backend.url = b.url;
        backend.token = b.token || '';
        if (b.error) hooks.onError?.(b.error);
      } catch (err) {
        hooks.onError?.(`Could not reach the Electron main process: ${err.message}`);
      }
    };

    const poll = async () => {
      if (done) return;
      if (!backend.url) await refresh();
      if (backend.url) {
        try {
          const res = await fetch(`${backend.url}/health`, { cache: 'no-store' });
          if (res.ok) { finish(); return; }
        } catch { /* not up yet */ }
      }
      showWaiting();
      timer = setTimeout(poll, 300);
    };

    bridge.onBackendReady?.(async () => { await refresh(); poll(); });
    bridge.onBackendError?.((msg) => { backend.ready = false; hooks.onError?.(msg); });

    refresh().then(poll);
  });
}

export async function getBackendLog() {
  try { return await bridge.getBackendLog(); } catch { return ''; }
}

async function request(method, path, body) {
  if (!backend.url) throw new ApiError('The cat is still waking up — the backend is not ready yet.');
  let res;
  try {
    res = await fetch(`${backend.url}${path}`, {
      method,
      headers: {
        'X-CatPDF-Token': backend.token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Could not reach the Cat PDF backend. It may have stopped — try restarting the app.');
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    let detail = data?.detail;
    if (Array.isArray(detail)) detail = detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
    else if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
    throw new ApiError(detail || `Something went wrong (HTTP ${res.status}).`, res.status);
  }
  return data;
}

export function renderUrl(path, page, width = 300) {
  const w = Math.max(50, Math.min(2400, Math.round(width)));
  return `${backend.url}/pdf/render?path=${encodeURIComponent(path)}&page=${page}&width=${w}&token=${encodeURIComponent(backend.token)}`;
}

const infoCache = new Map();

export const api = {
  health: () => request('GET', '/health'),
  /** Cached per path for the session; pass fresh=true to re-read. */
  info: async (path, fresh = false) => {
    if (!fresh && infoCache.has(path)) return infoCache.get(path);
    const data = await request('POST', '/pdf/info', { path });
    infoCache.set(path, data);
    return data;
  },
  text: (path, page) => request('POST', '/pdf/text', { path, page }),
  merge: (inputs, output) => request('POST', '/merge', { inputs, output }),
  applyEdits: (payload) => request('POST', '/edit/apply', payload),
  docxEngines: () => request('GET', '/convert/docx/engines'),
  convertDocx: (input, output, engine = 'auto') => request('POST', '/convert/docx', { input, output, engine }),
  convertImages: (payload) => request('POST', '/convert/images', payload),
  markdown: (payload) => request('POST', '/convert/markdown', payload),
};

/* ---------------------------------------------------------- path helpers */

export function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}

export function dirName(p) {
  const s = String(p);
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(0, i) : '';
}

export function stem(p) {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(0, i) : b;
}

export function ext(p) {
  const b = baseName(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

/** Suggest a sibling path: siblingPath('C:/a/report.pdf', '-merged', 'pdf') → C:/a/report-merged.pdf */
export function siblingPath(p, suffix, extension) {
  const dir = dirName(p);
  const sep = String(p).includes('\\') ? '\\' : '/';
  const name = `${stem(p)}${suffix}.${extension}`;
  return dir ? `${dir}${sep}${name}` : name;
}

/** file:// URL for a local path (used for image thumbnails). */
export function fileUrl(p) {
  const norm = String(p).replace(/\\/g, '/');
  const parts = norm.split('/').map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg)));
  const joined = parts.join('/');
  return joined.startsWith('/') ? `file://${joined}` : `file:///${joined}`;
}

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'];
export const BROWSER_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'];

export function fileKind(p) {
  const e = ext(p);
  if (e === 'pdf') return 'pdf';
  if (e === 'docx') return 'docx';
  if (IMAGE_EXT.includes(e)) return 'image';
  return 'other';
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
