import { h, ltr } from '../utils/dom.js';
import { card, kpi, kpiGrid, detailRow, field, alertBox } from '../components/ui.js';
import { openModal, toastOk, toastError } from '../components/feedback.js';
import { currentShift, listShifts, openShift, closeShift, shiftSummary } from '../repositories/shifts.js';
import { settings } from '../repositories/settings.js';
import { formatAmount } from '../utils/format.js';
import { toMinor, toMajor } from '../utils/money.js';
import { formatDateTime } from '../utils/dates.js';
import { notifyDataChanged } from '../state/store.js';
import { refresh } from '../router.js';

export async function render() {
  const s = settings(); const symbol = s.currencySymbol;
  const [shift, history] = await Promise.all([currentShift(), listShifts()]);
  const summary = await shiftSummary(shift);
  const money = (minor) => h('span', null, ltr(formatAmount(minor)), ` ${symbol}`);
  function openStart() {
    const amount = field({ label: 'الرصيد الافتتاحي', name: 'opening', value: '0', suffix: symbol });
    const cashier = field({ label: 'اسم الكاشير', name: 'cashier', placeholder: 'اختياري' });
    const modal = openModal({ title: 'فتح وردية', body: [amount.element, cashier.element], footer: [
      h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'فتح الوردية', on: { click: async () => { try { await openShift({ openingMinor: toMinor(amount.value || '0'), cashierName: cashier.value }); modal.close(); notifyDataChanged(); toastOk('تم فتح الوردية'); refresh(); } catch (e) { toastError(e.message); } } } }),
      h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
    ] });
  }
  function openClose() {
    const counted = field({ label: 'المبلغ النقدي الفعلي', name: 'counted', value: String(toMajor(summary.expectedMinor)), suffix: symbol });
    const note = field({ label: 'ملاحظة الإغلاق', name: 'note', rows: 2 });
    const modal = openModal({ title: 'إغلاق الوردية', body: [alertBox(`الرصيد المتوقع: ${formatAmount(summary.expectedMinor)} ${symbol}`, 'info'), counted.element, note.element], footer: [
      h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'إغلاق واعتماد', on: { click: async () => { try { const result = await closeShift({ shiftId: shift.id, countedMinor: toMinor(counted.value || '0'), note: note.value }); modal.close(); notifyDataChanged(); toastOk(`أغلقت الوردية، الفرق ${formatAmount(result.shift.differenceMinor)} ${symbol}`); refresh(); } catch (e) { toastError(e.message); } } } }),
      h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
    ] });
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'page__head' }, h('div', null, h('h2', { text: 'الورديات والصندوق' }), h('p', { text: 'متابعة النقدية الفعلية ومطابقتها مع الحركات المسجلة.' })), h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: shift ? 'إغلاق الوردية' : 'فتح وردية', on: { click: shift ? openClose : openStart } })),
    shift ? kpiGrid(kpi({ label: 'الرصيد المتوقع', value: formatAmount(summary.expectedMinor), unit: symbol, tone: 'green', iconName: 'cash' }), kpi({ label: 'مبيعات نقدية', value: formatAmount(summary.cashSalesMinor), unit: symbol, tone: 'blue', iconName: 'invoices' }), kpi({ label: 'مصروفات نقدية', value: formatAmount(summary.cashExpensesMinor), unit: symbol, tone: 'amber', iconName: 'expenses' })) : alertBox('لا توجد وردية مفتوحة. افتح وردية قبل بدء عمل الكاشير.', 'info'),
    shift ? card({ title: 'حركة الوردية الحالية', body: h('div', { class: 'stack' }, detailRow('فُتحت في', ltr(formatDateTime(shift.openedAt, s.dateFormat))), detailRow('الرصيد الافتتاحي', money(shift.openingMinor)), detailRow('تحصيلات العملاء النقدية', money(summary.customerCashMinor)), detailRow('الرصد المتوقع', money(summary.expectedMinor))) }) : null,
    card({ title: 'سجل الورديات', body: h('div', { class: 'stack' }, ...history.map((item) => detailRow(`${item.status === 'open' ? 'وردية مفتوحة' : 'وردية مغلقة'} — ${formatDateTime(item.openedAt, s.dateFormat)}`, item.status === 'closed' ? money(item.differenceMinor) : 'قيد العمل'))) })
  );
}
