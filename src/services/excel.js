/**
 * استيراد وتصدير Excel (.xlsx).
 *
 * قرار المستخدم: لا يُستخدم CSV في أي مكان — كل جداول التصدير والاستيراد بصيغة Excel.
 * التنفيذ يعتمد على src/utils/xlsx.js (ZIP + deflate-raw أصلي، بلا مكتبات).
 */

import { writeXlsx, readXlsx, downloadBlob, XLSX_MIME } from '../utils/xlsx.js';
import { toMajor, bpToPercent } from '../utils/money.js';
import { validateProduct, validateFile } from '../validation/validators.js';
import { listProducts, listCategories, createProduct, updateProduct, findBySku, categoryMap, createCategory } from '../repositories/products.js';
import { fileStamp, formatDateTime } from '../utils/dates.js';
import { settings } from '../repositories/settings.js';

export const XLSX_TYPES = [
  XLSX_MIME,
  'application/vnd.ms-excel',
  'application/octet-stream', // بعض المتصفحات لا تتعرّف على النوع
  '',
];

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

/** ينشئ اسم ملف واضح يتضمن التاريخ والوقت */
export const exportFileName = (base) => `${base}-${fileStamp()}.xlsx`;

/** يصدّر صفوفاً إلى ملف Excel وينزّله */
export async function exportRows(rows, { fileName, sheetName, columnWidths }) {
  const blob = await writeXlsx(rows, { sheetName, columnWidths });
  downloadBlob(blob, fileName);
  return blob;
}

/* ------------------------------------------------------------------ */
/* المنتجات                                                            */
/* ------------------------------------------------------------------ */

export const PRODUCT_COLUMNS = [
  'SKU', 'اسم المنتج', 'الباركود', 'الفئة', 'الوحدة',
  'سعر الشراء', 'سعر البيع', 'الضريبة %', 'الكمية', 'حد المخزون المنخفض',
  'الوصف', 'نشط',
];

export async function exportProducts() {
  const [products, categories] = await Promise.all([listProducts(), categoryMap()]);

  const rows = [PRODUCT_COLUMNS];
  for (const product of products) {
    rows.push([
      product.sku,
      product.name,
      product.barcode || '',
      categories.get(product.categoryId)?.name || '',
      product.unit,
      toMajor(product.costMinor),
      toMajor(product.priceMinor),
      bpToPercent(product.taxRateBp),
      product.quantity,
      product.lowStockThreshold,
      product.description || '',
      product.isActive === false ? 'لا' : 'نعم',
    ]);
  }

  return exportRows(rows, {
    fileName: exportFileName('المنتجات'),
    sheetName: 'المنتجات',
    columnWidths: [14, 32, 16, 16, 10, 12, 12, 10, 10, 16, 30, 8],
  });
}

/** ملف نموذجي للاستيراد — رأس + صف مثال */
export async function downloadProductTemplate() {
  const categories = await listCategories();
  const rows = [
    PRODUCT_COLUMNS,
    ['SKU-2001', 'اسم المنتج هنا', '6281000000001', categories[0]?.name || 'مواد غذائية', 'عبوة', 10, 15, 15, 100, 10, 'وصف اختياري', 'نعم'],
  ];
  return exportRows(rows, {
    fileName: 'قالب-استيراد-المنتجات.xlsx',
    sheetName: 'المنتجات',
    columnWidths: [14, 32, 16, 16, 10, 12, 12, 10, 10, 16, 30, 8],
  });
}

/**
 * يقرأ ملف Excel ويحوّله إلى صفوف مُتحقَّق منها **دون الكتابة إلى القاعدة**.
 * الكتابة تتم في خطوة منفصلة بعد أن يراجع المستخدم النتيجة.
 *
 * @returns {Promise<{valid:object[], invalid:{row:number, errors:string[], raw:any[]}[], newCategories:string[]}>}
 */
