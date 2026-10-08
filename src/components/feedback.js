/** إشعارات منبثقة، نوافذ، لوحات جانبية، وتأكيدات. */

import { h, render, trapFocus } from '../utils/dom.js';
import { icon } from './icons.js';

/* ------------------------------- Toast ------------------------------- */

const TOAST_ICON = { ok: 'checkCircle', error: 'error', warn: 'warning', info: 'info' };

let toastRegion = null;

function region() {
  if (!toastRegion) toastRegion = document.getElementById('toast-region');
  return toastRegion;
}

/**
 * يعرض إشعاراً مؤقتاً.
 * @param {string} message
 * @param {{tone?:'ok'|'error'|'warn'|'info', title?:string, duration?:number}} [options]
 */
export function toast(message, { tone = 'ok', title = '', duration = 4000 } = {}) {
  const host = region();
  if (!host) return () => {};

  let timer;
  const element = h('div', { class: ['toast', `toast--${tone}`], attrs: { role: tone === 'error' ? 'alert' : 'status' } },
    icon(TOAST_ICON[tone] || 'info'),
    h('div', { class: 'toast__body' },
      title ? h('div', { class: 'toast__title', text: title }) : null,
      h('div', { text: message })
    ),
    h('button', {
      class: 'toast__close',
      attrs: { type: 'button', 'aria-label': 'إغلاق الإشعار' },
      on: { click: () => dismiss() },
    }, icon('close'))
  );

  function dismiss() {
    clearTimeout(timer);
    element.remove();
  }

  host.appendChild(element);
  // الأخطاء تبقى حتى يغلقها المستخدم
  if (duration > 0 && tone !== 'error') timer = setTimeout(dismiss, duration);
  return dismiss;
}

export const toastOk = (message, options) => toast(message, { tone: 'ok', ...options });
export const toastError = (message, options) => toast(message, { tone: 'error', title: 'خطأ', duration: 0, ...options });
export const toastWarn = (message, options) => toast(message, { tone: 'warn', ...options });

/* ------------------------------- Modal ------------------------------- */

let activeModal = null;

/**
 * يفتح نافذة. يرجع { close, element }.
 * @param {{title:string, body:Node|Node[], footer?:Node[], size?:'md'|'lg', onClose?:Function, closable?:boolean}} config
 */
export function openModal({ title, body, footer = [], size = 'md', onClose, closable = true }) {
  closeModal();

  const host = document.getElementById('modal-region');
  const dialog = h('div', {
    class: ['modal', size === 'lg' && 'modal--lg'],
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
  },
    h('div', { class: 'modal__head' },
      h('h2', { class: 'modal__title', text: title }),
      closable
        ? h('button', {
            class: 'icon-btn',
            attrs: { type: 'button', 'aria-label': 'إغلاق' },
            on: { click: () => close() },
          }, icon('close'))
        : null
    ),
    h('div', { class: 'modal__body' }, body),
    footer.length > 0 ? h('div', { class: 'modal__foot' }, footer) : null
  );

  render(host, dialog);
  host.hidden = false;

  const releaseFocus = trapFocus(dialog, closable ? () => close() : null);

  const onBackdrop = (event) => {
    if (event.target === host && closable) close();
  };
  host.addEventListener('pointerdown', onBackdrop);

  function close() {
    if (activeModal !== state) return;
    host.removeEventListener('pointerdown', onBackdrop);
    releaseFocus();
    host.hidden = true;
    render(host);
    activeModal = null;
    onClose?.();
  }

  const state = { close, element: dialog };
  activeModal = state;
  return state;
}

export function closeModal() {
  activeModal?.close();
}

/**
 * نافذة تأكيد. ترجع Promise<boolean>.
 */
export function confirmDialog({
  title = 'تأكيد',
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  tone = 'primary',
  extra = null,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(value);
    };

    const modal = openModal({
      title,
      body: [
        h('p', { text: message, style: { 'line-height': '1.7' } }),
        extra,
      ],
      footer: [
        h('button', {
          class: ['btn', tone === 'danger' ? 'btn--danger' : 'btn--primary'],
          attrs: { type: 'button' },
          text: confirmLabel,
          on: { click: () => finish(true) },
        }),
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          text: cancelLabel,
          on: { click: () => finish(false) },
        }),
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * نافذة إدخال نص/رقم بسيطة. ترجع Promise<string|null>.
 */
export function promptDialog({ title, label, value = '', type = 'text', hint = '', confirmLabel = 'حفظ' }) {
  return new Promise((resolve) => {
    let settled = false;
    let input;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      modal.close();
      resolve(result);
    };

    const form = h('form', {
      on: { submit: (event) => { event.preventDefault(); finish(input.value); } },
    },
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'prompt-input', text: label }),
        h('input', {
          class: 'input',
          id: 'prompt-input',
          type,
          value,
          ref: (el) => { input = el; },
        }),
        hint ? h('p', { class: 'field__hint', text: hint }) : null
      )
    );

    const modal = openModal({
      title,
      body: form,
      footer: [
        h('button', {
          class: 'btn btn--primary',
          attrs: { type: 'button' },
          text: confirmLabel,
          on: { click: () => finish(input.value) },
        }),
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          text: 'إلغاء',
          on: { click: () => finish(null) },
        }),
      ],
      onClose: () => finish(null),
    });

    requestAnimationFrame(() => input?.select());
  });
}

/* ---------------------------- لوحة جانبية ---------------------------- */

let activePanel = null;

/**
 * يفتح لوحة جانبية منزلقة (نمط شاشتي المخزون والمصروفات).
 * @returns {{close:Function, element:HTMLElement}}
 */
export function openPanel({ title, body, footer = [], onClose }) {
  closePanel();

  const backdrop = h('div', { class: 'panel-backdrop', on: { pointerdown: () => close() } });

  const panel = h('aside', {
    class: 'panel',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
  },
    h('div', { class: 'panel__head' },
      h('button', {
        class: 'icon-btn',
        attrs: { type: 'button', 'aria-label': 'إغلاق' },
        on: { click: () => close() },
      }, icon('close')),
      h('h2', { class: 'panel__title', text: title })
    ),
    h('div', { class: 'panel__body' }, body),
    footer.length > 0 ? h('div', { class: 'panel__foot' }, footer) : null
  );

  document.body.append(backdrop, panel);
  const releaseFocus = trapFocus(panel, () => close());

  function close() {
    if (activePanel !== state) return;
    releaseFocus();
    backdrop.remove();
    panel.remove();
    activePanel = null;
    onClose?.();
  }

  const state = { close, element: panel };
  activePanel = state;
  return state;
}

export function closePanel() {
  activePanel?.close();
}

/** يغلق كل الطبقات العائمة — يُستدعى عند تغيير المسار */
export function closeOverlays() {
  closeModal();
  closePanel();
}
