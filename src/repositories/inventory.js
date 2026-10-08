/**
 * مستودع حركات المخزون.
 *
 * قاعدة ثابتة: كمية المنتج لا تتغير أبداً إلا عبر `applyMovement`، ومعها
 * سجل حركة في نفس المعاملة. لا يوجد مسار آخر يكتب `product.quantity`.
 */

import { tx, get, getAll, put, add, getAllByIndex, iterate } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO, dayKey, monotonicISO } from '../utils/dates.js';

export const MOVEMENT = {
  IN: 'in',
  OUT: 'out',
  SALE: 'sale',
  CANCEL: 'cancel',
  COUNT: 'count',
  DAMAGE: 'damage',
  RETURN: 'return',
  INITIAL: 'initial',
};

export const MOVEMENT_LABEL = {
  [MOVEMENT.IN]: 'إضافة',
  [MOVEMENT.OUT]: 'سحب',
  [MOVEMENT.SALE]: 'بيع',
  [MOVEMENT.CANCEL]: 'إلغاء فاتورة',
  [MOVEMENT.COUNT]: 'جرد',
  [MOVEMENT.DAMAGE]: 'تلف',
  [MOVEMENT.RETURN]: 'مرتجع',
  [MOVEMENT.INITIAL]: 'رصيد افتتاحي',
};

export const DEFAULT_REASONS = [
  { name: 'جرد', system: true },
  { name: 'تلف', system: true },
  { name: 'مرتجع من عميل', system: true },
  { name: 'مرتجع إلى مورد', system: true },
  { name: 'شراء جديد', system: true },
  { name: 'خطأ إدخال', system: true },
  { name: 'فقد أو سرقة', system: true },
  { name: 'هدية أو عينة', system: true },
];

/**
 * يطبّق حركة مخزون **داخل معاملة قائمة**.
 * يجب أن تشمل المعاملة متجري products و inventoryMovements.
 *
 * @param {Record<string, IDBObjectStore>} stores
 * @param {object} movement
 * @param {string} movement.productId
 * @param {number} movement.delta التغيير الموقّع (+ إضافة / − سحب)
 * @param {string} movement.type
 * @param {string} [movement.reason]
 * @param {string} [movement.note]
 * @param {string} [movement.refType] 'sale' | 'adjustment' | 'import' | ...
 * @param {string} [movement.refId]
 * @param {boolean} [movement.allowNegative]
 * @returns {Promise<{movement:object, product:object}>}
 * @throws إذا كان المنتج غير موجود أو الرصيد سيصبح سالباً بلا إذن
 */
export async function applyMovement(stores, {
  productId, delta, type, reason = '', note = '', refType = '', refId = '',
  allowNegative = false, actor = 'المستخدم',
}) {
  const productStore = stores[STORES.products];
  const movementStore = stores[STORES.inventoryMovements];

  const product = await get(productStore, productId);
  if (!product) throw new Error(`المنتج غير موجود (${productId})`);

  if (!Number.isInteger(delta)) throw new Error('كمية الحركة يجب أن تكون عدداً صحيحاً');

  const balanceAfter = (product.quantity || 0) + delta;
  if (balanceAfter < 0 && !allowNegative) {
    throw new Error(`الكمية المتاحة من "${product.name}" غير كافية (المتاح ${product.quantity})`);
  }

  const stamp = new Date();
  // طابع متزايد تماماً: حركات متتالية في نفس الميلي ثانية يجب أن تبقى مرتَّبة
  const createdAt = monotonicISO(stamp);
  const record = {
    id: uid('mov'),
    productId,
    sku: product.sku,
    productName: product.name,
    type,
    quantity: delta,
    balanceAfter,
    reason,
    note,
    refType,
    refId,
    actor,
    createdAt,
    dayKey: dayKey(stamp),
  };

  await put(productStore, { ...product, quantity: balanceAfter, updatedAt: createdAt });
  await add(movementStore, record);

  return { movement: record, product: { ...product, quantity: balanceAfter } };
}

