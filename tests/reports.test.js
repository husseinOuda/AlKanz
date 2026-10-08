/** التقارير والفلاتر والمجاميع، واستيراد/تصدير Excel. */

import { describe, it, beforeEach, afterEach, assert } from './harness.js';
import { freshDatabase, dropDatabase, seedBasics, makeProduct, makeCustomer, makeFile } from './setup.js';
import { completeSale, cancelSale, PAYMENT_TYPE } from '../src/repositories/sales.js';
import { createExpense } from '../src/repositories/expenses.js';
import {
  periodSummary, dailySeries, topProducts, salesByCategory,
  expensesByCategory, paymentMethods, stockReport, movementReport,
} from '../src/services/reports.js';
import { dayKey, addDays, dayRange, previousRange, presetRange, isDayKey } from '../src/utils/dates.js';
import { writeXlsx, readXlsx } from '../src/utils/xlsx.js';
import { parseProductsFile, commitProductsImport, PRODUCT_COLUMNS } from '../src/services/excel.js';
import { listProducts, findBySku } from '../src/repositories/products.js';

const today = () => dayKey(new Date());

describe('تجميع التقارير', () => {
  let dbName;
  let category;
  let expenseCategory;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category, expenseCategory } = await seedBasics({ taxRateBp: 0 }));
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يحسب الإيراد وعدد الفواتير ومتوسط الفاتورة', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 10000, costMinor: 6000 });

    await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });
    await completeSale({ lines: [{ productId: product.id, quantity: 3 }], taxRateBp: 0 });

    const summary = await periodSummary(today(), today());

    assert.equal(summary.invoiceCount, 2);
    assert.equal(summary.revenueMinor, 40000);
    assert.equal(summary.averageInvoiceMinor, 20000);
    assert.equal(summary.unitCount, 4);
    assert.equal(summary.costMinor, 24000);
    assert.equal(summary.grossProfitMinor, 16000);
  });

  it('يستبعد الفواتير الملغاة من كل المقاييس', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 5000 });

    await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });
    const { sale } = await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });
    await cancelSale(sale.id);

    const summary = await periodSummary(today(), today());

    assert.equal(summary.invoiceCount, 1, 'الفاتورة الملغاة لا تُحتسب');
    assert.equal(summary.revenueMinor, 5000);
    assert.equal(summary.cancelledSales.length, 1);
    assert.equal(summary.items.length, 1, 'سطور الفاتورة الملغاة مستبعدة من التكلفة');
  });

  it('يطرح المصروفات في صافي الحركة والربح', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 10000, costMinor: 4000 });
    await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });

    await createExpense({
      dayKey: today(), categoryId: expenseCategory.id, amountMinor: 2500,
      method: 'cash', title: 'مصروف', reference: '', note: '', attachment: null,
    });

    const summary = await periodSummary(today(), today());

    assert.equal(summary.expensesMinor, 2500);
    assert.equal(summary.netCashFlowMinor, 7500);            // 100.00 − 25.00
    assert.equal(summary.grossProfitMinor, 6000);            // 100.00 − 40.00
    assert.equal(summary.estimatedProfitMinor, 3500);        // 60.00 − 25.00
  });

  it('يفصل النقدي عن الآجل ويحسب المستحق', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 10000 });
    const customer = await makeCustomer();

    await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });
    await completeSale({
      lines: [{ productId: product.id, quantity: 2 }],
      customer: { id: customer.id, name: customer.name },
      paymentType: PAYMENT_TYPE.CREDIT,
      taxRateBp: 0,
    });

    const summary = await periodSummary(today(), today());

    assert.equal(summary.cashMinor, 10000);
    assert.equal(summary.creditMinor, 20000);
    assert.equal(summary.dueMinor, 20000);

    const methods = paymentMethods(summary);
    assert.equal(methods.length, 2);
    assert.equal(methods.find((m) => m.label === 'نقدي').value, 10000);
  });

  it('يستبعد ما هو خارج نطاق التاريخ', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 5000 });
    await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });

    const yesterday = dayKey(addDays(new Date(), -1));
    const past = await periodSummary(yesterday, yesterday);

    assert.equal(past.invoiceCount, 0, 'فاتورة اليوم يجب ألا تظهر في تقرير أمس');
    assert.equal(past.revenueMinor, 0);
  });

  it('يبني سلسلة يومية تغطي كل أيام الفترة', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 5000 });
    await completeSale({ lines: [{ productId: product.id, quantity: 1 }], taxRateBp: 0 });

    const from = dayKey(addDays(new Date(), -6));
    const summary = await periodSummary(from, today());
    const series = dailySeries(summary);

    assert.equal(series.length, 7, 'يجب أن تشمل السلسلة كل أيام الفترة حتى الفارغة');
    assert.equal(series[series.length - 1].salesMinor, 5000, 'مبيعات اليوم في آخر نقطة');
    assert.equal(series[0].salesMinor, 0, 'الأيام بلا مبيعات تكون صفراً لا محذوفة');
  });

  it('يرتّب الأكثر مبيعاً بالكمية', async () => {
    const first = await makeProduct(category.id, { name: 'أ', quantity: 100, priceMinor: 1000, costMinor: 600 });
    const second = await makeProduct(category.id, { name: 'ب', quantity: 100, priceMinor: 2000, costMinor: 900 });

    await completeSale({
      lines: [
        { productId: first.id, quantity: 10 },
        { productId: second.id, quantity: 3 },
      ],
      taxRateBp: 0,
    });

    const summary = await periodSummary(today(), today());
    const top = topProducts(summary);

    assert.equal(top.length, 2);
    assert.equal(top[0].name, 'أ');
    assert.equal(top[0].quantity, 10);
    assert.equal(top[0].revenueMinor, 10000);
    assert.equal(top[1].name, 'ب');
  });

  it('يجمّع المبيعات حسب فئة المنتج', async () => {
    const product = await makeProduct(category.id, { quantity: 100, priceMinor: 3000 });
    await completeSale({ lines: [{ productId: product.id, quantity: 2 }], taxRateBp: 0 });

    const summary = await periodSummary(today(), today());
    const slices = await salesByCategory(summary);

    assert.equal(slices.length, 1);
    assert.equal(slices[0].label, 'فئة اختبار');
    assert.equal(slices[0].value, 6000);
  });

  it('يجمّع المصروفات حسب الفئة', async () => {
    await createExpense({
      dayKey: today(), categoryId: expenseCategory.id, amountMinor: 4000,
      method: 'cash', title: 'أ', reference: '', note: '', attachment: null,
    });
    await createExpense({
      dayKey: today(), categoryId: expenseCategory.id, amountMinor: 1000,
      method: 'cash', title: 'ب', reference: '', note: '', attachment: null,
    });

    const summary = await periodSummary(today(), today());
    const slices = await expensesByCategory(summary);

    assert.equal(slices.length, 1);
    assert.equal(slices[0].value, 5000);
  });

  it('يصنّف المخزون المنخفض والمنعدم', async () => {
    await makeProduct(category.id, { name: 'متوفر', quantity: 50, lowStockThreshold: 10 });
    await makeProduct(category.id, { name: 'منخفض', quantity: 5, lowStockThreshold: 10 });
    await makeProduct(category.id, { name: 'منعدم', quantity: 0, lowStockThreshold: 10 });

    const report = await stockReport();

    assert.equal(report.totalProducts, 3);
    assert.equal(report.low.length, 1);
    assert.equal(report.out.length, 1);
    assert.equal(report.low[0].name, 'منخفض');
    assert.equal(report.out[0].name, 'منعدم');
    assert.equal(report.totalUnits, 55);
  });

  it('يجمّع حركات المخزون حسب السبب', async () => {
    const product = await makeProduct(category.id, { quantity: 100 });
    const { recordAdjustment } = await import('../src/repositories/inventory.js');

    await recordAdjustment({ productId: product.id, quantity: 10, reason: 'شراء جديد' });
    await recordAdjustment({ productId: product.id, quantity: -4, reason: 'تلف' });
    await recordAdjustment({ productId: product.id, quantity: -2, reason: 'تلف' });

    const report = await movementReport(today(), today());
    const damage = report.byReason.find((row) => row.reason === 'تلف');

    assert.equal(damage.count, 2);
    assert.equal(damage.decreases, 6);
    assert.equal(report.byReason.find((row) => row.reason === 'شراء جديد').increases, 10);
  });
});

