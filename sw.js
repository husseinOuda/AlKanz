/**
 * Service Worker — App Shell للعمل دون اتصال.
 *
 * فصل واضح للمسؤوليات:
 *  - Cache Storage: أصول التطبيق فقط (HTML/CSS/JS/أيقونات).
 *  - IndexedDB: بيانات العمل. لا يلمسها هذا الملف إطلاقاً.
 *
 * استراتيجية:
 *  - التنقّل (navigate): الشبكة أولاً مع مهلة، ثم index.html من الكاش.
 *    يضمن الحصول على نسخة أحدث عند التوفر دون تعطيل العمل دون اتصال.
 *  - الأصول: Cache First — الأصول مُصدَّرة مع الكاش، وأي تغيير يعني إصداراً جديداً.
 */

const CACHE_VERSION = 'sales-v4';
const PRECACHE = `${CACHE_VERSION}-shell`;

const SHELL_ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/css/print.css',
  'assets/css/print-thermal.css',
  'assets/fonts/fonts.css',
  'assets/fonts/tajawal-400-arabic.woff2',
  'assets/fonts/tajawal-400-latin.woff2',
  'assets/fonts/tajawal-500-arabic.woff2',
  'assets/fonts/tajawal-500-latin.woff2',
  'assets/fonts/tajawal-700-arabic.woff2',
  'assets/fonts/tajawal-700-latin.woff2',
  'assets/icons/favicon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/alkanz_desktop_icon_256.png',

  'src/boot-guard.js',
  'src/app.js',
  'src/router.js',
  'src/routes.js',
  'src/state/store.js',
  'src/db/db.js',
  'src/db/schema.js',
  'src/db/seed.js',
  'src/repositories/settings.js',
  'src/repositories/products.js',
  'src/repositories/inventory.js',
  'src/repositories/customers.js',
  'src/repositories/sales.js',
  'src/repositories/expenses.js',
  'src/repositories/purchasing.js',
  'src/services/reports.js',
  'src/services/backup.js',
  'src/services/excel.js',
  'src/services/print.js',
  'src/services/images.js',
  'src/services/pwa.js',
  'src/components/icons.js',
  'src/components/ui.js',
  'src/components/table.js',
  'src/components/charts.js',
  'src/components/shell.js',
  'src/components/feedback.js',
  'src/views/dashboard.js',
  'src/views/pos.js',
  'src/views/products.js',
  'src/views/product-form.js',
  'src/views/inventory.js',
  'src/views/reorder.js',
  'src/views/purchases.js',
  'src/views/invoices.js',
  'src/views/invoice-detail.js',
  'src/views/customers.js',
  'src/views/expenses.js',
  'src/views/reports.js',
  'src/views/backup.js',
  'src/views/settings.js',
  'src/utils/dom.js',
  'src/utils/money.js',
  'src/utils/format.js',
  'src/utils/dates.js',
  'src/utils/id.js',
  'src/utils/xlsx.js',
  'src/validation/validators.js',
];

const NAVIGATION_TIMEOUT = 3000;

/* ----------------------------- التثبيت ----------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // addAll يفشل كلياً إذا فشل أصل واحد؛ نضيف كلاً على حدة حتى لا يُفشل
    // ملفٌ واحد مفقود التثبيتَ بأكمله، ونسجّل ما فشل.
    const results = await Promise.allSettled(
      SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: 'reload' })))
    );
    const failed = results
      .map((result, index) => (result.status === 'rejected' ? SHELL_ASSETS[index] : null))
      .filter(Boolean);
    if (failed.length > 0) console.warn('[sw] أصول لم تُخزَّن:', failed);
  })());
});

/* ----------------------------- التفعيل ----------------------------- */

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('sales-') && name !== PRECACHE)
        .map((name) => caches.delete(name))
    );

    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ------------------------------ الجلب ------------------------------ */

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // لا نتدخّل في طلبات خارجية

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }

  event.respondWith(handleAsset(request));
});

/** التنقّل: شبكة أولاً بمهلة قصيرة، ثم index.html من الكاش */
async function handleNavigation(event) {
  const cache = await caches.open(PRECACHE);

  try {
    const preload = await event.preloadResponse;
    if (preload) {
      cache.put('index.html', preload.clone()).catch(() => {});
      return preload;
    }

    const response = await withTimeout(fetch(event.request), NAVIGATION_TIMEOUT);
    if (response && response.ok) {
      cache.put('index.html', response.clone()).catch(() => {});
      return response;
    }
    throw new Error('استجابة غير صالحة');
  } catch {
    const cached = await cache.match('index.html') || await cache.match('./');
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><h1>غير متصل</h1><p>افتح التطبيق مرة واحدة على الأقل وأنت متصل بالإنترنت.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/** الأصول: الكاش أولاً، ثم الشبكة مع تخزين النتيجة */
async function handleAsset(request) {
  const cache = await caches.open(PRECACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // خزّن فقط الاستجابات الناجحة من نفس الأصل
    if (response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    // أصل مفقود دون اتصال — نرجع خطأ واضحاً بدل استجابة فارغة صامتة
    return new Response('', { status: 504, statusText: 'الأصل غير متاح دون اتصال' });
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('انتهت المهلة')), ms)),
  ]);
}

/* ----------------------------- الرسائل ----------------------------- */

self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION });
  }
});
