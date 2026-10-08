/**
 * مستودع المبيعات.
 *
 * `completeSale` و`cancelSale` تنفّذان كل شيء داخل معاملة IndexedDB واحدة:
 * إنشاء الفاتورة وسطورها، وتخفيض المخزون، وتسجيل الحركات، وزيادة عدّاد الترقيم.
 * أي فشل في أي خطوة يُجهض المعاملة بالكامل فلا تبقى فاتورة جزئية ولا مخزون غير متسق.
 */

import { tx, get, getAll, put, add, del, count, getAllByIndex, iterate } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid, formatInvoiceNumber } from '../utils/id.js';
import { toISO, dayKey } from '../utils/dates.js';
import { computeTotals, allocateProportionally, roundHalfUp } from '../utils/money.js';
import { applyMovement, MOVEMENT } from './inventory.js';
import { readSettingIn, writeSettingIn, DEFAULT_SETTINGS } from './settings.js';

export const SALE_STATUS = { COMPLETED: 'completed', CANCELLED: 'cancelled', PENDING: 'pending' };

export const SALE_STATUS_LABEL = {
  [SALE_STATUS.COMPLETED]: 'مكتملة',
  [SALE_STATUS.PENDING]: 'معلقة',
  [SALE_STATUS.CANCELLED]: 'ملغاة',
};

export const SALE_STATUS_TONE = {
  [SALE_STATUS.COMPLETED]: 'green',
  [SALE_STATUS.PENDING]: 'amber',
  [SALE_STATUS.CANCELLED]: 'red',
};

export const PAYMENT_TYPE = {
  CASH: 'cash', BANK: 'bank', CARD: 'card', CHEQUE: 'cheque', WALLET: 'wallet', CREDIT: 'credit', MIXED: 'mixed',
};
export const PAYMENT_TYPE_LABEL = {
  [PAYMENT_TYPE.CASH]: 'نقدي', [PAYMENT_TYPE.BANK]: 'تحويل بنكي', [PAYMENT_TYPE.CARD]: 'بطاقة',
  [PAYMENT_TYPE.CHEQUE]: 'شيك', [PAYMENT_TYPE.WALLET]: 'محفظة إلكترونية', [PAYMENT_TYPE.CREDIT]: 'آجل',
  [PAYMENT_TYPE.MIXED]: 'دفع مختلط',
};

/* ------------------------------------------------------------------ */
/* إتمام البيع                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} input
 * @param {{productId:string, quantity:number, unitPriceMinor?:number}[]} input.lines
 * @param {{id:string|null, name:string}} [input.customer]
 * @param {{type:'percent'|'amount', value:number}} [input.discount]
 * @param {number} [input.taxRateBp]
 * @param {boolean} [input.taxInclusive]
 * @param {string} [input.paymentType]
 * @param {number} [input.paidMinor] المدفوع فعلياً (للآجل)
 * @param {{method:string, amountMinor:number}[]} [input.paymentBreakdown] دفعات الفاتورة
 * @param {string} [input.note]
 * @param {boolean} [input.allowNegativeStock]
 * @returns {Promise<{sale:object, items:object[]}>}
 */