describe('نطاقات التواريخ', () => {
  it('يبني نطاق أيام شاملاً الطرفين', () => {
    const range = dayRange('2026-05-01', '2026-05-05');
    assert.equal(range.length, 5);
    assert.equal(range[0], '2026-05-01');
    assert.equal(range[4], '2026-05-05');
  });

  it('يحسب الفترة السابقة بنفس الطول', () => {
    const previous = previousRange('2026-05-08', '2026-05-14'); // 7 أيام
    assert.equal(previous.from, '2026-05-01');
    assert.equal(previous.to, '2026-05-07');
  });

  it('يتحقق من صحة مفتاح اليوم', () => {
    assert.ok(isDayKey('2026-05-24'));
    assert.notOk(isDayKey('2026-13-01'), 'شهر 13 غير صالح');
    assert.notOk(isDayKey('2026-02-31'), 'يوم غير موجود');
    assert.notOk(isDayKey('24-05-2026'));
    assert.notOk(isDayKey(''));
  });

  it('يعطي نطاقات جاهزة صحيحة', () => {
    const todayRange = presetRange('today');
    assert.equal(todayRange.from, todayRange.to);

    const last7 = presetRange('last7');
    assert.equal(dayRange(last7.from, last7.to).length, 7);
  });
});

describe('Excel — الكتابة والقراءة', () => {
  it('يكتب ملفاً ويقرأه بنفس القيم (ذهاب وعودة)', async () => {
    const rows = [
      ['العمود الأول', 'رقم', 'نص عربي'],
      ['أ', 123, 'قيمة'],
      ['ب', 45.67, 'قيمة أخرى'],
      ['ج', 0, ''],
    ];

    const blob = await writeXlsx(rows, { sheetName: 'اختبار' });
    assert.ok(blob.size > 0, 'يجب إنتاج ملف غير فارغ');
    assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    const parsed = await readXlsx(blob);

    assert.equal(parsed.length, 4);
    assert.deepEqual(parsed[0], ['العمود الأول', 'رقم', 'نص عربي']);
    assert.equal(parsed[1][0], 'أ');
    assert.equal(parsed[1][1], 123);
    assert.equal(parsed[2][1], 45.67);
    assert.equal(parsed[3][1], 0);
  });

  it('يحافظ على المحارف الخاصة في XML', async () => {
    const rows = [['رأس'], ['نص فيه < و > و & و "اقتباس"']];
    const parsed = await readXlsx(await writeXlsx(rows));
    assert.equal(parsed[1][0], 'نص فيه < و > و & و "اقتباس"');
  });

  it('يرفض التصدير بلا بيانات', async () => {
    await assert.throws(() => writeXlsx([]), /لا توجد بيانات/);
  });

  it('يرفض ملفاً ليس ZIP', async () => {
    await assert.throws(
      () => readXlsx(new Blob(['هذا ليس ملف إكسل'])),
      /ليس أرشيف ZIP/
    );
  });
});

