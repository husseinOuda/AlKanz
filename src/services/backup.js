/**
 * النسخ الاحتياطي والاستعادة.
 *
 * ضمانات الاستعادة:
 *  1. يُفحص الملف بالكامل (النوع، الحجم، البنية، الإصدار، كل الحقول) قبل أي كتابة.
 *  2. تُنشأ نسخة تلقائية من البيانات الحالية قبل الاستبدال.
 *  3. المسح والكتابة يتمّان داخل معاملة IndexedDB واحدة — أي خطأ يُجهضها
 *     فتبقى البيانات الحالية كما هي بالضبط.
 *  4. لا يُدمج أي سجل ناقص أو مجهول بصمت؛ إما ملف صالح كامل أو رفض بسبب واضح.
 */

import { tx, getAll, add, del, clearStore } from '../db/db.js';
import { STORES, BACKUP_STORES, SCHEMA_VERSION, APP_VERSION } from '../db/schema.js';
import { uid } from '../utils/id.js';
import { toISO, fileStamp, dayKey } from '../utils/dates.js';
import { LIMITS, validateFile } from '../validation/validators.js';
import { isSafeImageDataUrl, isSafeAttachmentDataUrl, fileToText } from './images.js';
import { downloadBlob } from '../utils/xlsx.js';
import { invalidateSettingsCache, loadSettings, saveSettings } from '../repositories/settings.js';

export const BACKUP_KIND = { MANUAL: 'manual', AUTO: 'auto-pre-restore' };

/** أقصى عدد نسخ محفوظة داخل القاعدة — الأقدم يُحذف تلقائياً */
const KEEP_BACKUPS = 5;

/** أدنى إصدار مخطط يمكن استعادته */
const MIN_SUPPORTED_SCHEMA = 1;

/* ------------------------------------------------------------------ */
/* التصدير                                                             */
/* ------------------------------------------------------------------ */

/** يقرأ كل المتاجر ويبني حمولة النسخة */
export async function buildBackupPayload() {
  const data = {};

  await tx(BACKUP_STORES, 'readonly', async (stores) => {
    for (const name of BACKUP_STORES) {
      data[name] = await getAll(stores[name]);
    }
  });

  const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]));

  return {
    format: 'sales-system-backup',
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: toISO(),
    counts,
    data,
  };
}

/**
 * ينشئ نسخة احتياطية: يبني الحمولة، ويسجّلها، وينزّلها اختيارياً.
 * @param {{kind?:string, download?:boolean}} [options]
 */
export async function createBackup({ kind = BACKUP_KIND.MANUAL, download = true } = {}) {
  const payload = await buildBackupPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const fileName = kind === BACKUP_KIND.AUTO
    ? `backup-auto-${fileStamp()}.json`
    : `backup-${fileStamp()}.json`;

  const record = {
    id: uid('bkp'),
    fileName,
    kind,
    createdAt: payload.exportedAt,
    dayKey: dayKey(new Date()),
    sizeBytes: blob.size,
    schemaVersion: payload.schemaVersion,
    appVersion: payload.appVersion,
    counts: payload.counts,
    status: 'completed',
    // نحتفظ بالحمولة داخل القاعدة حتى تعمل الاستعادة والتنزيل لاحقاً فعلياً
    payload: json,
  };

  await tx(STORES.backupRecords, 'readwrite', async (stores) => {
    const store = stores[STORES.backupRecords];
    await add(store, record);

    // تقليم النسخ القديمة حتى لا تستهلك حصة التخزين بلا حد
    const all = await getAll(store);
    const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const old of sorted.slice(KEEP_BACKUPS)) {
      await del(store, old.id);
    }
  });

  if (download) downloadBlob(blob, fileName);
  await saveSettings({ lastBackupAt: payload.exportedAt });

  return { record: { ...record, payload: undefined }, blob, fileName, payload };
}

