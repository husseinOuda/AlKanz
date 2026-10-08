/**
 * تحقق وتطبيع لكل المدخلات.
 * كل مسار يدخل بيانات إلى قاعدة البيانات (نموذج، استيراد Excel، استعادة نسخة)
 * يمر من هنا. الدوال تُرجع { ok, value, errors } ولا ترمي استثناءات.
 */

import { toMinor, percentToBp } from '../utils/money.js';
import { isDayKey } from '../utils/dates.js';

export const LIMITS = {
  name: 120,
  sku: 40,
  barcode: 40,
  description: 500,
  note: 200,
  phone: 24,
  reference: 40,
  imageBytes: 5 * 1024 * 1024,
  attachmentBytes: 5 * 1024 * 1024,
  backupBytes: 100 * 1024 * 1024,
  maxQuantity: 1_000_000,
  maxAmountMinor: 99_999_999_999,
};

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const ATTACHMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];

/** يزيل الفراغات الزائدة والمحارف غير المرئية */
export function normalizeText(value, max = 255) {
  return String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // محارف اتجاه/صفرية العرض
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** نص متعدد الأسطر: يحافظ على الأسطر ويزيل المحارف الخفية */
export function normalizeMultiline(value, max = 500) {
  return String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

/** SKU: أحرف لاتينية وأرقام وشرطات فقط، بحالة كبيرة موحّدة */
export function normalizeSku(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\-_.]/g, '')
    .slice(0, LIMITS.sku);
}

/** باركود: أرقام وأحرف فقط */
export function normalizeBarcode(value) {
  const clean = String(value ?? '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, LIMITS.barcode);
  return clean || undefined; // undefined حتى لا يدخل الفهرس الفريد
}

/** هاتف: أرقام و + فقط، مع تحويل الأرقام العربية */
export function normalizePhone(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[^\d+]/g, '')
    .slice(0, LIMITS.phone);
}

/** كمية: عدد صحيح موجب (أو سالب إذا سُمح) */
export function parseQuantity(value, { allowNegative = false, allowZero = true } = {}) {
  const num = Number(String(value ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, ''));
  if (!Number.isFinite(num)) return NaN;
  if (!Number.isInteger(num)) return NaN;
  if (!allowNegative && num < 0) return NaN;
  if (!allowZero && num === 0) return NaN;
  if (Math.abs(num) > LIMITS.maxQuantity) return NaN;
  return num;
}

/* ------------------------------------------------------------------ */

function collect() {
  const errors = {};
  return {
    errors,
    add(field, message) { if (!errors[field]) errors[field] = message; },
    get ok() { return Object.keys(errors).length === 0; },
  };
}

