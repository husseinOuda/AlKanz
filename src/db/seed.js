/**
 * بيانات أولية.
 *
 * `ensureBaseData` تعمل دائماً وتنشئ ما لا غنى عنه (فئات المصروفات، أسباب التسوية،
 * الإعدادات الافتراضية) حتى تبدأ الشاشات بقاعدة صالحة.
 * `seedDemoData` اختيارية بالكامل ولا تعمل إلا بطلب صريح من المستخدم.
 */

import { tx, add, getAll, put } from './db.js';
import { STORES } from './schema.js';
import { uid } from '../utils/id.js';
import { toISO, dayKey, addDays } from '../utils/dates.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../repositories/expenses.js';
import { DEFAULT_REASONS, MOVEMENT } from '../repositories/inventory.js';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../repositories/settings.js';

const PRODUCT_CATEGORIES = [
  { name: 'مشروبات', color: '#1B63E3', icon: 'coffee', sortOrder: 1 },
  { name: 'مواد غذائية', color: '#0E9C8A', icon: 'basket', sortOrder: 2 },
  { name: 'منظفات', color: '#7C5CE0', icon: 'spray', sortOrder: 3 },
  { name: 'ألبان', color: '#0EA5E9', icon: 'coffee', sortOrder: 4 },
  { name: 'معلبات', color: '#D97706', icon: 'package', sortOrder: 5 },
  { name: 'عناية شخصية', color: '#EC4899', icon: 'spray', sortOrder: 6 },
];

/** منتجات مأخوذة من الشاشات المرجعية — للتجربة فقط */
const DEMO_PRODUCTS = [
  ['SKU-1001', 'مياه معدنية 1.5 لتر', 'مشروبات', 'عبوة', 500, 800, 120, 24],
  ['SKU-1002', 'حليب كامل الدسم 1 لتر', 'ألبان', 'عبوة', 1800, 2400, 45, 15],
  ['SKU-1003', 'زيت عباد الشمس 1 لتر', 'مواد غذائية', 'عبوة', 2500, 3200, 37, 12],
  ['SKU-1004', 'سكر أبيض 1 كجم', 'مواد غذائية', 'كيس', 1400, 1800, 60, 20],
  ['SKU-1005', 'شاي ناعم 250 جم', 'مشروبات', 'علبة', 1900, 2500, 88, 25],
  ['SKU-1006', 'مكرونة 400 جم', 'مواد غذائية', 'كيس', 850, 1200, 75, 20],
  ['SKU-1007', 'أرز مصري 1 كجم', 'مواد غذائية', 'كيس', 2100, 2800, 8, 15],
  ['SKU-1008', 'صلصة طماطم 300 جم', 'معلبات', 'علبة', 1000, 1500, 52, 18],
  ['SKU-1009', 'سائل غسيل أطباق 750 مل', 'منظفات', 'عبوة', 1400, 2000, 34, 12],
  ['SKU-1010', 'مسحوق غسيل 2.5 كجم', 'منظفات', 'كيس', 4200, 5500, 6, 10],
  ['SKU-1011', 'شامبو 400 مل', 'عناية شخصية', 'عبوة', 2200, 3000, 41, 12],
  ['SKU-1012', 'معجون أسنان 100 مل', 'عناية شخصية', 'علبة', 1250, 1800, 66, 20],
  ['SKU-1013', 'مناديل تواليت 10 رول', 'منظفات', 'حزمة', 2600, 3500, 25, 10],
  ['SKU-1014', 'مطهر أرضيات 1 لتر', 'منظفات', 'عبوة', 1900, 2700, 29, 12],
  ['SKU-1015', 'بطاطس شيبس 60 جم', 'مواد غذائية', 'كيس', 650, 1000, 93, 30],
  ['SKU-1016', 'قهوة عربية 250 جم', 'مشروبات', 'علبة', 1800, 2500, 44, 15],
  ['SKU-1017', 'تمور سكري فاخر 1 كجم', 'مواد غذائية', 'علبة', 3400, 4500, 18, 10],
  ['SKU-1018', 'جبن شرائح 200 جم', 'ألبان', 'علبة', 1500, 2100, 0, 12],
];

const DEMO_CUSTOMERS = [
  ['أحمد محمد', '0555123456'],
  ['سالم عبدالله', '0501122334'],
  ['محمد الحربي', '0556677889'],
  ['ناصر العتيبي', '0509988776'],
  ['خالد السبيعي', '0553344556'],
  ['مؤسسة الهدى التجارية', '0112233445'],
  ['شركة النور للتجارة', '0113344556'],
];

/* ------------------------------------------------------------------ */

