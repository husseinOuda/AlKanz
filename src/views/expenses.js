/** المصروفات — مرجع: UI/09-expenses.png */

import { h, render as renderInto, ltr, debounce } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, badge, searchField, field, pagination, rowMenu, alertBox } from '../components/ui.js';
import { dataTable } from '../components/table.js';
import { openPanel, openModal, toastOk, toastError, confirmDialog } from '../components/feedback.js';
import {
  listExpenses, createExpense, updateExpense, deleteExpense,
  listExpenseCategories, PAYMENT_METHODS, methodLabel,
} from '../repositories/expenses.js';
import { validateExpense, LIMITS } from '../validation/validators.js';
import { processAttachment } from '../services/images.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, formatInt, formatBytes } from '../utils/format.js';
import { formatDateTime, dayKey, monthKey } from '../utils/dates.js';
import { toMajor } from '../utils/money.js';
import { notifyDataChanged } from '../state/store.js';
import { refresh } from '../router.js';
import { exportExpenses } from '../services/excel.js';

export async function render(context) {
  const s = settings();
  const symbol = s.currencySymbol;

  const [expenses, categories] = await Promise.all([listExpenses(), listExpenseCategories()]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const today = dayKey(new Date());
  const thisMonth = monthKey(new Date());

  const state = {
    query: '',
    category: 'all',
    from: `${thisMonth}-01`,
    to: today,
    page: 1,
    pageSize: 10,
  };

  const tableHost = h('div');
  const kpiHost = h('div');

  function filtered() {
    const term = state.query.trim().toLowerCase();
    return expenses.filter((expense) => {
      if (state.category !== 'all' && expense.categoryId !== state.category) return false;
      if (state.from && expense.dayKey < state.from) return false;
      if (state.to && expense.dayKey > state.to) return false;
      if (!term) return true;
      const category = categoryById.get(expense.categoryId)?.name || '';
      return `${expense.title || ''} ${expense.reference || ''} ${expense.note || ''} ${category}`
        .toLowerCase().includes(term);
    });
  }

  /* --------------------------------- KPIs --------------------------------- */

  function drawKpis() {
    const rows = filtered();
    const todayTotal = expenses.filter((e) => e.dayKey === today);
    const monthTotal = expenses.filter((e) => e.dayKey.startsWith(thisMonth));

    const sum = (list) => list.reduce((total, expense) => total + expense.amountMinor, 0);
    const average = rows.length > 0 ? Math.round(sum(rows) / rows.length) : 0;

    // أعلى فئة في النطاق المحدد
    const byCategory = new Map();
    for (const expense of rows) {
      byCategory.set(expense.categoryId, (byCategory.get(expense.categoryId) || 0) + expense.amountMinor);
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];

    renderInto(kpiHost, kpiGrid(
      kpi({
        label: 'متوسط المصروف', value: formatAmount(average), unit: symbol,
        iconName: 'trendUp', tone: 'amber', subtext: 'للمصروف الواحد',
      }),
      kpi({
        label: 'أعلى فئة',
        value: h('span', { style: { 'font-size': '20px' }, text: top ? (categoryById.get(top[0])?.name || 'أخرى') : '—' }),
        iconName: 'tag', tone: 'violet',
        subtext: top ? `${formatAmount(top[1])} ${symbol}` : 'لا مصروفات',
      }),
      kpi({
        label: 'مصروفات الشهر', value: formatAmount(sum(monthTotal)), unit: symbol,
        iconName: 'calendar', tone: 'green', subtext: `عدد ${formatInt(monthTotal.length)}`,
      }),
      kpi({
        label: 'مصروفات اليوم', value: formatAmount(sum(todayTotal)), unit: symbol,
        iconName: 'calendar', tone: 'blue', subtext: `عدد ${formatInt(todayTotal.length)}`,
      })
    ));
  }

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
          caption: 'قائمة المصروفات',
          columns: [
            {
              key: 'createdAt',
              label: 'التاريخ',
              render: (expense) => ltr(formatDateTime(expense.createdAt, s.dateFormat)),
            },
            {
              key: 'categoryId',
              label: 'الفئة',
              render: (expense) => {
                const category = categoryById.get(expense.categoryId);
                return h('span', { class: 'row', style: { gap: '8px', 'flex-wrap': 'nowrap' } },
                  h('span', {
                    style: {
                      width: '9px', height: '9px', 'border-radius': '50%', flex: 'none',
                      background: category?.color || 'var(--text-3)',
                    },
                  }),
                  h('span', { style: { 'font-weight': '600' }, text: category?.name || 'أخرى' })
                );
              },
            },
            { key: 'title', label: 'البيان', render: (expense) => expense.title || '—' },
            { key: 'method', label: 'طريقة الدفع', render: (expense) => methodLabel(expense.method) },
            {
              key: 'amountMinor',
              label: 'المبلغ',
              render: (expense) => h('span', { style: { 'font-weight': '600' } },
                ltr(formatAmount(expense.amountMinor)), ` ${symbol}`),
            },
            {
              key: 'attachment',
              label: 'المرفق',
              render: (expense) => {
                if (!expense.attachment?.dataUrl) return h('span', { class: 'table__sub', text: '—' });
                const isPdf = expense.attachment.type === 'application/pdf';
                return h('button', {
                  class: 'icon-btn',
                  attrs: { type: 'button', 'aria-label': `عرض مرفق ${expense.title || 'المصروف'}` },
                  style: { color: isPdf ? 'var(--red)' : 'var(--green)' },
                  on: { click: () => openAttachment(expense) },
                }, icon(isPdf ? 'file' : 'image'));
              },
            },
            {
              key: 'actions',
              label: 'الإجراءات',
              className: 'is-actions',
              render: (expense) => rowMenu([
                { label: 'تعديل', icon: 'pencil', onSelect: () => openExpensePanel(expense) },
                { label: 'حذف', icon: 'trash', danger: true, onSelect: () => removeExpense(expense) },
              ], { label: 'إجراءات المصروف' }),
            },
          ],
          rows: pageRows,
          empty: expenses.length === 0
            ? {
                iconName: 'expenses',
                title: 'لا مصروفات مسجّلة',
                text: 'سجّل مصروفاتك لتظهر في التقارير وحساب صافي الحركة.',
              }
            : { iconName: 'search', title: 'لا نتائج في هذه الفترة', text: 'جرّب توسيع نطاق التاريخ أو تغيير الفئة.' },
        }),
        total > 0
          ? pagination({
              page: state.page, pageSize: state.pageSize, total, unit: 'مصروف',
              onPage: (page) => { state.page = page; drawTable(); },
              onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
            })
          : null
      ),
    }));
  }

  function openAttachment(expense) {
    const { attachment } = expense;
    const isPdf = attachment.type === 'application/pdf';

    const modal = openModal({
      title: attachment.name || 'المرفق',
      size: 'lg',
      body: isPdf
        ? alertBox('ملف PDF مرفق. استخدم زر التنزيل لفتحه في قارئ PDF.', 'info')
        : h('img', {
            src: attachment.dataUrl,
            alt: `مرفق ${expense.title || 'المصروف'}`,
            style: { width: '100%', 'max-height': '65vh', 'object-fit': 'contain' },
          }),
      footer: [
        h('a', {
          class: 'btn btn--primary',
          href: attachment.dataUrl,
          download: attachment.name || 'attachment',
        }, icon('download'), h('span', { text: 'تنزيل' })),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إغلاق', on: { click: () => modal.close() } }),
      ],
    });
  }

  async function removeExpense(expense) {
    const ok = await confirmDialog({
      title: 'حذف المصروف',
      message: `سيتم حذف مصروف "${expense.title || formatAmount(expense.amountMinor)}" نهائياً.`,
      confirmLabel: 'حذف',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await deleteExpense(expense.id);
      notifyDataChanged();
      toastOk('تم حذف المصروف');
      refresh();
    } catch (error) {
      toastError(error.message);
    }
  }

  /* ---------------------------- لوحة إضافة/تعديل ---------------------------- */

  function openExpensePanel(existing = null) {
    let attachment = existing?.attachment || null;

    const dateField = field({
      label: 'التاريخ', name: 'date', type: 'date', required: true,
      value: existing?.dayKey || today,
    });

    const categoryField = field({
      label: 'الفئة', name: 'categoryId', required: true,
      value: existing?.categoryId || categories[0]?.id || '',
      options: categories.map((category) => ({ value: category.id, label: category.name })),
    });

    const amountField = field({
      label: 'المبلغ', name: 'amount', required: true, suffix: symbol,
      placeholder: 'المبلغ',
      value: existing ? String(toMajor(existing.amountMinor)) : '',
    });

    const titleField = field({
      label: 'البيان', name: 'title',
      placeholder: 'وصف مختصر للمصروف', value: existing?.title || '', maxLength: LIMITS.name,
    });

    const methodField = field({
      label: 'طريقة الدفع', name: 'method',
      value: existing?.method || 'cash',
      options: PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })),
    });

    const referenceField = field({
      label: 'رقم المرجع', name: 'reference',
      placeholder: 'أدخل رقم المرجع (اختياري)',
      value: existing?.reference || '', maxLength: LIMITS.reference,
    });

    const noteField = field({
      label: 'ملاحظة', name: 'note', rows: 3,
      placeholder: 'أدخل ملاحظة (اختياري)',
      value: existing?.note || '', maxLength: LIMITS.note, counter: true,
    });

    /* ------------------------------ الإيصال ------------------------------ */

    const attachmentHost = h('div');

    function drawAttachment() {
      if (attachment) {
        renderInto(attachmentHost,
          h('div', { class: 'file-preview' },
            attachment.type === 'application/pdf'
              ? h('div', { class: 'table__thumb table__thumb--ph', style: { width: '54px', height: '54px', color: 'var(--red)' } }, icon('file'))
              : h('img', { src: attachment.dataUrl, alt: '' }),
            h('div', { style: { flex: '1', 'min-width': '0' } },
              h('div', { class: 'file-preview__name', text: attachment.name }),
              h('div', { class: 'file-preview__meta', text: formatBytes(attachment.bytes) })
            ),
            h('button', {
              class: 'icon-btn icon-btn--danger',
              attrs: { type: 'button', 'aria-label': 'إزالة المرفق' },
              on: { click: () => { attachment = null; drawAttachment(); } },
            }, icon('trash'))
          )
        );
        return;
      }

      const input = h('input', {
        type: 'file',
        accept: 'image/png,image/jpeg,image/webp,application/pdf',
        attrs: { 'aria-label': 'اختر ملف الإيصال' },
        on: { change: (event) => handleAttachment(event.target.files[0]) },
      });

      const drop = h('label', { class: 'file-drop' },
        icon('cloudUp', { class: 'file-drop__icon' }),
        h('span', { class: 'file-drop__title', text: 'اختر ملفاً' }),
        h('span', { class: 'file-drop__hint', text: 'PNG، JPG، PDF — الحد الأقصى 5MB' }),
        input
      );

      drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('is-over');
        handleAttachment(event.dataTransfer.files[0]);
      });

      renderInto(attachmentHost, drop);
    }

    async function handleAttachment(file) {
      if (!file) return;
      try {
        attachment = await processAttachment(file);
        drawAttachment();
        toastOk('تم إرفاق الإيصال');
      } catch (error) {
        toastError(error.message);
      }
    }

    drawAttachment();

    /* ------------------------------- الحفظ ------------------------------- */

    async function submit() {
      amountField.setError(null);
      categoryField.setError(null);
      dateField.setError(null);

      const result = validateExpense({
        amount: amountField.value,
        categoryId: categoryField.value,
        dayKey: dateField.value,
        method: methodField.value,
        title: titleField.value,
        reference: referenceField.value,
        note: noteField.value,
        attachment,
      });

      if (!result.ok) {
        for (const [key, message] of Object.entries(result.errors)) {
          ({ amount: amountField, categoryId: categoryField, dayKey: dateField }[key])?.setError(message);
        }
        const first = Object.keys(result.errors)[0];
        ({ amount: amountField, categoryId: categoryField, dayKey: dateField }[first])?.focus();
        return;
      }

      try {
        if (existing) await updateExpense(existing.id, result.value);
        else await createExpense(result.value);

        notifyDataChanged();
        panel.close();
        toastOk(existing ? 'تم حفظ التعديلات' : 'تم تسجيل المصروف');
        refresh();
      } catch (error) {
        toastError(error.message);
      }
    }

    const panel = openPanel({
      title: existing ? 'تعديل مصروف' : 'إضافة مصروف جديد',
      body: [
        dateField.element,
        categoryField.element,
        amountField.element,
        titleField.element,
        methodField.element,
        referenceField.element,
        noteField.element,
        h('div', { class: 'field' },
          h('span', { class: 'field__label', text: 'إيصال' }),
          attachmentHost
        ),
      ],
      footer: [
        h('button', { class: 'btn btn--success btn--block', attrs: { type: 'button' }, text: 'حفظ المصروف', on: { click: submit } }),
        h('button', { class: 'btn btn--ghost btn--block', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => panel.close() } }),
      ],
    });

    requestAnimationFrame(() => amountField.focus());
  }

  /* ------------------------------- الفلاتر ------------------------------- */

  const applyFilters = () => { state.page = 1; drawKpis(); drawTable(); };

  const search = searchField({
    placeholder: 'بحث',
    label: 'بحث في المصروفات',
    onInput: debounce((value) => { state.query = value; applyFilters(); }, 200),
  });

  const fromField = field({
    label: 'من تاريخ', name: 'from', type: 'date', value: state.from,
    onChange: (event) => { state.from = event.target.value; applyFilters(); },
  });

  const toField = field({
    label: 'إلى تاريخ', name: 'to', type: 'date', value: state.to,
    onChange: (event) => { state.to = event.target.value; applyFilters(); },
  });

  const categoryFilter = field({
    label: 'الفئة', name: 'category', value: 'all',
    options: [{ value: 'all', label: 'الكل' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
    onChange: (event) => { state.category = event.target.value; applyFilters(); },
  });

  const filterBar = h('div', { class: 'filter-bar' },
    h('div', { class: 'filter-bar__row' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', text: 'بحث' }), search.element),
      fromField.element,
      toField.element,
      categoryFilter.element,
      h('div', { class: 'filter-bar__actions' },
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: {
            click: async () => {
              try {
                await exportExpenses(filtered(), categoryById);
                toastOk('تم تصدير المصروفات إلى ملف Excel');
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
        h('button', {
          class: 'btn btn--success',
          attrs: { type: 'button' },
          on: { click: () => openExpensePanel() },
        }, h('span', { text: 'إضافة مصروف' }), icon('plus'))
      )
    ),
    kpiHost,
    filterBar,
    tableHost
  );
}
