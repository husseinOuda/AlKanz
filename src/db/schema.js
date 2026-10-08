/**
 * مخطط IndexedDB وترقياته.
 *
 * قاعدة الترقية: كل إصدار دالة واحدة تنتقل من (الإصدار−1) إلى الإصدار.
 * الدوال تعمل داخل معاملة `versionchange` التي يوفّرها المتصفح، فلا يجوز
 * داخلها انتظار أي وعد غير مرتبط بطلب IndexedDB (وإلا التزمت المعاملة تلقائياً).
 */

export const DB_NAME = 'sales-system';
export const SCHEMA_VERSION = 5;
export const APP_VERSION = '1.0.0';

export const STORES = {
  products: 'products',
  categories: 'categories',
  customers: 'customers',
  sales: 'sales',
  saleItems: 'saleItems',
  payments: 'payments',
  expenses: 'expenses',
  expenseCategories: 'expenseCategories',
  inventoryMovements: 'inventoryMovements',
  suspendedSales: 'suspendedSales',
  settings: 'settings',
  backupRecords: 'backupRecords',
  adjustmentReasons: 'adjustmentReasons',
  returns: 'returns',
  returnItems: 'returnItems',
  shifts: 'shifts',
  suppliers: 'suppliers',
  purchases: 'purchases',
  purchaseItems: 'purchaseItems',
  purchasePayments: 'purchasePayments',
  purchaseOrders: 'purchaseOrders',
};

/** كل المتاجر التي تدخل في النسخ الاحتياطي والاستعادة */
export const BACKUP_STORES = Object.values(STORES);

