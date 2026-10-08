/** لوحة التحكم — مرجع: UI/01-dashboard.png */

import { h, ltr } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, badge, emptyState, deltaPercent, pagination } from '../components/ui.js';
import { dataTable, twoLineCell, thumbCell } from '../components/table.js';
import { lineChart, donutChart, chartLegend, chartWithLegend, CHART_COLORS } from '../components/charts.js';
import { dashboardData } from '../services/reports.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, formatInt, formatCompact } from '../utils/format.js';
import { formatDateTime } from '../utils/dates.js';
import { SALE_STATUS_LABEL, SALE_STATUS_TONE, PAYMENT_TYPE_LABEL } from '../repositories/sales.js';
import { stockStatus, STOCK_LABEL, STOCK_TONE } from '../repositories/products.js';
import { isEmptyDatabase, seedDemoData } from '../db/seed.js';
import { notifyDataChanged } from '../state/store.js';
import { toastOk, toastError, confirmDialog } from '../components/feedback.js';
import { navigate, refresh } from '../router.js';

export async function render() {
  const symbol = settings().currencySymbol;
  const dateFormat = settings().dateFormat;

  const [data, empty] = await Promise.all([dashboardData(), isEmptyDatabase()]);

  if (empty) return firstRunScreen();

  const { today, yesterday, week, series, expenseSlices, lowStockProducts, lowStockCount, recentSales } = data;

  /* ------------------------------ بطاقات KPI ------------------------------ */

  const kpis = kpiGrid(
    kpi({
      label: 'مبيعات اليوم',
      value: formatAmount(today.revenueMinor),
      unit: symbol,
      iconName: 'banknote',
      tone: 'teal',
      delta: { percent: deltaPercent(today.revenueMinor, yesterday.revenueMinor), label: 'عن أمس' },
    }),
    kpi({
      label: 'عدد الفواتير',
      value: formatInt(today.invoiceCount),
      unit: 'فاتورة',
      iconName: 'clipboard',
      tone: 'violet',
      delta: { percent: deltaPercent(today.invoiceCount, yesterday.invoiceCount), label: 'عن أمس' },
    }),
    kpi({
      label: 'متوسط الفاتورة',
      value: formatAmount(today.averageInvoiceMinor),
      unit: symbol,
      iconName: 'file',
      tone: 'blue',
      delta: { percent: deltaPercent(today.averageInvoiceMinor, yesterday.averageInvoiceMinor), label: 'عن أمس' },
    }),
    kpi({
      label: 'صافي الحركة',
      value: formatAmount(today.netCashFlowMinor),
      unit: symbol,
      iconName: 'arrowUpDown',
      tone: 'green',
      delta: { percent: deltaPercent(today.netCashFlowMinor, yesterday.netCashFlowMinor), label: 'عن أمس' },
    })
  );

  /* -------------------------- المصروفات حسب الفئة -------------------------- */

  const expenseSlicesColored = expenseSlices.map((slice, index) => ({
    ...slice,
    color: slice.color || CHART_COLORS[index % CHART_COLORS.length],
  }));

  const expensesCard = card({
    title: 'المصروفات حسب الفئة',
    body: expenseSlicesColored.length === 0
      ? emptyState({
          iconName: 'expenses',
          title: 'لا مصروفات في آخر 7 أيام',
          text: 'سجّل مصروفاتك لتظهر هنا موزّعة حسب الفئة.',
        })
      : chartWithLegend(
          donutChart({ slices: expenseSlicesColored, title: 'المصروفات حسب الفئة', size: 200 }),
          chartLegend(expenseSlicesColored.map((slice) => ({
            label: slice.label,
            value: formatAmount(slice.value),
            color: slice.color,
          })))
        ),
    footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/expenses' }, h('span', { text: 'عرض الكل' })),
  });

  /* --------------------------- المبيعات خلال 7 أيام -------------------------- */

  const salesCard = card({
    title: 'المبيعات خلال 7 أيام',
    body: week.revenueMinor === 0
      ? emptyState({
          iconName: 'chart',
          title: 'لا مبيعات في آخر 7 أيام',
          text: 'ستظهر حركة المبيعات هنا بمجرد إتمام أول فاتورة.',
          action: h('a', { class: 'btn btn--sm btn--teal', href: '#/pos' },
            icon('pos'), h('span', { text: 'ابدأ البيع' })),
        })
      : lineChart({
          points: series.map((point) => ({
            label: point.relativeLabel,
            value: point.salesMinor / 100,
          })),
          title: 'المبيعات خلال 7 أيام',
          formatValue: (value) => formatCompact(value),
          height: 250,
        }),
    footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/reports' }, h('span', { text: 'عرض الكل' })),
  });

  /* -------------------------- الأصناف منخفضة المخزون ------------------------- */

  const lowStockCard = card({
    title: 'الأصناف منخفضة المخزون',
    titleIcon: lowStockCount > 0 ? 'warning' : null,
    body: lowStockProducts.length === 0
      ? emptyState({
          iconName: 'checkCircle',
          title: 'المخزون بحالة جيدة',
          text: 'لا توجد أصناف تحت الحد الأدنى حالياً.',
        })
      : h('ul', { class: 'stack', style: { gap: '14px' } },
          ...lowStockProducts.map((product) =>
            h('li', { class: 'row', style: { gap: '12px', 'flex-wrap': 'nowrap' } },
              thumbCell(product.image, product.name),
              h('div', { style: { flex: '1', 'min-width': '0' } },
                h('div', { class: 'table__main', text: product.name }),
                h('div', { class: 'table__sub' }, ltr(product.sku))
              ),
              h('div', { style: { 'text-align': 'center', flex: 'none' } },
                h('div', {
                  style: { 'font-weight': '700', color: product.quantity === 0 ? 'var(--red)' : 'var(--amber-strong)' },
                }, ltr(product.quantity)),
                h('div', { class: 'table__sub', text: 'وحدة' })
              )
            )
          )
        ),
    footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/inventory?stock=low' },
      h('span', { text: 'عرض الكل' })),
  });

  /* ------------------------------ آخر الفواتير ------------------------------ */

  const invoicesCard = card({
    title: 'آخر الفواتير',
    flush: true,
    body: dataTable({
      caption: 'آخر خمس فواتير',
      columns: [
        {
          key: 'number',
          label: 'رقم الفاتورة',
          render: (sale) => h('a', { href: `#/invoices/${sale.id}` }, ltr(sale.number)),
        },
        { key: 'customerName', label: 'العميل' },
        {
          key: 'totalMinor',
          label: 'الإجمالي',
          render: (sale) => h('span', null, ltr(formatAmount(sale.totalMinor)), ` ${symbol}`),
        },
        {
          key: 'status',
          label: 'الحالة',
          render: (sale) => badge(SALE_STATUS_LABEL[sale.status], SALE_STATUS_TONE[sale.status]),
        },
        {
          key: 'createdAt',
          label: 'التاريخ',
          render: (sale) => h('span', { class: 'row', style: { gap: '6px', 'flex-wrap': 'nowrap' } },
            icon('calendar', { class: 'icon' }),
            ltr(formatDateTime(sale.createdAt, dateFormat))
          ),
        },
        {
          key: 'paymentType',
          label: 'نوع الدفع',
          render: (sale) => h('span', { class: 'row', style: { gap: '6px', 'flex-wrap': 'nowrap' } },
            icon(sale.paymentType === 'credit' ? 'credit' : 'cash'),
            h('span', { text: PAYMENT_TYPE_LABEL[sale.paymentType] })
          ),
        },
      ],
      rows: recentSales,
      empty: {
        iconName: 'invoices',
        title: 'لا فواتير بعد',
        text: 'أول فاتورة تتمّها ستظهر هنا مباشرة.',
      },
    }),
    footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/invoices' }, h('span', { text: 'عرض الكل' })),
  });

  return h('div', { class: 'stack' },
    kpis,
    h('div', { class: 'grid-3' }, expensesCard, salesCard, lowStockCard),
    invoicesCard
  );
}