export const listBackups = () =>
  tx(STORES.backupRecords, 'readonly', (stores) => getAll(stores[STORES.backupRecords]))
    .then((rows) => rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ payload, ...rest }) => ({ ...rest, hasPayload: Boolean(payload) })));

/** ينزّل نسخة محفوظة مسبقاً */
export async function downloadBackup(id) {
  const record = await tx(STORES.backupRecords, 'readonly', async (stores) => {
    const rows = await getAll(stores[STORES.backupRecords]);
    return rows.find((row) => row.id === id);
  });

  if (!record) throw new Error('النسخة غير موجودة');
  if (!record.payload) throw new Error('محتوى هذه النسخة لم يعد محفوظاً محلياً');

  downloadBlob(new Blob([record.payload], { type: 'application/json' }), record.fileName);
  return record.fileName;
}

export const deleteBackup = (id) =>
  tx(STORES.backupRecords, 'readwrite', (stores) => del(stores[STORES.backupRecords], id));

/* ------------------------------------------------------------------ */
/* الفحص قبل الاستعادة                                                  */
/* ------------------------------------------------------------------ */

/** أشكال السجلات المتوقّعة لكل متجر: الحقول المطلوبة ونوعها */
const RECORD_SHAPES = {
  [STORES.products]: { id: 'string', sku: 'string', name: 'string', priceMinor: 'int', costMinor: 'int', quantity: 'int' },
  [STORES.categories]: { id: 'string', name: 'string' },
  [STORES.customers]: { id: 'string', name: 'string' },
  [STORES.suppliers]: { id: 'string', name: 'string' },
  [STORES.purchases]: { id: 'string', number: 'string', supplierId: 'string', totalMinor: 'int', status: 'string', createdAt: 'string' },
  [STORES.purchaseItems]: { id: 'string', purchaseId: 'string', productId: 'string', quantity: 'int', unitCostMinor: 'int' },
  [STORES.purchasePayments]: { id: 'string', supplierId: 'string', amountMinor: 'int', createdAt: 'string' },
  [STORES.purchaseOrders]: { id: 'string', supplierId: 'string', status: 'string', createdAt: 'string' },
  [STORES.sales]: { id: 'string', number: 'string', totalMinor: 'int', dayKey: 'string', status: 'string', createdAt: 'string' },
  [STORES.saleItems]: { id: 'string', saleId: 'string', productId: 'string', quantity: 'int', unitPriceMinor: 'int' },
  [STORES.payments]: { id: 'string', customerId: 'string', amountMinor: 'int', createdAt: 'string' },
  [STORES.expenses]: { id: 'string', amountMinor: 'int', dayKey: 'string', categoryId: 'string' },
  [STORES.expenseCategories]: { id: 'string', name: 'string' },
  [STORES.inventoryMovements]: { id: 'string', productId: 'string', quantity: 'int', type: 'string', createdAt: 'string' },
  [STORES.suspendedSales]: { id: 'string', createdAt: 'string' },
  [STORES.settings]: { key: 'string' },
  [STORES.backupRecords]: { id: 'string', fileName: 'string' },
  [STORES.adjustmentReasons]: { id: 'string', name: 'string' },
};

function checkType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'int') return Number.isInteger(value);
  return true;
}

/**
 * يفحص ملف نسخة احتياطية بالكامل دون أي كتابة.
 * @param {File} file
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[], payload:object|null, summary:object}>}
 */