const migrations = {
  /** الإصدار 1: البنية الأساسية */
  1(db) {
    const products = db.createObjectStore(STORES.products, { keyPath: 'id' });
    products.createIndex('sku', 'sku', { unique: true });
    products.createIndex('barcode', 'barcode', { unique: true });
    products.createIndex('categoryId', 'categoryId');
    products.createIndex('name', 'name');
    products.createIndex('createdAt', 'createdAt');

    const categories = db.createObjectStore(STORES.categories, { keyPath: 'id' });
    categories.createIndex('name', 'name', { unique: true });
    categories.createIndex('sortOrder', 'sortOrder');

    const customers = db.createObjectStore(STORES.customers, { keyPath: 'id' });
    customers.createIndex('name', 'name');
    customers.createIndex('phone', 'phone');
    customers.createIndex('createdAt', 'createdAt');

    const sales = db.createObjectStore(STORES.sales, { keyPath: 'id' });
    sales.createIndex('number', 'number', { unique: true });
    sales.createIndex('dayKey', 'dayKey');
    sales.createIndex('customerId', 'customerId');
    sales.createIndex('status', 'status');
    sales.createIndex('createdAt', 'createdAt');

    const saleItems = db.createObjectStore(STORES.saleItems, { keyPath: 'id' });
    saleItems.createIndex('saleId', 'saleId');
    saleItems.createIndex('productId', 'productId');
    saleItems.createIndex('dayKey', 'dayKey');

    const payments = db.createObjectStore(STORES.payments, { keyPath: 'id' });
    payments.createIndex('customerId', 'customerId');
    payments.createIndex('saleId', 'saleId');
    payments.createIndex('createdAt', 'createdAt');

    const expenses = db.createObjectStore(STORES.expenses, { keyPath: 'id' });
    expenses.createIndex('dayKey', 'dayKey');
    expenses.createIndex('categoryId', 'categoryId');
    expenses.createIndex('createdAt', 'createdAt');

    const expenseCategories = db.createObjectStore(STORES.expenseCategories, { keyPath: 'id' });
    expenseCategories.createIndex('name', 'name', { unique: true });

    const movements = db.createObjectStore(STORES.inventoryMovements, { keyPath: 'id' });
    movements.createIndex('productId', 'productId');
    movements.createIndex('createdAt', 'createdAt');
    movements.createIndex('dayKey', 'dayKey');
    movements.createIndex('type', 'type');
    movements.createIndex('refId', 'refId');

    const suspended = db.createObjectStore(STORES.suspendedSales, { keyPath: 'id' });
    suspended.createIndex('createdAt', 'createdAt');

    db.createObjectStore(STORES.settings, { keyPath: 'key' });

    const backups = db.createObjectStore(STORES.backupRecords, { keyPath: 'id' });
    backups.createIndex('createdAt', 'createdAt');
  },

  /**
   * الإصدار 2:
   *  - متجر أسباب التسوية (نمط Zoho: أسباب مُدارة لا نص حر)
   *  - فهرس dayKey على المدفوعات لتقارير الفترة
   *  - حقل nameLower على المنتجات لبحث غير حسّاس لحالة الأحرف
   */
  2(db, transaction) {
    if (!db.objectStoreNames.contains(STORES.adjustmentReasons)) {
      const reasons = db.createObjectStore(STORES.adjustmentReasons, { keyPath: 'id' });
      reasons.createIndex('name', 'name', { unique: true });
    }

    const payments = transaction.objectStore(STORES.payments);
    if (!payments.indexNames.contains('dayKey')) {
      payments.createIndex('dayKey', 'dayKey');
    }

    const products = transaction.objectStore(STORES.products);
    if (!products.indexNames.contains('nameLower')) {
      products.createIndex('nameLower', 'nameLower');
    }

    // ترحيل البيانات القائمة: تعبئة nameLower للسجلات القديمة
    products.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) return;
      const value = cursor.value;
      if (value.nameLower == null) {
        value.nameLower = String(value.name || '').toLowerCase();
        cursor.update(value);
      }
      cursor.continue();
    };
  },

  /** الإصدار 3: المرتجعات مرتبطة بالفاتورة والسطور الأصلية ولا تعدّلها. */
  3(db) {
    const returns = db.createObjectStore(STORES.returns, { keyPath: 'id' });
    returns.createIndex('saleId', 'saleId');
    returns.createIndex('dayKey', 'dayKey');
    returns.createIndex('createdAt', 'createdAt');
    const returnItems = db.createObjectStore(STORES.returnItems, { keyPath: 'id' });
    returnItems.createIndex('returnId', 'returnId');
    returnItems.createIndex('saleItemId', 'saleItemId');
    returnItems.createIndex('saleId', 'saleId');
  },
  4(db) {
    const shifts = db.createObjectStore(STORES.shifts, { keyPath: 'id' });
    shifts.createIndex('status', 'status');
    shifts.createIndex('openedAt', 'openedAt');
    shifts.createIndex('dayKey', 'dayKey');
  },
  /** الإصدار 5: الموردون وأوامر الشراء والفواتير والمدفوعات */
  5(db) {
    const suppliers = db.createObjectStore(STORES.suppliers, { keyPath: 'id' });
    suppliers.createIndex('name', 'name'); suppliers.createIndex('phone', 'phone');
    const purchases = db.createObjectStore(STORES.purchases, { keyPath: 'id' });
    purchases.createIndex('number', 'number', { unique: true }); purchases.createIndex('supplierId', 'supplierId'); purchases.createIndex('dayKey', 'dayKey'); purchases.createIndex('status', 'status');
    const items = db.createObjectStore(STORES.purchaseItems, { keyPath: 'id' });
    items.createIndex('purchaseId', 'purchaseId'); items.createIndex('productId', 'productId');
    const payments = db.createObjectStore(STORES.purchasePayments, { keyPath: 'id' });
    payments.createIndex('supplierId', 'supplierId'); payments.createIndex('purchaseId', 'purchaseId'); payments.createIndex('createdAt', 'createdAt'); payments.createIndex('dayKey', 'dayKey');
    const orders = db.createObjectStore(STORES.purchaseOrders, { keyPath: 'id' });
    orders.createIndex('supplierId', 'supplierId'); orders.createIndex('status', 'status'); orders.createIndex('createdAt', 'createdAt');
  },
};

/** يشغّل كل الترقيات اللازمة من oldVersion إلى newVersion */
export function runMigrations(db, transaction, oldVersion, newVersion) {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`لا توجد ترقية معرّفة للإصدار ${version}`);
    migrate(db, transaction);
  }
}

export const MIGRATION_VERSIONS = Object.keys(migrations).map(Number).sort((a, b) => a - b);
