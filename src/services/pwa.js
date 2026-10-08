/**
 * Service Worker والتخزين.
 *
 * حقيقة مهمة موثّقة في docs/offline-strategy.md: Service Worker **لا يعمل** من
 * بروتوكول file://. التطبيق يحتاج http://localhost أو HTTPS. نكشف ذلك للمستخدم
 * صراحةً في شاشة الإعدادات بدل الادعاء أن الأوفلاين مفعّل.
 */

import { appState } from '../state/store.js';

const SW_URL = 'sw.js';

/** هل السياق يسمح بتسجيل Service Worker؟ */
export function offlineCapability() {
  // ملاحظة: Chrome يعتبر file:// سياقاً آمناً (isSecureContext === true)
  // لكنه يرفض تسجيل Service Worker عليه، لذا نفحص البروتوكول صراحةً.
  if (window.location.protocol === 'file:') {
    return {
      ok: false,
      status: 'file',
      message: 'التطبيق يعمل من ملف محلي. كل الوظائف والبيانات تعمل بالكامل، لكن التخزين المؤقت للأصول والتثبيت كتطبيق يحتاجان تشغيله عبر خادم محلي أو HTTPS.',
    };
  }
  if (!('serviceWorker' in navigator)) {
    return { ok: false, status: 'unsupported', message: 'المتصفح لا يدعم Service Worker.' };
  }
  if (!window.isSecureContext) {
    return { ok: false, status: 'insecure', message: 'العمل دون اتصال يتطلب HTTPS أو localhost.' };
  }
  return { ok: true, status: 'ok', message: '' };
}

let registration = null;

/** يسجّل Service Worker ويراقب التحديثات */
export async function registerServiceWorker() {
  const capability = offlineCapability();
  if (!capability.ok) {
    appState.set({ swStatus: capability.status });
    return { ...capability, registration: null };
  }

  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: './' });

    // نسخة جديدة قيد التثبيت
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;

      installing.addEventListener('statechange', () => {
        // "installed" مع وجود controller = نسخة جديدة جاهزة تنتظر التفعيل
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          appState.set({ updateAvailable: true });
        }
      });
    });

    // إذا كان هناك عامل ينتظر بالفعل عند التحميل
    if (registration.waiting && navigator.serviceWorker.controller) {
      appState.set({ updateAvailable: true });
    }

    appState.set({ swStatus: 'active' });
    await readCacheVersion();

    // تحقّق من وجود تحديث عند كل إقلاع
    registration.update().catch(() => {});

    return { ok: true, status: 'active', message: '', registration };
  } catch (error) {
    console.error('[pwa] فشل تسجيل Service Worker:', error);
    appState.set({ swStatus: 'failed' });
    return { ok: false, status: 'failed', message: 'تعذّر تفعيل العمل دون اتصال.', registration: null };
  }
}

/** يسأل العامل النشط عن إصدار الكاش */
async function readCacheVersion() {
  const worker = navigator.serviceWorker.controller;
  if (!worker) return null;

  const version = await new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data?.version || null);
    };
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });

  if (version) appState.set({ cacheVersion: version });
  return version;
}

/**
 * يفعّل النسخة الجديدة ثم يعيد التحميل.
 * لا يُستدعى إلا بعد تأكيد المستخدم، حتى لا يفقد عملاً غير محفوظ.
 */
export async function applyUpdate() {
  if (!registration) registration = await navigator.serviceWorker.getRegistration();
  const waiting = registration?.waiting;

  if (!waiting) {
    window.location.reload();
    return;
  }

  // أعد التحميل مرة واحدة فقط عند تغيّر المتحكّم
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  waiting.postMessage({ type: 'SKIP_WAITING' });

  // احتياط لو لم يُطلق controllerchange
  setTimeout(() => {
    if (!reloaded) window.location.reload();
  }, 3000);
}

/* ------------------------------------------------------------------ */
/* التخزين                                                              */
/* ------------------------------------------------------------------ */

/** يقرأ تقدير مساحة التخزين وحالة الدوام */
export async function readStorageEstimate() {
  if (!navigator.storage?.estimate) {
    appState.set({ storage: { usage: 0, quota: 0, persisted: false, supported: false } });
    return null;
  }

  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const storage = { usage, quota, persisted, supported: true };
    appState.set({ storage });
    return storage;
  } catch (error) {
    console.warn('[pwa] تعذّر قراءة تقدير التخزين:', error);
    return null;
  }
}

/**
 * يطلب تخزيناً دائماً.
 * يجب أن يُستدعى بعد تفاعل واضح من المستخدم (نقرة زر)، لا تلقائياً عند الإقلاع.
 * @returns {Promise<{granted:boolean, message:string}>}
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return { granted: false, message: 'المتصفح لا يدعم التخزين الدائم.' };
  }
  if (!window.isSecureContext) {
    return { granted: false, message: 'التخزين الدائم يتطلب HTTPS أو localhost.' };
  }

  try {
    const granted = await navigator.storage.persist();
    await readStorageEstimate();
    return {
      granted,
      message: granted
        ? 'تم تفعيل التخزين الدائم. لن يُحذف تلقائياً عند امتلاء مساحة الجهاز.'
        : 'لم يمنح المتصفح تخزيناً دائماً. قد يُحذف التخزين المحلي عند ضغط المساحة — احتفظ بنسخ احتياطية منتظمة.',
    };
  } catch (error) {
    return { granted: false, message: `تعذّر طلب التخزين الدائم: ${error.message}` };
  }
}

/* ------------------------------------------------------------------ */
/* حالة الاتصال                                                         */
/* ------------------------------------------------------------------ */

export function watchConnection() {
  const update = () => appState.set({ online: navigator.onLine });
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}
