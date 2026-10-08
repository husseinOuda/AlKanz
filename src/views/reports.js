/** التقارير — مرجع: UI/10-reports.png */

import { h, render as renderInto, ltr } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, field, emptyState, deltaPercent, badge } from '../components/ui.js';
import { dataTable } from '../components/table.js';
import { lineChart, barChart, donutChart, chartLegend, chartWithLegend, inlineLegend, CHART_COLORS } from '../components/charts.js';
import { toastOk, toastError } from '../components/feedback.js';
import {
  compareWithPrevious, dailySeries, topProducts, salesByCategory,
  expensesByCategory, paymentMethods, stockReport, movementReport, stagnantProducts,
} from '../services/reports.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, formatInt, formatCompact, formatPercent } from '../utils/format.js';
import { presetRange, isDayKey, formatDate } from '../utils/dates.js';
import { toMajor } from '../utils/money.js';
import { printReport } from '../services/print.js';
import { exportReport, exportFileName } from '../services/excel.js';

const REPORT_TYPES = [
  { value: 'sales', label: 'ملخص المبيعات' },
  { value: 'salesExpenses', label: 'المبيعات والمصروفات' },
  { value: 'profit', label: 'الربح التقديري' },
  { value: 'topProducts', label: 'الأكثر مبيعاً' },
  { value: 'mostProfitable', label: 'الأكثر ربحية' },
  { value: 'stagnant', label: 'المنتجات الراكدة' },
  { value: 'category', label: 'المبيعات حسب الفئة' },
  { value: 'payments', label: 'طرق الدفع' },
  { value: 'stock', label: 'المخزون المنخفض والمنعدم' },
  { value: 'movements', label: 'حركات المخزون' },
];

const PRESETS = [
  { value: 'today', label: 'اليوم' },
  { value: 'last7', label: 'آخر 7 أيام' },
  { value: 'last30', label: 'آخر 30 يوماً' },
  { value: 'month', label: 'هذا الشهر' },
  { value: 'prevMonth', label: 'الشهر الماضي' },
  { value: 'year', label: 'هذه السنة' },
];

