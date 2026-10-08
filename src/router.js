/**
 * موجّه قائم على الـ hash.
 * سبب اختيار hash بدل History API: التطبيق يُنشر كملفات ثابتة، و`#/products`
 * يعمل بعد Refresh دون أي إعادة كتابة على الخادم (انظر docs/design-decisions.md).
 */

const routes = new Map();
let notFoundHandler = null;
let current = null;
let cleanup = null;
let outlet = null;
let onNavigate = null;

/** يسجّل مساراً. النمط: '/products' أو '/products/:id' */
export function route(pattern, handler, meta = {}) {
  const paramNames = [];
  const regexSource = pattern
    .replace(/\/:([^/]+)/g, (_, name) => { paramNames.push(name); return '/([^/]+)'; })
    .replace(/\//g, '\\/');

  routes.set(pattern, {
    pattern,
    regex: new RegExp(`^${regexSource}$`),
    paramNames,
    handler,
    meta,
  });
}

export function setNotFound(handler) {
  notFoundHandler = handler;
}

/** يفكّك '#/products/123?q=abc' إلى {path, query} */
function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [path, queryString = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  return { path: path.replace(/\/+$/, '') || '/', query };
}

function match(path) {
  for (const entry of routes.values()) {
    const result = entry.regex.exec(path);
    if (!result) continue;

    const params = {};
    entry.paramNames.forEach((name, index) => {
      params[name] = decodeURIComponent(result[index + 1]);
    });
    return { entry, params };
  }
  return null;
}

async function resolve() {
  const { path, query } = parseHash();
  const matched = match(path);

  // تنظيف الشاشة السابقة (إلغاء اشتراكات، إزالة مستمعين)
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (error) { console.error('[router] فشل تنظيف الشاشة:', error); }
  }
  cleanup = null;

  const context = {
    path,
    query,
    params: matched?.params || {},
    meta: matched?.entry.meta || {},
    /** تسجّل الشاشة دالة تنظيف تُستدعى عند مغادرتها */
    onCleanup(fn) { cleanup = fn; },
  };

  current = context;
  onNavigate?.(context);

  const handler = matched?.entry.handler || notFoundHandler;
  if (!handler) return;

  try {
    const view = await handler(context);
    // إن غيّر المستخدم المسار أثناء التحميل، تجاهل النتيجة القديمة
    if (current !== context) return;
    if (view && outlet) {
      outlet.replaceChildren(view);
      outlet.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  } catch (error) {
    console.error('[router] فشل عرض الشاشة:', error);
    if (current === context) throw error;
  }
}

/** يبدأ الموجّه */
export function startRouter({ mount, onChange }) {
  outlet = mount;
  onNavigate = onChange;

  window.addEventListener('hashchange', () => { resolve(); });

  if (!window.location.hash) {
    window.location.replace('#/dashboard');
  }
  return resolve();
}

/** ينتقل إلى مسار. replace=true لا يضيف إدخالاً في سجل التصفح */
export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) {
    resolve();
    return;
  }
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

/** يعيد رسم الشاشة الحالية */
export const refresh = () => resolve();

export const currentRoute = () => current;

/** يبني رابطاً مع معاملات استعلام */
export function href(path, query) {
  const params = new URLSearchParams(
    Object.entries(query || {}).filter(([, value]) => value != null && value !== '')
  );
  const suffix = params.toString();
  return `#${path}${suffix ? `?${suffix}` : ''}`;
}
