/** مستودع الإعدادات — صفوف key/value مع ذاكرة مؤقتة في الذاكرة. */

import { tx, get, put, getAll } from '../db/db.js';
import { STORES, APP_VERSION, SCHEMA_VERSION } from '../db/schema.js';

export const DEFAULT_SETTINGS = {
  storeName: 'متجري',
  storePhone: '',
  storeEmail: '',
  storeAddress: '',
  storeCrNumber: '',
  storeTaxNumber: '',

  // الشيكل هو الإعداد الافتراضي للإصدار الحالي. كل المستندات تقرأ هذه القيم
  // من الإعدادات ولا تحتفظ برمز عملة ثابت داخلها.
  currencyCode: 'ILS',
  currencySymbol: '₪',
  currencyDecimalDigits: 2,
  currencySymbolPosition: 'after', // 'before' | 'after'
  dateFormat: 'YYYY-MM-DD',

  invoicePrefix: 'INV',
  invoiceIncludeYear: true,
  invoiceNextNumber: 1,
  invoiceFooter: 'شكراً لتعاملكم معنا',

  defaultTaxRateBp: 1500,      // 15%
  taxInclusive: false,
  allowDiscount: true,
  maxDiscountPercent: 100,

  printTemplate: 'a4',         // 'a4' | 'thermal80' | 'thermal58'
  printShowStoreLogo: true,
  printShowTaxNumber: true,
  printShowPayment: true,
  printShowPaidDue: true,
  printShowInvoiceBarcode: false,
  invoiceTitle: 'فاتورة مبيعات',
  invoiceFooterFontSize: 12,

  allowNegativeStock: false,
  lowStockDefault: 5,

  backupReminder: 'weekly',    // 'off' | 'daily' | 'weekly'
  lastBackupAt: null,
  storagePersisted: false,

  seeded: false,
  appVersion: APP_VERSION,
  schemaVersion: SCHEMA_VERSION,
};

let cache = null;

/** يقرأ كل الإعدادات مدمجة مع القيم الافتراضية */
export async function loadSettings({ force = false } = {}) {
  if (cache && !force) return cache;

  const rows = await tx(STORES.settings, 'readonly', (stores) => getAll(stores[STORES.settings]));
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  cache = { ...DEFAULT_SETTINGS, ...stored };
  return cache;
}

/** القيم المحمّلة حالياً (متزامن). يجب استدعاء loadSettings مرة عند الإقلاع. */
export function settings() {
  return cache || DEFAULT_SETTINGS;
}

/** يحفظ مجموعة إعدادات دفعة واحدة داخل معاملة واحدة */
export async function saveSettings(patch) {
  const entries = Object.entries(patch);
  await tx(STORES.settings, 'readwrite', async (stores) => {
    for (const [key, value] of entries) {
      await put(stores[STORES.settings], { key, value });
    }
  });
  cache = { ...(cache || DEFAULT_SETTINGS), ...patch };
  return cache;
}

export async function getSetting(key) {
  const row = await tx(STORES.settings, 'readonly', (stores) => get(stores[STORES.settings], key));
  return row ? row.value : DEFAULT_SETTINGS[key];
}

/** يقرأ إعداداً داخل معاملة قائمة (لا يفتح معاملة جديدة) */
export async function readSettingIn(store, key) {
  const row = await get(store, key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

/** يكتب إعداداً داخل معاملة قائمة */
export function writeSettingIn(store, key, value) {
  if (cache) cache[key] = value;
  return put(store, { key, value });
}

export function invalidateSettingsCache() {
  cache = null;
}

/** رمز العملة الحالي للعرض */
export function currency() {
  return settings().currencySymbol || '';
}

export function dateFormat() {
  return settings().dateFormat || 'YYYY-MM-DD';
}