/** تسوية مخزون يدوية بسبب إلزامي — معاملة مستقلة */
export async function recordAdjustment({ productId, quantity, reason, note, allowNegative = false }) {
  return tx([STORES.products, STORES.inventoryMovements], 'readwrite', (stores) =>
    applyMovement(stores, {
      productId,
      delta: quantity,
      type: quantity >= 0 ? MOVEMENT.IN : MOVEMENT.OUT,
      reason,
      note,
      refType: 'adjustment',
      refId: uid('adj'),
      allowNegative,
    })
  );
}

/**
 * جرد: يضبط الكمية على القيمة الفعلية المعدودة ويسجّل الفرق كحركة واحدة.
 * لا يفعل شيئاً إذا كان الفرق صفراً.
 */
export async function recordStocktake({ productId, countedQuantity, note = '' }) {
  return tx([STORES.products, STORES.inventoryMovements], 'readwrite', async (stores) => {
    const product = await get(stores[STORES.products], productId);
    if (!product) throw new Error('المنتج غير موجود');

    const delta = countedQuantity - (product.quantity || 0);
    if (delta === 0) return { movement: null, product, delta: 0 };

    const result = await applyMovement(stores, {
      productId,
      delta,
      type: MOVEMENT.COUNT,
      reason: 'جرد',
      note: note || `الكمية المعدودة ${countedQuantity} مقابل المسجّلة ${product.quantity}`,
      refType: 'stocktake',
      refId: uid('stk'),
      allowNegative: true, // نتيجة العدّ هي الحقيقة
    });
    return { ...result, delta };
  });
}

/* ------------------------------- قراءة ------------------------------- */

export const listMovements = (limit = 200) =>
  tx(STORES.inventoryMovements, 'readonly', async (stores) => {
    const items = [];
    await iterate(stores[STORES.inventoryMovements].index('createdAt'), null, (movement) => {
      items.push(movement);
      return items.length < limit;
    }, 'prev');
    return items;
  });

export const movementsForProduct = (productId, limit = 100) =>
  tx(STORES.inventoryMovements, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.inventoryMovements], 'productId', productId, limit)
  ).then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

export const movementsInRange = (fromKey, toKey) =>
  tx(STORES.inventoryMovements, 'readonly', (stores) =>
    getAllByIndex(stores[STORES.inventoryMovements], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
  );

/** آخر حركة لكل منتج — لعمود «آخر حركة» في شاشة المخزون */
export async function lastMovementByProduct() {
  const map = new Map();
  await tx(STORES.inventoryMovements, 'readonly', (stores) =>
    iterate(stores[STORES.inventoryMovements].index('createdAt'), null, (movement) => {
      if (!map.has(movement.productId)) map.set(movement.productId, movement);
      return true;
    }, 'prev')
  );
  return map;
}

/* --------------------------- أسباب التسوية --------------------------- */

export const listReasons = () =>
  tx(STORES.adjustmentReasons, 'readonly', (stores) => getAll(stores[STORES.adjustmentReasons]))
    .then((rows) => rows.filter((r) => r.isActive !== false));

export async function createReason(name) {
  const record = { id: uid('rsn'), name, isActive: true, system: false, createdAt: toISO() };
  try {
    await tx(STORES.adjustmentReasons, 'readwrite', (stores) => add(stores[STORES.adjustmentReasons], record));
  } catch (error) {
    if (error?.name === 'ConstraintError') throw new Error(`السبب "${name}" موجود بالفعل`);
    throw error;
  }
  return record;
}

/**
 * تعطيل سبب. لا يُحذف أبداً إن كان مستخدماً في حركة (نمط Zoho)،
 * لأن حذفه يفسد قابلية قراءة السجل التاريخي.
 */
export async function deactivateReason(id) {
  return tx([STORES.adjustmentReasons, STORES.inventoryMovements], 'readwrite', async (stores) => {
    const store = stores[STORES.adjustmentReasons];
    const reason = await get(store, id);
    if (!reason) throw new Error('السبب غير موجود');
    await put(store, { ...reason, isActive: false });
    return true;
  });
}
