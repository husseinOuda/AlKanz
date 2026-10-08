/**
 * مستودع العملاء والذمم.
 *
 * الرصيد **محسوب دائماً** من الفواتير الآجلة والمدفوعات، ولا يوجد حقل رصيد
 * محفوظ يمكن أن ينحرف عن الحركات.
 */

import { tx, get, getAll, put, add, del, getAllByIndex, iterate } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO, dayKey } from '../utils/dates.js';
import { returnsForSale } from './returns.js';

/** عميل نقدي افتراضي — ليس سجلاً في قاعدة البيانات */
export const WALK_IN = Object.freeze({
  id: null,
  name: 'عميل نقدي',
  phone: '',
  isWalkIn: true,
});

export const listCustomers = () =>
  tx(STORES.customers, 'readonly', (stores) => getAll(stores[STORES.customers]));

export const getCustomer = (id) =>
  tx(STORES.customers, 'readonly', (stores) => get(stores[STORES.customers], id));

export async function createCustomer(value) {
  const record = { id: uid('cus'), ...value, createdAt: toISO(), updatedAt: toISO() };
  await tx(STORES.customers, 'readwrite', (stores) => add(stores[STORES.customers], record));
  return record;
}

export async function updateCustomer(id, patch) {
  return tx(STORES.customers, 'readwrite', async (stores) => {
    const store = stores[STORES.customers];
    const existing = await get(store, id);
    if (!existing) throw new Error('العميل غير موجود');
    const record = { ...existing, ...patch, id, updatedAt: toISO() };
    await put(store, record);
    return record;
  });
}

/** حذف عميل — يُمنع إن كان له فواتير أو مدفوعات (حماية السجل المالي) */
export async function deleteCustomer(id) {
  return tx([STORES.customers, STORES.sales, STORES.payments], 'readwrite', async (stores) => {
    const sales = await getAll(stores[STORES.sales].index('customerId'), id, 1);
    if (sales.length > 0) {
      throw new Error('لا يمكن حذف عميل له فواتير. يمكنك تعطيله بدل حذفه.');
    }
    const payments = await getAll(stores[STORES.payments].index('customerId'), id, 1);
    if (payments.length > 0) {
      throw new Error('لا يمكن حذف عميل له مدفوعات مسجّلة.');
    }
    await del(stores[STORES.customers], id);
    return true;
  });
}

/* ------------------------------ الذمم ------------------------------ */

/**
 * يحسب ملخصاً مالياً لكل عميل في مسح واحد.
 * @returns {Promise<Map<string, {balanceMinor, purchasesMinor, invoiceCount, lastPurchaseAt, monthPurchasesMinor}>>}
 */
export async function customerLedgers() {
  const ledgers = new Map();
  const monthPrefix = dayKey(new Date()).slice(0, 7);

  const ensure = (id) => {
    if (!ledgers.has(id)) {
      ledgers.set(id, {
        balanceMinor: 0,
        purchasesMinor: 0,
        paidMinor: 0,
        invoiceCount: 0,
        monthPurchasesMinor: 0,
        lastPurchaseAt: null,
      });
    }
    return ledgers.get(id);
  };

  await tx([STORES.sales, STORES.payments, STORES.returns], 'readonly', async (stores) => {
    await iterate(stores[STORES.sales], null, (sale) => {
      if (!sale.customerId || sale.status === 'cancelled') return true;
      const ledger = ensure(sale.customerId);
      ledger.invoiceCount += 1;
      ledger.purchasesMinor += sale.totalMinor;
      ledger.balanceMinor += sale.dueMinor || 0;
      if (sale.dayKey?.startsWith(monthPrefix)) ledger.monthPurchasesMinor += sale.totalMinor;
      if (!ledger.lastPurchaseAt || sale.createdAt > ledger.lastPurchaseAt) {
        ledger.lastPurchaseAt = sale.createdAt;
      }
      return true;
    });

    await iterate(stores[STORES.payments], null, (payment) => {
      if (!payment.customerId) return true;
      const ledger = ensure(payment.customerId);
      ledger.balanceMinor -= payment.amountMinor;
      ledger.paidMinor += payment.amountMinor;
      return true;
    });
    await iterate(stores[STORES.returns], null, (returnRecord) => {
      if (!returnRecord.customerId || returnRecord.refundMethod !== 'credit') return true;
      const ledger = ensure(returnRecord.customerId);
      ledger.balanceMinor -= returnRecord.refundMinor;
      ledger.paidMinor += returnRecord.refundMinor;
      return true;
    });
  });

  return ledgers;
}

export async function customerBalance(customerId) {
  const ledgers = await customerLedgers();
  return ledgers.get(customerId)?.balanceMinor ?? 0;
}

/** يسجّل دفعة من عميل */
export async function recordPayment({ customerId, amountMinor, method, reference, note, saleId = null }) {
  const stamp = new Date();
  const record = {
    id: uid('pay'),
    customerId,
    saleId,
    amountMinor,
    method: method || 'cash',
    reference: reference || '',
    note: note || '',
    createdAt: toISO(stamp),
    dayKey: dayKey(stamp),
  };

  await tx([STORES.customers, STORES.payments], 'readwrite', async (stores) => {
    const customer = await get(stores[STORES.customers], customerId);
    if (!customer) throw new Error('العميل غير موجود');
    await add(stores[STORES.payments], record);
  });

  return record;
}

export const paymentsForCustomer = (customerId) =>
  tx(STORES.payments, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.payments], 'customerId', customerId)
  ).then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

export const paymentsInRange = (fromKey, toKey) =>
  tx(STORES.payments, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.payments], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
  );

/**
 * كشف حساب: الفواتير والمدفوعات مرتبة زمنياً مع رصيد تراكمي.
 */
export async function customerStatement(customerId) {
  const [sales, payments] = await Promise.all([
    tx(STORES.sales, 'readonly', (stores) => getAllByIndex(stores[STORES.sales], 'customerId', customerId)),
    paymentsForCustomer(customerId),
  ]);
  const returns = (await Promise.all(sales.map((sale) => returnsForSale(sale.id)))).flat()
    .filter((returnRecord) => returnRecord.customerId === customerId && returnRecord.refundMethod === 'credit');

  const entries = [
    ...sales
      .filter((sale) => sale.status !== 'cancelled')
      .map((sale) => ({
        at: sale.createdAt,
        kind: 'invoice',
        label: sale.number,
        debitMinor: sale.dueMinor || 0,
        creditMinor: 0,
        totalMinor: sale.totalMinor,
        ref: sale.id,
      })),
    ...payments.map((payment) => ({
      at: payment.createdAt,
      kind: 'payment',
      label: payment.reference || 'دفعة',
      debitMinor: 0,
      creditMinor: payment.amountMinor,
      ref: payment.id,
    })),
    ...returns.map((returnRecord) => ({
      at: returnRecord.createdAt,
      kind: 'return',
      label: `مرتجع ${returnRecord.saleNumber}`,
      debitMinor: 0,
      creditMinor: returnRecord.refundMinor,
      ref: returnRecord.id,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  let running = 0;
  for (const entry of entries) {
    running += entry.debitMinor - entry.creditMinor;
    entry.balanceMinor = running;
  }

  return { entries, balanceMinor: running };
}
