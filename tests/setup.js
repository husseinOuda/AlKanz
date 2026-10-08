/** أدوات مشتركة للاختبارات: قاعدة بيانات معزولة وبيانات تجهيز. */

import { configureDatabase, deleteDatabase, closeDB, tx, add, getAll } from '../src/db/db.js';
import { STORES } from '../src/db/schema.js';
import { invalidateSettingsCache, loadSettings, saveSettings } from '../src/repositories/settings.js';
import { createProduct, createCategory } from '../src/repositories/products.js';
import { createCustomer } from '../src/repositories/customers.js';
import { createExpenseCategory } from '../src/repositories/expenses.js';
import { createReason } from '../src/repositories/inventory.js';
import { uid } from '../src/utils/id.js';
import { toISO } from '../src/utils/dates.js';

let counter = 0;

/**
 * ينشئ قاعدة بيانات نظيفة معزولة لكل اختبار.
 * يستخدم اسماً فريداً حتى لا تتداخل الاختبارات ولا تمسّ بيانات المستخدم الحقيقية.
 */
export async function freshDatabase() {
  await closeDB();
  counter += 1;
  const name = `test-sales-${Date.now()}-${counter}`;
  configureDatabase(name);
  invalidateSettingsCache();
  await loadSettings({ force: true });
  return name;
}

export async function dropDatabase(name) {
  try {
    await deleteDatabase(name);
  } catch {
    // قد تكون محجوبة على ويندوز؛ لا يؤثر على صحة الاختبار
  }
}

/** بيانات أساسية: فئة + أسباب + إعدادات محدّدة */
export async function seedBasics({ taxRateBp = 1500, taxInclusive = false, allowNegativeStock = false } = {}) {
  const category = await createCategory({ name: 'فئة اختبار', sortOrder: 1 });
  const expenseCategory = await createExpenseCategory({ name: 'مصروف اختبار' });
  await createReason('جرد');

  await saveSettings({
    defaultTaxRateBp: taxRateBp,
    taxInclusive,
    allowNegativeStock,
    invoicePrefix: 'INV',
    invoiceNextNumber: 1,
    invoiceIncludeYear: true,
    currencySymbol: 'ر.س',
    allowDiscount: true,
    maxDiscountPercent: 100,
  });

  return { category, expenseCategory };
}

/** ينشئ منتجاً بقيم افتراضية معقولة */
export function makeProduct(categoryId, overrides = {}) {
  const suffix = uid().slice(0, 6).toUpperCase();
  return createProduct({
    name: overrides.name || `منتج ${suffix}`,
    nameLower: (overrides.name || `منتج ${suffix}`).toLowerCase(),
    sku: overrides.sku || `SKU-${suffix}`,
    barcode: overrides.barcode,
    categoryId,
    unit: 'قطعة',
    costMinor: overrides.costMinor ?? 1000,
    priceMinor: overrides.priceMinor ?? 1500,
    taxRateBp: overrides.taxRateBp ?? 1500,
    quantity: overrides.quantity ?? 100,
    lowStockThreshold: overrides.lowStockThreshold ?? 10,
    description: '',
    image: null,
    isActive: overrides.isActive !== false,
  });
}

export function makeCustomer(overrides = {}) {
  return createCustomer({
    name: overrides.name || 'عميل اختبار',
    phone: overrides.phone || '0500000000',
    note: '',
    isActive: true,
  });
}

/** يقرأ الكمية الحالية لمنتج مباشرة من القاعدة */
export async function quantityOf(productId) {
  const rows = await tx(STORES.products, 'readonly', (stores) => getAll(stores[STORES.products]));
  return rows.find((row) => row.id === productId)?.quantity ?? null;
}

/** يعدّ الحركات المسجّلة لمنتج */
export async function movementCount(productId, type = null) {
  const rows = await tx(STORES.inventoryMovements, 'readonly', (stores) =>
    getAll(stores[STORES.inventoryMovements]));
  return rows.filter((row) => row.productId === productId && (!type || row.type === type)).length;
}

export async function countRows(storeName) {
  const rows = await tx(storeName, 'readonly', (stores) => getAll(stores[storeName]));
  return rows.length;
}

/** ينشئ ملفاً وهمياً لاختبارات الاستيراد والاستعادة */
export function makeFile(content, name, type = 'application/json') {
  const body = typeof content === 'string' ? content : JSON.stringify(content);
  return new File([body], name, { type });
}