export async function completeSale({
  lines,
  customer = { id: null, name: 'عميل نقدي' },
  discount = { type: 'amount', value: 0 },
  taxRateBp = 0,
  taxInclusive = false,
  paymentType = PAYMENT_TYPE.CASH,
  paidMinor = null,
  paymentBreakdown = [],
  note = '',
  allowNegativeStock = false,
}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('لا يمكن إتمام بيع بعربة فارغة');
  }
  if ((paymentType === PAYMENT_TYPE.CREDIT || Number(paidMinor) < 0) && !customer?.id) {
    throw new Error('البيع الآجل يتطلب اختيار عميل مسجّل');
  }

  return tx(
    [STORES.products, STORES.inventoryMovements, STORES.sales, STORES.saleItems, STORES.settings],
    'readwrite',
    async (stores) => {
      const productStore = stores[STORES.products];

      // 1) قراءة المنتجات والتحقق منها قبل أي كتابة
      const resolved = [];
      for (const line of lines) {
        const product = await get(productStore, line.productId);
        if (!product) throw new Error('أحد المنتجات في العربة لم يعد موجوداً');

        const quantity = Number(line.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error(`كمية غير صالحة للمنتج "${product.name}"`);
        }
        if (!allowNegativeStock && product.quantity < quantity) {
          throw new Error(`الكمية المتاحة من "${product.name}" غير كافية (المتاح ${product.quantity})`);
        }

        resolved.push({
          product,
          quantity,
          unitPriceMinor: line.unitPriceMinor ?? product.priceMinor,
          unitCostMinor: product.costMinor ?? 0,
        });
      }

      // 2) الحسابات المالية (وحدات صغرى صحيحة)
      const totals = computeTotals(
        resolved.map((r) => ({ unitPriceMinor: r.unitPriceMinor, quantity: r.quantity })),
        discount,
        taxRateBp,
        taxInclusive
      );

      const lineGross = resolved.map((r) => roundHalfUp(r.unitPriceMinor * r.quantity));
      const lineDiscounts = allocateProportionally(totals.discountMinor, lineGross);

      // 3) ترقيم الفاتورة من داخل نفس المعاملة (يمنع تكرار الرقم)
      const settingsStore = stores[STORES.settings];
      const prefix = await readSettingIn(settingsStore, 'invoicePrefix') ?? DEFAULT_SETTINGS.invoicePrefix;
      const includeYear = await readSettingIn(settingsStore, 'invoiceIncludeYear');
      const nextNumber = Number(await readSettingIn(settingsStore, 'invoiceNextNumber')) || 1;

      const stamp = new Date();
      const number = formatInvoiceNumber(
        prefix,
        nextNumber,
        includeYear === false ? null : stamp.getFullYear()
      );

      const saleId = uid('sal');
      const createdAt = toISO(stamp);
      const today = dayKey(stamp);

      const normalizedBreakdown = (paymentBreakdown || [])
        .map((entry) => ({ method: entry.method, amountMinor: Math.max(0, Math.round(Number(entry.amountMinor) || 0)) }))
        .filter((entry) => entry.amountMinor > 0 && PAYMENT_TYPE_LABEL[entry.method] && entry.method !== PAYMENT_TYPE.CREDIT);
      const breakdownPaid = normalizedBreakdown.reduce((sum, entry) => sum + entry.amountMinor, 0);
      const paid = normalizedBreakdown.length > 0
        ? Math.min(breakdownPaid, totals.totalMinor)
        : paymentType === PAYMENT_TYPE.CREDIT
          ? Math.min(Math.max(Number(paidMinor) || 0, 0), totals.totalMinor)
          : totals.totalMinor;
      if (paid < totals.totalMinor && !customer?.id) {
        throw new Error('الدفع الجزئي يتطلب اختيار عميل مسجّل');
      }

      const sale = {
        id: saleId,
        number,
        status: SALE_STATUS.COMPLETED,
        paymentType,
        paymentBreakdown: normalizedBreakdown,
        customerId: customer?.id || null,
        customerName: customer?.name || 'عميل نقدي',
        subtotalMinor: totals.subtotalMinor,
        discountType: discount?.type || 'amount',
        discountValue: discount?.value || 0,
        discountMinor: totals.discountMinor,
        taxRateBp,
        taxInclusive: Boolean(taxInclusive),
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        paidMinor: paid,
        dueMinor: totals.totalMinor - paid,
        itemCount: resolved.length,
        unitCount: resolved.reduce((sum, r) => sum + r.quantity, 0),
        costMinor: resolved.reduce((sum, r) => sum + roundHalfUp(r.unitCostMinor * r.quantity), 0),
        note: note || '',
        createdAt,
        updatedAt: createdAt,
        dayKey: today,
        cancelledAt: null,
        cancelReason: null,
      };

      // 4) الكتابة: الفاتورة ثم السطور ثم حركات المخزون
      await add(stores[STORES.sales], sale);

      const items = [];
      for (let i = 0; i < resolved.length; i += 1) {
        const r = resolved[i];
        const item = {
          id: uid('sit'),
          saleId,
          productId: r.product.id,
          sku: r.product.sku,
          name: r.product.name,          // لقطة: تغيير اسم المنتج لاحقاً لا يغيّر الفاتورة
          unit: r.product.unit,
          quantity: r.quantity,
          unitPriceMinor: r.unitPriceMinor,
          unitCostMinor: r.unitCostMinor, // لقطة التكلفة لحماية تقارير الربح
          lineDiscountMinor: lineDiscounts[i],
          lineTotalMinor: lineGross[i] - lineDiscounts[i],
          dayKey: today,
          createdAt,
        };
        items.push(item);
        await add(stores[STORES.saleItems], item);

        await applyMovement(stores, {
          productId: r.product.id,
          delta: -r.quantity,
          type: MOVEMENT.SALE,
          reason: 'بيع',
          note: `فاتورة ${number}`,
          refType: 'sale',
          refId: saleId,
          allowNegative: allowNegativeStock,
        });
      }

      // 5) زيادة العدّاد — آخر خطوة، داخل نفس المعاملة
      await writeSettingIn(settingsStore, 'invoiceNextNumber', nextNumber + 1);

      return { sale, items };
    }
  );
}

/* ------------------------------------------------------------------ */
/* إلغاء الفاتورة                                                       */
/* ------------------------------------------------------------------ */

