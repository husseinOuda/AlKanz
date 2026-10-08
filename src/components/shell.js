/** هيكل التطبيق: الشريط الجانبي، الشريط العلوي، شريط التنقل السفلي للهاتف. */

import { h, render, ltr } from '../utils/dom.js';
import { icon } from './icons.js';
import { appState } from '../state/store.js';
import { formatBytes } from '../utils/format.js';
import { navigate } from '../router.js';

export const NAV_ITEMS = [
  { path: '/dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
  { path: '/pos', label: 'نقطة البيع', icon: 'pos' },
  { path: '/products', label: 'المنتجات', icon: 'products' },
  { path: '/inventory', label: 'المخزون', icon: 'inventory' },
  { path: '/invoices', label: 'الفواتير', icon: 'invoices' },
  { path: '/customers', label: 'العملاء', icon: 'customers' },
  { path: '/expenses', label: 'المصروفات', icon: 'expenses' },
  { path: '/shifts', label: 'الورديات والصندوق', icon: 'cash' },
  { path: '/reports', label: 'التقارير', icon: 'reports' },
  { path: '/backup', label: 'النسخ الاحتياطي', icon: 'backup' },
  { path: '/settings', label: 'الإعدادات', icon: 'settings' },
];

/** عناصر شريط التنقل السفلي على الهاتف (13-mobile-pos-draft.png) */
const TAB_ITEMS = [
  { path: '/dashboard', label: 'الرئيسية', icon: 'home' },
  { path: '/pos', label: 'البيع', icon: 'pos' },
  { path: '/products', label: 'المنتجات', icon: 'products' },
  { path: '/invoices', label: 'الفواتير', icon: 'invoices' },
  { path: '__more', label: 'المزيد', icon: 'more' },
];

/** شعار التطبيق — أعمدة بيانية صاعدة كما في الصور */
function brandMark() {
  return h('svg:svg', {
    class: 'brand__mark',
    attrs: { viewBox: '0 0 48 48', fill: 'none', 'aria-hidden': 'true' },
  },
    h('svg:rect', { attrs: { x: 6, y: 20, width: 8, height: 20, rx: 2, fill: 'currentColor' } }),
    h('svg:rect', { attrs: { x: 19, y: 12, width: 8, height: 28, rx: 2, fill: '#ffffff' } }),
    h('svg:rect', { attrs: { x: 32, y: 4, width: 8, height: 36, rx: 2, fill: 'currentColor' } }),
    h('svg:path', {
      attrs: { d: 'M6 30 L20 18 L28 24 L42 8', stroke: '#ffffff', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none', opacity: '0.9' },
    })
  );
}

export function buildShell({ onSearch }) {
  const navList = h('nav', { class: 'nav', attrs: { 'aria-label': 'التنقل الرئيسي' } });
  const navLinks = new Map();

  // الأيقونة أولاً ⇒ تظهر في أقصى اليمين (RTL) مطابقةً للصور المرجعية،
  // وتصطفّ كل الأيقونات على محور رأسي واحد.
  for (const item of NAV_ITEMS) {
    const link = h('a', { class: 'nav__item', href: `#${item.path}` },
      icon(item.icon),
      h('span', { class: 'nav__label', text: item.label })
    );
    navLinks.set(item.path, link);
    navList.appendChild(link);
  }

  const storageFill = h('div', { class: 'storage-widget__fill', style: { width: '0%' } });
  const storageText = h('div', { class: 'storage-widget__text', text: 'جارٍ الحساب…' });

  const sidebar = h('aside', { class: 'sidebar', id: 'app-sidebar' },
    h('div', { class: 'brand' }, brandMark(), h('span', { class: 'brand__name', text: 'نظام المبيعات' })),
    navList,
    h('div', { class: 'storage-widget' },
      icon('database'),
      h('div', { class: 'storage-widget__body' },
        h('div', { class: 'storage-widget__label', text: 'التخزين المحلي' }),
        h('div', { class: 'storage-widget__bar' }, storageFill),
        storageText
      )
    )
  );

  /* ------------------------------ الشريط العلوي ------------------------------ */

  const pageTitle = h('h1', { class: 'topbar__title', text: 'لوحة التحكم' });

  const connDot = h('span', { class: 'conn-status__dot' });
  const connLabel = h('span', { text: 'جاهز دون اتصال' });
  const connStatus = h('div', {
    class: 'conn-status',
    dataset: { online: 'true' },
    attrs: { role: 'status', title: 'حالة الاتصال' },
  }, icon('checkCircle'), connLabel);

  const notifBadge = h('span', { class: 'icon-btn__badge', text: '0', hidden: true });
  const notifButton = h('button', {
    class: 'icon-btn',
    attrs: { type: 'button', 'aria-label': 'التنبيهات' },
    on: { click: () => navigate('/notifications') },
  }, icon('bell'), notifBadge);

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'بحث',
    attrs: { 'aria-label': 'بحث عام في المنتجات والفواتير والعملاء' },
    on: {
      keydown: (event) => {
        if (event.key === 'Enter' && event.target.value.trim()) {
          onSearch?.(event.target.value.trim());
        }
      },
    },
  });

  const topbar = h('header', { class: 'topbar' },
    h('button', {
      class: 'topbar__burger',
      attrs: { type: 'button', 'aria-label': 'إظهار القائمة', 'aria-controls': 'app-sidebar', 'aria-expanded': 'false' },
      on: {
        click: () => appState.set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      },
    }, icon('menu')),
    pageTitle,
    h('div', { class: 'topbar__search' }, h('div', { class: 'search' }, icon('search', { class: 'search__icon' }), searchInput)),
    h('div', { class: 'topbar__actions' },
      connStatus,
      notifButton,
      h('button', {
        class: 'icon-btn',
        attrs: { type: 'button', 'aria-label': 'الإعدادات' },
        on: { click: () => navigate('/settings') },
      }, icon('settings')),
      h('button', {
        class: 'user-chip',
        attrs: { type: 'button', 'aria-label': 'حساب المستخدم' },
        on: { click: () => navigate('/settings') },
      },
        h('span', { class: 'user-chip__avatar' }, icon('user')),
        h('span', { class: 'user-chip__name', text: 'المستخدم' }),
        icon('chevronDown', { class: 'icon-chev' })
      )
    )
  );

  /* --------------------------------- المحتوى -------------------------------- */

  const main = h('main', { class: 'main', id: 'main-content', attrs: { tabindex: '-1' } });

  /* --------------------------- شريط التنقل السفلي --------------------------- */

  const tabLinks = new Map();
  const tabbar = h('nav', { class: 'tabbar', attrs: { 'aria-label': 'التنقل السريع' } },
    ...TAB_ITEMS.map((item) => {
      if (item.path === '__more') {
        return h('button', {
          class: 'tabbar__item',
          attrs: { type: 'button' },
          on: { click: () => appState.set({ sidebarOpen: true }) },
        }, icon(item.icon), h('span', { text: item.label }));
      }
      const link = h('a', { class: 'tabbar__item', href: `#${item.path}` },
        icon(item.icon), h('span', { text: item.label }));
      tabLinks.set(item.path, link);
      return link;
    })
  );

  /* --------------------------------- الحالة --------------------------------- */

  const burger = topbar.querySelector('.topbar__burger');

  appState.subscribe((state) => {
    // حالة الاتصال
    const online = state.online;
    connStatus.dataset.online = String(online);
    connLabel.textContent = online ? 'جاهز دون اتصال' : 'غير متصل — يعمل محلياً';

    // مساحة التخزين
    if (state.storage) {
      const { usage = 0, quota = 0 } = state.storage;
      const ratio = quota > 0 ? usage / quota : 0;
      storageFill.style.width = `${Math.min(100, ratio * 100)}%`;
      storageText.textContent = `${formatBytes(usage)} / ${formatBytes(quota)} (${Math.round(ratio * 100)}%)`;
    }

    // عدّاد البيوع المعلّقة كتنبيه
    const pending = state.suspendedCount || 0;
    notifBadge.hidden = pending === 0;
    notifBadge.textContent = String(pending);
    notifButton.setAttribute(
      'aria-label',
      pending > 0 ? `التنبيهات: ${pending} بيع معلّق` : 'التنبيهات'
    );

    // الشريط الجانبي على الشاشات الصغيرة
    sidebar.classList.toggle('is-open', Boolean(state.sidebarOpen));
    burger.setAttribute('aria-expanded', String(Boolean(state.sidebarOpen)));
  }, { immediate: true });

  /** يحدّث العنصر النشط وعنوان الصفحة */
  function setActiveRoute(path, title) {
    const base = `/${path.split('/').filter(Boolean)[0] || 'dashboard'}`;

    for (const [itemPath, link] of navLinks) {
      if (itemPath === base) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    for (const [itemPath, link] of tabLinks) {
      if (itemPath === base) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }

    const label = title || NAV_ITEMS.find((item) => item.path === base)?.label || 'نظام المبيعات';
    pageTitle.textContent = label;
    document.title = `${label} — نظام المبيعات`;
  }

  return { sidebar, topbar, main, tabbar, setActiveRoute, searchInput };
}

/** يركّب الهيكل داخل جذر التطبيق */
export function mountShell(root, shell) {
  root.removeAttribute('aria-busy');
  render(root, shell.topbar, shell.sidebar, shell.main, shell.tabbar);

  // إغلاق الشريط الجانبي عند النقر خارجه على الشاشات الصغيرة
  document.addEventListener('pointerdown', (event) => {
    if (!appState.get().sidebarOpen) return;
    if (shell.sidebar.contains(event.target)) return;
    if (event.target.closest('.topbar__burger, .tabbar__item')) return;
    appState.set({ sidebarOpen: false });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && appState.get().sidebarOpen) {
      appState.set({ sidebarOpen: false });
    }
  });
}

/** شاشة خطأ عامة عند فشل الإقلاع */
export function bootError(message, detail) {
  return h('div', { class: 'boot boot--error' },
    h('div', { class: 'empty__icon', style: { background: 'var(--red-soft)', color: 'var(--red)' } }, icon('error')),
    h('h1', { style: { 'font-size': '18px' }, text: 'تعذّر تشغيل التطبيق' }),
    h('p', { style: { 'max-width': '460px', 'text-align': 'center' }, text: message }),
    detail ? h('p', { class: 'field__hint' }, ltr(detail)) : null,
    h('button', {
      class: 'btn btn--primary',
      attrs: { type: 'button' },
      text: 'إعادة المحاولة',
      on: { click: () => window.location.reload() },
    })
  );
}
