/** الحساب المالي: الوحدات الصغرى، الخصم، الضريبة، التقريب. */

import { describe, it, assert } from './harness.js';
import {
  toMinor, toMajor, roundHalfUp, percentOf, percentToBp, bpToPercent,
  computeTotals, allocateProportionally,
} from '../src/utils/money.js';

describe('تحويل المبالغ إلى وحدات صغرى', () => {
  it('يحوّل الأعداد العشرية بدقة', () => {
    assert.equal(toMinor('10'), 1000);
    assert.equal(toMinor('10.5'), 1050);
    assert.equal(toMinor('10.55'), 1055);
    assert.equal(toMinor(0.1), 10);
    assert.equal(toMinor('0.01'), 1);
  });

  it('يتجنّب أخطاء Floating Point الكلاسيكية', () => {
    // 0.1 + 0.2 !== 0.3 في الأعداد العشرية، لكن الوحدات الصغرى صحيحة
    assert.equal(toMinor('0.1') + toMinor('0.2'), toMinor('0.3'));
    assert.equal(toMinor('1.005'), 101); // تقريب half-up على المنزلة الثالثة
    assert.equal(toMinor('19.99') * 3, 5997);
  });

  it('يقبل الأرقام العربية والفواصل', () => {
    assert.equal(toMinor('١٢٣٫٤٥'), 12345);
    assert.equal(toMinor('1,250.00'), 125000);
    assert.equal(toMinor('١٠'), 1000);
  });

  it('يرفض المدخلات غير الصالحة', () => {
    assert.ok(Number.isNaN(toMinor('abc')));
    assert.ok(Number.isNaN(toMinor('12.3.4')));
    assert.equal(toMinor(''), 0);
    assert.equal(toMinor(null), 0);
  });

  it('يتعامل مع القيم السالبة', () => {
    assert.equal(toMinor('-5.25'), -525);
    assert.equal(toMajor(-525), -5.25);
  });
});

describe('التقريب والنسب', () => {
  it('يقرّب half-away-from-zero', () => {
    assert.equal(roundHalfUp(2.5), 3);
    assert.equal(roundHalfUp(-2.5), -3);
    assert.equal(roundHalfUp(2.4), 2);
  });

  it('يحسب النسبة بنقاط الأساس', () => {
    assert.equal(percentOf(10000, 1500), 1500);   // 15% من 100.00
    assert.equal(percentOf(10000, 500), 500);     // 5%
    assert.equal(percentToBp(15), 1500);
    assert.equal(percentToBp(14.5), 1450);
    assert.equal(bpToPercent(1500), 15);
  });
});

describe('حساب مجاميع الفاتورة', () => {
  const lines = [
    { unitPriceMinor: 2400, quantity: 2 },  // 48.00
    { unitPriceMinor: 1800, quantity: 1 },  // 18.00
    { unitPriceMinor: 3200, quantity: 1 },  // 32.00
  ]; // المجموع الفرعي = 98.00

  it('يحسب المجموع الفرعي والضريبة بدون خصم', () => {
    const totals = computeTotals(lines, { type: 'amount', value: 0 }, 1500, false);
    assert.equal(totals.subtotalMinor, 9800);
    assert.equal(totals.discountMinor, 0);
    assert.equal(totals.taxMinor, 1470);       // 15% من 98.00
    assert.equal(totals.totalMinor, 11270);
  });

  it('يطبّق خصماً بمبلغ ثابت قبل الضريبة', () => {
    const totals = computeTotals(lines, { type: 'amount', value: 800 }, 1500, false);
    assert.equal(totals.discountMinor, 800);
    assert.equal(totals.taxMinor, 1350);       // 15% من 90.00
    assert.equal(totals.totalMinor, 10350);
  });

  it('يطبّق خصماً بنسبة مئوية', () => {
    const totals = computeTotals(lines, { type: 'percent', value: 1000 }, 1500, false);
    assert.equal(totals.discountMinor, 980);   // 10% من 98.00
    assert.equal(totals.taxMinor, 1323);       // 15% من 88.20
    assert.equal(totals.totalMinor, 10143);
  });

  it('يمنع تجاوز الخصم للمجموع الفرعي', () => {
    const totals = computeTotals(lines, { type: 'amount', value: 999999 }, 1500, false);
    assert.equal(totals.discountMinor, 9800);
    assert.equal(totals.totalMinor, 0);
  });

  it('يمنع الخصم السالب', () => {
    const totals = computeTotals(lines, { type: 'amount', value: -500 }, 1500, false);
    assert.equal(totals.discountMinor, 0);
  });

  it('يستخرج الضريبة من السعر عندما يكون شاملاً', () => {
    const totals = computeTotals([{ unitPriceMinor: 11500, quantity: 1 }], { type: 'amount', value: 0 }, 1500, true);
    assert.equal(totals.subtotalMinor, 11500);
    assert.equal(totals.taxMinor, 1500);        // 115.00 شامل 15% ⇒ ضريبة 15.00
    assert.equal(totals.taxableMinor, 10000);
    assert.equal(totals.totalMinor, 11500);     // الإجمالي لا يتغيّر
  });

  it('يعطي إجمالياً صفراً لسلة فارغة', () => {
    const totals = computeTotals([], { type: 'amount', value: 0 }, 1500, false);
    assert.equal(totals.subtotalMinor, 0);
    assert.equal(totals.totalMinor, 0);
  });

  it('يبقى المجموع صحيحاً مع كميات كبيرة', () => {
    const totals = computeTotals([{ unitPriceMinor: 333, quantity: 7 }], { type: 'amount', value: 0 }, 1500, false);
    assert.equal(totals.subtotalMinor, 2331);
    assert.equal(totals.taxMinor, 350);         // 15% من 23.31 = 3.4965 ⇒ 3.50
    assert.equal(totals.totalMinor, 2681);
  });
});

describe('توزيع الخصم على السطور', () => {
  it('يوزّع بالتناسب ويحافظ على المجموع الكلي', () => {
    const shares = allocateProportionally(1000, [5000, 3000, 2000]);
    assert.equal(shares.reduce((sum, share) => sum + share, 0), 1000);
    assert.deepEqual(shares, [500, 300, 200]);
  });

  it('يسند فرق التقريب لآخر سطر فلا يضيع فلس', () => {
    const shares = allocateProportionally(100, [1, 1, 1]);
    assert.equal(shares.reduce((sum, share) => sum + share, 0), 100);
  });

  it('يرجع أصفاراً عند غياب الأوزان', () => {
    assert.deepEqual(allocateProportionally(500, [0, 0]), [0, 0]);
  });
});
