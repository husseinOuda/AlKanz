/**
 * يلتقط لقطات لكل شاشة للمقارنة البصرية مع الصور المرجعية في UI/.
 *
 *   node tools/screenshot.mjs [--mobile] [--out=مجلد]
 */

import { launch, serveStatic, sleep } from './browser.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8781;

const args = process.argv.slice(2);
const MOBILE = args.includes('--mobile');
const OUT = resolve(ROOT, args.find((a) => a.startsWith('--out='))?.slice(6) || 'screenshots');

const SCREENS = [
  ['01-dashboard', '#/dashboard'],
  ['02-pos', '#/pos'],
  ['03-products-list', '#/products'],
  ['04-product-form', '#/products/new'],
  ['05-inventory', '#/inventory'],
  ['06-invoices-list', '#/invoices'],
  ['08-customers', '#/customers'],
  ['09-expenses', '#/expenses'],
  ['10-reports', '#/reports'],
  ['11-backup-restore', '#/backup'],
  ['12-settings', '#/settings'],
];

const server = await serveStatic(ROOT, PORT);
const width = MOBILE ? 390 : 1680;
const height = MOBILE ? 844 : 941;
const browser = await launch({ headless: true, width, height });

mkdirSync(OUT, { recursive: true });

try {
  await browser.goto(`http://127.0.0.1:${PORT}/index.html#/dashboard`);
  await browser.waitFor("!!document.querySelector('.sidebar')", { label: 'تحميل الهيكل' });

  // تأكّد من وجود بيانات لتبدو اللقطات واقعية
  const seeded = await browser.evaluate(`(async () => {
    const { isEmptyDatabase, seedDemoData } = await import('/src/db/seed.js');
    if (await isEmptyDatabase()) { await seedDemoData(); return 'seeded'; }
    return 'already';
  })()`);
  console.log(`بيانات: ${seeded}`);

  for (const [name, hash] of SCREENS) {
    // امسح الـ hash أولاً حتى تُعاد الشاشة الحالية رسماً بالبيانات الجديدة
    await browser.evaluate("window.location.hash = '#/__reset'");
    await sleep(120);
    await browser.evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
    await sleep(1100);
    await browser.waitFor("!document.querySelector('.boot')", { label: name });

    // أخفِ الإشعارات المنبثقة حتى لا تحجب المحتوى في اللقطة
    await browser.evaluate("document.getElementById('toast-region').replaceChildren()");

    // افتح تفاصيل فاتورة حقيقية لالتقاط شاشة 07
    const file = join(OUT, `${name}${MOBILE ? '-mobile' : ''}.png`);
    await browser.screenshot(file, { fullPage: !MOBILE });
    console.log(`✓ ${name}`);
  }

  // شاشة تفاصيل الفاتورة تحتاج معرّفاً حقيقياً
  const saleId = await browser.evaluate(`(async () => {
    const { listSales } = await import('/src/repositories/sales.js');
    const sales = await listSales(1);
    return sales[0]?.id || null;
  })()`);

  if (saleId) {
    await browser.evaluate(`window.location.hash = '#/invoices/${saleId}'`);
    await sleep(900);
    await browser.screenshot(join(OUT, `07-invoice-detail${MOBILE ? '-mobile' : ''}.png`), { fullPage: !MOBILE });
    console.log('✓ 07-invoice-detail');
  }

  const errors = [...browser.pageErrors, ...browser.consoleMessages.filter((m) => m.type === 'error').map((m) => m.text)];
  if (errors.length > 0) {
    console.log(`\n⚠ ${errors.length} خطأ في الطرفية:`);
    for (const error of [...new Set(errors)].slice(0, 20)) console.log('  •', error);
  } else {
    console.log('\n✓ لا أخطاء في الطرفية');
  }

  console.log(`\nاللقطات في: ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