/** ينشئ البيانات المرجعية التي لا يعمل التطبيق بدونها */
export async function ensureBaseData() {
  await tx(
    [STORES.expenseCategories, STORES.adjustmentReasons, STORES.categories],
    'readwrite',
    async (stores) => {
      const existingExpenseCats = await getAll(stores[STORES.expenseCategories]);
      if (existingExpenseCats.length === 0) {
        for (const category of DEFAULT_EXPENSE_CATEGORIES) {
          await add(stores[STORES.expenseCategories], {
            id: uid('ecat'), ...category, createdAt: toISO(),
          });
        }
      }

      const existingReasons = await getAll(stores[STORES.adjustmentReasons]);
      if (existingReasons.length === 0) {
        for (const reason of DEFAULT_REASONS) {
          await add(stores[STORES.adjustmentReasons], {
            id: uid('rsn'), ...reason, isActive: true, createdAt: toISO(),
          });
        }
      }

      const existingCategories = await getAll(stores[STORES.categories]);
      if (existingCategories.length === 0) {
        for (const category of PRODUCT_CATEGORIES) {
          await add(stores[STORES.categories], { id: uid('cat'), ...category, createdAt: toISO() });
        }
      }
    }
  );

  // اكتب الإعدادات الافتراضية الناقصة مرة واحدة فقط
  const current = await loadSettings({ force: true });
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length > 0) await saveSettings(missing);
}

/** هل القاعدة فارغة من بيانات العمل؟ */
export async function isEmptyDatabase() {
  return tx([STORES.products, STORES.sales], 'readonly', async (stores) => {
    const products = await getAll(stores[STORES.products], null, 1);
    const sales = await getAll(stores[STORES.sales], null, 1);
    return products.length === 0 && sales.length === 0;
  });
}

/**
 * بيانات تجريبية اختيارية. تُستدعى بطلب المستخدم فقط.
 * تنشئ منتجات وعملاء ومصروفات ومبيعات موزّعة على آخر 7 أيام.
 */
