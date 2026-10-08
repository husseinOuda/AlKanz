/**
 * البيع والإلغاء — ذرّية المعاملات.
 * هذه أهم اختبارات المشروع: بيع ناجح يخفض المخزون **مرة واحدة**،
 * وبيع فاشل لا يغيّره إطلاقاً، وإلغاء يعيده **مرة واحدة**.
 */

import { describe, it, beforeEach, afterEach, assert } from './harness.js';
import {
  freshDatabase, dropDatabase, seedBasics, makeProduct, makeCustomer,
  quantityOf, movementCount, countRows,
} from './setup.js';
import {
  completeSale, cancelSale, getSaleWithItems, listSales,
  suspendSale, listSuspended, resumeSuspended,
  SALE_STATUS, PAYMENT_TYPE,
} from '../src/repositories/sales.js';
import { MOVEMENT } from '../src/repositories/inventory.js';
import { STORES } from '../src/db/schema.js';
import { getProduct } from '../src/repositories/products.js';
import { customerLedgers } from '../src/repositories/customers.js';
import { getSetting, saveSettings } from '../src/repositories/settings.js';

describe('إتمام البيع', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics({ taxRateBp: 1500 }));
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يخفض المخزون مرة واحدة بالضبط', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 2000 });

    await completeSale({ lines: [{ productId: product.id, quantity: 3 }] });

    assert.equal(await quantityOf(product.id), 97, 'الكمية يجب أن تنقص 3 فقط');
    assert.equal(await movementCount(product.id, MOVEMENT.SALE), 1, 'يجب تسجيل حركة بيع واحدة');
  });

  it('ينشئ الفاتورة وسطورها بلقطة السعر والتكلفة', async () => {
    const product = await makeProduct(category.id, {
      name: 'منتج أ', quantity: 50, priceMinor: 2000, costMinor: 1200,
    });

    const { sale } = await completeSale({ lines: [{ productId: product.id, quantity: 2 }] });
    const { items } = await getSaleWithItems(sale.id);

    assert.equal(items.length, 1);
    assert.equal(items[0].unitPriceMinor, 2000);
    assert.equal(items[0].unitCostMinor, 1200, 'يجب تجميد التكلفة داخل السطر');
    assert.equal(items[0].name, 'منتج أ', 'يجب تجميد اسم المنتج داخل السطر');
    assert.equal(items[0].lineTotalMinor, 4000);
  });

  it('لا يتأثر ربح الفاتورة بتغيير سعر المنتج لاحقاً', async () => {
    const product = await makeProduct(category.id, { quantity: 50, priceMinor: 2000, costMinor: 1000 });
    const { sale } = await completeSale({ lines: [{ productId: product.id, quantity: 1 }] });

    // ارفع التكلفة بعد البيع
    const { updateProduct } = await import('../src/repositories/products.js');
    const current = await getProduct(product.id);
    await updateProduct(product.id, { ...current, costMinor: 5000 });

    const { items } = await getSaleWithItems(sale.id);
    assert.equal(items[0].unitCostMinor, 1000, 'التكلفة التاريخية يجب ألا تتغيّر');
  });

  it('يحسب المجاميع ويخزّنها على الفاتورة', async () => {
    const product = await makeProduct(category.id, { quantity: 50, priceMinor: 10000 });

    const { sale } = await completeSale({
      lines: [{ productId: product.id, quantity: 1 }],
      discount: { type: 'amount', value: 1000 },
      taxRateBp: 1500,
    });

    assert.equal(sale.subtotalMinor, 10000);
    assert.equal(sale.discountMinor, 1000);
    assert.equal(sale.taxMinor, 1350);      // 15% من 90.00
    assert.equal(sale.totalMinor, 10350);
    assert.equal(sale.paidMinor, 10350, 'الدفع النقدي يعني السداد الكامل');
    assert.equal(sale.dueMinor, 0);
  });

  it('يرقّم الفواتير تسلسلياً بلا تكرار', async () => {
    const product = await makeProduct(category.id, { quantity: 100 });

    const first = await completeSale({ lines: [{ productId: product.id, quantity: 1 }] });
    const second = await completeSale({ lines: [{ productId: product.id, quantity: 1 }] });
    const third = await completeSale({ lines: [{ productId: product.id, quantity: 1 }] });

    const year = new Date().getFullYear();
    assert.equal(first.sale.number, `INV-${year}-00001`);
    assert.equal(second.sale.number, `INV-${year}-00002`);
    assert.equal(third.sale.number, `INV-${year}-00003`);
    assert.equal(await getSetting('invoiceNextNumber'), 4, 'يجب زيادة العدّاد داخل نفس المعاملة');
  });

  it('يسجّل بيعاً آجلاً بذمة على العميل', async () => {
    const product = await makeProduct(category.id, { quantity: 50, priceMinor: 10000 });
    const customer = await makeCustomer();

    const { sale } = await completeSale({
      lines: [{ productId: product.id, quantity: 1 }],
      customer: { id: customer.id, name: customer.name },
      paymentType: PAYMENT_TYPE.CREDIT,
      taxRateBp: 0,
      paidMinor: 3000,
    });

    assert.equal(sale.totalMinor, 10000);
    assert.equal(sale.paidMinor, 3000);
    assert.equal(sale.dueMinor, 7000);

    const ledgers = await customerLedgers();
    assert.equal(ledgers.get(customer.id).balanceMinor, 7000);
  });

  it('يبيع عدة أصناف ويخصم كلاً منها مرة واحدة', async () => {
    const first = await makeProduct(category.id, { quantity: 20 });
    const second = await makeProduct(category.id, { quantity: 30 });

    await completeSale({
      lines: [
        { productId: first.id, quantity: 5 },
        { productId: second.id, quantity: 7 },
      ],
    });

    assert.equal(await quantityOf(first.id), 15);
    assert.equal(await quantityOf(second.id), 23);
    assert.equal(await movementCount(first.id, MOVEMENT.SALE), 1);
    assert.equal(await movementCount(second.id, MOVEMENT.SALE), 1);
  });
});

