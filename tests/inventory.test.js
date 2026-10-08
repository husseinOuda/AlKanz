/** المخزون: التسويات، الجرد، سجل الحركات، والذمم. */

import { describe, it, beforeEach, afterEach, assert } from './harness.js';
import {
  freshDatabase, dropDatabase, seedBasics, makeProduct, makeCustomer,
  quantityOf, movementCount, countRows,
} from './setup.js';
import {
  recordAdjustment, recordStocktake, movementsForProduct, listReasons,
  createReason, deactivateReason, MOVEMENT,
} from '../src/repositories/inventory.js';
import { recordPayment, customerLedgers, customerStatement, deleteCustomer } from '../src/repositories/customers.js';
import { completeSale, PAYMENT_TYPE } from '../src/repositories/sales.js';
import { validateAdjustment } from '../src/validation/validators.js';
import { STORES } from '../src/db/schema.js';

describe('تسوية المخزون', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يضيف كمية ويسجّل الحركة بالرصيد بعدها', async () => {
    const product = await makeProduct(category.id, { quantity: 20 });

    const { movement } = await recordAdjustment({
      productId: product.id, quantity: 15, reason: 'شراء جديد', note: 'دفعة واردة',
    });

    assert.equal(await quantityOf(product.id), 35);
    assert.equal(movement.type, MOVEMENT.IN);
    assert.equal(movement.quantity, 15);
    assert.equal(movement.balanceAfter, 35, 'يجب تسجيل الرصيد بعد الحركة');
    assert.equal(movement.reason, 'شراء جديد');
    assert.equal(movement.note, 'دفعة واردة');
  });

  it('يسحب كمية ويسجّل الحركة', async () => {
    const product = await makeProduct(category.id, { quantity: 20 });

    const { movement } = await recordAdjustment({ productId: product.id, quantity: -8, reason: 'تلف' });

    assert.equal(await quantityOf(product.id), 12);
    assert.equal(movement.type, MOVEMENT.OUT);
    assert.equal(movement.balanceAfter, 12);
  });

  it('يمنع السحب إلى رصيد سالب', async () => {
    const product = await makeProduct(category.id, { quantity: 5 });

    await assert.throws(
      () => recordAdjustment({ productId: product.id, quantity: -10, reason: 'تلف' }),
      /غير كافية/
    );

    assert.equal(await quantityOf(product.id), 5, 'المخزون يجب ألا يتغيّر');
    assert.equal(await movementCount(product.id), 0, 'يجب ألا تُسجَّل حركة');
  });

  it('يشترط سبباً للتسوية', () => {
    const result = validateAdjustment({ productId: 'p1', quantity: 5, reason: '  ' });
    assert.notOk(result.ok);
    assert.equal(result.errors.reason, 'السبب مطلوب');
  });

  it('يرفض كمية صفرية أو كسرية', () => {
    assert.notOk(validateAdjustment({ productId: 'p1', quantity: 0, reason: 'جرد' }).ok);
    assert.notOk(validateAdjustment({ productId: 'p1', quantity: 2.5, reason: 'جرد' }).ok);
    assert.ok(validateAdjustment({ productId: 'p1', quantity: -5, reason: 'جرد' }).ok);
  });

  it('يبني سجل حركات متسلسلاً صحيحاً', async () => {
    const product = await makeProduct(category.id, { quantity: 0 });

    await recordAdjustment({ productId: product.id, quantity: 50, reason: 'شراء جديد' });
    await recordAdjustment({ productId: product.id, quantity: -20, reason: 'تلف' });
    await recordAdjustment({ productId: product.id, quantity: 10, reason: 'مرتجع من عميل' });

    const movements = await movementsForProduct(product.id);
    assert.equal(movements.length, 3);
    assert.equal(await quantityOf(product.id), 40);

    // مرتّبة تنازلياً؛ نتحقق من تسلسل الأرصدة زمنياً
    const chronological = movements.slice().reverse();
    assert.deepEqual(chronological.map((m) => m.balanceAfter), [50, 30, 40]);
  });
});

describe('الجرد', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يضبط الكمية على المعدود ويسجّل الفرق', async () => {
    const product = await makeProduct(category.id, { quantity: 50 });

    const result = await recordStocktake({ productId: product.id, countedQuantity: 47 });

    assert.equal(result.delta, -3);
    assert.equal(await quantityOf(product.id), 47);
    assert.equal(await movementCount(product.id, MOVEMENT.COUNT), 1);
  });

  it('لا يسجّل حركة إذا كان الجرد مطابقاً', async () => {
    const product = await makeProduct(category.id, { quantity: 50 });

    const result = await recordStocktake({ productId: product.id, countedQuantity: 50 });

    assert.equal(result.delta, 0);
    assert.equal(result.movement, null);
    assert.equal(await movementCount(product.id), 0, 'لا حركة عند عدم وجود فرق');
  });

  it('يزيد الكمية عند جرد أعلى من المسجّل', async () => {
    const product = await makeProduct(category.id, { quantity: 10 });
    const result = await recordStocktake({ productId: product.id, countedQuantity: 18 });

    assert.equal(result.delta, 8);
    assert.equal(await quantityOf(product.id), 18);
  });
});

