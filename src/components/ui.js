/** مكوّنات واجهة مشتركة مبنية على design tokens المستخرجة من الصور المرجعية. */

import { h, ltr } from '../utils/dom.js';
import { icon } from './icons.js';
import { formatAmount, formatInt, formatPercent } from '../utils/format.js';

/* ------------------------------- بطاقة ------------------------------- */

export function card({ title, titleIcon, actions, body, footer, flush = false, className } = {}) {
  return h('section', { class: ['card', flush && 'card--flush', className] },
    title || actions
      ? h('div', { class: 'card__head' },
          h('h2', { class: 'card__title' }, titleIcon ? icon(titleIcon) : null, title || ''),
          actions ? h('div', { class: 'row' }, actions) : null
        )
      : null,
    body ? h('div', { class: 'card__body' }, body) : null,
    footer ? h('div', { class: 'card__foot' }, footer) : null
  );
}

/* ------------------------------- شارة ------------------------------- */

export function badge(text, tone = 'gray', { withDot = false, iconName } = {}) {
  return h('span', { class: ['badge', `badge--${tone}`] },
    withDot ? h('span', { class: 'badge__dot' }) : null,
    iconName ? icon(iconName) : null,
    h('span', { text })
  );
}

/* ------------------------------ بطاقة KPI ---------------------------- */

/**
 * @param {object} config
 * @param {string} config.label
 * @param {string|Node} config.value
 * @param {string} [config.unit]
 * @param {string} config.iconName
 * @param {string} [config.tone] teal|blue|green|amber|red|violet
 * @param {{percent:number, label?:string}} [config.delta]
 * @param {string} [config.variant] 'default' | 'stacked' | 'tinted'
 * @param {{label:string, href:string}} [config.link]
 */
export function kpi({
  label, value, unit, iconName, tone = 'blue', delta, variant = 'default', link, subtext,
}) {
  const iconBox = h('div', { class: ['kpi__icon', `kpi__icon--${tone}`] }, icon(iconName));

  const deltaNode = delta
    ? (() => {
        const direction = delta.percent > 0 ? 'up' : delta.percent < 0 ? 'down' : 'flat';
        return h('div', { class: ['kpi__delta', `kpi__delta--${direction}`] },
          direction !== 'flat' ? icon(direction === 'up' ? 'trendUp' : 'trendDown') : null,
          h('span', { text: formatPercent(Math.abs(delta.percent)), style: { color: 'inherit' } }),
          h('span', { text: delta.label || 'عن أمس' })
        );
      })()
    : null;

  const valueNode = typeof value === 'string' || typeof value === 'number'
    ? h('div', { class: 'kpi__value' }, ltr(value))
    : h('div', { class: 'kpi__value' }, value);

  if (variant === 'stacked') {
    return h('article', { class: 'kpi kpi--stacked' },
      h('div', { class: 'kpi__top' }, iconBox, h('div', { class: 'kpi__label', text: label })),
      h('div', { class: 'kpi__body' },
        valueNode,
        unit ? h('div', { class: 'kpi__unit', text: unit }) : null,
        subtext ? h('div', { class: 'kpi__unit', text: subtext }) : null
      ),
      link ? h('a', { class: 'kpi__link', href: link.href, text: link.label }) : null
    );
  }

  if (variant === 'tinted') {
    return h('article', { class: ['kpi', 'kpi--tinted', `is-${tone}`] },
      h('div', { class: 'kpi__body' },
        h('div', { class: 'kpi__label', text: label }),
        valueNode,
        subtext ? h('div', { class: 'kpi__unit', text: subtext }) : null
      ),
      h('div', { class: 'kpi__icon' }, icon(iconName))
    );
  }

  return h('article', { class: 'kpi' },
    h('div', { class: 'kpi__body' },
      h('div', { class: 'kpi__label', text: label }),
      valueNode,
      unit ? h('div', { class: 'kpi__unit', text: unit }) : null,
      subtext ? h('div', { class: 'kpi__unit', text: subtext }) : null,
      deltaNode
    ),
    iconBox
  );
}

export const kpiGrid = (...cards) => h('div', { class: 'kpi-grid' }, cards);

