/**
 * يشغّل مجموعة الاختبارات بلا واجهة، ثم فحوصاً شاملة من طرف إلى طرف
 * (الموجّه، البقاء بعد التحديث، العمل دون شبكة، الطباعة، الاستجابة).
 *
 *   node tools/run-tests.mjs [--headed] [--unit-only]
 */

import { launch, serveStatic, sleep } from './browser.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;

const args = process.argv.slice(2);
const HEADED = args.includes('--headed');
const UNIT_ONLY = args.includes('--unit-only');

const server = await serveStatic(ROOT, PORT);
const browser = await launch({ headless: !HEADED });

let exitCode = 0;
const e2e = { passed: 0, failed: 0, failures: [] };

async function check(name, fn) {
  try {
    await fn();
    e2e.passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    e2e.failed += 1;
    e2e.failures.push({ name, error: error.message });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  /* ------------------------ 1) اختبارات الوحدة والتكامل ------------------------ */

  console.log('\n=== اختبارات الوحدة والتكامل (IndexedDB حقيقي) ===\n');

  await browser.goto(`http://127.0.0.1:${PORT}/tests/index.html`);
  await browser.waitFor('!!window.__TEST_RESULTS__', { timeout: 180_000, label: 'اكتمال الاختبارات' });

  const report = await browser.evaluate('window.__TEST_RESULTS__');

  for (const suite of report.suites) {
    const failed = suite.tests.filter((test) => !test.ok).length;
    const mark = failed === 0 ? '✓' : '✗';
    console.log(`${mark} ${suite.name} (${suite.tests.length - failed}/${suite.tests.length})`);
    for (const test of suite.tests) {
      if (!test.ok) console.log(`    ✗ ${test.name}\n      ${test.error}`);
    }
  }

  console.log(`\nالنتيجة: ${report.passed}/${report.total} نجح، ${report.failed} فشل — ${Math.round(report.durationMs)}ms`);
  if (report.failed > 0) exitCode = 1;

  if (UNIT_ONLY) process.exit(exitCode);

  /* --------------------------- 2) فحوص من طرف إلى طرف --------------------------- */

  console.log('\n=== فحوص من طرف إلى طرف ===\n');

  const appUrl = `http://127.0.0.1:${PORT}/index.html`;
  await browser.goto(`${appUrl}#/dashboard`);
  await browser.waitFor("!!document.querySelector('.sidebar')", { label: 'الهيكل' });

  await browser.evaluate(`(async () => {
    const seed = await import('/src/db/seed.js');
    if (await seed.isEmptyDatabase()) await seed.seedDemoData();
  })()`);
  await browser.evaluate("window.location.hash = '#/dashboard'");
  await sleep(700);
  browser.clearLogs();

  await check('الاتجاه RTL واللغة العربية معلنان', async () => {
    const doc = await browser.evaluate(`({
      dir: document.documentElement.dir, lang: document.documentElement.lang,
    })`);
    assert(doc.dir === 'rtl', `dir = ${doc.dir}`);
    assert(doc.lang === 'ar', `lang = ${doc.lang}`);
  });

  await check('مسارات Hash Router تعمل لكل الشاشات', async () => {
    const routes = ['/pos', '/products', '/inventory', '/invoices', '/customers', '/expenses', '/reports', '/backup', '/settings'];
    for (const route of routes) {
      await browser.evaluate(`window.location.hash = '#${route}'`);
      await sleep(450);
      const active = await browser.evaluate(
        `document.querySelector('.nav__item[aria-current="page"]')?.getAttribute('href')`
      );
      assert(active === `#${route}`, `${route}: العنصر النشط = ${active}`);
    }
  });

  await check('التنقّل Back/Forward يعيد الشاشة الصحيحة', async () => {
    await browser.evaluate("window.location.hash = '#/products'");
    await sleep(400);
    await browser.evaluate("window.location.hash = '#/customers'");
    await sleep(400);

    await browser.session.send('Page.navigateToHistoryEntry', await historyEntry(-1));
    await sleep(600);
    let hash = await browser.evaluate('window.location.hash');
    assert(hash === '#/products', `بعد Back: ${hash}`);

    await browser.session.send('Page.navigateToHistoryEntry', await historyEntry(1));
    await sleep(600);
    hash = await browser.evaluate('window.location.hash');
    assert(hash === '#/customers', `بعد Forward: ${hash}`);

    const title = await browser.evaluate(`document.querySelector('.topbar__title')?.textContent`);
    assert(title === 'العملاء', `العنوان بعد Forward: ${title}`);
  });

  await check('مسار غير معروف يعرض شاشة "غير موجودة"', async () => {
    await browser.evaluate("window.location.hash = '#/لا-يوجد-هذا'");
    await sleep(500);
    const text = await browser.evaluate(`document.querySelector('.empty__title')?.textContent || ''`);
    assert(text.includes('غير موجودة'), `النص: ${text}`);
  });

  await check('الرابط المباشر لفاتورة يعمل بعد إعادة التحميل', async () => {
    const saleId = await browser.evaluate(`(async () => {
      const { listSales } = await import('/src/repositories/sales.js');
      return (await listSales(1))[0]?.id || null;
    })()`);
    assert(saleId, 'لا توجد فواتير');

    await browser.goto(`${appUrl}#/invoices/${saleId}`);
    await browser.waitFor("!!document.querySelector('.invoice-hero__num')", { label: 'تفاصيل الفاتورة' });
    const number = await browser.evaluate(`document.querySelector('.invoice-hero__num')?.textContent`);
    assert(/INV-/.test(number), `رقم الفاتورة: ${number}`);
  });

  await check('البيانات تبقى بعد إعادة تحميل الصفحة', async () => {
    const before = await browser.evaluate(`(async () => {
      const { listProducts } = await import('/src/repositories/products.js');
      return (await listProducts()).length;
    })()`);
    assert(before > 0, 'لا توجد منتجات قبل إعادة التحميل');

    await browser.goto(`${appUrl}#/products`);
    await browser.waitFor("!!document.querySelector('.table')", { label: 'جدول المنتجات' });

    const after = await browser.evaluate(`(async () => {
      const { listProducts } = await import('/src/repositories/products.js');
      return (await listProducts()).length;
    })()`);
    assert(after === before, `قبل ${before} وبعد ${after}`);
  });

  await check('بيع كامل من نقطة البيع يخفض المخزون وينشئ فاتورة', async () => {
    const result = await browser.evaluate(`(async () => {
      const { listProducts, getProduct } = await import('/src/repositories/products.js');
      const { completeSale, listSales } = await import('/src/repositories/sales.js');

      const products = await listProducts();
      const target = products.find((p) => p.quantity > 5);
      const before = target.quantity;
      const salesBefore = (await listSales(9999)).length;

      const { sale } = await completeSale({ lines: [{ productId: target.id, quantity: 2 }] });
      const after = (await getProduct(target.id)).quantity;
      const salesAfter = (await listSales(9999)).length;

      return { before, after, salesBefore, salesAfter, number: sale.number, id: sale.id };
    })()`);

    assert(result.after === result.before - 2, `المخزون: ${result.before} → ${result.after}`);
    assert(result.salesAfter === result.salesBefore + 1, 'يجب إنشاء فاتورة واحدة');
    assert(/^INV-\d{4}-\d{5}$/.test(result.number), `شكل الرقم: ${result.number}`);
  });

  await check('الطباعة A4 تبني مستنداً كاملاً', async () => {
    const result = await browser.evaluate(`(async () => {
      const { getSaleWithItems, listSales } = await import('/src/repositories/sales.js');
      const { printInvoice } = await import('/src/services/print.js');
      const { loadSettings } = await import('/src/repositories/settings.js');
      await loadSettings({ force: true });

      const sale = (await listSales(1))[0];
      const data = await getSaleWithItems(sale.id);

      // نبني المستند دون فتح مربع الطباعة
      const originalPrint = window.print;
      window.print = () => {};
      printInvoice(data.sale, data.items, 'a4');
      await new Promise((r) => requestAnimationFrame(r));

      const region = document.getElementById('print-region');
      const out = {
        template: region.dataset.template,
        hasDoc: !!region.querySelector('.pr--a4'),
        rows: region.querySelectorAll('.pr__table tbody tr').length,
        hasTotals: !!region.querySelector('.pr-row--strong'),
        text: region.textContent.slice(0, 200),
      };
      window.print = originalPrint;
      return out;
    })()`);

    assert(result.template === 'a4', `القالب: ${result.template}`);
    assert(result.hasDoc, 'لم يُبنَ مستند A4');
    assert(result.rows > 0, 'جدول الأصناف فارغ');
    assert(result.hasTotals, 'كتلة المجاميع مفقودة');
  });

  await check('الطباعة الحرارية 80mm تبني إيصالاً وتبدّل حجم الصفحة', async () => {
    const result = await browser.evaluate(`(async () => {
      const { getSaleWithItems, listSales } = await import('/src/repositories/sales.js');
      const { printInvoice } = await import('/src/services/print.js');

      const sale = (await listSales(1))[0];
      const data = await getSaleWithItems(sale.id);

      const originalPrint = window.print;
      window.print = () => {};
      printInvoice(data.sale, data.items, 'thermal80');
      await new Promise((r) => requestAnimationFrame(r));

      const region = document.getElementById('print-region');
      const sheet = document.getElementById('print-thermal-css');
      const out = {
        template: region.dataset.template,
        hasReceipt: !!region.querySelector('.pr--thermal'),
        items: region.querySelectorAll('.pr__item').length,
        sheetMedia: sheet?.media,
      };
      window.print = originalPrint;
      return out;
    })()`);

    assert(result.hasReceipt, 'لم يُبنَ إيصال حراري');
    assert(result.items > 0, 'لا أصناف في الإيصال');
    assert(result.sheetMedia === 'print', `media ورقة الحراري: ${result.sheetMedia}`);
  });

  await check('تصدير Excel ينتج ملفاً صالحاً قابلاً للقراءة', async () => {
    const result = await browser.evaluate(`(async () => {
      const { writeXlsx, readXlsx } = await import('/src/utils/xlsx.js');
      const { listProducts } = await import('/src/repositories/products.js');

      const products = await listProducts();
      const rows = [['SKU', 'الاسم', 'السعر'], ...products.slice(0, 5).map((p) => [p.sku, p.name, p.priceMinor / 100])];

      const blob = await writeXlsx(rows, { sheetName: 'منتجات' });
      const parsed = await readXlsx(blob);
      return { size: blob.size, rows: parsed.length, first: parsed[1], header: parsed[0] };
    })()`);

    assert(result.size > 500, `حجم الملف: ${result.size}`);
    assert(result.rows >= 2, `عدد الصفوف: ${result.rows}`);
    assert(result.header[0] === 'SKU', `الرأس: ${result.header}`);
  });

  await check('دورة نسخ احتياطي واستعادة كاملة', async () => {
    const result = await browser.evaluate(`(async () => {
      const { buildBackupPayload, inspectBackupFile, restoreBackup } = await import('/src/services/backup.js');
      const { listProducts, createProduct } = await import('/src/repositories/products.js');
      const { listCategories } = await import('/src/repositories/products.js');

      const payload = await buildBackupPayload();
      const countBefore = (await listProducts()).length;

      const categories = await listCategories();
      await createProduct({
        name: 'منتج مؤقت للاختبار', nameLower: 'مؤقت', sku: 'E2E-TEMP-1',
        categoryId: categories[0].id, unit: 'قطعة', costMinor: 100, priceMinor: 200,
        taxRateBp: 1500, quantity: 1, lowStockThreshold: 0, description: '', image: null, isActive: true,
      });
      const countAfterAdd = (await listProducts()).length;

      const file = new File([JSON.stringify(payload)], 'e2e-backup.json', { type: 'application/json' });
      const inspection = await inspectBackupFile(file);
      if (!inspection.ok) return { error: inspection.errors.join(' | ') };

      await restoreBackup(inspection.payload, { autoBackup: false });
      const countAfterRestore = (await listProducts()).length;
      const tempStillThere = (await listProducts()).some((p) => p.sku === 'E2E-TEMP-1');

      return { countBefore, countAfterAdd, countAfterRestore, tempStillThere };
    })()`);

    assert(!result.error, `فشل الفحص: ${result.error}`);
    assert(result.countAfterAdd === result.countBefore + 1, 'لم يُضف المنتج المؤقت');
    assert(result.countAfterRestore === result.countBefore, `بعد الاستعادة: ${result.countAfterRestore} بدل ${result.countBefore}`);
    assert(!result.tempStillThere, 'الاستعادة يجب أن تزيل المنتج المضاف بعد النسخة');
  });

  await check('نسخة تالفة تُرفض دون المساس بالبيانات', async () => {
    const result = await browser.evaluate(`(async () => {
      const { inspectBackupFile } = await import('/src/services/backup.js');
      const { listProducts } = await import('/src/repositories/products.js');

      const before = (await listProducts()).length;
      const corrupt = new File(['{ ليس json صالحاً'], 'bad.json', { type: 'application/json' });
      const inspection = await inspectBackupFile(corrupt);
      const after = (await listProducts()).length;

      return { ok: inspection.ok, errors: inspection.errors, before, after };
    })()`);

    assert(result.ok === false, 'كان يجب رفض الملف التالف');
    assert(result.before === result.after, 'عدد المنتجات تغيّر رغم رفض الملف');
  });

  await check('العمل دون شبكة بعد أول زيارة (Service Worker)', async () => {
    // انتظر تفعيل Service Worker
    await browser.goto(`${appUrl}#/dashboard`);
    await browser.waitFor(
      "navigator.serviceWorker && navigator.serviceWorker.controller !== null",
      { timeout: 25_000, label: 'تفعيل Service Worker' }
    );

    // اقطع الشبكة تماماً
    await browser.session.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });

    await browser.goto(`${appUrl}#/products`);
    await browser.waitFor("!!document.querySelector('.sidebar')", { timeout: 20_000, label: 'الهيكل دون شبكة' });
    await sleep(1200);

    const state = await browser.evaluate(`({
      online: navigator.onLine,
      hasSidebar: !!document.querySelector('.sidebar'),
      hasTable: !!document.querySelector('.table'),
      products: document.querySelectorAll('.table tbody tr').length,
    })`);

    // أعد الشبكة قبل أي تأكيد قد يفشل
    await browser.session.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });

    assert(state.online === false, 'المتصفح لم يدخل وضع عدم الاتصال');
    assert(state.hasSidebar, 'الهيكل لم يُحمَّل دون شبكة');
    assert(state.hasTable, 'الجدول لم يُرسم دون شبكة');
    assert(state.products > 0, 'البيانات المحلية لم تُقرأ دون شبكة');
  });

  await check('لا تمرير أفقي على كل الشاشات في وضع سطح المكتب', async () => {
    await browser.setViewport(1680, 941, false);
    const routes = ['/dashboard', '/pos', '/products', '/products/new', '/inventory',
      '/invoices', '/customers', '/expenses', '/reports', '/backup', '/settings'];
    const overflowing = [];

    for (const route of routes) {
      await browser.evaluate("window.location.hash = '#/__reset'");
      await sleep(120);
      await browser.evaluate(`window.location.hash = '#${route}'`);
      await sleep(650);
      const overflow = await browser.evaluate('document.documentElement.scrollWidth - window.innerWidth');
      if (overflow > 2) overflowing.push(`${route} (+${overflow}px)`);
    }
    assert(overflowing.length === 0, `تمرير أفقي في: ${overflowing.join(', ')}`);
  });

  await check('الاستجابة: تخطيط الهاتف يظهر شريط التنقل السفلي', async () => {
    await browser.setViewport(390, 844, true);
    await browser.goto(`${appUrl}#/pos`);
    await sleep(1000);

    const layout = await browser.evaluate(`(() => {
      const tabbar = document.querySelector('.tabbar');
      const sidebar = document.querySelector('.sidebar');
      const styles = tabbar ? getComputedStyle(tabbar) : null;
      const cards = document.querySelectorAll('.product-card');
      return {
        tabbarVisible: styles ? styles.display !== 'none' : false,
        sidebarHidden: sidebar ? getComputedStyle(sidebar).transform !== 'none' : false,
        bodyOverflow: document.documentElement.scrollWidth <= window.innerWidth + 2,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        productCards: cards.length,
      };
    })()`);

    assert(layout.tabbarVisible, 'شريط التنقل السفلي غير ظاهر على الهاتف');
    assert(layout.sidebarHidden, 'الشريط الجانبي يجب أن ينزلق خارج الشاشة');
    assert(layout.bodyOverflow, `تمرير أفقي: ${layout.scrollWidth} > ${layout.innerWidth}`);
  });

  await check('أهداف اللمس على الهاتف ≥ 44px', async () => {
    const small = await browser.evaluate(`(() => {
      const selectors = ['.icon-btn', '.tabbar__item', '.btn', '.chip', '.pager__btn'];
      const bad = [];
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          if (rect.height < 44 - 0.5) bad.push(selector + ' h=' + Math.round(rect.height));
        }
      }
      return [...new Set(bad)];
    })()`);
    assert(small.length === 0, `عناصر أصغر من 44px: ${small.join(', ')}`);
  });

  await check('لا تمرير أفقي على كل الشاشات في وضع الهاتف', async () => {
    const routes = ['/dashboard', '/products', '/inventory', '/invoices', '/customers', '/expenses', '/reports', '/backup', '/settings'];
    const overflowing = [];
    for (const route of routes) {
      await browser.evaluate(`window.location.hash = '#${route}'`);
      await sleep(500);
      const overflow = await browser.evaluate(
        'document.documentElement.scrollWidth - window.innerWidth'
      );
      if (overflow > 2) overflowing.push(`${route} (+${overflow}px)`);
    }
    assert(overflowing.length === 0, `تمرير أفقي في: ${overflowing.join(', ')}`);
  });

  await check('التباين ووسوم الوصولية الأساسية موجودة', async () => {
    await browser.setViewport(1680, 941, false);
    await browser.goto(`${appUrl}#/products`);
    await sleep(900);

    const a11y = await browser.evaluate(`(() => {
      const issues = [];

      // كل زر أيقوني له اسم يمكن قراءته
      for (const el of document.querySelectorAll('button')) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
        if (!label) issues.push('زر بلا اسم: ' + el.className);
      }
      // كل صورة لها بديل
      for (const img of document.querySelectorAll('img')) {
        if (img.alt === null) issues.push('صورة بلا alt');
      }
      // كل حقل له تسمية مرتبطة
      for (const input of document.querySelectorAll('input, select, textarea')) {
        const id = input.id;
        const hasLabel = (id && document.querySelector('label[for="' + id + '"]'))
          || input.getAttribute('aria-label')
          || input.closest('label');
        if (!hasLabel) issues.push('حقل بلا تسمية: ' + (input.name || input.type));
      }
      return [...new Set(issues)].slice(0, 10);
    })()`);

    assert(a11y.length === 0, `مشاكل وصولية: ${a11y.join(' | ')}`);
  });

  /* --------------------- 3) وضع الملف المحلي (file://) --------------------- */

  await check('الحزمة app.bundle.js محدّثة مقابل المصدر', async () => {
    const { execFileSync } = await import('node:child_process');
    try {
      execFileSync(process.execPath, [resolve(ROOT, 'tools/build.mjs'), '--check'], { stdio: 'pipe' });
    } catch (error) {
      throw new Error('الحزمة قديمة. شغّل: node tools/build.mjs');
    }
  });

  await check('التطبيق يقلع ويعمل بالكامل من file:// مباشرة', async () => {
    const { pathToFileURL } = await import('node:url');
    const fileUrl = pathToFileURL(resolve(ROOT, 'index.html')).href;

    await browser.setViewport(1680, 941, false);
    browser.clearLogs();
    await browser.goto(fileUrl);
    await browser.waitFor("!!document.querySelector('.sidebar')", { timeout: 20_000, label: 'الهيكل من file://' });

    const boot = await browser.evaluate(`({
      proto: location.protocol,
      booted: !!window.__APP_BOOTED__,
      fileMode: !!window.__RUN_FROM_FILE__,
      nav: document.querySelectorAll('.nav__item').length,
    })`);
    assert(boot.proto === 'file:', `البروتوكول: ${boot.proto}`);
    assert(boot.booted, 'التطبيق لم يقلع من file://');
    assert(boot.fileMode, 'لم يُفعَّل وضع الملف المحلي');
    assert(boot.nav === 10, `عناصر التنقل: ${boot.nav}`);

    const clickText = (selector, text) => browser.evaluate(
      `[...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((el) => el.textContent.includes(${JSON.stringify(text)}))?.click()`
    );

    // بيانات تجريبية عبر الواجهة الحقيقية
    await clickText('.main button', 'إضافة بيانات تجريبية');
    await sleep(900);
    await clickText('#modal-region button', 'إضافة البيانات');
    await browser.waitFor("document.querySelectorAll('.kpi__value').length > 0",
      { timeout: 40_000, label: 'إنشاء البيانات التجريبية من file://' });

    // بيع كامل بالنقر
    await browser.evaluate("window.location.hash = '#/pos'");
    await sleep(1500);
    await browser.evaluate("document.querySelector('.product-card:not([disabled])').click()");
    await sleep(600);
    const cartRows = await browser.evaluate("document.querySelectorAll('.cart__items tbody tr').length");
    assert(cartRows === 1, `سطور العربة: ${cartRows}`);

    await clickText('.cart__actions button', 'إتمام البيع');
    await sleep(900);
    await clickText('#modal-region button', 'تأكيد وإتمام البيع');
    await sleep(1600);
    const receipt = await browser.evaluate("document.querySelector('#modal-region')?.textContent || ''");
    assert(/INV-\d{4}-\d{5}/.test(receipt), `لم تُنشأ فاتورة: ${receipt.slice(0, 60)}`);
    await clickText('#modal-region button', 'بيع جديد');
    await sleep(400);

    // البيانات تبقى بعد إعادة التحميل
    await browser.goto(fileUrl);
    await browser.waitFor("!!document.querySelector('.sidebar')", { timeout: 20_000 });
    await browser.evaluate("window.location.hash = '#/products'");
    await sleep(1600);
    const products = await browser.evaluate("document.querySelectorAll('.table tbody tr').length");
    assert(products > 0, 'البيانات لم تبقَ بعد إعادة التحميل من file://');

    // التقارير والمخططات
    await browser.evaluate("window.location.hash = '#/reports'");
    await sleep(2200);
    const charts = await browser.evaluate("document.querySelectorAll('svg.chart').length");
    assert(charts > 0, 'لم تُرسم المخططات من file://');

    const errors = [
      ...browser.pageErrors,
      ...browser.consoleMessages.filter((m) => m.type === 'error').map((m) => m.text),
    ].filter((text) => !/favicon/i.test(text));
    assert(errors.length === 0, `أخطاء في وضع file://:\n      ${[...new Set(errors)].slice(0, 4).join('\n      ')}`);
  });

  await check('لا أخطاء في طرفية المتصفح خلال كل الفحوص', async () => {
    const errors = [
      ...browser.pageErrors,
      ...browser.consoleMessages.filter((m) => m.type === 'error').map((m) => m.text),
    ].filter((text) => !/favicon/i.test(text));

    assert(errors.length === 0, `${errors.length} خطأ:\n      ${[...new Set(errors)].slice(0, 5).join('\n      ')}`);
  });

  /* ------------------------------- النتيجة ------------------------------- */

  console.log(`\nفحوص E2E: ${e2e.passed} نجح، ${e2e.failed} فشل`);
  if (e2e.failed > 0) exitCode = 1;

  console.log('\n' + '='.repeat(56));
  console.log(exitCode === 0
    ? `✓ كل الاختبارات نجحت — ${report.passed} وحدة/تكامل + ${e2e.passed} من طرف إلى طرف`
    : `✗ توجد اختبارات فاشلة (وحدة: ${report.failed}، E2E: ${e2e.failed})`);
  console.log('='.repeat(56));

  async function historyEntry(offset) {
    const history = await browser.session.send('Page.getNavigationHistory');
    const index = Math.max(0, Math.min(history.entries.length - 1, history.currentIndex + offset));
    return { entryId: history.entries[index].id };
  }
} catch (error) {
  console.error('\nفشل تشغيل الاختبارات:', error);
  exitCode = 1;
} finally {
  await browser.close();
  server.close();
  process.exit(exitCode);
}
