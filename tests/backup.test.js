/** النسخ الاحتياطي والاستعادة والترقية بين إصدارات IndexedDB. */

import { describe, it, beforeEach, afterEach, assert } from './harness.js';
import {
  freshDatabase, dropDatabase, seedBasics, makeProduct, makeCustomer,
  quantityOf, countRows, makeFile,
} from './setup.js';
import {
  buildBackupPayload, createBackup, inspectBackupFile, restoreBackup,
  clearAllData, listBackups, backupReminderDue, BACKUP_KIND,
} from '../src/services/backup.js';
import { completeSale } from '../src/repositories/sales.js';
import { listProducts } from '../src/repositories/products.js';
import { STORES, SCHEMA_VERSION, DB_NAME } from '../src/db/schema.js';
import { openDB, closeDB, req, tx, getAll } from '../src/db/db.js';
import { loadSettings } from '../src/repositories/settings.js';

describe('تصدير النسخة الاحتياطية', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يبني حمولة تحتوي البيانات الوصفية وكل الكيانات', async () => {
    await makeProduct(category.id, { sku: 'BK-1' });
    await makeCustomer({ name: 'عميل النسخة' });

    const payload = await buildBackupPayload();

    assert.equal(payload.format, 'sales-system-backup');
    assert.equal(payload.schemaVersion, SCHEMA_VERSION);
    assert.ok(payload.appVersion, 'يجب تضمين إصدار التطبيق');
    assert.ok(payload.exportedAt, 'يجب تضمين وقت التصدير');

    assert.ok(Array.isArray(payload.data[STORES.products]));
    assert.ok(Array.isArray(payload.data[STORES.customers]));
    assert.ok(Array.isArray(payload.data[STORES.sales]));
    assert.ok(Array.isArray(payload.data[STORES.settings]));
    assert.equal(payload.data[STORES.products].length, 1);
    assert.equal(payload.counts[STORES.products], 1);
  });

  it('يسجّل النسخة في السجل المحلي', async () => {
    await makeProduct(category.id);
    await createBackup({ kind: BACKUP_KIND.MANUAL, download: false });

    const backups = await listBackups();
    assert.equal(backups.length, 1);
    assert.ok(backups[0].sizeBytes > 0);
    assert.ok(backups[0].hasPayload, 'يجب حفظ المحتوى ليعمل التنزيل لاحقاً');
    assert.ok(/^backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(backups[0].fileName), `اسم الملف: ${backups[0].fileName}`);
  });
});

describe('فحص ملف النسخة قبل الاستعادة', () => {
  let dbName;

  beforeEach(async () => {
    dbName = await freshDatabase();
    await seedBasics();
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يقبل ملفاً صالحاً', async () => {
    const payload = await buildBackupPayload();
    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));

    assert.ok(result.ok, `التوقع قبول الملف — ${result.errors.join(' | ')}`);
    assert.equal(result.errors.length, 0);
    assert.ok(result.payload);
  });

  it('يرفض ملفاً ليس JSON', async () => {
    const result = await inspectBackupFile(makeFile('هذا ليس json {{{', 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /JSON صالح/.test(error)));
    assert.equal(result.payload, null);
  });

  it('يرفض امتداداً غير json', async () => {
    const result = await inspectBackupFile(makeFile('{}', 'backup.txt', 'text/plain'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /صيغة JSON/.test(error)));
  });

  it('يرفض ملفاً بصيغة غير معروفة', async () => {
    const result = await inspectBackupFile(makeFile({ hello: 'world' }, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /ليس نسخة احتياطية/.test(error)));
  });

  it('يرفض إصدار مخطط أحدث من التطبيق', async () => {
    const payload = await buildBackupPayload();
    payload.schemaVersion = SCHEMA_VERSION + 5;

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /إصدار أحدث/.test(error)));
  });

  it('يرفض إصدار مخطط غير صالح', async () => {
    const payload = await buildBackupPayload();
    payload.schemaVersion = 'خطأ';

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /إصدار المخطط/.test(error)));
  });

  it('يرفض سجلاً بحقول ناقصة أو بنوع خاطئ', async () => {
    const payload = await buildBackupPayload();
    payload.data[STORES.products] = [{ id: 'p1', sku: 'X', name: 'ناقص' }]; // بلا priceMinor

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /priceMinor/.test(error)));
  });

  it('يرفض مبلغاً نصياً بدل عدد صحيح', async () => {
    const payload = await buildBackupPayload();
    payload.data[STORES.products] = [{
      id: 'p1', sku: 'X', name: 'م', priceMinor: '1500', costMinor: 1000, quantity: 5,
    }];

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
  });

  it('يرفض سطر فاتورة بلا فاتورة مرتبطة', async () => {
    const payload = await buildBackupPayload();
    payload.data[STORES.saleItems] = [{
      id: 'si1', saleId: 'غير-موجود', productId: 'p1', quantity: 1, unitPriceMinor: 100,
    }];

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /بلا فاتورة مرتبطة/.test(error)));
  });

  it('يرفض صورة مضمّنة بصيغة غير آمنة', async () => {
    const payload = await buildBackupPayload();
    payload.data[STORES.products] = [{
      id: 'p1', sku: 'X', name: 'م', priceMinor: 100, costMinor: 50, quantity: 1,
      image: 'javascript:alert(1)',
    }];

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /صورة غير صالحة/.test(error)));
  });

  it('يرفض متجراً ليس مصفوفة', async () => {
    const payload = await buildBackupPayload();
    payload.data[STORES.customers] = { not: 'array' };

    const result = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.notOk(result.ok);
    assert.ok(result.errors.some((error) => /ليس مصفوفة/.test(error)));
  });
});

