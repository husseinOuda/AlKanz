/** مستودع المنتجات والفئات. */

import { tx, get, getAll, put, add, del, getByIndex, iterate } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO } from '../utils/dates.js';

export const STOCK_STATUS = { OUT: 'out', LOW: 'low', OK: 'ok' };

export function stockStatus(product) {
  if (!product) return STOCK_STATUS.OUT;
  if (product.quantity <= 0) return STOCK_STATUS.OUT;
  if (product.quantity <= (product.reorderPoint ?? product.minimumStock ?? product.lowStockThreshold ?? 0)) return STOCK_STATUS.LOW;
  return STOCK_STATUS.OK;
}

export const STOCK_LABEL = {
  [STOCK_STATUS.OUT]: 'نفد المخزون',
  [STOCK_STATUS.LOW]: 'يحتاج إلى إعادة طلب',
  [STOCK_STATUS.OK]: 'متوفر',
};

export const STOCK_TONE = {
  [STOCK_STATUS.OUT]: 'red',
  [STOCK_STATUS.LOW]: 'amber',
  [STOCK_STATUS.OK]: 'green',
};

/* ------------------------------- قراءة ------------------------------- */

export const listProducts = () =>
  tx(STORES.products, 'readonly', (stores) => getAll(stores[STORES.products]));

export const getProduct = (id) =>
  tx(STORES.products, 'readonly', (stores) => get(stores[STORES.products], id));

export const findBySku = (sku) =>
  tx(STORES.products, 'readonly', (stores) => getByIndex(stores[STORES.products], 'sku', sku));

export const findByBarcode = (barcode) =>
  tx(STORES.products, 'readonly', (stores) => getByIndex(stores[STORES.products], 'barcode', barcode));

/** بحث سريع بالاسم أو SKU أو الباركود — مطابقة دقيقة للباركود أولاً */
export async function searchProducts(term, { limit = 50, activeOnly = true } = {}) {
  const query = String(term || '').trim().toLowerCase();
  if (!query) return [];

  return tx(STORES.products, 'readonly', async (stores) => {
    const store = stores[STORES.products];

    const exact = await getByIndex(store, 'barcode', query.toUpperCase())
      || await getByIndex(store, 'sku', query.toUpperCase());
    if (exact) return [exact];

    const results = [];
    await iterate(store, null, (product) => {
      if (activeOnly && product.isActive === false) return true;
      const haystack = `${product.nameLower || ''} ${product.sku || ''} ${product.barcode || ''}`.toLowerCase();
      if (haystack.includes(query)) results.push(product);
      return results.length < limit;
    });
    return results;
  });
}

export async function productsToReorder() {
  const products = await listProducts();
  return products.filter((p) => p.isActive !== false).map((product) => {
    const minimumStock = product.minimumStock ?? product.lowStockThreshold ?? 0;
    const reorderPoint = product.reorderPoint ?? product.lowStockThreshold ?? minimumStock;
    const threshold = Math.max(minimumStock, reorderPoint);
    const maximumStock = product.maximumStock ?? 0;
    const targetStock = maximumStock > threshold ? maximumStock : threshold;
    return { ...product, minimumStock, reorderPoint, targetStock, suggestedPurchase: Math.max(1, targetStock - (product.quantity || 0)) };
  }).filter((product) => product.quantity <= product.reorderPoint)
    .sort((a, b) => (a.quantity - a.reorderPoint) - (b.quantity - b.reorderPoint));
}

export async function lowStockProducts(limit = 100) {
  const products = await listProducts();
  return products
    .filter((p) => p.isActive !== false && stockStatus(p) !== STOCK_STATUS.OK)
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, limit);
}

/* ------------------------------- كتابة ------------------------------- */

/**
 * ينشئ منتجاً. يفشل إن كان SKU أو الباركود مكرراً (فهرس فريد على مستوى القاعدة).
 * @throws {Error} برسالة عربية مفهومة عند التكرار
 */