export async function parseProductsFile(file) {
  const check = validateFile(file, { types: null, maxBytes: MAX_IMPORT_BYTES, label: 'ملف Excel' });
  if (!check.ok) throw new Error(check.error);
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error('الملف يجب أن يكون بصيغة Excel (.xlsx)');
  }

  const rows = await readXlsx(file);
  if (rows.length < 2) throw new Error('الملف لا يحتوي على بيانات بعد صف العناوين');

  const header = rows[0].map((cell) => String(cell ?? '').trim());
  const columnIndex = (name) => header.findIndex((cell) => cell === name);

  const idx = {
    sku: columnIndex('SKU'),
    name: columnIndex('اسم المنتج'),
    barcode: columnIndex('الباركود'),
    category: columnIndex('الفئة'),
    unit: columnIndex('الوحدة'),
    cost: columnIndex('سعر الشراء'),
    price: columnIndex('سعر البيع'),
    tax: columnIndex('الضريبة %'),
    quantity: columnIndex('الكمية'),
    lowStock: columnIndex('حد المخزون المنخفض'),
    description: columnIndex('الوصف'),
    active: columnIndex('نشط'),
  };

  const required = ['sku', 'name', 'category', 'unit', 'cost', 'price'];
  const missing = required.filter((key) => idx[key] < 0);
  if (missing.length > 0) {
    const labels = { sku: 'SKU', name: 'اسم المنتج', category: 'الفئة', unit: 'الوحدة', cost: 'سعر الشراء', price: 'سعر البيع' };
    throw new Error(`أعمدة مفقودة في الملف: ${missing.map((key) => labels[key]).join('، ')}`);
  }

  const categories = await listCategories();
  const categoryByName = new Map(categories.map((category) => [category.name.trim(), category]));

  const cell = (row, key) => (idx[key] >= 0 ? row[idx[key]] : undefined);

  const valid = [];
  const invalid = [];
  const seenSkus = new Set();
  const newCategories = new Set();
  const defaultTax = bpToPercent(settings().defaultTaxRateBp);

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;

    const categoryName = String(cell(row, 'category') ?? '').trim();
    const existingCategory = categoryByName.get(categoryName);

    const result = validateProduct({
      sku: cell(row, 'sku'),
      name: cell(row, 'name'),
      barcode: cell(row, 'barcode'),
      // نمرّر معرّفاً مؤقتاً حتى يمر التحقق، ويُستبدل بالمعرّف الحقيقي عند الحفظ
      categoryId: existingCategory?.id || (categoryName ? `new:${categoryName}` : ''),
      unit: cell(row, 'unit'),
      cost: cell(row, 'cost'),
      price: cell(row, 'price'),
      taxRate: cell(row, 'tax') ?? defaultTax,
      quantity: cell(row, 'quantity') ?? 0,
      lowStockThreshold: cell(row, 'lowStock') ?? 0,
      description: cell(row, 'description'),
      isActive: String(cell(row, 'active') ?? 'نعم').trim() !== 'لا',
    });

    if (!result.ok) {
      invalid.push({ row: i + 1, errors: Object.values(result.errors), raw: row });
      continue;
    }

    if (seenSkus.has(result.value.sku)) {
      invalid.push({ row: i + 1, errors: [`رمز SKU "${result.value.sku}" مكرر داخل الملف`], raw: row });
      continue;
    }
    seenSkus.add(result.value.sku);

    if (!existingCategory && categoryName) newCategories.add(categoryName);
    valid.push({ ...result.value, categoryName, row: i + 1 });
  }

  return { valid, invalid, newCategories: [...newCategories], totalRows: rows.length - 1 };
}

/**
 * يكتب نتيجة الاستيراد.
 * @param {object[]} products مخرجات parseProductsFile().valid
 * @param {{mode:'skip'|'update', createCategories:boolean}} options
 */
