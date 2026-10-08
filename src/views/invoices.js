/** الفواتير — مرجع: UI/06-invoices-list.png */

import { h, render as renderInto, ltr, debounce } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, badge, searchField, field, pagination, rowMenu } from '../components/ui.js';
import { dataTable } from '../components/table.js';
import { toastOk, toastError, confirmDialog } from '../components/feedback.js';
import {
  listSales, cancelSale, getSaleWithItems,
  SALE_STATUS, SALE_STATUS_LABEL, SALE_STATUS_TONE, PAYMENT_TYPE_LABEL,
} from '../repositories/sales.js';
import { listCustomers } from '../repositories/customers.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, itemsLabel } from '../utils/format.js';
import { formatDate, isDayKey } from '../utils/dates.js';
import { notifyDataChanged } from '../state/store.js';
import { navigate, refresh } from '../router.js';
import { printInvoice } from '../services/print.js';
import { exportInvoices } from '../services/excel.js';

export async function render(context) {
  const s = settings();
  const symbol = s.currencySymbol;

  const [sales, customers] = await Promise.all([listSales(2000), listCustomers()]);

  const state = {
    query: context.query.q || '',
    from: '',
    to: '',
    customer: context.query.customer || 'all',
    payment: 'all',
    status: 'all',
    page: 1,
    pageSize: 8,
  };

  const tableHost = h('div');
  const kpiHost = h('div');

  function filtered() {
    const term = state.query.trim().toLowerCase();

    return sales.filter((sale) => {
      if (state.customer !== 'all') {
        if (state.customer === 'walkin' ? sale.customerId : sale.customerId !== state.customer) return false;
      }
      if (state.payment !== 'all' && sale.paymentType !== state.payment) return false;
      if (state.status !== 'all' && sale.status !== state.status) return false;
      if (state.from && sale.dayKey < state.from) return false;
      if (state.to && sale.dayKey > state.to) return false;
      if (!term) return true;
      return `${sale.number} ${sale.customerName}`.toLowerCase().includes(term);
    });
  }

  function drawKpis() {
    const rows = filtered().filter((sale) => sale.status !== SALE_STATUS.CANCELLED);
    const total = rows.reduce((sum, sale) => sum + sale.totalMinor, 0);
    const paid = rows.reduce((sum, sale) => sum + sale.paidMinor, 0);
    const due = rows.reduce((sum, sale) => sum + sale.dueMinor, 0);

    renderInto(kpiHost, h('div', { class: 'grid-3' },
      kpi({ variant: 'tinted', tone: 'blue', label: 'إجمالي المبيعات', value: `${formatAmount(total)} ${symbol}`, iconName: 'trendUp' }),
      kpi({ variant: 'tinted', tone: 'green', label: 'مدفوع', value: `${formatAmount(paid)} ${symbol}`, iconName: 'checkCircle' }),
      kpi({ variant: 'tinted', tone: 'amber', label: 'آجل', value: `${formatAmount(due)} ${symbol}`, iconName: 'clock' })
    ));
  }

  function drawTable() {
    const rows = filtered();
    const total = rows.length;
    const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > maxPage) state.page = maxPage;
    const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

    renderInto(tableHost, card({
      flush: true,
      body: h('div', null,
        dataTable({
          caption: 'قائمة الفواتير',
          columns: [
            {
              key: 'number',
              label: 'رقم الفاتورة',
              render: (sale) => h('a', { href: `#/invoices/${sale.id}` }, ltr(sale.number)),
            },
            { key: 'dayKey', label: 'التاريخ', render: (sale) => ltr(formatDate(sale.createdAt, s.dateFormat)) },
            { key: 'customerName', label: 'العميل' },
            { key: 'itemCount', label: 'الأصناف', render: (sale) => itemsLabel(sale.itemCount) },
            {
              key: 'paymentType',
              label: 'نوع الدفع',
              render: (sale) => h('span', { class: 'row', style: { gap: '6px', 'flex-wrap': 'nowrap' } },
                icon(sale.paymentType === 'credit' ? 'credit' : 'cash'),
                h('span', { text: PAYMENT_TYPE_LABEL[sale.paymentType] })
              ),
            },
            {
              key: 'totalMinor',
              label: 'الإجمالي',
              render: (sale) => h('span', { style: { 'font-weight': '600' } },
                ltr(formatAmount(sale.totalMinor)), ` ${symbol}`),
            },
            {
              key: 'status',
              label: 'الحالة',
              render: (sale) => badge(SALE_STATUS_LABEL[sale.status], SALE_STATUS_TONE[sale.status]),
            },
            {
              key: 'actions',
              label: 'الإجراءات',
              className: 'is-actions',
              render: (sale) => rowMenu([
                { label: 'عرض التفاصيل', icon: 'eye', onSelect: () => navigate(`/invoices/${sale.id}`) },
                { label: 'طباعة', icon: 'printer', onSelect: () => doPrint(sale) },
                sale.status !== SALE_STATUS.CANCELLED
                  ? { label: 'إلغاء الفاتورة', icon: 'xCircle', danger: true, onSelect: () => doCancel(sale) }
                  : null,
              ], { label: `إجراءات الفاتورة ${sale.number}` }),
            },
          ],
          rows: pageRows,
          empty: sales.length === 0
            ? {
                iconName: 'invoices',
                title: 'لا فواتير بعد',
                text: 'أتمم أول عملية بيع من نقطة البيع لتظهر الفاتورة هنا.',
              }
            : { iconName: 'search', title: 'لا نتائج مطابقة', text: 'جرّب تغيير الفلاتر أو نطاق التاريخ.' },
        }),
        total > 0
          ? pagination({
              page: state.page, pageSize: state.pageSize, total, unit: 'فاتورة',
              sizes: [8, 20, 50, 100],
              onPage: (page) => { state.page = page; drawTable(); },
              onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
            })
          : null
      ),
    }));
  }

  async function doPrint(sale) {
    try {
      const data = await getSaleWithItems(sale.id);
      if (!data) throw new Error('الفاتورة غير موجودة');
      printInvoice(data.sale, data.items);
    } catch (error) {
      toastError(error.message);
    }
  }

  async function doCancel(sale) {
    const ok = await confirmDialog({
      title: 'إلغاء الفاتورة',
      message: `سيتم إرجاع كل أصناف الفاتورة ${sale.number} إلى المخزون وتسجيل حركة لكل صنف. الفاتورة تبقى في السجل بحالة «ملغاة» ولا تُحذف.`,
      confirmLabel: 'إلغاء الفاتورة',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      const result = await cancelSale(sale.id, 'إلغاء من قائمة الفواتير');
      notifyDataChanged();
      toastOk(`تم إلغاء الفاتورة وإرجاع ${result.restoredLines} صنفاً إلى المخزون`);
      refresh();
    } catch (error) {
      toastError(error.message);
    }
  }

  /* ------------------------------- الفلاتر ------------------------------- */

  const applyFilters = () => { state.page = 1; drawKpis(); drawTable(); };

  const search = searchField({
    placeholder: 'بحث برقم الفاتورة أو العميل',
    value: state.query,
    label: 'بحث في الفواتير',
    onInput: debounce((value) => { state.query = value; applyFilters(); }, 200),
  });

  const fromField = field({
    label: 'من تاريخ', name: 'from', type: 'date',
    onChange: (event) => {
      state.from = isDayKey(event.target.value) ? event.target.value : '';
      applyFilters();
    },
  });

  const toField = field({
    label: 'إلى تاريخ', name: 'to', type: 'date',
    onChange: (event) => {
      state.to = isDayKey(event.target.value) ? event.target.value : '';
      applyFilters();
    },
  });

  const customerField = field({
    label: 'العميل', name: 'customer', value: state.customer,
    options: [
      { value: 'all', label: 'الكل' },
      { value: 'walkin', label: 'عميل نقدي' },
      ...customers.map((customer) => ({ value: customer.id, label: customer.name })),
    ],
    onChange: (event) => { state.customer = event.target.value; applyFilters(); },
  });

  const paymentField = field({
    label: 'نوع الدفع', name: 'payment', value: 'all',
    options: [
      { value: 'all', label: 'الكل' },
      { value: 'cash', label: 'نقدي' },
      { value: 'credit', label: 'آجل' },
    ],
    onChange: (event) => { state.payment = event.target.value; applyFilters(); },
  });

  const statusField = field({
    label: 'الحالة', name: 'status', value: 'all',
    options: [
      { value: 'all', label: 'الكل' },
      { value: SALE_STATUS.COMPLETED, label: 'مكتملة' },
      { value: SALE_STATUS.CANCELLED, label: 'ملغاة' },
    ],
    onChange: (event) => { state.status = event.target.value; applyFilters(); },
  });

  const filterBar = h('div', { class: 'filter-bar' },
    h('div', { class: 'filter-bar__row' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: 'بحث' }), search.element),
      fromField.element,
      toField.element,
      customerField.element
    ),
    h('div', { class: 'filter-bar__row' },
      paymentField.element,
      statusField.element,
      h('div'),
      h('div', { class: 'filter-bar__actions' },
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: {
            click: async () => {
              try {
                await exportInvoices(filtered());
                toastOk('تم تصدير الفواتير إلى ملف Excel');
              } catch (error) {
                toastError(`تعذّر التصدير: ${error.message}`);
              }
            },
          },
        }, h('span', { text: 'تصدير Excel' }), icon('download'))
      )
    )
  );

  drawKpis();
  drawTable();

  return h('div', { class: 'stack' },
    h('div', { class: 'page__head' },
      h('span'),
      h('div', { class: 'page__actions' },
        h('a', { class: 'btn btn--primary', href: '#/pos' },
          h('span', { text: 'فاتورة جديدة' }), icon('plus'))
      )
    ),
    kpiHost,
    filterBar,
    tableHost
  );
}