describe('Excel — استيراد المنتجات', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  async function makeXlsxFile(rows, name = 'products.xlsx') {
    const blob = await writeXlsx(rows);
    return new File([blob], name, { type: blob.type });
  }

  it('يستورد صفوفاً صالحة وينشئ المنتجات', async () => {
    const file = await makeXlsxFile([
      PRODUCT_COLUMNS,
      ['IMP-1', 'منتج مستورد', '', 'فئة اختبار', 'قطعة', 10, 15, 15, 25, 5, 'وصف', 'نعم'],
      ['IMP-2', 'منتج آخر', '', 'فئة اختبار', 'علبة', 20, 30, 15, 10, 2, '', 'نعم'],
    ]);

    const parsed = await parseProductsFile(file);
    assert.equal(parsed.valid.length, 2);
    assert.equal(parsed.invalid.length, 0);

    const result = await commitProductsImport(parsed.valid, { mode: 'skip' });
    assert.equal(result.created, 2);
    assert.equal(result.failed.length, 0);

    const imported = await findBySku('IMP-1');
    assert.ok(imported);
    assert.equal(imported.name, 'منتج مستورد');
    assert.equal(imported.costMinor, 1000);
    assert.equal(imported.priceMinor, 1500);
    assert.equal(imported.quantity, 25);
  });

  it('يفصل الصفوف غير الصالحة ولا يكتبها', async () => {
    const file = await makeXlsxFile([
      PRODUCT_COLUMNS,
      ['GOOD-1', 'منتج صالح', '', 'فئة اختبار', 'قطعة', 10, 15, 15, 5, 1, '', 'نعم'],
      ['', 'بلا SKU', '', 'فئة اختبار', 'قطعة', 10, 15, 15, 5, 1, '', 'نعم'],
      ['BAD-2', '', '', 'فئة اختبار', 'قطعة', 10, 15, 15, 5, 1, '', 'نعم'],
    ]);

    const parsed = await parseProductsFile(file);
    assert.equal(parsed.valid.length, 1);
    assert.equal(parsed.invalid.length, 2);
    assert.equal(parsed.valid[0].sku, 'GOOD-1');

    await commitProductsImport(parsed.valid, { mode: 'skip' });
    assert.equal((await listProducts()).length, 1);
  });

  it('يكتشف SKU مكرراً داخل الملف نفسه', async () => {
    const file = await makeXlsxFile([
      PRODUCT_COLUMNS,
      ['SAME', 'أول', '', 'فئة اختبار', 'قطعة', 10, 15, 15, 5, 1, '', 'نعم'],
      ['SAME', 'ثانٍ', '', 'فئة اختبار', 'قطعة', 10, 15, 15, 5, 1, '', 'نعم'],
    ]);

    const parsed = await parseProductsFile(file);
    assert.equal(parsed.valid.length, 1);
    assert.equal(parsed.invalid.length, 1);
    assert.ok(/مكرر داخل الملف/.test(parsed.invalid[0].errors[0]));
  });

  it('يتخطّى الموجود مسبقاً أو يحدّثه حسب الخيار', async () => {
    await makeProduct(category.id, { sku: 'EXIST-1', name: 'الاسم الأصلي', priceMinor: 1000 });

    const file = await makeXlsxFile([
      PRODUCT_COLUMNS,
      ['EXIST-1', 'اسم محدّث', '', 'فئة اختبار', 'قطعة', 12, 25, 15, 5, 1, '', 'نعم'],
    ]);

    const skipped = await commitProductsImport((await parseProductsFile(file)).valid, { mode: 'skip' });
    assert.equal(skipped.skipped, 1);
    assert.equal(skipped.created, 0);
    assert.equal((await findBySku('EXIST-1')).name, 'الاسم الأصلي');

    const updated = await commitProductsImport((await parseProductsFile(file)).valid, { mode: 'update' });
    assert.equal(updated.updated, 1);
    const after = await findBySku('EXIST-1');
    assert.equal(after.name, 'اسم محدّث');
    assert.equal(after.priceMinor, 2500);
  });

  it('ينشئ الفئات الجديدة الواردة في الملف', async () => {
    const file = await makeXlsxFile([
      PRODUCT_COLUMNS,
      ['NEWCAT-1', 'منتج', '', 'فئة جديدة تماماً', 'قطعة', 10, 15, 15, 5, 1, '', 'نعم'],
    ]);

    const parsed = await parseProductsFile(file);
    assert.deepEqual(parsed.newCategories, ['فئة جديدة تماماً']);

    await commitProductsImport(parsed.valid, { mode: 'skip', createCategories: true });

    const { listCategories } = await import('../src/repositories/products.js');
    const categories = await listCategories();
    assert.ok(categories.some((item) => item.name === 'فئة جديدة تماماً'));
  });

  it('يرفض ملفاً بأعمدة مفقودة', async () => {
    const file = await makeXlsxFile([['عمود غريب', 'آخر'], ['أ', 'ب']]);
    await assert.throws(() => parseProductsFile(file), /أعمدة مفقودة/);
  });

  it('يرفض ملفاً ليس بامتداد xlsx', async () => {
    const blob = await writeXlsx([['أ'], ['ب']]);
    const file = new File([blob], 'data.csv', { type: 'text/csv' });
    await assert.throws(() => parseProductsFile(file), /صيغة Excel/);
  });

  it('يرفض ملفاً بلا صفوف بيانات', async () => {
    const file = await makeXlsxFile([PRODUCT_COLUMNS]);
    await assert.throws(() => parseProductsFile(file), /لا يحتوي على بيانات/);
  });
});
