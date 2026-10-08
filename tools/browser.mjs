/**
 * مشغّل متصفح Chromium عبر بروتوكول CDP — أداة تطوير فقط.
 *
 * يُستخدم لتشغيل الاختبارات بلا واجهة والتقاط لقطات الشاشة للمراجعة البصرية.
 * لا علاقة له بالتطبيق نفسه: المنتج النهائي ملفات ثابتة لا يحتاج Node إطلاقاً.
 *
 * لا يتطلب npm install: يستخدم متصفح النظام و`ws` من الحزم العامة إن وُجدت،
 * ويسقط إلى تنفيذ WebSocket يدوي بسيط عند عدم توفّرها.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** يحمّل ws من الحزم العامة */
function loadWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(require.resolve('ws', { paths: [globalRoot] }));
  } catch {
    throw new Error('تعذّر إيجاد WebSocket. استخدم Node 22+ أو ثبّت ws عالمياً: npm i -g ws');
  }
}

const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findBrowser() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const found = BROWSER_PATHS.find((path) => existsSync(path));
  if (!found) throw new Error('لم يُعثر على متصفح Chromium. عيّن CHROME_PATH.');
  return found;
}

/** يطلق متصفحاً بلا واجهة ويرجع جلسة CDP */
export async function launch({ headless = true, width = 1680, height = 941 } = {}) {
  const WebSocketImpl = loadWebSocket();
  const executable = findBrowser();
  const profileDir = mkdtempSync(join(tmpdir(), 'cdp-profile-'));
  const port = 9200 + Math.floor(Math.random() * 500);

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-gpu',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');

  const child = spawn(executable, args, { stdio: 'ignore', detached: false });

  // انتظر جهوزية نقطة التصحيح
  let wsUrl = null;
  for (let attempt = 0; attempt < 60 && !wsUrl; attempt += 1) {
    await sleep(250);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await response.json()).webSocketDebuggerUrl;
    } catch { /* لم يبدأ بعد */ }
  }
  if (!wsUrl) {
    child.kill();
    throw new Error('تعذّر الاتصال بالمتصفح');
  }

  const socket = new WebSocketImpl(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = (event) => reject(new Error(`فشل اتصال CDP: ${event.message || ''}`));
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  socket.onmessage = (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
      return;
    }

    const handlers = listeners.get(message.method);
    if (handlers) for (const handler of handlers) handler(message.params, message.sessionId);
  };

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`انتهت مهلة ${method}`));
        }
      }, 60_000);
    });
  }

  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
    return () => listeners.get(method).delete(handler);
  }

  // افتح هدفاً وأرفق به
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  const session = {
    send: (method, params) => send(method, params, sessionId),
    on,
    sessionId,
  };

  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Log.enable');
  await session.send('Network.enable');
  await session.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });

  /* --------------------------- جمع رسائل الطرفية --------------------------- */

  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];

  session.on('Runtime.consoleAPICalled', (params) => {
    if (params.sessionId && params.sessionId !== sessionId) return;
    const text = (params.args || [])
      .map((arg) => arg.value ?? arg.description ?? (arg.preview ? previewToText(arg.preview) : arg.type))
      .join(' ');
    consoleMessages.push({ type: params.type, text });
  });

  session.on('Runtime.exceptionThrown', (params) => {
    const detail = params.exceptionDetails;
    pageErrors.push(detail.exception?.description || detail.text || 'خطأ غير معروف');
  });

  session.on('Log.entryAdded', (params) => {
    const entry = params.entry;
    if (entry.level === 'error') {
      pageErrors.push(`${entry.source}: ${entry.text} ${entry.url || ''}`);
    }
  });

  session.on('Network.loadingFailed', (params) => {
    if (params.type === 'Image' || params.type === 'Font') return;
    failedRequests.push(`${params.type}: ${params.errorText}`);
  });

  /* --------------------------------- API --------------------------------- */

  async function goto(url, { waitFor = 'load' } = {}) {
    const loaded = new Promise((resolve) => {
      const off = session.on(waitFor === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired', () => {
        off();
        resolve();
      });
      setTimeout(resolve, 25_000);
    });
    await session.send('Page.navigate', { url });
    await loaded;
  }

  async function evaluate(expression, { awaitPromise = true } = {}) {
    const result = await session.send('Runtime.evaluate', {
      expression: typeof expression === 'function' ? `(${expression})()` : expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  /** ينتظر حتى يصبح تعبير JS صادقاً */
  async function waitFor(expression, { timeout = 20_000, interval = 120, label = '' } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch { /* الصفحة قد تكون تُحمَّل */ }
      await sleep(interval);
    }
    throw new Error(`انتهت المهلة بانتظار: ${label || expression}`);
  }

  let viewport = { width, height, mobile: false };

  /**
   * لقطة شاشة. fullPage يوسّع نافذة العرض مؤقتاً بدل استخدام clip،
   * لأن clip مع captureBeyondViewport يشوّه العناصر ذات position: sticky/fixed.
   */
  async function screenshot(path, { fullPage = false } = {}) {
    let resized = false;

    if (fullPage) {
      const metrics = await session.send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      const fullHeight = Math.min(Math.ceil(size.height), 12000);

      if (fullHeight > viewport.height) {
        await session.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width, height: fullHeight,
          deviceScaleFactor: 1, mobile: viewport.mobile,
        });
        resized = true;
        await sleep(220); // امنح التخطيط فرصة الاستقرار بعد التوسيع
      }
    }

    const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(data, 'base64'));

    if (resized) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height,
        deviceScaleFactor: 1, mobile: viewport.mobile,
      });
      await sleep(120);
    }
    return path;
  }

  async function setViewport(w, hh, mobile = false) {
    viewport = { width: w, height: hh, mobile };
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: hh, deviceScaleFactor: 1, mobile,
    });
  }

  async function click(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }

  async function close() {
    try { await send('Browser.close'); } catch { /* قد يكون مغلقاً */ }
    try { socket.close(); } catch { /* تجاهل */ }
    child.kill();
    await sleep(300);
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* مقفل على ويندوز */ }
  }

  return {
    session, goto, evaluate, waitFor, screenshot, setViewport, click, close,
    consoleMessages, pageErrors, failedRequests,
    clearLogs() {
      consoleMessages.length = 0;
      pageErrors.length = 0;
      failedRequests.length = 0;
    },
  };
}

function previewToText(preview) {
  if (!preview.properties) return preview.description || '';
  return `{${preview.properties.map((p) => `${p.name}: ${p.value}`).join(', ')}}`;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** يشغّل خادم ملفات ثابتة بسيطاً للاختبار */
export function serveStatic(rootDir, port) {
  return new Promise((resolve) => {
    import('node:http').then(({ createServer }) => {
      import('node:fs').then((fs) => {
        import('node:path').then((path) => {
          const MIME = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.mjs': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.webmanifest': 'application/manifest+json; charset=utf-8',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
          };

          const server = createServer((req, res) => {
            const urlPath = decodeURIComponent(req.url.split('?')[0]);
            let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);

            // امنع الخروج من جذر المشروع
            if (!filePath.startsWith(rootDir)) {
              res.writeHead(403).end('forbidden');
              return;
            }
            if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
              filePath = path.join(filePath, 'index.html');
            }
            if (!fs.existsSync(filePath)) {
              res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
              return;
            }

            res.writeHead(200, {
              'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
              'Cache-Control': 'no-store',
              'Service-Worker-Allowed': '/',
            });
            fs.createReadStream(filePath).pipe(res);
          });

          server.listen(port, '127.0.0.1', () => resolve(server));
        });
      });
    });
  });
}