export async function inspectBackupFile(file) {
  const errors = [];
  const warnings = [];

  const fileCheck = validateFile(file, { types: null, maxBytes: LIMITS.backupBytes, label: 'ملف النسخة' });
  if (!fileCheck.ok) return { ok: false, errors: [fileCheck.error], warnings, payload: null, summary: {} };

  if (!/\.json$/i.test(file.name)) {
    return { ok: false, errors: ['الملف يجب أن يكون بصيغة JSON'], warnings, payload: null, summary: {} };
  }

  let payload;
  try {
    payload = JSON.parse(await fileToText(file));
  } catch {
    return { ok: false, errors: ['الملف ليس JSON صالحاً — قد يكون تالفاً'], warnings, payload: null, summary: {} };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: ['بنية الملف غير متوقّعة'], warnings, payload: null, summary: {} };
  }

  if (payload.format !== 'sales-system-backup') {
    errors.push('هذا الملف ليس نسخة احتياطية من هذا النظام');
  }

  const schemaVersion = Number(payload.schemaVersion);
  if (!Number.isInteger(schemaVersion)) {
    errors.push('إصدار المخطط مفقود أو غير صالح');
  } else if (schemaVersion > SCHEMA_VERSION) {
    errors.push(`النسخة أُنشئت بإصدار أحدث (${schemaVersion}) من إصدار التطبيق الحالي (${SCHEMA_VERSION}). حدّث التطبيق أولاً.`);
  } else if (schemaVersion < MIN_SUPPORTED_SCHEMA) {
    errors.push(`إصدار المخطط ${schemaVersion} لم يعد مدعوماً`);
  } else if (schemaVersion < SCHEMA_VERSION) {
    warnings.push(`النسخة من إصدار أقدم (${schemaVersion}) وسيتم ترقيتها إلى ${SCHEMA_VERSION}`);
  }

  if (!payload.data || typeof payload.data !== 'object') {
    errors.push('الملف لا يحتوي على قسم البيانات');
    return { ok: false, errors, warnings, payload: null, summary: {} };
  }

  const summary = {};
  let totalRecords = 0;

  for (const store of BACKUP_STORES) {
    const rows = payload.data[store];

    if (rows === undefined) {
      // متجر أُضيف في إصدار أحدث من إصدار النسخة — مقبول ويبدأ فارغاً
      summary[store] = 0;
      if (schemaVersion === SCHEMA_VERSION) warnings.push(`المتجر "${store}" مفقود من الملف وسيبدأ فارغاً`);
      continue;
    }

    if (!Array.isArray(rows)) {
      errors.push(`المتجر "${store}" ليس مصفوفة`);
      continue;
    }

    summary[store] = rows.length;
    totalRecords += rows.length;

    const shape = RECORD_SHAPES[store];
    if (!shape) continue;

    // نفحص كل السجلات، لا عيّنة — البيانات المالية لا تحتمل فحصاً جزئياً
    for (let i = 0; i < rows.length; i += 1) {
      const record = rows[i];
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        errors.push(`سجل غير صالح في "${store}" عند الموضع ${i + 1}`);
        break;
      }
      for (const [field, type] of Object.entries(shape)) {
        if (!checkType(record[field], type)) {
          errors.push(`الحقل "${field}" غير صالح في "${store}" عند الموضع ${i + 1}`);
          break;
        }
      }
      if (errors.length > 12) break;
    }
  }

  // فحص data URLs — نرفض أي محتوى مضمّن لا يطابق نمطاً آمناً
  for (const product of payload.data[STORES.products] || []) {
    if (product.image && !isSafeImageDataUrl(product.image)) {
      errors.push(`صورة غير صالحة في المنتج "${product.sku || product.id}"`);
      break;
    }
  }
  for (const expense of payload.data[STORES.expenses] || []) {
    const url = expense.attachment?.dataUrl;
    if (url && !isSafeAttachmentDataUrl(url)) {
      errors.push('مرفق غير صالح في أحد المصروفات');
      break;
    }
  }

  // فحص تكامل مرجعي أساسي
  const productIds = new Set((payload.data[STORES.products] || []).map((p) => p.id));
  const saleIds = new Set((payload.data[STORES.sales] || []).map((s) => s.id));
  const orphanItems = (payload.data[STORES.saleItems] || []).filter((item) => !saleIds.has(item.saleId));
  if (orphanItems.length > 0) {
    errors.push(`${orphanItems.length} سطر فاتورة بلا فاتورة مرتبطة`);
  }
  const orphanProducts = (payload.data[STORES.saleItems] || []).filter((item) => !productIds.has(item.productId));
  if (orphanProducts.length > 0) {
    warnings.push(`${orphanProducts.length} سطر فاتورة يشير إلى منتج محذوف (سيُستعاد كما هو)`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    payload: errors.length === 0 ? payload : null,
    summary: {
      ...summary,
      totalRecords,
      exportedAt: payload.exportedAt,
      appVersion: payload.appVersion,
      schemaVersion,
      fileName: file.name,
      fileSize: file.size,
    },
  };
}

