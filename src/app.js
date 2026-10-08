/** نقطة دخول التطبيق. */

import { render } from './utils/dom.js';
import { startRouter, navigate } from './router.js';
import { registerRoutes } from './routes.js';
import { buildShell, mountShell, bootError } from './components/shell.js';
import { closeOverlays, toastError, toast } from './components/feedback.js';
import { appState, notifyDataChanged } from './state/store.js';
import { loadSettings } from './repositories/settings.js';
import { ensureBaseData } from './db/seed.js';
import { countSuspended } from './repositories/sales.js';
import { registerServiceWorker, readStorageEstimate, watchConnection, applyUpdate, offlineCapability } from './services/pwa.js';
import { backupReminderDue } from './services/backup.js';
import { icon } from './components/icons.js';
import { h } from './utils/dom.js';

const root = document.getElementById('app');

async function boot() {
  // 1) قاعدة البيانات والإعدادات — بدونها لا تعمل أي شاشة
  await ensureBaseData();
  const settings = await loadSettings({ force: true });
  appState.set({ settings });

  // 2) الهيكل
  const shell = buildShell({
    onSearch: (term) => navigate(`/products?q=${encodeURIComponent(term)}`),
  });
  mountShell(root, shell);

  // 3) المسارات
  registerRoutes();
  await startRouter({
    mount: shell.main,
    onChange: (context) => {
      closeOverlays();
      appState.set({ sidebarOpen: false });
      shell.setActiveRoute(context.path, context.meta.title);
    },
  });

  // أعلن نجاح الإقلاع حتى لا يعرض حارس الإقلاع شاشة تشخيص بعد المهلة
  window.__APP_BOOTED__ = true;

  // 4) الخدمات الجانبية — لا تحجب أول رسم
  watchConnection();
  refreshSuspendedCount();

  registerServiceWorker().then(readStorageEstimate);

  // تحديث عدّاد البيوع المعلّقة وحجم التخزين بعد كل تغيير بيانات
  let lastVersion = appState.get().dataVersion;
  appState.subscribe((state) => {
    if (state.dataVersion === lastVersion) return;
    lastVersion = state.dataVersion;
    refreshSuspendedCount();
    readStorageEstimate();
  });

  watchForUpdate();
  scheduleBackupReminder(settings);
  warnIfInsecureContext();
}

async function refreshSuspendedCount() {
  try {
    appState.set({ suspendedCount: await countSuspended() });
  } catch (error) {
    console.warn('[app] تعذّر قراءة عدد البيوع المعلّقة:', error);
  }
}

/** يعرض شريط «تحديث متاح» عند جهوزية نسخة جديدة من Service Worker */
function watchForUpdate() {
  let shown = false;
  appState.subscribe((state) => {
    if (!state.updateAvailable || shown) return;
    shown = true;

    toast('', {
      tone: 'info',
      duration: 0,
      title: 'تحديث متاح',
    });

    // نستبدل محتوى آخر إشعار بزر تفعيل صريح
    const region = document.getElementById('toast-region');
    const last = region.lastElementChild;
    if (!last) return;

    const body = last.querySelector('.toast__body');
    render(body,
      h('div', { class: 'toast__title', text: 'تحديث متاح' }),
      h('div', { text: 'نسخة جديدة من التطبيق جاهزة. سيُعاد تحميل الصفحة عند التفعيل.' }),
      h('button', {
        class: 'btn btn--sm btn--primary',
        style: { 'margin-top': '10px' },
        attrs: { type: 'button' },
        text: 'تحديث الآن',
        on: { click: () => applyUpdate() },
      })
    );
  });
}

/** تذكير دوري بالنسخ الاحتياطي خارج الجهاز */
function scheduleBackupReminder(settings) {
  const reminder = backupReminderDue(settings);
  if (!reminder?.due) return;

  setTimeout(() => {
    const dismiss = toast('', { tone: 'warn', duration: 0 });
    const region = document.getElementById('toast-region');
    const body = region.lastElementChild?.querySelector('.toast__body');
    if (!body) return;

    render(body,
      h('div', { class: 'toast__title', text: 'تذكير بالنسخ الاحتياطي' }),
      h('div', { text: reminder.message }),
      h('button', {
        class: 'btn btn--sm btn--ghost',
        style: { 'margin-top': '10px' },
        attrs: { type: 'button' },
        text: 'إنشاء نسخة الآن',
        on: {
          click: () => {
            dismiss();
            navigate('/backup');
          },
        },
      })
    );
  }, 2500);
}

/** ينبّه بوضوح إذا فُتح التطبيق بطريقة لا يعمل فيها الأوفلاين */
function warnIfInsecureContext() {
  const capability = offlineCapability();
  if (capability.ok) return;

  // وضع الملف المحلي مدعوم بالكامل عبر الحزمة الكلاسيكية — لا داعي لإنذار
  if (capability.status === 'file') return;

  setTimeout(() => {
    toast(capability.message, { tone: 'warn', title: 'العمل دون اتصال غير مفعّل', duration: 0 });
  }, 1200);
}

/* ------------------------------------------------------------------ */

boot().catch((error) => {
  console.error('[app] فشل الإقلاع:', error);
  render(root, bootError(
    error?.name === 'AbortError' || /قاعدة البيانات/.test(error?.message || '')
      ? error.message
      : 'حدث خطأ أثناء تهيئة قاعدة البيانات المحلية. تأكد أن المتصفح يسمح بالتخزين لهذا الموقع (ليس في وضع التصفح الخاص).',
    error?.message
  ));
});

// أخطاء غير ملتقطة: نعرضها للمستخدم بدل تركها في الطرفية فقط
window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] وعد مرفوض دون معالجة:', event.reason);
  const message = event.reason?.message || 'حدث خطأ غير متوقع';
  // تجاهل الإلغاءات المتعمّدة
  if (event.reason?.name === 'AbortError' && /أُجهضت/.test(message)) return;
  toastError(message);
});

export { notifyDataChanged };
