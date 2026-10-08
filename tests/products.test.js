/** المنتجات: CRUD، القيود، تفرّد SKU، والتحقق. */

import { describe, it, beforeEach, afterEach, assert } from './harness.js';
import { freshDatabase, dropDatabase, seedBasics, makeProduct, quantityOf } from './setup.js';
import {
  createProduct, getProduct, updateProduct, deleteProduct, listProducts,
  findBySku, findByBarcode, searchProducts, stockStatus, STOCK_STATUS,
  createCategory, deleteCategory, listCategories,
} from '../src/repositories/products.js';
import { validateProduct } from '../src/validation/validators.js';
import { completeSale } from '../src/repositories/sales.js';

describe('المنتجات — CRUD والقيود', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => {
    await dropDatabase(dbName);
  });

  it('ينشئ منتجاً ويقرأه', async () => {
    const product = await makeProduct(category.id, { name: 'شاي', sku: 'TEA-1', priceMinor: 2500 });

    const fetched = await getProduct(product.id);
    assert.ok(fetched, 'المنتج يجب أن يُقرأ بعد الإنشاء');
    assert.equal(fetched.name, 'شاي');
    assert.equal(fetched.sku, 'TEA-1');
    assert.equal(fetched.priceMinor, 2500);
    assert.ok(fetched.createdAt, 'يجب تسجيل تاريخ الإنشاء');
  });

  it('يرفض SKU مكرراً', async () => {
    await makeProduct(category.id, { sku: 'DUP-1' });

    const error = await assert.throws(
      () => makeProduct(category.id, { sku: 'DUP-1' }),
      /مستخدم بالفعل/,
      'التوقع رفض SKU المكرر'
    );
    assert.equal(error.name, 'ConstraintError');

    const all = await listProducts();
    assert.equal(all.length, 1, 'يجب ألا يُنشأ منتج ثانٍ');
  });

  it('يرفض باركود مكرراً ويسمح بتركه فارغاً', async () => {
    await makeProduct(category.id, { sku: 'BC-1', barcode: '6281000000001' });

    await assert.throws(
      () => makeProduct(category.id, { sku: 'BC-2', barcode: '6281000000001' }),
      /مستخدم بالفعل/
    );

    // الباركود الفارغ لا يدخل الفهرس الفريد، فيمكن تكراره
    await assert.doesNotThrow(() => makeProduct(category.id, { sku: 'BC-3' }));
    await assert.doesNotThrow(() => makeProduct(category.id, { sku: 'BC-4' }));

    const all = await listProducts();
    assert.equal(all.length, 3);
  });

  it('يوحّد صيغة SKU إلى حروف كبيرة', () => {
    const result = validateProduct({
      name: 'منتج', sku: ' sku-abc ', categoryId: 'c1', unit: 'قطعة',
      cost: '10', price: '15', taxRate: 15, quantity: 1, lowStockThreshold: 1,
    });
    assert.ok(result.ok);
    assert.equal(result.value.sku, 'SKU-ABC');
  });

  it('يعدّل المنتج دون تغيير الكمية', async () => {
    const product = await makeProduct(category.id, { quantity: 50, priceMinor: 1000 });

    await updateProduct(product.id, { ...product, name: 'اسم جديد', priceMinor: 2000, quantity: 999 });

    const updated = await getProduct(product.id);
    assert.equal(updated.name, 'اسم جديد');
    assert.equal(updated.priceMinor, 2000);
    assert.equal(updated.quantity, 50, 'الكمية تتغير عبر حركات المخزون فقط');
  });

  it('يحذف منتجاً غير مستخدم', async () => {
    const product = await makeProduct(category.id);
    await deleteProduct(product.id);
    assert.equal(await getProduct(product.id), undefined);
  });

  it('يمنع حذف منتج مرتبط بفاتورة', async () => {
    const product = await makeProduct(category.id, { quantity: 10 });
    await completeSale({ lines: [{ productId: product.id, quantity: 1 }] });

    await assert.throws(
      () => deleteProduct(product.id),
      /لا يمكن حذف منتج مرتبط بفواتير/
    );

    assert.ok(await getProduct(product.id), 'يجب أن يبقى المنتج موجوداً');
  });

  it('يمنع حذف فئة مرتبطة بمنتجات', async () => {
    await makeProduct(category.id);
    await assert.throws(() => deleteCategory(category.id), /مرتبطة بمنتجات/);
  });

  it('يرفض فئة مكررة الاسم', async () => {
    await assert.throws(() => createCategory({ name: 'فئة اختبار' }), /موجودة بالفعل/);
  });
});

