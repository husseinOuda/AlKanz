/**
 * حساب مالي بوحدات صغرى صحيحة (Integer minor units).
 * كل القيم المالية في قاعدة البيانات مخزّنة كأعداد صحيحة (قروش/هللات)،
 * ولا تُستخدم أعداد عشرية في أي عملية حسابية لتفادي أخطاء Floating Point.
 */

export const MINOR_PER_MAJOR = 100;

/** يحوّل مدخل المستخدم (نص أو رقم بوحدة كبرى) إلى وحدة صغرى صحيحة. */
export function toMinor(input) {
  if (input == null || input === '') return 0;

  const normalized = String(input)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))   // أرقام عربية-هندية
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))   // أرقام فارسية
    .replace(/[,\s٬ ]/g, '')                            // فواصل آلاف
    .replace(/٫/g, '.')                                      // الفاصلة العشرية العربية
    .trim();

  if (!/^-?\d*\.?\d*$/.test(normalized) || normalized === '' || normalized === '-') return NaN;

  const negative = normalized.startsWith('-');
  const [whole = '0', fraction = ''] = normalized.replace('-', '').split('.');
  const cents = (fraction + '00').slice(0, 2);

  // التقريب على الرقم العشري الثالث (half-up) حتى لا يُهمل إدخال مثل 1.005
  const third = Number(fraction[2] || 0);
  let value = Number(whole) * MINOR_PER_MAJOR + Number(cents);
  if (third >= 5) value += 1;

  if (!Number.isFinite(value)) return NaN;
  return negative ? -value : value;
}

/** يحوّل وحدة صغرى إلى رقم بوحدة كبرى (للعرض أو التصدير فقط، لا للحساب). */
export function toMajor(minor) {
  return (minor ?? 0) / MINOR_PER_MAJOR;
}

/** تقريب half-away-from-zero — الأنسب للضريبة والخصم في الفوترة. */
export function roundHalfUp(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** نسبة مئوية من مبلغ بوحدة صغرى. rateBp = نقاط أساس (1% = 100). */
export function percentOf(minor, rateBp) {
  return roundHalfUp((minor * rateBp) / 10000);
}

/** يحوّل نسبة مئوية (مثل 15 أو 14.5) إلى نقاط أساس صحيحة. */
export function percentToBp(percent) {
  const value = Number(percent);
  if (!Number.isFinite(value)) return 0;
  return roundHalfUp(value * 100);
}

export function bpToPercent(bp) {
  return (bp ?? 0) / 100;
}

/**
 * يحسب مجاميع سلة البيع بالكامل بوحدات صغرى.
 *
 * @param {{unitPriceMinor:number, quantity:number}[]} lines
 * @param {{type:'percent'|'amount', value:number}} discount  value = نقاط أساس أو وحدة صغرى
 * @param {number} taxRateBp نسبة الضريبة بنقاط الأساس
 * @param {boolean} taxInclusive هل السعر شامل الضريبة
 * @returns {{subtotalMinor:number, discountMinor:number, taxableMinor:number, taxMinor:number, totalMinor:number}}
 */
export function computeTotals(lines, discount = { type: 'amount', value: 0 }, taxRateBp = 0, taxInclusive = false) {
  const subtotalMinor = lines.reduce(
    (sum, line) => sum + roundHalfUp(line.unitPriceMinor * line.quantity),
    0
  );

  let discountMinor = discount?.type === 'percent'
    ? percentOf(subtotalMinor, discount.value || 0)
    : roundHalfUp(discount?.value || 0);

  // الخصم لا يتجاوز المجموع الفرعي ولا يكون سالباً
  discountMinor = Math.min(Math.max(discountMinor, 0), subtotalMinor);

  const netMinor = subtotalMinor - discountMinor;

  let taxMinor;
  let taxableMinor;
  if (taxInclusive) {
    // السعر شامل: الضريبة مستخرجة من الصافي
    taxMinor = roundHalfUp((netMinor * taxRateBp) / (10000 + taxRateBp));
    taxableMinor = netMinor - taxMinor;
  } else {
    taxableMinor = netMinor;
    taxMinor = percentOf(netMinor, taxRateBp);
  }

  const totalMinor = taxInclusive ? netMinor : netMinor + taxMinor;

  return { subtotalMinor, discountMinor, taxableMinor, taxMinor, totalMinor };
}

/**
 * يوزّع الخصم على السطور بالتناسب، ويسند فروق التقريب إلى آخر سطر
 * حتى يبقى مجموع الأنصبة مساوياً تماماً لإجمالي الخصم.
 */
export function allocateProportionally(totalMinor, weights) {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum <= 0 || totalMinor === 0) return weights.map(() => 0);

  const shares = weights.map((w) => roundHalfUp((totalMinor * w) / weightSum));
  const drift = totalMinor - shares.reduce((sum, s) => sum + s, 0);

  // آخر سطر بوزن غير صفري يمتص فرق التقريب
  for (let i = shares.length - 1; i >= 0; i -= 1) {
    if (weights[i] > 0) { shares[i] += drift; break; }
  }
  return shares;
}