describe('الاستعادة', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يستعيد البيانات بالكامل ويستبدل الحالية', async () => {
    const product = await makeProduct(category.id, { sku: 'ORIG-1', quantity: 40 });
    await makeCustomer({ name: 'عميل أصلي' });
    await completeSale({ lines: [{ productId: product.id, quantity: 5 }] });

    const payload = await buildBackupPayload();
    const snapshotQuantity = await quantityOf(product.id);

    // غيّر البيانات بعد أخذ النسخة
    await makeProduct(category.id, { sku: 'NEW-1' });
    assert.equal((await listProducts()).length, 2);

    const inspection = await inspectBackupFile(makeFile(payload, 'backup.json'));
    assert.ok(inspection.ok);

    const result = await restoreBackup(inspection.payload, { autoBackup: false });

    const products = await listProducts();
    assert.equal(products.length, 1, 'يجب استبدال البيانات لا دمجها');
    assert.equal(products[0].sku, 'ORIG-1');
    assert.equal(await quantityOf(products[0].id), snapshotQuantity);
    assert.equal(await countRows(STORES.sales), 1);
    assert.ok(result.restored[STORES.products] >= 1);
  });

  it('ينشئ نسخة أمان تلقائية قبل الاستعادة', async () => {
    await makeProduct(category.id, { sku: 'SAFE-1' });
    const payload = await buildBackupPayload();

    const inspection = await inspectBackupFile(makeFile(payload, 'backup.json'));
    const result = await restoreBackup(inspection.payload, { autoBackup: true });

    assert.ok(result.safetyBackup, 'يجب إنشاء نسخة أمان');
    assert.equal(result.safetyBackup.kind, BACKUP_KIND.AUTO);

    const backups = await listBackups();
    assert.ok(backups.some((backup) => backup.kind === BACKUP_KIND.AUTO), 'نسخة الأمان يجب أن تبقى في السجل بعد الاستعادة');
  });

  it('يعيد الإعدادات من الملف', async () => {
    const { saveSettings } = await import('../src/repositories/settings.js');
    await saveSettings({ storeName: 'متجر النسخة', currencySymbol: 'د.ك' });

    const payload = await buildBackupPayload();
    await saveSettings({ storeName: 'متجر مختلف', currencySymbol: '$' });

    const inspection = await inspectBackupFile(makeFile(payload, 'backup.json'));
    await restoreBackup(inspection.payload, { autoBackup: false });

    const restored = await loadSettings({ force: true });
    assert.equal(restored.storeName, 'متجر النسخة');
    assert.equal(restored.currencySymbol, 'د.ك');
  });

  it('يرفض الاستعادة بحمولة فارغة', async () => {
    await assert.throws(() => restoreBackup(null), /لا توجد بيانات صالحة/);
    await assert.throws(() => restoreBackup({}), /لا توجد بيانات صالحة/);
  });

  it('يحافظ على البيانات الحالية عند فشل الاستعادة', async () => {
    await makeProduct(category.id, { sku: 'KEEP-1' });
    const before = await listProducts();

    // حمولة سليمة البنية لكن تحوي سجلاً بمفتاح مكرر يُفشل الكتابة
    const payload = await buildBackupPayload();
    payload.data[STORES.products] = [
      { id: 'dup', sku: 'A', name: 'أ', priceMinor: 1, costMinor: 1, quantity: 1 },
      { id: 'dup', sku: 'B', name: 'ب', priceMinor: 1, costMinor: 1, quantity: 1 },
    ];

    await assert.throws(() => restoreBackup(payload, { autoBackup: false }));

    const after = await listProducts();
    assert.equal(after.length, before.length, 'يجب بقاء عدد المنتجات كما هو');
    assert.equal(after[0].sku, 'KEEP-1', 'يجب بقاء البيانات الأصلية سليمة');
  });
});