export async function createProduct(value) {
  const record = {
    id: uid('prd'),
    ...value,
    createdAt: toISO(),
    updatedAt: toISO(),
  };

  try {
    await tx(STORES.products, 'readwrite', (stores) => add(stores[STORES.products], record));
  } catch (error) {
    throw translateConstraintError(error, record);
  }
  return record;
}

export async function updateProduct(id, patch) {
  let updated;
  try {
    updated = await tx(STORES.products, 'readwrite', async (stores) => {
      const store = stores[STORES.products];
      const existing = await get(store, id);
      if (!existing) throw new Error('المنتج غير موجود');

      const record = { ...existing, ...patch, id, updatedAt: toISO() };
      // الكمية تتغير عبر حركات المخزون فقط، لا عبر تعديل المنتج مباشرة
      record.quantity = existing.quantity;
      await put(store, record);
      return record;
    });
  } catch (error) {
    throw translateConstraintError(error, patch);
  }
  return updated;
}

/** حذف منتج — يُمنع إن كان مستخدماً في أي فاتورة (حماية التقارير التاريخية) */
export async function deleteProduct(id) {
  return tx([STORES.products, STORES.saleItems], 'readwrite', async (stores) => {
    const used = await getAll(stores[STORES.saleItems].index('productId'), id, 1);
    if (used.length > 0) {
      throw new Error('لا يمكن حذف منتج مرتبط بفواتير. يمكنك تعطيله بدل حذفه.');
    }
    await del(stores[STORES.products], id);
    return true;
  });
}

export async function setProductActive(id, isActive) {
  return tx(STORES.products, 'readwrite', async (stores) => {
    const store = stores[STORES.products];
    const existing = await get(store, id);
    if (!existing) throw new Error('المنتج غير موجود');
    const record = { ...existing, isActive: Boolean(isActive), updatedAt: toISO() };
    await put(store, record);
    return record;
  });
}

function translateConstraintError(error, record) {
  if (error?.name === 'ConstraintError') {
    const message = record?.barcode
      ? `رمز SKU "${record.sku}" أو الباركود "${record.barcode}" مستخدم بالفعل`
      : `رمز SKU "${record?.sku ?? ''}" مستخدم بالفعل`;
    const wrapped = new Error(message);
    wrapped.name = 'ConstraintError';
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

/* ------------------------------ الفئات ------------------------------ */

export const listCategories = () =>
  tx(STORES.categories, 'readonly', (stores) => getAll(stores[STORES.categories]))
    .then((rows) => rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));

export async function createCategory({ name, color = '#0E9C8A', icon = 'tag', sortOrder = 0 }) {
  const record = { id: uid('cat'), name, color, icon, sortOrder, createdAt: toISO() };
  try {
    await tx(STORES.categories, 'readwrite', (stores) => add(stores[STORES.categories], record));
  } catch (error) {
    if (error?.name === 'ConstraintError') throw new Error(`الفئة "${name}" موجودة بالفعل`);
    throw error;
  }
  return record;
}

export async function updateCategory(id, patch) {
  return tx(STORES.categories, 'readwrite', async (stores) => {
    const store = stores[STORES.categories];
    const existing = await get(store, id);
    if (!existing) throw new Error('الفئة غير موجودة');
    const record = { ...existing, ...patch, id };
    await put(store, record);
    return record;
  });
}

/** حذف فئة — يُمنع إن كانت مستخدمة */
export async function deleteCategory(id) {
  return tx([STORES.categories, STORES.products], 'readwrite', async (stores) => {
    const used = await getAll(stores[STORES.products].index('categoryId'), id, 1);
    if (used.length > 0) throw new Error('لا يمكن حذف فئة مرتبطة بمنتجات');
    await del(stores[STORES.categories], id);
    return true;
  });
}

/** خريطة id → فئة لتفادي استعلام لكل صف */
export async function categoryMap() {
  const categories = await listCategories();
  return new Map(categories.map((c) => [c.id, c]));
}
