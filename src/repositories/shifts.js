/** وردية الكاشير: رصيد افتتاحي، حساب متوقع، وإقفال موثق بالفروقات. */
import { tx, get, getAll, put, add, getAllByIndex } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO, dayKey } from '../utils/dates.js';

export const SHIFT_STATUS = { OPEN: 'open', CLOSED: 'closed' };

export const currentShift = () => tx(STORES.shifts, 'readonly', (stores) => getAllByIndex(stores[STORES.shifts], 'status', SHIFT_STATUS.OPEN, 1)).then((rows) => rows[0] || null);
export const listShifts = (limit = 100) => tx(STORES.shifts, 'readonly', (stores) => getAll(stores[STORES.shifts])).then((rows) => rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, limit));

export async function openShift({ openingMinor, cashierName = '', note = '' }) {
  const amount = Math.max(0, Math.round(Number(openingMinor) || 0));
  return tx(STORES.shifts, 'readwrite', async (stores) => {
    const open = await getAllByIndex(stores[STORES.shifts], 'status', SHIFT_STATUS.OPEN, 1);
    if (open[0]) throw new Error('توجد وردية مفتوحة بالفعل');
    const stamp = new Date(); const record = { id: uid('shf'), status: SHIFT_STATUS.OPEN, openingMinor: amount, cashierName: cashierName.trim(), note: note.trim(), openedAt: toISO(stamp), dayKey: dayKey(stamp) };
    await add(stores[STORES.shifts], record); return record;
  });
}

export async function shiftSummary(shift) {
  if (!shift) return null;
  const end = shift.closedAt || toISO();
  const [sales, payments, expenses] = await Promise.all([
    tx(STORES.sales, 'readonly', (stores) => getAll(stores[STORES.sales])),
    tx(STORES.payments, 'readonly', (stores) => getAll(stores[STORES.payments])),
    tx(STORES.expenses, 'readonly', (stores) => getAll(stores[STORES.expenses])),
  ]);
  const inWindow = (row) => row.createdAt >= shift.openedAt && row.createdAt <= end;
  const cashSalesMinor = sales.filter((sale) => inWindow(sale) && sale.status === 'completed')
    .reduce((sum, sale) => sum + (sale.paymentBreakdown?.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amountMinor, 0) || (sale.paymentType === 'cash' ? sale.paidMinor : 0)), 0);
  const customerCashMinor = payments.filter((p) => inWindow(p) && p.method === 'cash').reduce((sum, p) => sum + p.amountMinor, 0);
  const cashExpensesMinor = expenses.filter((e) => inWindow(e) && e.method === 'cash').reduce((sum, e) => sum + e.amountMinor, 0);
  const expectedMinor = shift.openingMinor + cashSalesMinor + customerCashMinor - cashExpensesMinor;
  return { shift, cashSalesMinor, customerCashMinor, cashExpensesMinor, expectedMinor };
}

export async function closeShift({ shiftId, countedMinor, note = '' }) {
  const open = await currentShift();
  if (!open || open.id !== shiftId) throw new Error('الوردية غير مفتوحة');
  const summary = await shiftSummary(open);
  return tx(STORES.shifts, 'readwrite', async (stores) => {
    const shift = await get(stores[STORES.shifts], shiftId);
    if (!shift || shift.status !== SHIFT_STATUS.OPEN) throw new Error('الوردية غير مفتوحة');
    const actual = Math.max(0, Math.round(Number(countedMinor) || 0)); const closedAt = toISO();
    const record = { ...shift, status: SHIFT_STATUS.CLOSED, expectedMinor: summary.expectedMinor, countedMinor: actual, differenceMinor: actual - summary.expectedMinor, closeNote: note.trim(), closedAt };
    await put(stores[STORES.shifts], record); return { shift: record, summary };
  });
}