/** يتحقق من منتج ويعيد كائناً مطبّعاً جاهزاً للتخزين */
export function validateProduct(input) {
  const v = collect();

  const name = normalizeText(input.name, LIMITS.name);
  if (!name) v.add('name', 'اسم المنتج مطلوب');

  const sku = normalizeSku(input.sku);
  if (!sku) v.add('sku', 'رمز SKU مطلوب');
  else if (sku.length < 2) v.add('sku', 'رمز SKU قصير جداً');

  const barcode = normalizeBarcode(input.barcode);

  const categoryId = normalizeText(input.categoryId, 60);
  if (!categoryId) v.add('categoryId', 'الفئة مطلوبة');

  const unit = normalizeText(input.unit, 20);
  if (!unit) v.add('unit', 'الوحدة مطلوبة');

  const costMinor = toMinor(input.costMinor ?? input.cost);
  if (!Number.isFinite(costMinor) || costMinor < 0) v.add('cost', 'سعر الشراء غير صالح');
  else if (costMinor > LIMITS.maxAmountMinor) v.add('cost', 'سعر الشراء كبير جداً');

  const priceMinor = toMinor(input.priceMinor ?? input.price);
  if (!Number.isFinite(priceMinor) || priceMinor < 0) v.add('price', 'سعر البيع غير صالح');
  else if (priceMinor > LIMITS.maxAmountMinor) v.add('price', 'سعر البيع كبير جداً');

  const taxRateBp = input.taxRateBp != null ? Math.trunc(Number(input.taxRateBp)) : percentToBp(input.taxRate ?? 0);
  if (!Number.isFinite(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) {
    v.add('taxRate', 'نسبة الضريبة يجب أن تكون بين 0 و100');
  }

  const quantity = parseQuantity(input.quantity ?? 0);
  if (Number.isNaN(quantity)) v.add('quantity', 'الكمية يجب أن تكون عدداً صحيحاً غير سالب');

  const lowStockThreshold = parseQuantity(input.lowStockThreshold ?? 0);
  if (Number.isNaN(lowStockThreshold)) v.add('lowStockThreshold', 'حد المخزون المنخفض غير صالح');

  const description = normalizeMultiline(input.description, LIMITS.description);

  if (!v.ok) return { ok: false, errors: v.errors, value: null };

  return {
    ok: true,
    errors: {},
    value: {
      name,
      nameLower: name.toLowerCase(),
      sku,
      barcode,
      categoryId,
      unit,
      costMinor,
      priceMinor,
      taxRateBp,
      quantity,
      lowStockThreshold,
      description,
      image: input.image ?? null,
      isActive: input.isActive !== false,
    },
  };
}

export function validateCustomer(input) {
  const v = collect();

  const name = normalizeText(input.name, LIMITS.name);
  if (!name) v.add('name', 'اسم العميل مطلوب');

  const phone = normalizePhone(input.phone);
  if (phone && phone.replace(/\D/g, '').length < 7) v.add('phone', 'رقم الهاتف غير صالح');

  const note = normalizeMultiline(input.note, LIMITS.note);

  if (!v.ok) return { ok: false, errors: v.errors, value: null };

  return {
    ok: true,
    errors: {},
    value: { name, phone, note, isActive: input.isActive !== false },
  };
}

export function validateExpense(input) {
  const v = collect();

  const amountMinor = toMinor(input.amountMinor ?? input.amount);
  if (!Number.isFinite(amountMinor)) v.add('amount', 'المبلغ مطلوب');
  else if (amountMinor <= 0) v.add('amount', 'المبلغ يجب أن يكون أكبر من صفر');
  else if (amountMinor > LIMITS.maxAmountMinor) v.add('amount', 'المبلغ كبير جداً');

  const categoryId = normalizeText(input.categoryId, 60);
  if (!categoryId) v.add('categoryId', 'الفئة مطلوبة');

  const dayKey = String(input.dayKey || '').trim();
  if (!isDayKey(dayKey)) v.add('dayKey', 'التاريخ غير صالح');

  const method = normalizeText(input.method, 30) || 'cash';
  const title = normalizeText(input.title, LIMITS.name);
  const reference = normalizeText(input.reference, LIMITS.reference);
  const note = normalizeMultiline(input.note, LIMITS.note);

  if (!v.ok) return { ok: false, errors: v.errors, value: null };

  return {
    ok: true,
    errors: {},
    value: {
      amountMinor, categoryId, dayKey, method, title, reference, note,
      attachment: input.attachment ?? null,
    },
  };
}

export function validateAdjustment(input) {
  const v = collect();

  const productId = normalizeText(input.productId, 60);
  if (!productId) v.add('productId', 'اختر منتجاً');

  const quantity = parseQuantity(input.quantity, { allowNegative: true, allowZero: false });
  if (Number.isNaN(quantity)) v.add('quantity', 'الكمية يجب أن تكون عدداً صحيحاً غير صفري');

  const reason = normalizeText(input.reason, 60);
  if (!reason) v.add('reason', 'السبب مطلوب');

  const note = normalizeMultiline(input.note, LIMITS.note);

  if (!v.ok) return { ok: false, errors: v.errors, value: null };
  return { ok: true, errors: {}, value: { productId, quantity, reason, note } };
}

export function validatePayment(input) {
  const v = collect();

  const customerId = normalizeText(input.customerId, 60);
  if (!customerId) v.add('customerId', 'العميل مطلوب');

  const amountMinor = toMinor(input.amountMinor ?? input.amount);
  if (!Number.isFinite(amountMinor)) v.add('amount', 'المبلغ مطلوب');
  else if (amountMinor <= 0) v.add('amount', 'المبلغ يجب أن يكون أكبر من صفر');
  else if (amountMinor > LIMITS.maxAmountMinor) v.add('amount', 'المبلغ كبير جداً');

  if (!v.ok) return { ok: false, errors: v.errors, value: null };

  return {
    ok: true,
    errors: {},
    value: {
      customerId,
      amountMinor,
      method: normalizeText(input.method, 30) || 'cash',
      reference: normalizeText(input.reference, LIMITS.reference),
      note: normalizeMultiline(input.note, LIMITS.note),
    },
  };
}

/** يتحقق من ملف مرفوع قبل قراءته */
export function validateFile(file, { types, maxBytes, label = 'الملف' }) {
  if (!file) return { ok: false, error: `${label} مطلوب` };
  if (file.size === 0) return { ok: false, error: `${label} فارغ` };
  if (file.size > maxBytes) {
    return { ok: false, error: `حجم ${label} يتجاوز الحد المسموح (${Math.round(maxBytes / 1024 / 1024)} ميجابايت)` };
  }
  if (types && types.length > 0 && !types.includes(file.type)) {
    return { ok: false, error: `نوع ${label} غير مدعوم` };
  }
  return { ok: true, error: null };
}