describe('المنتجات — التحقق من المدخلات', () => {
  it('يرفض منتجاً بلا اسم أو SKU', () => {
    const result = validateProduct({ name: '  ', sku: '', categoryId: '', unit: '', cost: '', price: '' });
    assert.notOk(result.ok);
    assert.equal(result.errors.name, 'اسم المنتج مطلوب');
    assert.equal(result.errors.sku, 'رمز SKU مطلوب');
    assert.ok(result.errors.categoryId);
    assert.ok(result.errors.unit);
  });

  it('يرفض الأسعار السالبة والكميات الكسرية', () => {
    const negative = validateProduct({
      name: 'م', sku: 'SK1', categoryId: 'c', unit: 'قطعة',
      cost: '-5', price: '10', taxRate: 15, quantity: 1, lowStockThreshold: 0,
    });
    assert.notOk(negative.ok);
    assert.ok(negative.errors.cost);

    const fractional = validateProduct({
      name: 'م', sku: 'SK1', categoryId: 'c', unit: 'قطعة',
      cost: '5', price: '10', taxRate: 15, quantity: '1.5', lowStockThreshold: 0,
    });
    assert.notOk(fractional.ok);
    assert.ok(fractional.errors.quantity);
  });

  it('يرفض نسبة ضريبة خارج النطاق', () => {
    const result = validateProduct({
      name: 'م', sku: 'SK1', categoryId: 'c', unit: 'قطعة',
      cost: '5', price: '10', taxRate: 150, quantity: 1, lowStockThreshold: 0,
    });
    assert.notOk(result.ok);
    assert.ok(result.errors.taxRate);
  });

  it('يقصّ النصوص الطويلة ويزيل المحارف الخفية', () => {
    const result = validateProduct({
      name: `منتج​‮${'ط'.repeat(200)}`,
      sku: 'SK1', categoryId: 'c', unit: 'قطعة',
      cost: '5', price: '10', taxRate: 15, quantity: 1, lowStockThreshold: 0,
    });
    assert.ok(result.ok);
    assert.ok(result.value.name.length <= 120, 'يجب قصّ الاسم عند الحد');
    assert.notOk(/[​‮]/.test(result.value.name), 'يجب إزالة محارف الاتجاه الخفية');
  });
});

describe('المنتجات — البحث وحالة المخزون', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يحسب حالة المخزون من الكمية والحد الأدنى', () => {
    assert.equal(stockStatus({ quantity: 0, lowStockThreshold: 5 }), STOCK_STATUS.OUT);
    assert.equal(stockStatus({ quantity: 5, lowStockThreshold: 5 }), STOCK_STATUS.LOW);
    assert.equal(stockStatus({ quantity: 3, lowStockThreshold: 5 }), STOCK_STATUS.LOW);
    assert.equal(stockStatus({ quantity: 6, lowStockThreshold: 5 }), STOCK_STATUS.OK);
  });

  it('يبحث بالاسم و SKU', async () => {
    await makeProduct(category.id, { name: 'شاي أخضر', sku: 'TEA-100' });
    await makeProduct(category.id, { name: 'قهوة عربية', sku: 'COF-200' });

    const byName = await searchProducts('شاي');
    assert.equal(byName.length, 1);
    assert.equal(byName[0].sku, 'TEA-100');

    const bySku = await searchProducts('COF-200');
    assert.equal(bySku.length, 1);
    assert.equal(bySku[0].name, 'قهوة عربية');
  });

  it('يجد المنتج بالباركود مباشرة', async () => {
    await makeProduct(category.id, { sku: 'BAR-1', barcode: '9990001' });
    const found = await findByBarcode('9990001');
    assert.ok(found);
    assert.equal(found.sku, 'BAR-1');
  });

  it('يرجع نتيجة فارغة لبحث بلا تطابق', async () => {
    await makeProduct(category.id, { name: 'شاي' });
    assert.equal((await searchProducts('لا يوجد')).length, 0);
  });
});