describe('مسح البيانات والتذكير', () => {
  let dbName;
  let category;

  beforeEach(async () => {
    dbName = await freshDatabase();
    ({ category } = await seedBasics());
  });

  afterEach(async () => { await dropDatabase(dbName); });

  it('يمسح كل البيانات ويُبقي سجل النسخ', async () => {
    await makeProduct(category.id);
    await createBackup({ download: false });

    await clearAllData({ keepBackups: true });

    assert.equal(await countRows(STORES.products), 0);
    assert.equal(await countRows(STORES.sales), 0);
    assert.ok(await countRows(STORES.backupRecords) > 0, 'سجل النسخ يجب أن يبقى');
  });

  it('يحدّد وقت استحقاق التذكير بالنسخ', () => {
    assert.equal(backupReminderDue({ backupReminder: 'off', lastBackupAt: null }), null);

    const never = backupReminderDue({ backupReminder: 'weekly', lastBackupAt: null });
    assert.ok(never.due, 'عدم وجود نسخة يعني استحقاق التذكير');

    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    assert.ok(backupReminderDue({ backupReminder: 'weekly', lastBackupAt: old }).due);

    const recent = new Date(Date.now() - 3600000).toISOString();
    assert.notOk(backupReminderDue({ backupReminder: 'weekly', lastBackupAt: recent }).due);
  });
});

describe('ترقية مخطط IndexedDB', () => {
  const MIGRATION_DB = 'test-migration-db';

  afterEach(async () => {
    await closeDB();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(MIGRATION_DB);
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    });
  });

  it('يرقّي من الإصدار 1 إلى الإصدار الحالي دون فقد بيانات', async () => {
    // 1) افتح على الإصدار 1 واكتب سجلاً بشكل الإصدار القديم (بلا nameLower)
    const v1 = await openDB(1, MIGRATION_DB);
    assert.equal(v1.version, 1);
    assert.notOk(v1.objectStoreNames.contains(STORES.adjustmentReasons),
      'متجر أسباب التسوية غير موجود في الإصدار 1');

    await new Promise((resolve, reject) => {
      const transaction = v1.transaction(STORES.products, 'readwrite');
      transaction.objectStore(STORES.products).add({
        id: 'legacy-1',
        sku: 'LEGACY-1',
        name: 'منتج قديم',
        categoryId: 'c1',
        unit: 'قطعة',
        costMinor: 500,
        priceMinor: 900,
        taxRateBp: 1500,
        quantity: 7,
        lowStockThreshold: 2,
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    v1.close();

    // 2) افتح على الإصدار الحالي — تعمل الترقيات
    const v2 = await openDB(SCHEMA_VERSION, MIGRATION_DB);
    assert.equal(v2.version, SCHEMA_VERSION);

    assert.ok(v2.objectStoreNames.contains(STORES.adjustmentReasons),
      'الترقية يجب أن تنشئ متجر أسباب التسوية');

    const products = v2.transaction(STORES.products, 'readonly').objectStore(STORES.products);
    assert.ok(products.indexNames.contains('nameLower'), 'الترقية يجب أن تضيف فهرس nameLower');

    const payments = v2.transaction(STORES.payments, 'readonly').objectStore(STORES.payments);
    assert.ok(payments.indexNames.contains('dayKey'), 'الترقية يجب أن تضيف فهرس dayKey على المدفوعات');

    // 3) البيانات القديمة سليمة ومُرحَّلة
    const migrated = await req(
      v2.transaction(STORES.products, 'readonly').objectStore(STORES.products).get('legacy-1')
    );
    assert.ok(migrated, 'السجل القديم يجب أن يبقى');
    assert.equal(migrated.name, 'منتج قديم');
    assert.equal(migrated.quantity, 7);
    assert.equal(migrated.nameLower, 'منتج قديم', 'الترقية يجب أن تعبّئ nameLower للسجلات القديمة');

    v2.close();
  });

  it('يفتح قاعدة جديدة مباشرة على الإصدار الحالي', async () => {
    const db = await openDB(SCHEMA_VERSION, MIGRATION_DB);
    assert.equal(db.version, SCHEMA_VERSION);
    for (const store of Object.values(STORES)) {
      assert.ok(db.objectStoreNames.contains(store), `المتجر ${store} يجب أن يكون موجوداً`);
    }
    db.close();
  });
});