/**
 * إلغاء بعملية تعويض ذرّية: يعيد كل كمية إلى المخزون ويسجّل حركة لكل سطر،
 * ويحدّث حالة الفاتورة. الفاتورة **لا تُحذف** أبداً.
 */
export async function cancelSale(saleId, reason = '') {
  return tx(
    [STORES.products, STORES.inventoryMovements, STORES.sales, STORES.saleItems],
    'readwrite',
    async (stores) => {
      const saleStore = stores[STORES.sales];
      const sale = await get(saleStore, saleId);
      if (!sale) throw new Error('الفاتورة غير موجودة');
      if (sale.status === SALE_STATUS.CANCELLED) throw new Error('الفاتورة ملغاة بالفعل');

      const items = await getAll(stores[STORES.saleItems].index('saleId'), saleId);
      if (items.length === 0) throw new Error('لا توجد سطور لهذه الفاتورة');

      for (const item of items) {
        await applyMovement(stores, {
          productId: item.productId,
          delta: item.quantity,
          type: MOVEMENT.CANCEL,
          reason: 'إلغاء فاتورة',
          note: `إلغاء ${sale.number}${reason ? ` — ${reason}` : ''}`,
          refType: 'sale-cancel',
          refId: saleId,
          allowNegative: true, // الإرجاع يزيد المخزون، لا يمكن أن يجعله سالباً
        });
      }

      const cancelledAt = toISO();
      const updated = {
        ...sale,
        status: SALE_STATUS.CANCELLED,
        cancelledAt,
        cancelReason: reason || '',
        updatedAt: cancelledAt,
        dueMinor: 0, // الفاتورة الملغاة لا تُحمّل على ذمة العميل
      };
      await put(saleStore, updated);

      return { sale: updated, restoredLines: items.length };
    }
  );
}

/* ------------------------------------------------------------------ */
/* قراءة                                                                */
/* ------------------------------------------------------------------ */

export const getSale = (id) =>
  tx(STORES.sales, 'readonly', (stores) => get(stores[STORES.sales], id));

export const getSaleItems = (saleId) =>
  tx(STORES.saleItems, 'readonly', (stores) => getAllByIndex(stores[STORES.saleItems], 'saleId', saleId));

export async function getSaleWithItems(saleId) {
  return tx([STORES.sales, STORES.saleItems], 'readonly', async (stores) => {
    const sale = await get(stores[STORES.sales], saleId);
    if (!sale) return null;
    const items = await getAll(stores[STORES.saleItems].index('saleId'), saleId);
    return { sale, items };
  });
}

export const listSales = (limit = 500) =>
  tx(STORES.sales, 'readonly', async (stores) => {
    const items = [];
    await iterate(stores[STORES.sales].index('createdAt'), null, (sale) => {
      items.push(sale);
      return items.length < limit;
    }, 'prev');
    return items;
  });

export const salesInRange = (fromKey, toKey) =>
  tx(STORES.sales, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.sales], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
  );

export const saleItemsInRange = (fromKey, toKey) =>
  tx(STORES.saleItems, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.saleItems], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
  );

export const salesForCustomer = (customerId, limit = 50) =>
  tx(STORES.sales, 'readonly', (stores) => getAllByIndex(stores[STORES.sales], 'customerId', customerId))
    .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));

/* ------------------------------------------------------------------ */
/* البيوع المعلّقة                                                      */
/* ------------------------------------------------------------------ */

export async function suspendSale(cart) {
  const record = {
    id: uid('sus'),
    label: cart.label || '',
    customerId: cart.customer?.id || null,
    customerName: cart.customer?.name || 'عميل نقدي',
    lines: cart.lines,
    discount: cart.discount || { type: 'amount', value: 0 },
    itemCount: cart.lines.length,
    totalMinor: cart.totalMinor || 0,
    createdAt: toISO(),
  };
  await tx(STORES.suspendedSales, 'readwrite', (stores) => add(stores[STORES.suspendedSales], record));
  return record;
}

export const listSuspended = () =>
  tx(STORES.suspendedSales, 'readonly', (stores) => getAll(stores[STORES.suspendedSales]))
    .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

/** يستعيد بيعاً معلّقاً ويحذفه في نفس المعاملة حتى لا يُستعاد مرتين */
export async function resumeSuspended(id) {
  return tx(STORES.suspendedSales, 'readwrite', async (stores) => {
    const store = stores[STORES.suspendedSales];
    const record = await get(store, id);
    if (!record) throw new Error('البيع المعلّق غير موجود');
    await del(store, id);
    return record;
  });
}

export const deleteSuspended = (id) =>
  tx(STORES.suspendedSales, 'readwrite', (stores) => del(stores[STORES.suspendedSales], id));

export const countSuspended = () =>
  tx(STORES.suspendedSales, 'readonly', (stores) => count(stores[STORES.suspendedSales]));