describe('البيع الفاشل — لا أثر جانبي', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('لا يغيّر المخزون عند نقص الكمية', async () => {
    const product = await makeProduct(category.id, { quantity: 5 });

    await assert.throws(
      () => completeSale({ lines: [{ productId: product.id, quantity: 10 }] }),
      /غير كافية/
    );

    assert.equal(await quantityOf(product.id), 5, 'المخزون يجب ألا يتغيّر');
    assert.equal(await countRows(STORES.sales), 0, 'يجب ألا تُنشأ فاتورة');
    assert.equal(await countRows(STORES.saleItems), 0, 'يجب ألا تُنشأ سطور');
    assert.equal(await movementCount(product.id, MOVEMENT.SALE), 0, 'يجب ألا تُسجَّل حركة');
    assert.equal(await getSetting('invoiceNextNumber'), 1, 'يجب ألا يزيد عدّاد الترقيم');
  });

  it('يُجهض البيع بالكامل إذا فشل صنف واحد من عدة أصناف', async () => {
    const ok = await makeProduct(category.id, { quantity: 100 });
    const short = await makeProduct(category.id, { quantity: 1 });

    await assert.throws(
      () => completeSale({
        lines: [
          { productId: ok.id, quantity: 5 },
          { productId: short.id, quantity: 50 },
        ],
      }),
      /غير كافية/
    );

    assert.equal(await quantityOf(ok.id), 100, 'الصنف الأول يجب ألا يُخصم');
    assert.equal(await quantityOf(short.id), 1);
    assert.equal(await countRows(STORES.sales), 0);
    assert.equal(await countRows(STORES.inventoryMovements), 0);
  });

  it('يرفض البيع بعربة فارغة', async () => {
    await assert.throws(() => completeSale({ lines: [] }), /عربة فارغة/);
  });

  it('يرفض البيع الآجل بلا عميل مسجّل', async () => {
    const product = await makeProduct(category.id, { quantity: 10 });
    await assert.throws(
      () => completeSale({ lines: [{ productId: product.id, quantity: 1 }], paymentType: PAYMENT_TYPE.CREDIT }),
      /يتطلب اختيار عميل/
    );
    assert.equal(await quantityOf(product.id), 10);
  });

  it('يرفض كمية غير صحيحة', async () => {
    const product = await makeProduct(category.id, { quantity: 10 });

    await assert.throws(() => completeSale({ lines: [{ productId: product.id, quantity: 0 }] }), /كمية غير صالحة/);
    await assert.throws(() => completeSale({ lines: [{ productId: product.id, quantity: -3 }] }), /كمية غير صالحة/);
    await assert.throws(() => completeSale({ lines: [{ productId: product.id, quantity: 1.5 }] }), /كمية غير صالحة/);

    assert.equal(await quantityOf(product.id), 10);
    assert.equal(await countRows(STORES.sales), 0);
  });

  it('يرفض منتجاً غير موجود', async () => {
    await assert.throws(
      () => completeSale({ lines: [{ productId: 'prd_غير-موجود', quantity: 1 }] }),
      /لم يعد موجوداً/
    );
    assert.equal(await countRows(STORES.sales), 0);
  });

  it('يسمح بالمخزون السالب عندما تُفعَّل القاعدة صراحةً', async () => {
    const product = await makeProduct(category.id, { quantity: 2 });

    const { sale } = await completeSale({
      lines: [{ productId: product.id, quantity: 5 }],
      allowNegativeStock: true,
    });

    assert.ok(sale.id);
    assert.equal(await quantityOf(product.id), -3, 'القاعدة المفعّلة تسمح بالسالب');
  });
});