/* ------------------------------------------------------------------ */
/* الاستعادة                                                           */
/* ------------------------------------------------------------------ */

/**
 * يستعيد نسخة تم فحصها مسبقاً.
 * المسح والكتابة داخل معاملة واحدة؛ أي خطأ يعيد كل شيء كما كان.
 *
 * @param {object} payload مخرجات inspectBackupFile().payload
 * @param {{autoBackup?:boolean}} [options]
 */
export async function restoreBackup(payload, { autoBackup = true } = {}) {
  if (!payload?.data) throw new Error('لا توجد بيانات صالحة للاستعادة');

  // نسخة أمان من الوضع الحالي — خارج معاملة الاستعادة
  let safetyBackup = null;
  if (autoBackup) {
    safetyBackup = await createBackup({ kind: BACKUP_KIND.AUTO, download: false });
  }

  // نحتفظ بسجلات النسخ الحالية حتى لا تفقد نسخة الأمان نفسها بالاستعادة
  const preservedBackups = await tx(STORES.backupRecords, 'readonly', (stores) =>
    getAll(stores[STORES.backupRecords]));

  const restored = {};

  await tx(BACKUP_STORES, 'readwrite', async (stores) => {
    for (const name of BACKUP_STORES) {
      const store = stores[name];
      await clearStore(store);

      if (name === STORES.backupRecords) {
        // سجل النسخ لا يُستورد من الملف — نعيد سجلاتنا المحلية
        for (const record of preservedBackups) await add(store, record);
        restored[name] = preservedBackups.length;
        continue;
      }

      const rows = payload.data[name] || [];
      for (const row of rows) await add(store, row);
      restored[name] = rows.length;
    }
  });

  invalidateSettingsCache();
  await loadSettings({ force: true });

  return { restored, safetyBackup: safetyBackup?.record || null };
}

/** يمسح كل بيانات العمل ويُبقي سجل النسخ */
export async function clearAllData({ keepBackups = true } = {}) {
  const preserved = keepBackups
    ? await tx(STORES.backupRecords, 'readonly', (stores) => getAll(stores[STORES.backupRecords]))
    : [];

  await tx(BACKUP_STORES, 'readwrite', async (stores) => {
    for (const name of BACKUP_STORES) {
      await clearStore(stores[name]);
    }
    for (const record of preserved) await add(stores[STORES.backupRecords], record);
  });

  invalidateSettingsCache();
  return true;
}

/* ------------------------------------------------------------------ */
/* تذكير النسخ                                                          */
/* ------------------------------------------------------------------ */

/** هل حان وقت تذكير المستخدم بأخذ نسخة خارج الجهاز؟ */
export function backupReminderDue(settingsValue) {
  const { backupReminder, lastBackupAt } = settingsValue;
  if (backupReminder === 'off') return null;

  if (!lastBackupAt) {
    return { due: true, days: null, message: 'لم تُنشئ أي نسخة احتياطية بعد. بياناتك محفوظة على هذا المتصفح فقط.' };
  }

  const days = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000);
  const threshold = backupReminder === 'daily' ? 1 : 7;

  if (days >= threshold) {
    return {
      due: true,
      days,
      message: days === 0
        ? 'أنشئ نسخة احتياطية جديدة واحفظها خارج الجهاز.'
        : `مرّ ${days} يوماً على آخر نسخة احتياطية. احفظ نسخة خارج الجهاز.`,
    };
  }
  return { due: false, days, message: '' };
}