export async function render(context) {
  const s = settings();
  const symbol = s.currencySymbol;

  const initial = presetRange('last7');
  const state = {
    type: context.query.type || 'sales',
    from: context.query.from && isDayKey(context.query.from) ? context.query.from : initial.from,
    to: context.query.to && isDayKey(context.query.to) ? context.query.to : initial.to,
    data: null,
  };

  const contentHost = h('div', { class: 'stack' });

  /* ------------------------------ شريط الأدوات ------------------------------ */

  const typeField = field({
    label: 'نوع التقرير', name: 'type', value: state.type,
    options: REPORT_TYPES,
    onChange: (event) => { state.type = event.target.value; load(); },
  });

  const fromField = field({ label: 'من تاريخ', name: 'from', type: 'date', value: state.from });
  const toField = field({ label: 'إلى تاريخ', name: 'to', type: 'date', value: state.to });

  const presetField = field({
    label: 'فترة سريعة', name: 'preset', value: 'last7',
    options: [{ value: 'custom', label: 'مخصّص' }, ...PRESETS],
    onChange: (event) => {
      if (event.target.value === 'custom') return;
      const range = presetRange(event.target.value);
      state.from = range.from;
      state.to = range.to;
      fromField.value = range.from;
      toField.value = range.to;
      load();
    },
  });

  function applyDates() {
    const from = fromField.value;
    const to = toField.value;

    if (!isDayKey(from) || !isDayKey(to)) {
      toastError('التاريخ غير صالح');
      return;
    }
    if (from > to) {
      toastError('«من تاريخ» يجب أن يسبق «إلى تاريخ»');
      return;
    }

    state.from = from;
    state.to = to;
    presetField.value = 'custom';
    load();
  }

  const toolbar = h('div', { class: 'report-toolbar' },
    typeField.element,
    fromField.element,
    toField.element,
    presetField.element,
    h('div', { class: 'filter-bar__actions' },
      h('button', {
        class: 'btn btn--success',
        attrs: { type: 'button' },
        on: { click: applyDates },
      }, h('span', { text: 'تطبيق' }), icon('filter')),
      h('button', {
        class: 'btn btn--ghost',
        attrs: { type: 'button' },
        on: {
          click: () => {
            const range = presetRange('last7');
            state.from = range.from;
            state.to = range.to;
            state.type = 'sales';
            typeField.value = 'sales';
            fromField.value = range.from;
            toField.value = range.to;
            presetField.value = 'last7';
            load();
          },
        },
      }, h('span', { text: 'إعادة تعيين' }), icon('refresh'))
    )
  );

  const actionRow = h('div', { class: 'page__actions' },
    h('button', {
      class: 'btn btn--ghost',
      attrs: { type: 'button' },
      on: { click: () => doPrint() },
    }, h('span', { text: 'طباعة التقرير' }), icon('printer')),
    h('button', {
      class: 'btn btn--ghost',
      attrs: { type: 'button' },
      on: { click: () => doExport() },
    }, h('span', { text: 'تصدير Excel' }), icon('download'))
  );

  /* -------------------------------- التحميل -------------------------------- */

  async function load() {
    renderInto(contentHost, h('div', { class: 'card' }, h('div', { class: 'card__body' },
      h('p', { class: 'field__hint', text: 'جارٍ حساب التقرير…' }))));

    try {
      const { current, prior } = await compareWithPrevious(state.from, state.to);
      const [categorySlices, expenseSlices, stock, movements, stagnant] = await Promise.all([
        salesByCategory(current),
        expensesByCategory(current),
        stockReport(),
        movementReport(state.from, state.to),
        stagnantProducts(60),
      ]);

      state.data = { current, prior, categorySlices, expenseSlices, stock, movements, stagnant };
      draw();
    } catch (error) {
      renderInto(contentHost, card({
        body: emptyState({
          iconName: 'error',
          title: 'تعذّر حساب التقرير',
          text: error.message,
        }),
      }));
    }
  }

  /* --------------------------------- الرسم --------------------------------- */

  function draw() {
    const { current, prior } = state.data;
    const rangeLabel = `${formatDate(state.from, s.dateFormat)} — ${formatDate(state.to, s.dateFormat)}`;

    const kpis = kpiGrid(
      kpi({
        label: 'إجمالي المبيعات', value: formatAmount(current.revenueMinor), unit: symbol,
        iconName: 'basket', tone: 'green',
        delta: { percent: deltaPercent(current.revenueMinor, prior.revenueMinor), label: 'مقارنة بالفترة السابقة' },
      }),
      kpi({
        label: 'إجمالي المصروفات', value: formatAmount(current.expensesMinor), unit: symbol,
        iconName: 'wallet', tone: 'amber',
        delta: { percent: deltaPercent(current.expensesMinor, prior.expensesMinor), label: 'مقارنة بالفترة السابقة' },
      }),
      kpi({
        label: 'الربح التقديري', value: formatAmount(current.estimatedProfitMinor), unit: symbol,
        iconName: 'pieChart', tone: current.estimatedProfitMinor >= 0 ? 'teal' : 'red',
        delta: { percent: deltaPercent(current.estimatedProfitMinor, prior.estimatedProfitMinor), label: 'مقارنة بالفترة السابقة' },
      }),
      kpi({
        label: 'عدد الفواتير', value: formatInt(current.invoiceCount), unit: 'فاتورة',
        iconName: 'receipt', tone: 'blue',
        delta: { percent: deltaPercent(current.invoiceCount, prior.invoiceCount), label: 'مقارنة بالفترة السابقة' },
      })
    );

    const body = current.invoiceCount === 0 && current.expenses.length === 0 && state.type !== 'stock'
      ? card({
          body: emptyState({
            iconName: 'chart',
            title: 'لا بيانات في هذه الفترة',
            text: 'لم تُسجَّل مبيعات أو مصروفات بين هذين التاريخين. جرّب توسيع النطاق.',
          }),
        })
      : reportBody();

    renderInto(contentHost,
      h('p', { class: 'field__hint' }, 'الفترة: ', ltr(rangeLabel)),
      kpis,
      body
    );
  }

  function reportBody() {
    const { current, categorySlices, expenseSlices, stock, movements } = state.data;
    const series = dailySeries(current);

    switch (state.type) {
      case 'salesExpenses':
        return h('div', { class: 'stack' },
          card({
            title: 'المبيعات والمصروفات',
            body: h('div', null,
              inlineLegend([
                { label: `المبيعات (${symbol})`, color: '#12855A' },
                { label: `المصروفات (${symbol})`, color: '#DC2626' },
              ]),
              barChart({
                labels: series.map((point) => point.key),
                series: [
                  { name: 'المبيعات', color: '#12855A', values: series.map((p) => p.salesMinor / 100) },
                  { name: 'المصروفات', color: '#DC2626', values: series.map((p) => p.expensesMinor / 100) },
                ],
                title: 'المبيعات والمصروفات اليومية',
              })
            ),
          }),
          expenseSlices.length > 0
            ? card({
                title: 'المصروفات حسب الفئة',
                body: chartWithLegend(
                  donutChart({ slices: colorize(expenseSlices), title: 'المصروفات حسب الفئة' }),
                  chartLegend(colorize(expenseSlices).map((slice) => ({
                    label: slice.label, value: `${formatAmount(slice.value)} ${symbol}`, color: slice.color,
                  })))
                ),
              })
            : null
        );

      case 'profit':
        return h('div', { class: 'stack' },
          card({
            title: 'مكوّنات الربح التقديري',
            body: h('div', { class: 'stack', style: { gap: '2px' } },
              profitRow('إجمالي المبيعات (شامل الضريبة)', current.revenueMinor),
              profitRow('الضريبة المحصّلة', -current.taxMinor),
              profitRow('صافي الإيراد', current.netRevenueMinor, true),
              profitRow('تكلفة البضاعة المباعة', -current.costMinor),
              profitRow('مجمل الربح', current.grossProfitMinor, true),
              profitRow('المصروفات التشغيلية', -current.expensesMinor),
              profitRow('الربح التقديري', current.estimatedProfitMinor, true, true)
            ),
            footer: h('p', { class: 'field__hint' },
              'التكلفة محسوبة من سعر شراء المنتج المحفوظ داخل كل سطر فاتورة وقت البيع، فتغيير الأسعار لاحقاً لا يؤثر على أرباح الفواتير السابقة.'),
          }),
          card({
            title: 'اتجاه المبيعات',
            body: lineChart({
              points: series.map((p) => ({ label: p.key, value: p.salesMinor / 100 })),
              title: 'اتجاه المبيعات',
              showValues: series.length <= 10,
              color: '#12855A',
            }),
          })
        );

      case 'topProducts':
      case 'mostProfitable': {
        const top = topProducts(current, 20).sort(state.type === 'mostProfitable' ? (a, b) => b.profitMinor - a.profitMinor : (a, b) => b.quantity - a.quantity);
        const totalQty = top.reduce((sum, item) => sum + item.quantity, 0);
        const totalRevenue = top.reduce((sum, item) => sum + item.revenueMinor, 0);

        return card({
          title: state.type === 'mostProfitable' ? 'المنتجات الأكثر ربحية' : 'الأكثر مبيعاً',
          flush: true,
          body: dataTable({
            caption: 'المنتجات الأكثر مبيعاً',
            columns: [
              { key: 'name', label: 'المنتج', render: (row) => h('div', null,
                h('div', { class: 'table__main', text: row.name }),
                h('div', { class: 'table__sub' }, ltr(row.sku))
              ) },
              { key: 'quantity', label: 'الكمية المباعة', render: (row) => ltr(row.quantity) },
              { key: 'revenueMinor', label: 'الإيراد', render: (row) => h('span', null, ltr(formatAmount(row.revenueMinor)), ` ${symbol}`) },
              {
                key: 'profit',
                label: 'الربح',
                render: (row) => {
                  const profit = row.revenueMinor - row.costMinor;
                  return h('span', { style: { color: profit >= 0 ? 'var(--green)' : 'var(--red)' } },
                    ltr(formatAmount(profit)), ` ${symbol}`);
                },
              },
            ],
            rows: top.length > 0
              ? [...top, {
                  productId: '__total', name: 'الإجمالي', sku: '',
                  quantity: totalQty, revenueMinor: totalRevenue,
                  costMinor: top.reduce((sum, item) => sum + item.costMinor, 0),
                }]
              : [],
            empty: { iconName: 'products', title: 'لا مبيعات في هذه الفترة', text: 'لم يُبَع أي منتج بين هذين التاريخين.' },
          }),
        });
      }

      case 'stagnant':
        return card({ title: 'المنتجات الراكدة — لم تُبع خلال 60 يوماً', flush: true, body: dataTable({ caption: 'المنتجات الراكدة', columns: [
          { key: 'name', label: 'المنتج', render: (row) => h('div', null, h('div', { class: 'table__main', text: row.name }), h('div', { class: 'table__sub' }, ltr(row.sku))) },
          { key: 'lastSaleDay', label: 'آخر بيع', render: (row) => ltr(row.lastSaleDay || 'لم يُبع') },
          { key: 'quantity', label: 'الكمية', render: (row) => ltr(row.quantity) },
          { key: 'value', label: 'قيمة المخزون', render: (row) => h('span', null, ltr(formatAmount(row.quantity * row.costMinor)), ` ${symbol}`) },
        ], rows: state.data.stagnant, empty: { iconName: 'products', title: 'لا توجد منتجات راكدة', text: 'كل المنتجات النشطة لها مبيعات حديثة.' } }) });

      case 'category':
        return card({
          title: 'المبيعات حسب الفئة',
          body: categorySlices.length === 0
            ? emptyState({ iconName: 'tag', title: 'لا مبيعات', text: 'لا توجد مبيعات في هذه الفترة.' })
            : chartWithLegend(
                donutChart({ slices: colorize(categorySlices), title: 'المبيعات حسب الفئة' }),
                chartLegend(colorize(categorySlices).map((slice) => ({
                  label: slice.label,
                  value: formatPercent((slice.value / categorySlices.reduce((sum, x) => sum + x.value, 0)) * 100),
                  color: slice.color,
                })))
              ),
        });

      case 'payments': {
        const slices = paymentMethods(current);
        const total = slices.reduce((sum, slice) => sum + slice.value, 0);
        return card({
          title: 'طرق الدفع',
          body: slices.length === 0
            ? emptyState({ iconName: 'wallet', title: 'لا مبيعات', text: 'لا توجد مبيعات في هذه الفترة.' })
            : chartWithLegend(
                donutChart({ slices, title: 'طرق الدفع' }),
                chartLegend(slices.map((slice) => ({
                  label: slice.label,
                  value: formatPercent((slice.value / total) * 100),
                  color: slice.color,
                })))
              ),
        });
      }

      case 'stock':
        return h('div', { class: 'stack' },
          h('div', { class: 'grid-3' },
            kpi({ label: 'إجمالي الأصناف', value: formatInt(stock.totalProducts), unit: 'صنف', iconName: 'products', tone: 'blue' }),
            kpi({ label: 'مخزون منخفض', value: formatInt(stock.low.length), unit: 'صنف', iconName: 'arrowDown', tone: 'amber' }),
            kpi({ label: 'نفد المخزون', value: formatInt(stock.out.length), unit: 'صنف', iconName: 'packageX', tone: 'red' })
          ),
          card({
            title: 'الأصناف التي تحتاج إعادة طلب',
            flush: true,
            body: dataTable({
              caption: 'المخزون المنخفض والمنعدم',
              columns: [
                { key: 'name', label: 'المنتج', render: (row) => h('div', null,
                  h('div', { class: 'table__main', text: row.name }),
                  h('div', { class: 'table__sub' }, ltr(row.sku))
                ) },
                { key: 'categoryName', label: 'الفئة' },
                { key: 'quantity', label: 'الكمية', render: (row) => h('span', {
                  style: { color: row.quantity === 0 ? 'var(--red)' : 'var(--amber)', 'font-weight': '700' },
                }, ltr(row.quantity)) },
                { key: 'lowStockThreshold', label: 'الحد الأدنى', render: (row) => ltr(row.lowStockThreshold) },
                { key: 'status', label: 'الحالة', render: (row) => badge(
                  row.status === 'out' ? 'نفد المخزون' : 'منخفض', row.status === 'out' ? 'red' : 'amber') },
                { key: 'value', label: 'قيمة المخزون', render: (row) => h('span', null,
                  ltr(formatAmount(row.stockValueMinor)), ` ${symbol}`) },
              ],
              rows: [...stock.out, ...stock.low],
              empty: { iconName: 'checkCircle', title: 'المخزون بحالة جيدة', text: 'لا توجد أصناف تحت الحد الأدنى.' },
            }),
          })
        );

      case 'movements':
        return h('div', { class: 'stack' },
          card({
            title: 'حركات المخزون مجمّعة حسب السبب',
            flush: true,
            body: dataTable({
              caption: 'ملخص حركات المخزون',
              columns: [
                { key: 'reason', label: 'السبب' },
                { key: 'count', label: 'عدد الحركات', render: (row) => ltr(row.count) },
                { key: 'increases', label: 'إجمالي الإضافة', render: (row) => h('span', { style: { color: 'var(--green)' } }, ltr(`+${row.increases}`)) },
                { key: 'decreases', label: 'إجمالي السحب', render: (row) => h('span', { style: { color: 'var(--red)' } }, ltr(`−${row.decreases}`)) },
              ],
              rows: movements.byReason,
              empty: { iconName: 'history', title: 'لا حركات', text: 'لم تُسجَّل حركات مخزون في هذه الفترة.' },
            }),
          })
        );

      case 'sales':
      default:
        return h('div', { class: 'stack' },
          h('div', { class: 'grid-2' },
            card({
              title: 'المبيعات والمصروفات',
              body: h('div', null,
                inlineLegend([
                  { label: `المبيعات (${symbol})`, color: '#12855A' },
                  { label: `المصروفات (${symbol})`, color: '#DC2626' },
                ]),
                barChart({
                  labels: series.map((p) => p.key),
                  series: [
                    { name: 'المبيعات', color: '#12855A', values: series.map((p) => p.salesMinor / 100) },
                    { name: 'المصروفات', color: '#DC2626', values: series.map((p) => p.expensesMinor / 100) },
                  ],
                  title: 'المبيعات والمصروفات',
                })
              ),
            }),
            card({
              title: 'اتجاه المبيعات',
              body: lineChart({
                points: series.map((p) => ({ label: p.key, value: p.salesMinor / 100 })),
                title: 'اتجاه المبيعات',
                showValues: series.length <= 10,
                color: '#12855A',
              }),
            })
          ),
          h('div', { class: 'grid-3' },
            card({
              title: 'طرق الدفع',
              body: (() => {
                const slices = paymentMethods(current);
                const total = slices.reduce((sum, slice) => sum + slice.value, 0);
                return slices.length === 0
                  ? emptyState({ iconName: 'wallet', title: 'لا مبيعات', text: '' })
                  : chartWithLegend(
                      donutChart({ slices, title: 'طرق الدفع', size: 180 }),
                      chartLegend(slices.map((slice) => ({
                        label: slice.label, value: formatPercent((slice.value / total) * 100), color: slice.color,
                      })))
                    );
              })(),
            }),
            card({
              title: 'المبيعات حسب الفئة',
              body: categorySlices.length === 0
                ? emptyState({ iconName: 'tag', title: 'لا مبيعات', text: '' })
                : chartWithLegend(
                    donutChart({ slices: colorize(categorySlices), title: 'المبيعات حسب الفئة', size: 180 }),
                    chartLegend(colorize(categorySlices).map((slice) => ({
                      label: slice.label,
                      value: formatPercent((slice.value / categorySlices.reduce((sum, x) => sum + x.value, 0)) * 100),
                      color: slice.color,
                    })))
                  ),
            }),
            card({
              title: 'الأكثر مبيعاً',
              flush: true,
              body: (() => {
                const top = topProducts(current, 5);
                return dataTable({
                  caption: 'أكثر خمسة منتجات مبيعاً',
                  columns: [
                    { key: 'name', label: 'المنتج' },
                    { key: 'quantity', label: 'الكمية المباعة', render: (row) => ltr(row.quantity) },
                    { key: 'revenueMinor', label: 'الإيراد', render: (row) => h('span', null, ltr(formatAmount(row.revenueMinor)), ` ${symbol}`) },
                  ],
                  rows: top.length > 0
                    ? [...top, {
                        name: 'الإجمالي',
                        quantity: top.reduce((sum, item) => sum + item.quantity, 0),
                        revenueMinor: top.reduce((sum, item) => sum + item.revenueMinor, 0),
                      }]
                    : [],
                  empty: { iconName: 'products', title: 'لا مبيعات', text: '' },
                });
              })(),
            })
          )
        );
    }
  }

  function profitRow(label, minor, strong = false, highlight = false) {
    return h('div', {
      class: 'invoice-totals__row',
      style: highlight
        ? { background: minor >= 0 ? 'var(--green-soft)' : 'var(--red-soft)', 'font-size': '16px' }
        : null,
    },
      h('span', { style: strong ? { 'font-weight': '700' } : null, text: label }),
      h('span', {
        style: {
          'font-weight': strong ? '700' : '600',
          color: minor < 0 ? 'var(--red)' : highlight || strong ? 'var(--green)' : 'inherit',
        },
      }, ltr(formatAmount(minor)), ` ${symbol}`)
    );
  }

  const colorize = (slices) => slices.map((slice, index) => ({
    ...slice,
    color: slice.color || CHART_COLORS[index % CHART_COLORS.length],
  }));

  /* ----------------------------- طباعة وتصدير ----------------------------- */

  function reportTable() {
    const { current, categorySlices, expenseSlices, stock, movements } = state.data;
    const series = dailySeries(current);
    const typeLabel = REPORT_TYPES.find((type) => type.value === state.type)?.label || 'تقرير';

    switch (state.type) {
      case 'topProducts':
      case 'mostProfitable':
        return {
          title: typeLabel,
          header: ['المنتج', 'SKU', 'الكمية المباعة', `الإيراد (${symbol})`, `الربح (${symbol})`],
          rows: topProducts(current, 100).map((row) => [
            row.name, row.sku, row.quantity,
            toMajor(row.revenueMinor), toMajor(row.revenueMinor - row.costMinor),
          ]),
        };
      case 'stagnant':
        return { title: typeLabel, header: ['المنتج', 'SKU', 'آخر بيع', 'الكمية', `القيمة (${symbol})`], rows: state.data.stagnant.map((row) => [row.name, row.sku, row.lastSaleDay || 'لم يُبع', row.quantity, toMajor(row.quantity * row.costMinor)]) };
      case 'category':
        return {
          title: typeLabel,
          header: ['الفئة', `المبيعات (${symbol})`],
          rows: categorySlices.map((slice) => [slice.label, toMajor(slice.value)]),
        };
      case 'payments':
        return {
          title: typeLabel,
          header: ['طريقة الدفع', `المبلغ (${symbol})`],
          rows: paymentMethods(current).map((slice) => [slice.label, toMajor(slice.value)]),
        };
      case 'stock':
        return {
          title: typeLabel,
          header: ['المنتج', 'SKU', 'الفئة', 'الكمية', 'الحد الأدنى', 'الحالة', `قيمة المخزون (${symbol})`],
          rows: [...stock.out, ...stock.low].map((row) => [
            row.name, row.sku, row.categoryName, row.quantity, row.lowStockThreshold,
            row.status === 'out' ? 'نفد المخزون' : 'منخفض', toMajor(row.stockValueMinor),
          ]),
        };
      case 'movements':
        return {
          title: typeLabel,
          header: ['السبب', 'عدد الحركات', 'إجمالي الإضافة', 'إجمالي السحب'],
          rows: movements.byReason.map((row) => [row.reason, row.count, row.increases, row.decreases]),
        };
      case 'profit':
        return {
          title: typeLabel,
          header: ['البند', `المبلغ (${symbol})`],
          rows: [
            ['إجمالي المبيعات', toMajor(current.revenueMinor)],
            ['الضريبة المحصّلة', toMajor(-current.taxMinor)],
            ['صافي الإيراد', toMajor(current.netRevenueMinor)],
            ['تكلفة البضاعة المباعة', toMajor(-current.costMinor)],
            ['مجمل الربح', toMajor(current.grossProfitMinor)],
            ['المصروفات التشغيلية', toMajor(-current.expensesMinor)],
            ['الربح التقديري', toMajor(current.estimatedProfitMinor)],
          ],
        };
      default:
        return {
          title: typeLabel,
          header: ['اليوم', `المبيعات (${symbol})`, `المصروفات (${symbol})`, `الصافي (${symbol})`],
          rows: series.map((point) => [
            point.key, toMajor(point.salesMinor), toMajor(point.expensesMinor),
            toMajor(point.salesMinor - point.expensesMinor),
          ]),
        };
    }
  }

  function statCards() {
    const { current } = state.data;
    return [
      { label: 'إجمالي المبيعات', value: `${formatAmount(current.revenueMinor)} ${symbol}` },
      { label: 'إجمالي المصروفات', value: `${formatAmount(current.expensesMinor)} ${symbol}` },
      { label: 'الربح التقديري', value: `${formatAmount(current.estimatedProfitMinor)} ${symbol}` },
      { label: 'عدد الفواتير', value: formatInt(current.invoiceCount) },
    ];
  }

  function doPrint() {
    if (!state.data) return;
    const table = reportTable();
    printReport({
      title: table.title,
      subtitle: `الفترة من ${formatDate(state.from, s.dateFormat)} إلى ${formatDate(state.to, s.dateFormat)}`,
      stats: statCards(),
      tables: [table],
    });
  }

  async function doExport() {
    if (!state.data) return;
    try {
      const table = reportTable();
      await exportReport({
        title: table.title,
        fileName: exportFileName(`${table.title}-${state.from}-${state.to}`),
        header: table.header,
        rows: table.rows,
      });
      toastOk('تم تصدير التقرير إلى ملف Excel');
    } catch (error) {
      toastError(`تعذّر التصدير: ${error.message}`);
    }
  }

  /* -------------------------------- التركيب -------------------------------- */

  await load();

  return h('div', { class: 'stack' },
    h('div', { class: 'page__head' }, h('span'), actionRow),
    toolbar,
    contentHost
  );
}
