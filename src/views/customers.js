/** العملاء والذمم — مرجع: UI/08-customers.png */

import { h, render as renderInto, ltr, debounce } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import {
  card, kpi, kpiGrid, badge, searchField, field, pagination, emptyState,
  rowMenu, detailRow, avatar, alertBox,
} from '../components/ui.js';
import { dataTable } from '../components/table.js';
import { openModal, openPanel, toastOk, toastError, confirmDialog } from '../components/feedback.js';
import {
  listCustomers, createCustomer, updateCustomer, deleteCustomer,
  customerLedgers, recordPayment, customerStatement, getCustomer,
} from '../repositories/customers.js';
import { salesForCustomer } from '../repositories/sales.js';
import { validateCustomer, validatePayment, LIMITS } from '../validation/validators.js';
import { PAYMENT_METHODS, methodLabel } from '../repositories/expenses.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, formatInt, initials } from '../utils/format.js';
import { formatDate, formatDateTime } from '../utils/dates.js';
import { toMajor } from '../utils/money.js';
import { notifyDataChanged } from '../state/store.js';
import { navigate, refresh } from '../router.js';
import { exportCustomers } from '../services/excel.js';
import { printReport } from '../services/print.js';

export async function render(context) {
  const s = settings();
  const symbol = s.currencySymbol;

  const [customers, ledgers] = await Promise.all([listCustomers(), customerLedgers()]);

  const state = {
    query: context.query.q || '',
    status: 'all',
    balance: 'all',
    page: 1,
    pageSize: 10,
    selectedId: customers[0]?.id || null,
  };

  const tableHost = h('div');
  const detailHost = h('div', { class: 'detail-panel' });

  const ledgerOf = (id) => ledgers.get(id) || {
    balanceMinor: 0, purchasesMinor: 0, invoiceCount: 0, monthPurchasesMinor: 0, lastPurchaseAt: null,
  };

  function filtered() {
    const term = state.query.trim().toLowerCase();
    return customers.filter((customer) => {
      if (state.status === 'active' && customer.isActive === false) return false;
      if (state.status === 'inactive' && customer.isActive !== false) return false;

      const balance = ledgerOf(customer.id).balanceMinor;
      if (state.balance === 'due' && balance <= 0) return false;
      if (state.balance === 'clear' && balance > 0) return false;

      if (!term) return true;
      return `${customer.name} ${customer.phone || ''}`.toLowerCase().includes(term);
    });
  }

  /* --------------------------------- KPIs --------------------------------- */

  const activeCount = customers.filter((customer) => customer.isActive !== false).length;
  const totalDue = [...ledgers.values()].reduce((sum, ledger) => sum + Math.max(0, ledger.balanceMinor), 0);

  const kpis = h('div', { class: 'grid-3' },
    kpi({ label: 'إجمالي العملاء', value: formatInt(customers.length), unit: 'عميل', iconName: 'customers', tone: 'violet' }),
    kpi({ label: 'عملاء نشطون', value: formatInt(activeCount), unit: 'عميل', iconName: 'user', tone: 'blue' }),
    kpi({
      label: 'إجمالي الذمم',
      value: formatAmount(totalDue),
      unit: symbol,
      iconName: 'wallet',
      tone: totalDue > 0 ? 'amber' : 'green',
    })
  );

  /* -------------------------------- الجدول -------------------------------- */

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
          caption: 'قائمة العملاء',
          rowKey: (customer) => customer.id,
          isSelected: (customer) => customer.id === state.selectedId,
          onRowClick: (customer) => {
            state.selectedId = customer.id;
            drawTable();
            drawDetail();
          },
          columns: [
            {
              key: 'name',
              label: 'الاسم',
              render: (customer) => h('div', { class: 'row', style: { gap: '10px', 'flex-wrap': 'nowrap' } },
                avatar(customer.name, { small: true }),
                h('div', null,
                  h('div', { class: 'table__main', text: customer.name }),
                  customer.isActive === false ? h('div', { class: 'table__sub', text: 'غير نشط' }) : null
                )
              ),
            },
            { key: 'phone', label: 'الهاتف', render: (customer) => (customer.phone ? ltr(customer.phone) : '—') },
            { key: 'invoiceCount', label: 'عدد الفواتير', render: (customer) => ltr(ledgerOf(customer.id).invoiceCount) },
            {
              key: 'purchases',
              label: 'إجمالي المشتريات',
              render: (customer) => h('span', null, ltr(formatAmount(ledgerOf(customer.id).purchasesMinor)), ` ${symbol}`),
            },
            {
              key: 'balance',
              label: 'الرصيد',
              render: (customer) => {
                const balance = ledgerOf(customer.id).balanceMinor;
                return h('span', {
                  style: { color: balance > 0 ? 'var(--red)' : 'var(--green)', 'font-weight': '600' },
                }, ltr(formatAmount(balance)), ` ${symbol}`);
              },
            },
            {
              key: 'lastPurchase',
              label: 'آخر شراء',
              render: (customer) => {
                const last = ledgerOf(customer.id).lastPurchaseAt;
                return last ? ltr(formatDate(last, s.dateFormat)) : '—';
              },
            },
            {
              key: 'status',
              label: 'الحالة',
              render: (customer) => badge(customer.isActive === false ? 'غير نشط' : 'نشط',
                customer.isActive === false ? 'gray' : 'green'),
            },
            {
              key: 'actions',
              label: 'الإجراءات',
              className: 'is-actions',
              render: (customer) => rowMenu([
                { label: 'كشف الحساب', icon: 'chart', onSelect: () => navigate(`/customers/${customer.id}`) },
                { label: 'تسجيل دفعة', icon: 'banknote', onSelect: () => openPaymentDialog(customer) },
                { label: 'تعديل', icon: 'pencil', onSelect: () => openCustomerForm(customer) },
                { label: 'حذف', icon: 'trash', danger: true, onSelect: () => removeCustomer(customer) },
              ], { label: `إجراءات ${customer.name}` }),
            },
          ],
          rows: pageRows,
          empty: customers.length === 0
            ? {
                iconName: 'customers',
                title: 'لا عملاء بعد',
                text: 'أضف عميلاً لتتمكّن من البيع الآجل ومتابعة الذمم.',
              }
            : { iconName: 'search', title: 'لا نتائج مطابقة', text: 'جرّب تعديل البحث أو الفلاتر.' },
        }),
        total > 0
          ? pagination({
              page: state.page, pageSize: state.pageSize, total, unit: 'عميل',
              onPage: (page) => { state.page = page; drawTable(); },
              onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
            })
          : null
      ),
    }));
  }

  /* ------------------------------ لوحة التفاصيل ------------------------------ */

  async function drawDetail() {
    const customer = customers.find((item) => item.id === state.selectedId);

    if (!customer) {
      renderInto(detailHost, card({
        body: emptyState({
          iconName: 'user',
          title: 'اختر عميلاً',
          text: 'انقر على صف في الجدول لعرض تفاصيله.',
        }),
      }));
      return;
    }

    const ledger = ledgerOf(customer.id);
    const recentSales = await salesForCustomer(customer.id, 3);

    renderInto(detailHost, card({
      title: 'تفاصيل العميل',
      titleIcon: 'user',
      body: h('div', { class: 'stack' },
        h('div', { class: 'row', style: { gap: '12px' } },
          avatar(customer.name),
          h('div', null,
            h('h3', { style: { 'font-size': '16px', 'font-weight': '700' }, text: customer.name }),
            customer.isActive === false ? badge('غير نشط', 'gray') : null
          )
        ),

        h('div', { class: 'stack', style: { gap: '2px' } },
          detailRow('رقم الهاتف', customer.phone ? ltr(customer.phone) : '—', { iconName: 'phone' }),
          detailRow('الرصيد الحالي', h('span', {
            style: { color: ledger.balanceMinor > 0 ? 'var(--red)' : 'var(--green)', 'font-weight': '700' },
          }, ltr(formatAmount(ledger.balanceMinor)), ` ${symbol}`)),
          detailRow('مشتريات هذا الشهر', h('span', null,
            ltr(formatAmount(ledger.monthPurchasesMinor)), ` ${symbol}`)),
          detailRow('إجمالي المشتريات', h('span', null,
            ltr(formatAmount(ledger.purchasesMinor)), ` ${symbol}`))
        ),

        customer.note ? alertBox(customer.note, 'info', 'info') : null,

        h('div', { class: 'card', style: { padding: '14px' } },
          h('div', { class: 'invoice-parties__title' }, icon('invoices'), h('span', { text: 'آخر الفواتير' })),
          recentSales.length === 0
            ? h('p', { class: 'field__hint', text: 'لا فواتير لهذا العميل.' })
            : h('div', { class: 'mini-list' },
                ...recentSales.map((sale) =>
                  h('a', {
                    class: 'mini-list__item',
                    href: `#/invoices/${sale.id}`,
                    style: { color: 'inherit', 'text-decoration': 'none' },
                  },
                    h('span', { style: { color: 'var(--blue)' } }, ltr(sale.number)),
                    h('span', { class: 'table__sub' }, ltr(formatDate(sale.createdAt, s.dateFormat))),
                    h('span', { style: { 'font-weight': '600' } }, ltr(formatAmount(sale.totalMinor)), ` ${symbol}`)
                  )
                )
              )
        )
      ),
      footer: h('div', { class: 'stack', style: { gap: '8px' } },
        h('a', { class: 'btn btn--ghost btn--block', href: `#/customers/${customer.id}` },
          icon('chart'), h('span', { text: 'عرض الحساب' })),
        h('button', {
          class: 'btn btn--success btn--block',
          attrs: { type: 'button' },
          on: { click: () => openPaymentDialog(customer) },
        }, icon('banknote'), h('span', { text: 'تسجيل دفعة' })),
        h('button', {
          class: 'btn btn--ghost btn--block',
          attrs: { type: 'button' },
          on: { click: () => openCustomerForm(customer) },
        }, icon('pencil'), h('span', { text: 'تعديل' })),
        h('button', {
          class: 'btn btn--outline-danger btn--block',
          attrs: { type: 'button' },
          on: { click: () => removeCustomer(customer) },
        }, icon('trash'), h('span', { text: 'حذف' }))
      ),
    }));
  }

  /* -------------------------------- النماذج -------------------------------- */

  function openCustomerForm(existing = null) {
    const nameField = field({
      label: 'اسم العميل', name: 'name', required: true,
      value: existing?.name || '', placeholder: 'الاسم الكامل', maxLength: LIMITS.name,
    });
    const phoneField = field({
      label: 'رقم الهاتف', name: 'phone', type: 'tel',
      value: existing?.phone || '', placeholder: '05xxxxxxxx', maxLength: LIMITS.phone,
    });
    const noteField = field({
      label: 'ملاحظة', name: 'note', rows: 3,
      value: existing?.note || '', maxLength: LIMITS.note, counter: true,
      placeholder: 'ملاحظة اختيارية عن العميل',
    });

    async function submit() {
      nameField.setError(null);
      phoneField.setError(null);

      const result = validateCustomer({
        name: nameField.value,
        phone: phoneField.value,
        note: noteField.value,
        isActive: existing?.isActive !== false,
      });

      if (!result.ok) {
        for (const [key, message] of Object.entries(result.errors)) {
          ({ name: nameField, phone: phoneField }[key])?.setError(message);
        }
        return;
      }

      try {
        if (existing) await updateCustomer(existing.id, result.value);
        else await createCustomer(result.value);

        notifyDataChanged();
        modal.close();
        toastOk(existing ? 'تم حفظ بيانات العميل' : `تمت إضافة "${result.value.name}"`);
        refresh();
      } catch (error) {
        toastError(error.message);
      }
    }

    const form = h('form', {
      on: { submit: (event) => { event.preventDefault(); submit(); } },
    }, h('div', { class: 'stack' }, nameField.element, phoneField.element, noteField.element));

    const modal = openModal({
      title: existing ? 'تعديل عميل' : 'إضافة عميل جديد',
      body: form,
      footer: [
        h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'حفظ', on: { click: submit } }),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });

    requestAnimationFrame(() => nameField.focus());
  }

  function openPaymentDialog(customer) {
    const ledger = ledgerOf(customer.id);

    const amountField = field({
      label: 'المبلغ', name: 'amount', required: true, suffix: symbol,
      value: ledger.balanceMinor > 0 ? String(toMajor(ledger.balanceMinor)) : '',
      hint: ledger.balanceMinor > 0
        ? `الرصيد المستحق ${formatAmount(ledger.balanceMinor)} ${symbol}`
        : 'لا يوجد رصيد مستحق على هذا العميل',
    });

    const methodField = field({
      label: 'طريقة الدفع', name: 'method', value: 'cash',
      options: PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })),
    });

    const referenceField = field({
      label: 'رقم المرجع', name: 'reference',
      placeholder: 'رقم الإيصال أو الحوالة (اختياري)', maxLength: LIMITS.reference,
    });

    const noteField = field({
      label: 'ملاحظة', name: 'note', rows: 2, maxLength: LIMITS.note,
      placeholder: 'ملاحظة اختيارية',
    });

    async function submit() {
      amountField.setError(null);

      const result = validatePayment({
        customerId: customer.id,
        amount: amountField.value,
        method: methodField.value,
        reference: referenceField.value,
        note: noteField.value,
      });

      if (!result.ok) {
        amountField.setError(result.errors.amount || null);
        return;
      }

      try {
        await recordPayment(result.value);
        notifyDataChanged();
        modal.close();
        toastOk(`تم تسجيل دفعة ${formatAmount(result.value.amountMinor)} ${symbol} من ${customer.name}`);
        refresh();
      } catch (error) {
        toastError(error.message);
      }
    }

    const modal = openModal({
      title: `تسجيل دفعة — ${customer.name}`,
      body: h('div', { class: 'stack' },
        amountField.element, methodField.element, referenceField.element, noteField.element),
      footer: [
        h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'تسجيل الدفعة', on: { click: submit } }),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });

    requestAnimationFrame(() => amountField.focus());
  }

  async function removeCustomer(customer) {
    const ok = await confirmDialog({
      title: 'حذف العميل',
      message: `سيتم حذف "${customer.name}" نهائياً. لا يمكن حذف عميل له فواتير أو مدفوعات مسجّلة.`,
      confirmLabel: 'حذف',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await deleteCustomer(customer.id);
      notifyDataChanged();
      toastOk('تم حذف العميل');
      refresh();
    } catch (error) {
      toastError(error.message);
    }
  }

  /* ------------------------------- الفلاتر ------------------------------- */

  const search = searchField({
    placeholder: 'بحث بالاسم أو الهاتف',
    value: state.query,
    label: 'بحث في العملاء',
    onInput: debounce((value) => { state.query = value; state.page = 1; drawTable(); }, 200),
  });

  const statusFilter = field({
    label: 'الحالة', name: 'status', value: 'all',
    options: [
      { value: 'all', label: 'جميع الحالات' },
      { value: 'active', label: 'نشط' },
      { value: 'inactive', label: 'غير نشط' },
    ],
    onChange: (event) => { state.status = event.target.value; state.page = 1; drawTable(); },
  });

  const balanceFilter = field({
    label: 'الرصيد', name: 'balance', value: 'all',
    options: [
      { value: 'all', label: 'جميع الأرصدة' },
      { value: 'due', label: 'عليه مديونية' },
      { value: 'clear', label: 'رصيد مسدّد' },
    ],
    onChange: (event) => { state.balance = event.target.value; state.page = 1; drawTable(); },
  });

  const filterBar = h('div', { class: 'filter-bar' },
    h('div', { class: 'filter-bar__row' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: 'بحث' }), search.element),
      statusFilter.element,
      balanceFilter.element,
      h('div', { class: 'filter-bar__actions' },
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: {
            click: async () => {
              try {
                await exportCustomers(filtered(), ledgers);
                toastOk('تم تصدير العملاء إلى ملف Excel');
              } catch (error) {
                toastError(`تعذّر التصدير: ${error.message}`);
              }
            },
          },
        }, h('span', { text: 'تصدير Excel' }), icon('download'))
      )
    )
  );

  drawTable();
  drawDetail();

  return h('div', { class: 'stack' },
    h('div', { class: 'page__head' },
      h('span'),
      h('div', { class: 'page__actions' },
        h('button', {
          class: 'btn btn--teal',
          attrs: { type: 'button' },
          on: { click: () => openCustomerForm() },
        }, h('span', { text: 'إضافة عميل' }), icon('plus'))
      )
    ),
    kpis,
    filterBar,
    h('div', { class: 'split-layout' }, tableHost, detailHost)
  );
}

