/** مرتجعات المبيعات: عملية مستقلة تحفظ أثرها المالي والمخزني. */
import { tx, get, getAll, add, getAllByIndex } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO, dayKey } from '../utils/dates.js';
import { roundHalfUp } from '../utils/money.js';
import { applyMovement, MOVEMENT } from './inventory.js';
import { SALE_STATUS } from './sales.js';

export const REFUND_METHOD_LABEL = {
  cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك', wallet: 'محفظة إلكترونية', credit: 'تخفيض ذمة العميل',
};

export async function returnsForSale(saleId) {
  return tx(STORES.returns, 'readonly', (stores) => getAllByIndex(stores[STORES.returns], 'saleId', saleId))
    .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export const returnsInRange = (fromKey, toKey) =>
  tx(STORES.returns, 'readonly', (stores) => getAllByIndex(stores[STORES.returns], 'dayKey', IDBKeyRange.bound(fromKey, toKey)));

export async function returnAvailability(saleId) {
  return tx([STORES.saleItems, STORES.returnItems], 'readonly', async (stores) => {
    const items = await getAllByIndex(stores[STORES.saleItems], 'saleId', saleId);
    const returned = await getAllByIndex(stores[STORES.returnItems], 'saleId', saleId);
    const quantityByItem = new Map();
    for (const item of returned) quantityByItem.set(item.saleItemId, (quantityByItem.get(item.saleItemId) || 0) + item.quantity);
    return items.map((item) => ({ ...item, returnedQuantity: quantityByItem.get(item.id) || 0, availableQuantity: item.quantity - (quantityByItem.get(item.id) || 0) }));
  });
}

export async function createReturn({ saleId, lines, reason = '', refundMethod = 'cash', note = '' }) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('اختر صنفاً واحداً على الأقل للإرجاع');
  if (!REFUND_METHOD_LABEL[refundMethod]) throw new Error('طريقة إعادة المبلغ غير صالحة');
  return tx([STORES.sales, STORES.saleItems, STORES.returnItems, STORES.returns, STORES.products, STORES.inventoryMovements], 'readwrite', async (stores) => {
    const sale = await get(stores[STORES.sales], saleId);
    if (!sale || sale.status === SALE_STATUS.CANCELLED) throw new Error('لا يمكن إرجاع فاتورة غير موجودة أو ملغاة');
    const saleItems = await getAllByIndex(stores[STORES.saleItems], 'saleId', saleId);
    const previous = await getAllByIndex(stores[STORES.returnItems], 'saleId', saleId);
    const returned = new Map();
    for (const item of previous) returned.set(item.saleItemId, (returned.get(item.saleItemId) || 0) + item.quantity);
    const selected = [];
    for (const line of lines) {
      const source = saleItems.find((item) => item.id === line.saleItemId);
      const quantity = Math.trunc(Number(line.quantity));
      if (!source || quantity <= 0 || quantity > source.quantity - (returned.get(source.id) || 0)) throw new Error('كمية المرتجع تتجاوز الكمية المتاحة');
      selected.push({ source, quantity });
    }
    const weights = selected.map(({ source, quantity }) => source.lineTotalMinor * quantity / source.quantity);
    const sumWeights = weights.reduce((sum, value) => sum + value, 0);
    const refundMinor = sumWeights > 0 ? Math.min(sale.totalMinor, roundHalfUp(sale.totalMinor * sumWeights / Math.max(1, sale.subtotalMinor - sale.discountMinor))) : 0;
    const stamp = new Date(); const createdAt = toISO(stamp); const returnId = uid('ret');
    const record = { id: returnId, saleId, saleNumber: sale.number, customerId: sale.customerId || null, refundMinor, refundMethod, reason: reason.trim(), note: note.trim(), createdAt, dayKey: dayKey(stamp) };
    await add(stores[STORES.returns], record);
    const items = [];
    for (const { source, quantity } of selected) {
      const item = { id: uid('rit'), returnId, saleId, saleItemId: source.id, productId: source.productId, name: source.name, sku: source.sku, quantity, refundMinor: roundHalfUp(refundMinor * (source.lineTotalMinor * quantity / source.quantity) / Math.max(1, sumWeights)), createdAt };
      items.push(item); await add(stores[STORES.returnItems], item);
      await applyMovement(stores, { productId: source.productId, delta: quantity, type: MOVEMENT.RETURN, reason: reason || 'مرتجع من عميل', note: `مرتجع ${sale.number}`, refType: 'return', refId: returnId, allowNegative: true });
    }
    return { return: record, items };
  });
}