describe('أسباب التسوية', () => {
  let dbName;

  beforeEach(async () => {
    dbName = await freshDatabase();
    await seedBasics();
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يضيف سبباً جديداً ويرفض المكرر', async () => {
    await createReason('سبب خاص');
    const reasons = await listReasons();
    assert.ok(reasons.some((reason) => reason.name === 'سبب خاص'));

    await assert.throws(() => createReason('سبب خاص'), /موجود بالفعل/);
  });

  it('يعطّل السبب ولا يحذفه', async () => {
    const reason = await createReason('سبب مؤقت');
    await deactivateReason(reason.id);

    const active = await listReasons();
    assert.notOk(active.some((item) => item.id === reason.id), 'يجب ألا يظهر في القائمة النشطة');

    // لكنه ما زال في القاعدة للحفاظ على قراءة السجل التاريخي
    assert.ok(await countRows(STORES.adjustmentReasons) > 0);
  });
});

describe('العملاء والذمم', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يحسب الرصيد من الفواتير والمدفوعات لا من رقم محفوظ', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 10000 });
    const customer = await makeCustomer();

    await completeSale({
      lines: [{ productId: product.id, quantity: 2 }],
      customer: { id: customer.id, name: customer.name },
      paymentType: PAYMENT_TYPE.CREDIT,
      taxRateBp: 0,
    });

    let ledgers = await customerLedgers();
    assert.equal(ledgers.get(customer.id).balanceMinor, 20000);

    await recordPayment({ customerId: customer.id, amountMinor: 7500, method: 'cash' });

    ledgers = await customerLedgers();
    assert.equal(ledgers.get(customer.id).balanceMinor, 12500, 'الرصيد = الفواتير − المدفوعات');
  });

  it('يبني كشف حساب برصيد تراكمي صحيح', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 5000 });
    const customer = await makeCustomer();

    await completeSale({
      lines: [{ productId: product.id, quantity: 1 }],
      customer: { id: customer.id, name: customer.name },
      paymentType: PAYMENT_TYPE.CREDIT,
      taxRateBp: 0,
    });
    await recordPayment({ customerId: customer.id, amountMinor: 2000 });

    const statement = await customerStatement(customer.id);
    assert.equal(statement.entries.length, 2);
    assert.equal(statement.balanceMinor, 3000);
    assert.equal(statement.entries[statement.entries.length - 1].balanceMinor, 3000);
  });

  it('يحصي عدد الفواتير وإجمالي المشتريات', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 1000 });
    const customer = await makeCustomer();

    for (let i = 0; i < 3; i += 1) {
      await completeSale({
        lines: [{ productId: product.id, quantity: 1 }],
        customer: { id: customer.id, name: customer.name },
        taxRateBp: 0,
      });
    }

    const ledgers = await customerLedgers();
    const ledger = ledgers.get(customer.id);
    assert.equal(ledger.invoiceCount, 3);
    assert.equal(ledger.purchasesMinor, 3000);
    assert.equal(ledger.balanceMinor, 0, 'المبيعات النقدية لا تنشئ ذمة');
  });

  it('يمنع حذف عميل له فواتير', async () => {
    const product = await makeProduct(category.id, { quantity: 10 });
    const customer = await makeCustomer();

    await completeSale({
      lines: [{ productId: product.id, quantity: 1 }],
      customer: { id: customer.id, name: customer.name },
    });

    await assert.throws(() => deleteCustomer(customer.id), /له فواتير/);
  });

  it('يرفض دفعة بمبلغ غير صالح', async () => {
    const customer = await makeCustomer();
    const { validatePayment } = await import('../src/validation/validators.js');

    assert.notOk(validatePayment({ customerId: customer.id, amount: '0' }).ok);
    assert.notOk(validatePayment({ customerId: customer.id, amount: '-10' }).ok);
    assert.notOk(validatePayment({ customerId: customer.id, amount: 'abc' }).ok);
    assert.ok(validatePayment({ customerId: customer.id, amount: '25.50' }).ok);
  });

  it('يرفض دفعة لعميل غير موجود', async () => {
    await assert.throws(
      () => recordPayment({ customerId: 'cus_غير-موجود', amountMinor: 1000 }),
      /غير موجود/
    );
  });
});
