/**
 * بناء DOM آمن.
 * لا يوجد في هذا الملف — ولا في التطبيق كله — أي استخدام لـ innerHTML مع مدخلات المستخدم.
 * كل النصوص تُكتب عبر textContent أو createTextNode.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * ينشئ عنصراً.
 * @param {string} tag اسم الوسم، ويمكن أن يكون "svg:path" لعناصر SVG
 * @param {object} [props] الخصائص. مفاتيح خاصة: class, text, style, dataset, attrs, on, ref
 * @param {...(Node|string|number|null|undefined|Array)} children
 */
export function h(tag, props, ...children) {
  let el;
  if (tag.startsWith('svg:')) {
    el = document.createElementNS(SVG_NS, tag.slice(4));
  } else {
    el = document.createElement(tag);
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;

      switch (key) {
        case 'class':
          el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
          break;
        case 'text':
          el.textContent = String(value);
          break;
        case 'style':
          // CSSOM مسموح تحت CSP الصارمة، بعكس سمة style في الترميز
          for (const [prop, v] of Object.entries(value)) {
            if (v != null) el.style.setProperty(prop, String(v));
          }
          break;
        case 'dataset':
          for (const [k, v] of Object.entries(value)) {
            if (v != null) el.dataset[k] = String(v);
          }
          break;
        case 'attrs':
          for (const [k, v] of Object.entries(value)) {
            if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
          }
          break;
        case 'on':
          for (const [type, handler] of Object.entries(value)) {
            if (handler) el.addEventListener(type, handler);
          }
          break;
        case 'ref':
          if (typeof value === 'function') value(el);
          break;
        case 'html':
          throw new Error('h(): استخدام html ممنوع. استخدم text أو عناصر فرعية.');
        default:
          if (value === true) el.setAttribute(key, '');
          else el.setAttribute(key, String(value));
      }
    }
  }

  append(el, children);
  return el;
}

/** يضيف أبناءً (مع تسطيح المصفوفات وتجاهل null) */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** يفرّغ عنصراً من كل أبنائه */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** يستبدل محتوى عنصر بمحتوى جديد */
export function render(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

/** نص محايد الاتجاه للقيم اللاتينية (SKU، أرقام الفواتير، التواريخ) */
export function ltr(value) {
  return h('bdi', { dir: 'ltr', text: value ?? '' });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** يؤخر تنفيذ دالة (للبحث الحي) */
export function debounce(fn, ms = 250) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/**
 * يحصر التنقل بلوحة المفاتيح داخل عنصر (للنوافذ واللوحات الجانبية).
 * يرجع دالة تنظيف.
 */
export function trapFocus(container, onEscape) {
  const previouslyFocused = document.activeElement;
  const SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  const focusables = () => Array.from(container.querySelectorAll(SELECTOR)).filter(el => el.offsetParent !== null);

  const first = focusables()[0];
  (first || container).focus();

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) return;

    const firstItem = items[0];
    const lastItem = items[items.length - 1];

    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);

  return () => {
    container.removeEventListener('keydown', onKeyDown);
    if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };
}

/** يغلق عنصراً عند النقر خارجه. يرجع دالة تنظيف. */
export function onClickOutside(el, handler) {
  const listener = (event) => {
    if (!el.contains(event.target)) handler(event);
  };
  // تأجيل بإطار واحد حتى لا تُلتقط النقرة التي فتحت العنصر
  requestAnimationFrame(() => document.addEventListener('pointerdown', listener));
  return () => document.removeEventListener('pointerdown', listener);
}
