/** مستودع المصروفات وفئاتها. */

import { tx, get, getAll, put, add, del, getAllByIndex } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO } from '../utils/dates.js';

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدي' },
  { value: 'bank', label: 'تحويل بنكي' },
  { value: 'card', label: 'بطاقة' },
  { value: 'cheque', label: 'شيك' },
  { value: 'wallet', label: 'محفظة إلكترونية' },
  { value: 'credit', label: 'آجل' },
];

export const methodLabel = (value) =>
  PAYMENT_METHODS.find((m) => m.value === value)?.label || value || '—';

export const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'إيجار', color: '#7C5CE0' },
  { name: 'رواتب', color: '#12855A' },
  { name: 'مشتريات', color: '#1B63E3' },
  { name: 'نقل ومواصلات', color: '#D97706' },
  { name: 'مصروفات إدارية', color: '#0E9C8A' },
  { name: 'كهرباء وماء', color: '#0EA5E9' },
  { name: 'صيانة', color: '#EC4899' },
  { name: 'أخرى', color: '#94A3B8' },
];

export const listExpenses = (limit = 1000) =>
  tx(STORES.expenses, 'readonly', (stores) => getAll(stores[STORES.expenses]))
    .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));

export const expensesInRange = (fromKey, toKey) =>
  tx(STORES.expenses, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.expenses], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
  );

export const getExpense = (id) =>
  tx(STORES.expenses, 'readonly', (stores) => get(stores[STORES.expenses], id));

export async function createExpense(value) {
  const record = { id: uid('exp'), ...value, createdAt: toISO(), updatedAt: toISO() };
  await tx(STORES.expenses, 'readwrite', (stores) => add(stores[STORES.expenses], record));
  return record;
}

export async function updateExpense(id, patch) {
  return tx(STORES.expenses, 'readwrite', async (stores) => {
    const store = stores[STORES.expenses];
    const existing = await get(store, id);
    if (!existing) throw new Error('المصروف غير موجود');
    const record = { ...existing, ...patch, id, updatedAt: toISO() };
    await put(store, record);
    return record;
  });
}

export const deleteExpense = (id) =>
  tx(STORES.expenses, 'readwrite', (stores) => del(stores[STORES.expenses], id));

/* ------------------------------ الفئات ------------------------------ */

export const listExpenseCategories = () =>
  tx(STORES.expenseCategories, 'readonly', (stores) => getAll(stores[STORES.expenseCategories]));

export async function createExpenseCategory({ name, color = '#94A3B8' }) {
  const record = { id: uid('ecat'), name, color, createdAt: toISO() };
  try {
    await tx(STORES.expenseCategories, 'readwrite', (stores) => add(stores[STORES.expenseCategories], record));
  } catch (error) {
    if (error?.name === 'ConstraintError') throw new Error(`الفئة "${name}" موجودة بالفعل`);
    throw error;
  }
  return record;
}

export async function deleteExpenseCategory(id) {
  return tx([STORES.expenseCategories, STORES.expenses], 'readwrite', async (stores) => {
    const used = await getAll(stores[STORES.expenses].index('categoryId'), id, 1);
    if (used.length > 0) throw new Error('لا يمكن حذف فئة مرتبطة بمصروفات');
    await del(stores[STORES.expenseCategories], id);
    return true;
  });
}

export async function expenseCategoryMap() {
  const rows = await listExpenseCategories();
  return new Map(rows.map((row) => [row.id, row]));
}