describe('إلغاء الفاتورة', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يعيد المخزون مرة واحدة بالضبط', async () => {
    const product = await makeProduct(category.id, { quantity: 100 });
    const { sale } = await completeSale({ lines: [{ productId: product.id, quantity: 10 }] });

    assert.equal(await quantityOf(product.id), 90);

    await cancelSale(sale.id, 'اختبار');

    assert.equal(await quantityOf(product.id), 100, 'المخزون يعود إلى ما كان عليه');
    assert.equal(await movementCount(product.id, MOVEMENT.CANCEL), 1, 'حركة إرجاع واحدة فقط');
  });

  it('لا يحذف الفاتورة بل يغيّر حالتها', async () => {
    const product = await makeProduct(category.id, { quantity: 100 });
    const { sale } = await completeSale({ lines: [{ productId: product.id, quantity: 5 }] });

    await cancelSale(sale.id, 'سبب الإلغاء');

    const after = await getSaleWithItems(sale.id);
    assert.ok(after, 'الفاتورة يجب أن تبقى موجودة');
    assert.equal(after.sale.status, SALE_STATUS.CANCELLED);
    assert.equal(after.sale.cancelReason, 'سبب الإلغاء');
    assert.ok(after.sale.cancelledAt);
    assert.equal(after.items.length, 1, 'سطور الفاتورة تبقى للسجل التاريخي');
    assert.equal(await countRows(STORES.sales), 1);
  });

  it('يمنع الإلغاء المزدوج فلا يتضاعف المخزون', async () => {
    const product = await makeProduct(category.id, { quantity: 100 });
    const { sale } = await completeSale({ lines: [{ productId: product.id, quantity: 10 }] });

    await cancelSale(sale.id);
    await assert.throws(() => cancelSale(sale.id), /ملغاة بالفعل/);

    assert.equal(await quantityOf(product.id), 100, 'يجب ألا يزيد المخزون مرتين');
    assert.equal(await movementCount(product.id, MOVEMENT.CANCEL), 1);
  });

  it('يصفّر ذمة العميل عند الإلغاء', async () => {
    const product = await makeProduct(category.id, { quantity: 50, priceMinor: 10000 });
    const customer = await makeCustomer();

    const { sale } = await completeSale({
      lines: [{ productId: product.id, quantity: 1 }],
      customer: { id: customer.id, name: customer.name },
      paymentType: PAYMENT_TYPE.CREDIT,
      taxRateBp: 0,
    });

    let ledgers = await customerLedgers();
    assert.equal(ledgers.get(customer.id).balanceMinor, 10000);

    await cancelSale(sale.id);

    ledgers = await customerLedgers();
    assert.equal(ledgers.get(customer.id)?.balanceMinor ?? 0, 0, 'الفاتورة الملغاة لا تُحمّل على العميل');
  });

  it('يعيد كل الأصناف في فاتورة متعددة السطور', async () => {
    const first = await makeProduct(category.id, { quantity: 20 });
    const second = await makeProduct(category.id, { quantity: 30 });

    const { sale } = await completeSale({
      lines: [
        { productId: first.id, quantity: 5 },
        { productId: second.id, quantity: 10 },
      ],
    });

    const result = await cancelSale(sale.id);
    assert.equal(result.restoredLines, 2);
    assert.equal(await quantityOf(first.id), 20);
    assert.equal(await quantityOf(second.id), 30);
  });

  it('يرفض إلغاء فاتورة غير موجودة', async () => {
    await assert.throws(() => cancelSale('sal_غير-موجود'), /غير موجودة/);
  });
});

describe('البيوع المعلّقة', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يعلّق البيع ويستعيده دون المساس بالمخزون', async () => {
    const product = await makeProduct(category.id, { quantity: 40 });

    await suspendSale({
      lines: [{ productId: product.id, name: 'منتج', sku: 'S1', quantity: 3, unitPriceMinor: 1000 }],
      customer: { id: null, name: 'عميل نقدي' },
      totalMinor: 3000,
    });

    assert.equal(await quantityOf(product.id), 40, 'التعليق لا يخصم من المخزون');

    const suspended = await listSuspended();
    assert.equal(suspended.length, 1);

    const resumed = await resumeSuspended(suspended[0].id);
    assert.equal(resumed.lines.length, 1);
    assert.equal((await listSuspended()).length, 0, 'يُحذف بعد الاستعادة فلا يُستعاد مرتين');
  });

  it('يرفض استعادة بيع معلّق محذوف', async () => {
    await assert.throws(() => resumeSuspended('sus_غير-موجود'), /غير موجود/);
  });
});