export async function commitProductsImport(products, { mode = 'skip', createCategories = true } = {}) {
  const categories = await listCategories();
  const categoryByName = new Map(categories.map((category) => [category.name.trim(), category]));

  // أنشئ الفئات الجديدة أولاً (خارج حلقة المنتجات حتى لا تتكرر)
  if (createCategories) {
    const needed = new Set(products.map((p) => p.categoryName).filter((name) => name && !categoryByName.has(name)));
    let order = categories.length;
    for (const name of needed) {
      order += 1;
      const created = await createCategory({ name, sortOrder: order });
      categoryByName.set(name, created);
    }
  }

  const result = { created: 0, updated: 0, skipped: 0, failed: [] };

  for (const product of products) {
    const category = categoryByName.get(product.categoryName);
    if (!category) {
      result.failed.push({ row: product.row, sku: product.sku, error: `الفئة "${product.categoryName}" غير موجودة` });
      continue;
    }

    const { categoryName, row, ...fields } = product;
    const payload = { ...fields, categoryId: category.id };

    try {
      const existing = await findBySku(payload.sku);
      if (existing) {
        if (mode === 'update') {
          await updateProduct(existing.id, payload);
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
      } else {
        await createProduct(payload);
        result.created += 1;
      }
    } catch (error) {
      result.failed.push({ row, sku: payload.sku, error: error.message });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* الفواتير والتقارير                                                   */
/* ------------------------------------------------------------------ */

export async function exportInvoices(sales) {
  const symbol = settings().currencySymbol;
  const rows = [[
    'رقم الفاتورة', 'التاريخ', 'العميل', 'عدد الأصناف', 'نوع الدفع', 'الحالة',
    `المجموع الفرعي (${symbol})`, `الخصم (${symbol})`, `الضريبة (${symbol})`,
    `الإجمالي (${symbol})`, `المدفوع (${symbol})`, `المتبقي (${symbol})`,
  ]];

  const statusLabel = { completed: 'مكتملة', cancelled: 'ملغاة', pending: 'معلقة' };

  for (const sale of sales) {
    rows.push([
      sale.number,
      formatDateTime(sale.createdAt, settings().dateFormat),
      sale.customerName,
      sale.itemCount,
      sale.paymentType === 'credit' ? 'آجل' : 'نقدي',
      statusLabel[sale.status] || sale.status,
      toMajor(sale.subtotalMinor),
      toMajor(sale.discountMinor),
      toMajor(sale.taxMinor),
      toMajor(sale.totalMinor),
      toMajor(sale.paidMinor),
      toMajor(sale.dueMinor),
    ]);
  }

  return exportRows(rows, {
    fileName: exportFileName('الفواتير'),
    sheetName: 'الفواتير',
    columnWidths: [20, 20, 26, 12, 12, 12, 16, 14, 14, 16, 14, 14],
  });
}

export async function exportCustomers(customers, ledgers) {
  const symbol = settings().currencySymbol;
  const rows = [[
    'الاسم', 'الهاتف', 'عدد الفواتير', `إجمالي المشتريات (${symbol})`,
    `الرصيد (${symbol})`, 'آخر شراء', 'الحالة', 'ملاحظة',
  ]];

  for (const customer of customers) {
    const ledger = ledgers.get(customer.id) || {};
    rows.push([
      customer.name,
      customer.phone || '',
      ledger.invoiceCount || 0,
      toMajor(ledger.purchasesMinor || 0),
      toMajor(ledger.balanceMinor || 0),
      ledger.lastPurchaseAt ? formatDateTime(ledger.lastPurchaseAt, settings().dateFormat) : '',
      customer.isActive === false ? 'غير نشط' : 'نشط',
      customer.note || '',
    ]);
  }

  return exportRows(rows, {
    fileName: exportFileName('العملاء'),
    sheetName: 'العملاء',
    columnWidths: [28, 16, 12, 20, 16, 20, 10, 30],
  });
}

export async function exportExpenses(expenses, categories) {
  const symbol = settings().currencySymbol;
  const methodLabels = { cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك' };

  const rows = [['التاريخ', 'الفئة', 'البيان', `المبلغ (${symbol})`, 'طريقة الدفع', 'رقم المرجع', 'ملاحظة']];

  for (const expense of expenses) {
    rows.push([
      formatDateTime(expense.createdAt, settings().dateFormat),
      categories.get(expense.categoryId)?.name || '',
      expense.title || '',
      toMajor(expense.amountMinor),
      methodLabels[expense.method] || expense.method,
      expense.reference || '',
      expense.note || '',
    ]);
  }

  return exportRows(rows, {
    fileName: exportFileName('المصروفات'),
    sheetName: 'المصروفات',
    columnWidths: [20, 18, 32, 14, 14, 16, 30],
  });
}

export async function exportInventory(products) {
  const symbol = settings().currencySymbol;
  const statusLabels = { ok: 'متوفر', low: 'منخفض', out: 'نفد المخزون' };

  const rows = [[
    'SKU', 'اسم المنتج', 'الفئة', 'الكمية الحالية', 'الحد الأدنى', 'الحالة',
    `سعر الشراء (${symbol})`, `سعر البيع (${symbol})`, `قيمة المخزون (${symbol})`,
  ]];

  for (const product of products) {
    rows.push([
      product.sku,
      product.name,
      product.categoryName || '',
      product.quantity,
      product.lowStockThreshold,
      statusLabels[product.status] || '',
      toMajor(product.costMinor),
      toMajor(product.priceMinor),
      toMajor(product.stockValueMinor ?? product.quantity * product.costMinor),
    ]);
  }

  return exportRows(rows, {
    fileName: exportFileName('المخزون'),
    sheetName: 'المخزون',
    columnWidths: [14, 32, 18, 14, 12, 14, 16, 16, 18],
  });
}

/** تصدير تقرير عام: عنوان + جدول */
export async function exportReport({ title, header, rows, fileName }) {
  return exportRows([header, ...rows], {
    fileName: fileName || exportFileName(title),
    sheetName: title.slice(0, 30),
    columnWidths: header.map((label) => Math.max(12, Math.min(32, String(label).length + 8))),
  });
}