export async function seedDemoData() {
  const categories = await tx(STORES.categories, 'readonly', (stores) => getAll(stores[STORES.categories]));
  const categoryByName = new Map(categories.map((category) => [category.name, category]));

  const expenseCategories = await tx(STORES.expenseCategories, 'readonly', (stores) =>
    getAll(stores[STORES.expenseCategories]));

  const settings = await loadSettings();
  const stamp = toISO();

  /* ---------------------------- المنتجات ---------------------------- */
  const products = DEMO_PRODUCTS.map(([sku, name, categoryName, unit, costMinor, priceMinor, quantity, lowStockThreshold]) => ({
    id: uid('prd'),
    sku,
    barcode: undefined,
    name,
    nameLower: name.toLowerCase(),
    categoryId: categoryByName.get(categoryName)?.id || categories[0].id,
    unit,
    costMinor,
    priceMinor,
    taxRateBp: settings.defaultTaxRateBp,
    quantity,
    lowStockThreshold,
    description: '',
    image: null,
    isActive: true,
    createdAt: stamp,
    updatedAt: stamp,
  }));

  await tx([STORES.products, STORES.inventoryMovements], 'readwrite', async (stores) => {
    for (const product of products) {
      await add(stores[STORES.products], product);
      if (product.quantity > 0) {
        await add(stores[STORES.inventoryMovements], {
          id: uid('mov'),
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          type: MOVEMENT.INITIAL,
          quantity: product.quantity,
          balanceAfter: product.quantity,
          reason: 'رصيد افتتاحي',
          note: 'بيانات تجريبية',
          refType: 'seed',
          refId: 'seed',
          actor: 'النظام',
          createdAt: stamp,
          dayKey: dayKey(new Date()),
        });
      }
    }
  });

  /* ----------------------------- العملاء ----------------------------- */
  const customers = DEMO_CUSTOMERS.map(([name, phone]) => ({
    id: uid('cus'), name, phone, note: '', isActive: true, createdAt: stamp, updatedAt: stamp,
  }));

  await tx(STORES.customers, 'readwrite', async (stores) => {
    for (const customer of customers) await add(stores[STORES.customers], customer);
  });

  /* ---------------------------- المصروفات ---------------------------- */
  const expenseSamples = [
    ['إيجار', 'إيجار المحل', 240000, 'bank', 0],
    ['رواتب', 'رواتب الموظفين', 150000, 'bank', 0],
    ['مشتريات', 'شراء بضاعة متنوعة', 45025, 'cash', 1],
    ['نقل ومواصلات', 'مصاريف نقل وتوصيل', 12000, 'cash', 2],
    ['مصروفات إدارية', 'مصاريف متنوعة', 4890, 'cash', 3],
    ['كهرباء وماء', 'فاتورة الكهرباء', 32000, 'bank', 4],
  ];

  await tx(STORES.expenses, 'readwrite', async (stores) => {
    for (const [categoryName, title, amountMinor, method, daysAgo] of expenseSamples) {
      const date = addDays(new Date(), -daysAgo);
      const category = expenseCategories.find((c) => c.name === categoryName) || expenseCategories[0];
      await add(stores[STORES.expenses], {
        id: uid('exp'),
        dayKey: dayKey(date),
        categoryId: category.id,
        title,
        amountMinor,
        method,
        reference: '',
        note: '',
        attachment: null,
        createdAt: toISO(date),
        updatedAt: toISO(date),
      });
    }
  });

  /* ----------------------------- المبيعات ----------------------------- */
  // مبيعات موزّعة على آخر 7 أيام، تُخصم من المخزون بحركات حقيقية
  const stock = new Map(products.map((product) => [product.id, product.quantity]));
  let sequence = Number(settings.invoiceNextNumber) || 1;
  const salesCreated = [];

  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const date = addDays(new Date(), -daysAgo);
    const invoiceCount = 2 + ((daysAgo * 3) % 4); // 2..5 فواتير في اليوم

    for (let n = 0; n < invoiceCount; n += 1) {
      const lineCount = 1 + ((daysAgo + n) % 3);
      const lines = [];

      for (let l = 0; l < lineCount; l += 1) {
        const product = products[(daysAgo * 5 + n * 3 + l * 7) % products.length];
        const available = stock.get(product.id) || 0;
        const quantity = Math.min(1 + ((n + l) % 3), available);
        if (quantity <= 0) continue;
        if (lines.some((line) => line.productId === product.id)) continue;
        stock.set(product.id, available - quantity);
        lines.push({ product, quantity });
      }
      if (lines.length === 0) continue;

      const isCredit = n % 4 === 3;
      const customer = isCredit ? customers[(daysAgo + n) % customers.length] : null;

      const subtotalMinor = lines.reduce((sum, line) => sum + line.product.priceMinor * line.quantity, 0);
      // الخصم لا يتجاوز المجموع الفرعي أبداً — وإلا نتج إجمالي سالب
      const discountMinor = n % 5 === 0 ? Math.min(1000, subtotalMinor) : 0;
      const net = subtotalMinor - discountMinor;
      const taxMinor = Math.round((net * settings.defaultTaxRateBp) / 10000);
      const totalMinor = net + taxMinor;
      const paidMinor = isCredit ? 0 : totalMinor;

      const saleId = uid('sal');
      const createdAt = toISO(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9 + n, 15 * (n % 4)));

      salesCreated.push({
        sale: {
          id: saleId,
          number: `${settings.invoicePrefix}-${date.getFullYear()}-${String(sequence).padStart(5, '0')}`,
          status: 'completed',
          paymentType: isCredit ? 'credit' : 'cash',
          customerId: customer?.id || null,
          customerName: customer?.name || 'عميل نقدي',
          subtotalMinor,
          discountType: 'amount',
          discountValue: discountMinor,
          discountMinor,
          taxRateBp: settings.defaultTaxRateBp,
          taxInclusive: false,
          taxMinor,
          totalMinor,
          paidMinor,
          dueMinor: totalMinor - paidMinor,
          itemCount: lines.length,
          unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
          costMinor: lines.reduce((sum, line) => sum + line.product.costMinor * line.quantity, 0),
          note: '',
          createdAt,
          updatedAt: createdAt,
          dayKey: dayKey(date),
          cancelledAt: null,
          cancelReason: null,
        },
        lines,
        createdAt,
      });
      sequence += 1;
    }
  }

  await tx(
    [STORES.sales, STORES.saleItems, STORES.products, STORES.inventoryMovements],
    'readwrite',
    async (stores) => {
      for (const { sale, lines, createdAt } of salesCreated) {
        await add(stores[STORES.sales], sale);

        for (const { product, quantity } of lines) {
          await add(stores[STORES.saleItems], {
            id: uid('sit'),
            saleId: sale.id,
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unit: product.unit,
            quantity,
            unitPriceMinor: product.priceMinor,
            unitCostMinor: product.costMinor,
            lineDiscountMinor: 0,
            lineTotalMinor: product.priceMinor * quantity,
            dayKey: sale.dayKey,
            createdAt,
          });

          await add(stores[STORES.inventoryMovements], {
            id: uid('mov'),
            productId: product.id,
            sku: product.sku,
            productName: product.name,
            type: MOVEMENT.SALE,
            quantity: -quantity,
            balanceAfter: 0, // يُصحَّح بعد قليل من الرصيد النهائي
            reason: 'بيع',
            note: `فاتورة ${sale.number}`,
            refType: 'sale',
            refId: sale.id,
            actor: 'النظام',
            createdAt,
            dayKey: sale.dayKey,
          });
        }
      }

      // اضبط الكميات النهائية على ما تبقّى بعد كل المبيعات
      for (const product of products) {
        await put(stores[STORES.products], { ...product, quantity: stock.get(product.id) ?? product.quantity });
      }
    }
  );

  await saveSettings({ invoiceNextNumber: sequence, seeded: true });

  return {
    products: products.length,
    customers: customers.length,
    sales: salesCreated.length,
    expenses: expenseSamples.length,
  };
}
