/** جدول بيانات: رؤوس قابلة للفرز، حالة فارغة، تحديد صف، وإجراءات. */

import { h } from '../utils/dom.js';
import { icon } from './icons.js';
import { emptyState } from './ui.js';

/**
 * @param {object} config
 * @param {{key:string,label:string,render?:Function,sortable?:boolean,className?:string,width?:string}[]} config.columns
 * @param {object[]} config.rows
 * @param {{key:string,dir:'asc'|'desc'}} [config.sort]
 * @param {(key:string)=>void} [config.onSort]
 * @param {(row:object)=>string} [config.rowKey]
 * @param {(row:object)=>boolean} [config.isSelected]
 * @param {(row:object)=>void} [config.onRowClick]
 * @param {object} [config.empty] إعدادات الحالة الفارغة
 * @param {string} [config.caption] وصف للقارئات الشاشية
 */
export function dataTable({
  columns, rows, sort, onSort, rowKey, isSelected, onRowClick, empty, caption,
}) {
  if (!rows || rows.length === 0) {
    return emptyState(empty || { title: 'لا توجد بيانات', text: 'لم يتم العثور على سجلات مطابقة.' });
  }

  const headerCell = (column) => {
    const isSorted = sort?.key === column.key;
    const ariaSort = isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

    if (!column.sortable || !onSort) {
      return h('th', {
        class: column.className,
        attrs: { scope: 'col', ...(column.width ? { style: null } : {}) },
        style: column.width ? { width: column.width } : null,
        text: column.label,
      });
    }

    return h('th', {
      class: column.className,
      attrs: { scope: 'col', 'aria-sort': ariaSort },
      style: column.width ? { width: column.width } : null,
    },
      h('button', {
        class: 'table__sort',
        attrs: { type: 'button', 'aria-sort': ariaSort },
        on: { click: () => onSort(column.key) },
      },
        h('span', { text: column.label }),
        icon(isSorted ? (sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'arrowUpDown')
      )
    );
  };

  return h('div', { class: 'table-wrap' },
    h('table', { class: 'table' },
      caption ? h('caption', { class: 'sr-only', text: caption }) : null,
      h('thead', null, h('tr', null, ...columns.map(headerCell))),
      h('tbody', null,
        ...rows.map((row, index) => {
          const selected = isSelected?.(row);
          return h('tr', {
            attrs: {
              ...(selected ? { 'aria-selected': 'true' } : {}),
              ...(onRowClick ? { tabindex: '0', role: 'button' } : {}),
            },
            dataset: rowKey ? { key: rowKey(row) } : null,
            style: onRowClick ? { cursor: 'pointer' } : null,
            on: onRowClick
              ? {
                  click: (event) => {
                    // لا تفعّل تحديد الصف عند الضغط على زر أو رابط داخله
                    if (event.target.closest('button, a, input, select')) return;
                    onRowClick(row);
                  },
                  keydown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      if (event.target.closest('button, a, input, select')) return;
                      event.preventDefault();
                      onRowClick(row);
                    }
                  },
                }
              : {},
          },
            ...columns.map((column) => {
              const content = column.render ? column.render(row, index) : row[column.key];
              return h('td', { class: column.className },
                content == null || content === '' ? '—' : content);
            })
          );
        })
      )
    )
  );
}

/** خلية بسطرين: عنوان + تفصيل */
export function twoLineCell(main, sub) {
  return h('div', null,
    h('div', { class: 'table__main', text: main }),
    sub ? h('div', { class: 'table__sub' }, sub) : null
  );
}

/** صورة مصغّرة في الجدول مع بديل عند عدم وجود صورة */
export function thumbCell(src, alt) {
  if (!src) {
    return h('div', { class: 'table__thumb table__thumb--ph', attrs: { role: 'img', 'aria-label': alt || 'لا توجد صورة' } },
      icon('image'));
  }
  return h('img', { class: 'table__thumb', src, alt: alt || '', loading: 'lazy', decoding: 'async' });
}

/** مجموعة أزرار إجراءات صغيرة (نمط شاشة المنتجات) */
export function actionButtons(...buttons) {
  return h('div', { class: 'table__actions' }, ...buttons.filter(Boolean));
}

export function actionButton({ label, iconName, tone = 'ghost', onClick, title }) {
  const toneClass = {
    ghost: 'btn--ghost',
    primary: 'btn--outline',
    danger: 'btn--outline-danger',
  }[tone] || 'btn--ghost';

  return h('button', {
    class: ['btn', 'btn--sm', toneClass],
    attrs: { type: 'button', title: title || label },
    on: { click: onClick },
  }, h('span', { text: label }), icon(iconName));
}