/* ------------------------------------------------------------------ */
/* كشف الحساب                                                          */
/* ------------------------------------------------------------------ */

export async function renderStatement(context) {
  const customer = await getCustomer(context.params.id);

  if (!customer) {
    return card({
      body: emptyState({
        iconName: 'search',
        title: 'العميل غير موجود',
        action: h('a', { class: 'btn btn--primary', href: '#/customers' }, h('span', { text: 'العودة إلى العملاء' })),
      }),
    });
  }

  const s = settings();
  const symbol = s.currencySymbol;
  const { entries, balanceMinor } = await customerStatement(customer.id);

  return h('div', { class: 'stack' },
    h('nav', { class: 'breadcrumb' },
      h('a', { href: '#/customers', text: 'العملاء' }),
      icon('chevronLeft'),
      h('span', { text: customer.name })
    ),

    h('div', { class: 'page__head' },
      h('div', { class: 'row', style: { gap: '12px' } },
        avatar(customer.name),
        h('div', null,
          h('h2', { class: 'page__title', text: customer.name }),
          customer.phone ? h('p', { class: 'field__hint' }, ltr(customer.phone)) : null
        )
      ),
      h('div', { class: 'page__actions' },
        h('button', {
          class: 'btn btn--secondary',
          attrs: { type: 'button' },
          on: { click: () => printReport({
            title: 'كشف الحساب',
            subtitle: customer.phone ? `${customer.name} — ${customer.phone}` : customer.name,
            stats: [{ label: 'الرصيد الحالي', value: `${formatAmount(balanceMinor)} ${symbol}` }],
            tables: [{
              title: 'الحركات المالية',
              header: ['التاريخ', 'النوع', 'المرجع', 'مدين (عليه)', 'دائن (له)', 'الرصيد التراكمي'],
              rows: entries.map((entry) => [
                formatDateTime(entry.at, s.dateFormat),
                entry.kind === 'invoice' ? 'فاتورة' : 'دفعة',
                entry.label,
                entry.debitMinor > 0 ? `${formatAmount(entry.debitMinor)} ${symbol}` : '—',
                entry.creditMinor > 0 ? `${formatAmount(entry.creditMinor)} ${symbol}` : '—',
                `${formatAmount(entry.balanceMinor)} ${symbol}`,
              ]),
            }],
          }) },
        }, icon('printer'), h('span', { text: 'طباعة كشف الحساب' })),
        h('span', {
          class: 'badge',
          style: {
            background: balanceMinor > 0 ? 'var(--red-soft)' : 'var(--green-soft)',
            color: balanceMinor > 0 ? 'var(--red)' : 'var(--green)',
            'font-size': '15px',
            padding: '8px 16px',
          },
        }, 'الرصيد: ', ltr(formatAmount(balanceMinor)), ` ${symbol}`)
      )
    ),

    card({
      title: 'كشف الحساب',
      titleIcon: 'history',
      flush: true,
      body: dataTable({
        caption: `كشف حساب ${customer.name}`,
        columns: [
          { key: 'at', label: 'التاريخ', render: (entry) => ltr(formatDateTime(entry.at, s.dateFormat)) },
          {
            key: 'kind',
            label: 'النوع',
            render: (entry) => badge(entry.kind === 'invoice' ? 'فاتورة' : 'دفعة',
              entry.kind === 'invoice' ? 'blue' : 'green'),
          },
          {
            key: 'label',
            label: 'المرجع',
            render: (entry) => (entry.kind === 'invoice'
              ? h('a', { href: `#/invoices/${entry.ref}` }, ltr(entry.label))
              : h('span', { text: entry.label })),
          },
          {
            key: 'debit',
            label: 'مدين (عليه)',
            render: (entry) => (entry.debitMinor > 0
              ? h('span', { style: { color: 'var(--red)' } }, ltr(formatAmount(entry.debitMinor)), ` ${symbol}`)
              : '—'),
          },
          {
            key: 'credit',
            label: 'دائن (له)',
            render: (entry) => (entry.creditMinor > 0
              ? h('span', { style: { color: 'var(--green)' } }, ltr(formatAmount(entry.creditMinor)), ` ${symbol}`)
              : '—'),
          },
          {
            key: 'balance',
            label: 'الرصيد التراكمي',
            render: (entry) => h('span', { style: { 'font-weight': '600' } },
              ltr(formatAmount(entry.balanceMinor)), ` ${symbol}`),
          },
        ],
        rows: entries,
        empty: {
          iconName: 'history',
          title: 'لا حركات على الحساب',
          text: 'لم تُسجَّل فواتير آجلة أو مدفوعات لهذا العميل.',
        },
      }),
    })
  );
}