/* ------------------------------------------------------------------ */
/* شاشة أول تشغيل                                                       */
/* ------------------------------------------------------------------ */

function firstRunScreen() {
  let seeding = false;

  const seedButton = h('button', {
    class: 'btn btn--primary',
    attrs: { type: 'button' },
    on: {
      click: async (event) => {
        if (seeding) return;
        // احفظ المرجع قبل أي await — المتصفح يصفّر currentTarget بعد انتهاء الإرسال
        const button = event.currentTarget;
        const confirmed = await confirmDialog({
          title: 'إضافة بيانات تجريبية',
          message: 'سيتم إنشاء منتجات وعملاء ومبيعات ومصروفات للتجربة. يمكنك حذفها لاحقاً من شاشة النسخ الاحتياطي.',
          confirmLabel: 'إضافة البيانات',
        });
        if (!confirmed) return;

        seeding = true;
        button.disabled = true;
        button.textContent = 'جارٍ الإنشاء…';

        try {
          const result = await seedDemoData();
          notifyDataChanged();
          toastOk(`تمت إضافة ${result.products} منتجاً و${result.sales} فاتورة و${result.customers} عميلاً.`);
          refresh();
        } catch (error) {
          toastError(`تعذّر إنشاء البيانات التجريبية: ${error.message}`);
          button.disabled = false;
          seeding = false;
        }
      },
    },
  }, icon('zap'), h('span', { text: 'إضافة بيانات تجريبية' }));

  return h('div', { class: 'stack' },
    card({
      body: h('div', { class: 'empty', style: { padding: '48px 20px' } },
        h('div', { class: 'empty__icon', style: { width: '72px', height: '72px', background: 'var(--teal-soft)', color: 'var(--teal)' } },
          icon('store', { size: 34 })),
        h('h2', { style: { 'font-size': '20px', 'font-weight': '700' }, text: 'مرحباً بك في نظام المبيعات' }),
        h('p', { class: 'empty__text', style: { 'max-width': '520px' } },
          'قاعدة البيانات فارغة. ابدأ بإضافة منتجاتك، أو جرّب النظام ببيانات جاهزة. كل شيء يُحفظ على هذا الجهاز ولا يُرسل إلى أي خادم.'),
        h('div', { class: 'row', style: { 'margin-top': '8px', 'justify-content': 'center' } },
          h('a', { class: 'btn btn--teal', href: '#/products/new' },
            icon('plus'), h('span', { text: 'إضافة أول منتج' })),
          seedButton,
          h('a', { class: 'btn btn--ghost', href: '#/backup' },
            icon('upload'), h('span', { text: 'استعادة نسخة احتياطية' }))
        )
      ),
    }),

    h('div', { class: 'grid-3' },
      infoCard('database', 'بياناتك محلية', 'كل السجلات مخزّنة في متصفح هذا الجهاز فقط. لا يوجد خادم ولا حساب ولا مزامنة.'),
      infoCard('cloudUp', 'النسخ الاحتياطي مسؤوليتك', 'احفظ نسخة JSON خارج الجهاز بانتظام. مسح بيانات المتصفح يمسح كل شيء.'),
      infoCard('zap', 'يعمل دون اتصال', 'بعد أول زيارة عبر HTTPS أو localhost، يعمل التطبيق كاملاً بلا إنترنت.')
    )
  );
}

function infoCard(iconName, title, text) {
  return card({
    body: h('div', { class: 'stack', style: { gap: '10px' } },
      h('div', { class: 'kpi__icon kpi__icon--blue', style: { width: '40px', height: '40px' } }, icon(iconName)),
      h('h3', { style: { 'font-size': '15px', 'font-weight': '700' }, text: title }),
      h('p', { style: { 'font-size': '13.5px', color: 'var(--text-2)', 'line-height': '1.7' }, text })
    ),
  });
}