/** يحسب نسبة التغير بأمان (يتجنّب القسمة على صفر) */
export function deltaPercent(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* ------------------------------- حقول ------------------------------- */

let fieldCounter = 0;

/**
 * حقل نموذج كامل: تسمية فعلية مرتبطة، رسالة خطأ مرتبطة عبر aria-describedby.
 * @returns {{element:HTMLElement, input:HTMLElement, setError:Function, value:Function}}
 */
export function field({
  label, name, type = 'text', value = '', placeholder = '', required = false,
  hint = '', options = null, rows = null, suffix = null, min, max, step,
  disabled = false, autofocus = false, maxLength, onInput, onChange, counter = false,
}) {
  fieldCounter += 1;
  const id = `f${fieldCounter}-${name || type}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  let input;
  const describedBy = [];
  if (hint) describedBy.push(hintId);

  const shared = {
    id,
    name: name || id,
    disabled: disabled || undefined,
    'aria-required': required ? 'true' : undefined,
    ref: (el) => { input = el; },
    on: {
      ...(onInput ? { input: onInput } : {}),
      ...(onChange ? { change: onChange } : {}),
    },
  };

  let control;
  if (options) {
    control = h('select', { class: 'select', ...shared },
      ...options.map((option) =>
        h('option', {
          value: option.value,
          selected: String(option.value) === String(value) || undefined,
          text: option.label,
        })
      )
    );
  } else if (rows) {
    control = h('textarea', {
      class: 'textarea', rows, placeholder, maxlength: maxLength, ...shared,
    }, value || '');
  } else {
    control = h('input', {
      class: 'input', type, value, placeholder, min, max, step, maxlength: maxLength,
      autofocus: autofocus || undefined, ...shared,
    });
  }

  const counterNode = counter && maxLength
    ? h('div', { class: 'field__counter', text: `${String(value || '').length} / ${maxLength}` })
    : null;

  if (counterNode) {
    control.addEventListener('input', () => {
      counterNode.textContent = `${control.value.length} / ${maxLength}`;
    });
  }

  const errorNode = h('p', { class: 'field__error', id: errorId, attrs: { role: 'alert' }, hidden: true });

  const controlWrap = suffix
    ? h('div', { class: 'input-affix' }, control, h('span', { class: 'input-affix__suffix', text: suffix }))
    : control;

  const element = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id },
      label,
      required ? h('span', { class: 'field__req', text: '*', attrs: { 'aria-hidden': 'true' } }) : null
    ),
    controlWrap,
    hint ? h('p', { class: 'field__hint', id: hintId, text: hint }) : null,
    counterNode,
    errorNode
  );

  if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '));

  function setError(message) {
    if (message) {
      errorNode.textContent = message;
      errorNode.hidden = false;
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', [errorId, ...describedBy].join(' '));
    } else {
      errorNode.hidden = true;
      errorNode.textContent = '';
      control.removeAttribute('aria-invalid');
      if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '));
      else control.removeAttribute('aria-describedby');
    }
  }

  return {
    element,
    input: control,
    setError,
    get value() { return control.value; },
    set value(next) {
      control.value = next;
      if (counterNode) counterNode.textContent = `${control.value.length} / ${maxLength}`;
    },
    focus: () => control.focus(),
  };
}

/** مفتاح تبديل */
export function toggleField({ label, name, checked = false, onChange }) {
  let input;
  const element = h('label', { class: 'toggle' },
    h('input', {
      type: 'checkbox', name, checked: checked || undefined,
      ref: (el) => { input = el; },
      on: onChange ? { change: (event) => onChange(event.target.checked) } : {},
    }),
    h('span', { class: 'toggle__track', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'toggle__label', text: label })
  );
  return { element, input, get checked() { return input.checked; }, set checked(v) { input.checked = v; } };
}

/** خانة اختيار */
export function checkboxField({ label, name, checked = false, onChange }) {
  let input;
  const element = h('label', { class: 'checkbox' },
    h('input', {
      type: 'checkbox', name, checked: checked || undefined,
      ref: (el) => { input = el; },
      on: onChange ? { change: (event) => onChange(event.target.checked) } : {},
    }),
    h('span', { text: label })
  );
  return { element, input, get checked() { return input.checked; } };
}

/** حقل بحث مع زر مسح */
export function searchField({ placeholder = 'بحث', value = '', onInput, label = 'بحث' }) {
  let input;
  const clear = h('button', {
    class: 'search__clear',
    attrs: { type: 'button', 'aria-label': 'مسح البحث' },
    hidden: !value,
    on: {
      click: () => {
        input.value = '';
        clear.hidden = true;
        onInput?.('');
        input.focus();
      },
    },
  }, icon('close'));

  const element = h('div', { class: 'search' },
    icon('search', { class: 'search__icon' }),
    h('input', {
      class: 'input',
      type: 'search',
      placeholder,
      value,
      attrs: { 'aria-label': label },
      ref: (el) => { input = el; },
      on: {
        input: (event) => {
          clear.hidden = !event.target.value;
          onInput?.(event.target.value);
        },
      },
    }),
    clear
  );

  return { element, input, get value() { return input.value; } };
}

/* ------------------------------ حالات ------------------------------ */

export function emptyState({ title, text, iconName = 'boxOpen', action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon(iconName)),
    h('p', { class: 'empty__title', text: title }),
    text ? h('p', { class: 'empty__text', text }) : null,
    action || null
  );
}

export function errorState(message, { onRetry } = {}) {
  return h('div', { class: 'state-error', attrs: { role: 'alert' } },
    icon('error'),
    h('div', null,
      h('p', { class: 'state-error__title', text: 'تعذّر إتمام العملية' }),
      h('p', { text: message }),
      onRetry
        ? h('button', {
            class: 'btn btn--sm btn--ghost',
            attrs: { type: 'button' },
            text: 'إعادة المحاولة',
            style: { 'margin-top': '10px' },
            on: { click: onRetry },
          })
        : null
    )
  );
}

export function alertBox(message, tone = 'info', iconName) {
  const icons = { info: 'info', warn: 'warning', error: 'error', ok: 'checkCircle' };
  return h('div', { class: ['alert', `alert--${tone}`] },
    icon(iconName || icons[tone] || 'info'),
    h('div', typeof message === 'string' ? { text: message } : null,
      typeof message === 'string' ? null : message)
  );
}

/** هيكل تحميل لجدول */
export function tableSkeleton(rows = 6, columns = 5) {
  return h('div', { style: { padding: '16px' }, attrs: { 'aria-hidden': 'true' } },
    ...Array.from({ length: rows }, () =>
      h('div', { class: 'row', style: { gap: '16px', 'margin-bottom': '14px' } },
        ...Array.from({ length: columns }, (_, i) =>
          h('div', { class: 'skeleton', style: { flex: i === 0 ? '2' : '1' } })
        )
      )
    )
  );
}

/* ---------------------------- ترقيم الصفحات ---------------------------- */

/**
 * @param {{page:number, pageSize:number, total:number, onPage:Function, onPageSize?:Function, unit?:string}} config
 */
export function pagination({ page, pageSize, total, onPage, onPageSize, unit = 'عنصر', sizes = [10, 20, 50, 100] }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pageButton = (n) => h('button', {
    class: 'pager__btn',
    attrs: { type: 'button', ...(n === page ? { 'aria-current': 'page' } : {}), 'aria-label': `صفحة ${n}` },
    text: String(n),
    on: { click: () => n !== page && onPage(n) },
  });

  const navButton = (iconName, label, targetPage, disabled) => h('button', {
    class: 'pager__btn',
    attrs: { type: 'button', 'aria-label': label },
    disabled: disabled || undefined,
    on: { click: () => !disabled && onPage(targetPage) },
  }, icon(iconName));

  // نافذة أرقام حول الصفحة الحالية مع اختصار بالنقاط
  const numbers = [];
  const window_ = 1;
  let last = 0;
  for (let n = 1; n <= pageCount; n += 1) {
    const inWindow = n === 1 || n === pageCount || Math.abs(n - page) <= window_;
    if (!inWindow) continue;
    if (last && n - last > 1) numbers.push(h('span', { class: 'pager__gap', text: '…' }));
    numbers.push(pageButton(n));
    last = n;
  }

  return h('div', { class: 'pager' },
    h('p', { class: 'pager__info' },
      total === 0 ? 'لا توجد نتائج' : `عرض ${from} إلى ${to} من ${formatInt(total)} ${unit}`
    ),
    h('nav', { class: 'pager__controls', attrs: { 'aria-label': 'ترقيم الصفحات' } },
      navButton('chevronsRight', 'الصفحة الأولى', 1, page === 1),
      navButton('chevronRight', 'الصفحة السابقة', page - 1, page === 1),
      ...numbers,
      navButton('chevronLeft', 'الصفحة التالية', page + 1, page >= pageCount),
      navButton('chevronsLeft', 'الصفحة الأخيرة', pageCount, page >= pageCount)
    ),
    onPageSize
      ? h('label', { class: 'pager__size' },
          h('span', { text: 'لكل صفحة' }),
          h('select', {
            class: 'select',
            attrs: { 'aria-label': 'عدد العناصر لكل صفحة' },
            on: { change: (event) => onPageSize(Number(event.target.value)) },
          }, ...sizes.map((size) =>
            h('option', { value: size, selected: size === pageSize || undefined, text: String(size) })
          ))
        )
      : null
  );
}

/* ------------------------------ متنوعات ------------------------------ */

export function progressBar(ratio, { tone } = {}) {
  const clamped = Math.max(0, Math.min(1, ratio || 0));
  const auto = clamped > 0.9 ? 'is-danger' : clamped > 0.75 ? 'is-warn' : '';
  return h('div', {
    class: 'progress',
    attrs: {
      role: 'progressbar',
      'aria-valuenow': Math.round(clamped * 100),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
  }, h('div', { class: ['progress__fill', tone || auto], style: { width: `${clamped * 100}%` } }));
}

export function avatar(name, { small = false } = {}) {
  const letters = String(name || '؟').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
  return h('div', { class: ['avatar', small && 'avatar--sm'], attrs: { 'aria-hidden': 'true' }, text: letters });
}

/** مبلغ منسّق مع رمز العملة، بأرقام لاتينية معزولة الاتجاه */
export function money(minor, symbol, { tone, decimals = 2, symbolPosition = 'after' } = {}) {
  const text = formatAmount(minor, decimals);
  const content = symbol
    ? (symbolPosition === 'before' ? `${symbol} ${text}` : `${text} ${symbol}`)
    : text;
  return h('span', {
    class: tone ? `is-${tone}` : null,
    style: tone === 'green' ? { color: 'var(--green)' } : tone === 'red' ? { color: 'var(--red)' } : null,
  }, ltr(content));
}

export function detailRow(label, value, { iconName } = {}) {
  return h('div', { class: 'detail-row' },
    h('span', { class: 'detail-row__label' }, iconName ? icon(iconName) : null, label),
    h('span', { class: 'detail-row__value' }, value)
  );
}

/** رقاقات تصفية */
export function chipGroup({ items, active, onSelect, label = 'تصفية' }) {
  return h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': label } },
    ...items.map((item) =>
      h('button', {
        class: 'chip',
        attrs: { type: 'button', 'aria-pressed': String(item.value === active) },
        on: { click: () => onSelect(item.value) },
      },
        item.icon ? icon(item.icon) : null,
        h('span', { text: item.label })
      )
    )
  );
}

/** قائمة إجراءات صف (زر ⋮) */
export function rowMenu(items, { label = 'إجراءات' } = {}) {
  let list;
  let cleanup = null;

  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    cleanup?.();
    cleanup = null;
  };

  const button = h('button', {
    class: 'row-menu__btn',
    attrs: { type: 'button', 'aria-label': label, 'aria-expanded': 'false', 'aria-haspopup': 'menu' },
    on: {
      click: (event) => {
        event.stopPropagation();
        const willOpen = list.hidden;
        // أغلق أي قائمة أخرى مفتوحة
        document.querySelectorAll('.row-menu__list:not([hidden])').forEach((el) => { el.hidden = true; });
        list.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) {
          const onDocClick = (e) => { if (!wrapper.contains(e.target)) close(); };
          const onKey = (e) => { if (e.key === 'Escape') { close(); button.focus(); } };
          document.addEventListener('pointerdown', onDocClick);
          document.addEventListener('keydown', onKey);
          cleanup = () => {
            document.removeEventListener('pointerdown', onDocClick);
            document.removeEventListener('keydown', onKey);
          };
        } else {
          close();
        }
      },
    },
  }, icon('more'));

  list = h('div', { class: 'row-menu__list', hidden: true, attrs: { role: 'menu' } },
    ...items.filter(Boolean).map((item) =>
      h('button', {
        class: ['row-menu__item', item.danger && 'row-menu__item--danger'],
        attrs: { type: 'button', role: 'menuitem' },
        on: {
          click: () => {
            close();
            item.onSelect();
          },
        },
      },
        item.icon ? icon(item.icon) : null,
        h('span', { text: item.label })
      )
    )
  );

  const wrapper = h('div', { class: 'row-menu' }, button, list);
  return wrapper;
}
