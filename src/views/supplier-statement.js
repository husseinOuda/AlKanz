import { h } from '../utils/dom.js';
import { formatAmount } from '../utils/format.js';
import { formatDateTime } from '../utils/dates.js';
import { supplierStatement } from '../repositories/purchasing.js';
import { printReport } from '../services/print.js';
import { settings } from '../repositories/settings.js';

export async function render({ params } = {}) {
  const data = await supplierStatement(params?.id);
  if (!data) return h('section', { class: 'card card__body' }, h('h2', { text: 'المورد غير موجود' }), h('a', { href: '#/purchases', text: 'العودة إلى الموردين' }));
  const prefs = settings();
  const symbol = prefs.currencySymbol || '';
  const money = (n) => `${formatAmount(n)} ${symbol}`.trim();
  const rows = data.entries.map((e) => h('tr', null,
    h('td', { text: formatDateTime(e.at, prefs.dateFormat) }),
    h('td', { text: e.kind === 'purchase' ? 'فاتورة شراء' : 'دفعة' }),
    h('td', { text: e.label }),
    h('td', { text: e.debitMinor ? money(e.debitMinor) : '—' }),
    h('td', { text: e.creditMinor ? money(e.creditMinor) : '—' }),
    h('td', { text: money(e.balanceMinor) })));
  return h('div', { class: 'page stack' },
    h('div', { class: 'page-header' }, h('div', null, h('h2', { text: `كشف حساب ${data.supplier.name}` }), h('p', { class: 'muted', text: data.supplier.phone || '' })),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn--outline', href: '#/purchases', text: 'العودة إلى الموردين' }),
        h('button', { class: 'btn btn--secondary', attrs: { type: 'button' }, text: 'طباعة كشف الحساب', on: { click: () => printReport({
          title: 'كشف حساب المورد', subtitle: [data.supplier.name, data.supplier.phone].filter(Boolean).join(' — '),
          stats: [{ label: 'الرصيد الحالي', value: money(data.balanceMinor) }],
          tables: [{ title: 'الحركات المالية', header: ['التاريخ', 'النوع', 'المرجع', 'مدين (مشتريات)', 'دائن (دفعات)', 'الرصيد التراكمي'], rows: data.entries.map((e) => [formatDateTime(e.at, prefs.dateFormat), e.kind === 'purchase' ? 'فاتورة شراء' : 'دفعة', e.label, e.debitMinor ? money(e.debitMinor) : '—', e.creditMinor ? money(e.creditMinor) : '—', money(e.balanceMinor)]) }],
        }) } }))),
    h('section', { class: 'card card__body' }, h('h3', { text: 'الحركات المالية' }),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ...['التاريخ', 'النوع', 'المرجع', 'مدين (مشتريات)', 'دائن (دفعات)', 'الرصيد التراكمي'].map((x) => h('th', { text: x })))),
        h('tbody', null, ...rows)))));
}
