/** المخزون — مرجع: UI/05-inventory.png */

import { h, render as renderInto, ltr, debounce } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, badge, searchField, field, pagination, emptyState, rowMenu, alertBox } from '../components/ui.js';
import { dataTable, thumbCell } from '../components/table.js';
import { openPanel, openModal, toastOk, toastError } from '../components/feedback.js';
import { listProducts, listCategories, stockStatus, STOCK_LABEL, STOCK_TONE, STOCK_STATUS } from '../repositories/products.js';
import {
  recordAdjustment, recordStocktake, listReasons, lastMovementByProduct,
  movementsForProduct, MOVEMENT_LABEL,
} from '../repositories/inventory.js';
import { validateAdjustment, parseQuantity, LIMITS } from '../validation/validators.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, formatInt } from '../utils/format.js';
import { formatDate, formatDateTime } from '../utils/dates.js';
import { notifyDataChanged } from '../state/store.js';
import { refresh } from '../router.js';
import { exportInventory } from '../services/excel.js';

export async function render(context) {
  const s = settings();
  const symbol = s.currencySymbol;

  const [products, categories, reasons, lastMovements] = await Promise.all([
    listProducts(), listCategories(), listReasons(), lastMovementByProduct(),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const active = products.filter((product) => product.isActive !== false);

  const state = {
    query: '',
    category: 'all',
    stock: context.query.stock || 'all',
    page: 1,
    pageSize: 10,
  };

  const tableHost = h('div');

  function filtered() {
    const term = state.query.trim().toLowerCase();
    return active.filter((product) => {
      if (state.category !== 'all' && product.categoryId !== state.category) return false;
      if (state.stock !== 'all' && stockStatus(product) !== state.stock) return false;
      if (!term) return true;
      return `${product.nameLower || product.name.toLowerCase()} ${product.sku}`.includes(term);
    });
  }

  /* --------------------------------- KPIs --------------------------------- */

  const totalUnits = active.reduce((sum, product) => sum + product.quantity, 0);
  const stockValue = active.reduce((sum, product) => sum + product.quantity * product.costMinor, 0);
  const lowCount = active.filter((product) => stockStatus(product) === STOCK_STATUS.LOW).length;
  const outCount = active.filter((product) => stockStatus(product) === STOCK_STATUS.OUT).length;

  const kpis = kpiGrid(
    kpi({
      variant: 'stacked', label: 'إجمالي الوحدات', value: formatInt(totalUnits), unit: 'وحدة',
      iconName: 'products', tone: 'teal',
      link: { label: 'عرض التفاصيل', href: '#/inventory' },
    }),
    kpi({
      variant: 'stacked', label: 'قيمة المخزون', value: formatAmount(stockValue), unit: symbol,
      iconName: 'layers', tone: 'violet',
      link: { label: 'عرض التفاصيل', href: '#/reports?type=stock' },
    }),
    kpi({
      variant: 'stacked', label: 'مخزون منخفض', value: formatInt(lowCount), unit: 'منتجات',
      iconName: 'arrowDown', tone: 'amber',
      link: { label: 'عرض التفاصيل', href: '#/inventory?stock=low' },
    }),
    kpi({
      variant: 'stacked', label: 'نفد المخزون', value: formatInt(outCount), unit: 'منتجات',
      iconName: 'packageX', tone: 'red',
      link: { label: 'عرض التفاصيل', href: '#/inventory?stock=out' },
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
          caption: 'قائمة المخزون',
          columns: [
            { key: 'image', label: 'صورة', render: (product) => thumbCell(product.image, product.name) },
            {
              key: 'name',
              label: 'اسم المنتج',
              render: (product) => h('div', null,
                h('div', { class: 'table__main', text: product.name }),
                h('div', { class: 'table__sub', text: categoryById.get(product.categoryId)?.name || '' })
              ),
            },
            { key: 'sku', label: 'SKU', render: (product) => ltr(product.sku) },
            {
              key: 'quantity',
              label: 'الكمية الحالية',
              render: (product) => h('span', { style: { 'font-weight': '600' } }, ltr(product.quantity)),
            },
            { key: 'lowStockThreshold', label: 'الحد الأدنى', render: (product) => ltr(product.lowStockThreshold) },
            {
              key: 'status',
              label: 'الحالة',
              render: (product) => {
                const status = stockStatus(product);
                return badge(STOCK_LABEL[status], STOCK_TONE[status]);
              },
            },
            {
              key: 'lastMovement',
              label: 'آخر حركة',
              render: (product) => {
                const movement = lastMovements.get(product.id);
                if (!movement) return h('span', { class: 'table__sub', text: 'لا حركات' });
                const sign = movement.quantity >= 0 ? 'إضافة' : 'سحب';
                return h('div', null,
                  h('div', null, ltr(formatDate(movement.createdAt, s.dateFormat))),
                  h('div', { class: 'table__sub', text: `${sign} ${Math.abs(movement.quantity)} وحدة` })
                );
              },
            },
            {
              key: 'actions',
              label: 'الإجراءات',
              className: 'is-actions',
              render: (product) => rowMenu([
                { label: 'تسوية مخزون', icon: 'sliders', onSelect: () => openAdjustPanel(product) },
                { label: 'جرد هذا الصنف', icon: 'clipboard', onSelect: () => openStocktake(product) },
                { label: 'سجل الحركات', icon: 'history', onSelect: () => openHistory(product) },
                { label: 'تعديل المنتج', icon: 'pencil', onSelect: () => { window.location.hash = `#/products/${product.id}/edit`; } },
              ], { label: `إجراءات ${product.name}` }),
            },
          ],
          rows: pageRows,
          empty: {
            iconName: 'layers',
            title: active.length === 0 ? 'لا توجد منتجات' : 'لا نتائج مطابقة',
            text: active.length === 0
              ? 'أضف منتجات لتتمكّن من إدارة المخزون.'
              : 'جرّب تعديل البحث أو مسح الفلاتر.',
          },
        }),
        total > 0
          ? pagination({
              page: state.page, pageSize: state.pageSize, total, unit: 'منتج',
              onPage: (page) => { state.page = page; drawTable(); },
              onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
            })
          : null
      ),
    }));
  }

  /* ------------------------------- الفلاتر ------------------------------- */

  const search = searchField({
    placeholder: 'بحث باسم المنتج أو SKU',
    label: 'بحث في المخزون',
    onInput: debounce((value) => { state.query = value; state.page = 1; drawTable(); }, 200),
  });

  const categoryFilter = field({
    label: 'الفئة', name: 'category', value: state.category,
    options: [{ value: 'all', label: 'الكل' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
    onChange: (event) => { state.category = event.target.value; state.page = 1; drawTable(); },
  });

  const stockFilter = field({
    label: 'حالة المخزون', name: 'stock', value: state.stock,
    options: [
      { value: 'all', label: 'الكل' },
      { value: STOCK_STATUS.OK, label: 'متوفر' },
      { value: STOCK_STATUS.LOW, label: 'منخفض' },
      { value: STOCK_STATUS.OUT, label: 'نفد المخزون' },
    ],
    onChange: (event) => { state.stock = event.target.value; state.page = 1; drawTable(); },
  });

  const filterBar = h('div', { class: 'filter-bar' },
    h('div', { class: 'filter-bar__row' },
      h('div', { class: 'field' },
        h('label', { class: 'field__label', text: 'بحث' }),
        search.element
      ),
      categoryFilter.element,
      stockFilter.element,
      h('div', { class: 'filter-bar__actions' },
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: {
            click: () => {
              state.query = ''; state.category = 'all'; state.stock = 'all'; state.page = 1;
              search.input.value = '';
              categoryFilter.value = 'all';
              stockFilter.value = 'all';
              drawTable();
            },
          },
        }, h('span', { text: 'مسح الفلاتر' }), icon('close'))
      )
    )
  );

  /* --------------------------- لوحة تسوية المخزون --------------------------- */

  function openAdjustPanel(initialProduct) {
    let product = initialProduct;
    let direction = 1; // 1 إضافة، -1 سحب

    const currentField = field({
      label: 'المخزون الحالي', name: 'current',
      value: `${product.quantity} ${product.unit}`, disabled: true,
    });

    // اختيار المنتج من داخل اللوحة (كما في الصورة المرجعية)
    const productField = field({
      label: 'المنتج', name: 'productId', required: true,
      value: product.id,
      options: active.map((item) => ({ value: item.id, label: `${item.name} — ${item.sku}` })),
      onChange: (event) => {
        product = active.find((item) => item.id === event.target.value) || product;
        currentField.value = `${product.quantity} ${product.unit}`;
        drawProductPreview();
        updatePreview();
      },
    });

    const productPreview = h('div');
    function drawProductPreview() {
      renderInto(productPreview,
        h('div', { class: 'file-preview' },
          product.image
            ? h('img', { src: product.image, alt: '' })
            : h('div', { class: 'table__thumb table__thumb--ph', style: { width: '54px', height: '54px' } }, icon('package')),
          h('div', null,
            h('div', { class: 'file-preview__name', text: product.name }),
            h('div', { class: 'file-preview__meta' }, 'SKU: ', ltr(product.sku))
          )
        )
      );
    }
    drawProductPreview();

    const quantityField = field({
      label: 'الكمية', name: 'quantity', type: 'number', min: '0', required: true,
      value: '0',
      hint: 'أدخل كمية موجبة، ثم اختر نوع الحركة أعلاه',
    });

    const reasonField = field({
      label: 'السبب', name: 'reason', required: true,
      value: reasons[0]?.name || '',
      options: reasons.map((reason) => ({ value: reason.name, label: reason.name })),
    });

    const noteField = field({
      label: 'ملاحظة', name: 'note', rows: 3,
      placeholder: 'أدخل ملاحظة (اختياري)', maxLength: LIMITS.note, counter: true,
    });

    const previewLine = h('p', { class: 'field__hint' });
    const updatePreview = () => {
      const raw = parseQuantity(quantityField.value, { allowZero: true });
      const delta = Number.isNaN(raw) ? 0 : raw * direction;
      const after = product.quantity + delta;
      previewLine.textContent = `الرصيد بعد التسوية: ${after} ${product.unit}`;
      previewLine.style.color = after < 0 ? 'var(--red)' : 'var(--text-3)';
    };
    quantityField.input.addEventListener('input', updatePreview);
    updatePreview();

    const typeButtons = h('div', { class: 'segmented' },
      h('button', {
        class: 'segmented__btn',
        attrs: { type: 'button', 'aria-pressed': 'true' },
        on: { click: (event) => setDirection(1, event.currentTarget) },
      }, icon('plus'), h('span', { text: 'إضافة' })),
      h('button', {
        class: 'segmented__btn',
        attrs: { type: 'button', 'aria-pressed': 'false' },
        on: { click: (event) => setDirection(-1, event.currentTarget) },
      }, icon('minus'), h('span', { text: 'سحب' }))
    );

    function setDirection(value, button) {
      direction = value;
      for (const child of typeButtons.children) {
        child.setAttribute('aria-pressed', String(child === button));
      }
      updatePreview();
    }

    async function submit() {
      quantityField.setError(null);
      reasonField.setError(null);

      const magnitude = parseQuantity(quantityField.value, { allowZero: false });
      if (Number.isNaN(magnitude) || magnitude <= 0) {
        quantityField.setError('أدخل كمية أكبر من صفر');
        quantityField.focus();
        return;
      }

      const result = validateAdjustment({
        productId: product.id,
        quantity: magnitude * direction,
        reason: reasonField.value,
        note: noteField.value,
      });

      if (!result.ok) {
        for (const [key, message] of Object.entries(result.errors)) {
          ({ quantity: quantityField, reason: reasonField }[key])?.setError(message);
        }
        return;
      }

      try {
        await recordAdjustment({ ...result.value, allowNegative: s.allowNegativeStock });
        notifyDataChanged();
        panel.close();
        toastOk(`تمت تسوية مخزون "${product.name}"`);
        refresh();
      } catch (error) {
        toastError(error.message);
      }
    }

    const panel = openPanel({
      title: 'تعديل المخزون',
      body: [
        productField.element,
        productPreview,
        currentField.element,
        h('div', { class: 'field' },
          h('span', { class: 'field__label', text: 'نوع الحركة' }),
          typeButtons
        ),
        h('div', null, quantityField.element, previewLine),
        reasonField.element,
        noteField.element,
      ],
      footer: [
        h('button', { class: 'btn btn--primary btn--block', attrs: { type: 'button' }, text: 'حفظ التسوية', on: { click: submit } }),
        h('button', { class: 'btn btn--ghost btn--block', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => panel.close() } }),
      ],
    });

    requestAnimationFrame(() => quantityField.focus());
  }

  /* --------------------------------- الجرد --------------------------------- */

  function openStocktake(product) {
    const countedField = field({
      label: 'الكمية المعدودة فعلياً', name: 'counted', type: 'number', min: '0', required: true,
      value: String(product.quantity),
      hint: `الكمية المسجّلة في النظام: ${product.quantity} ${product.unit}`,
    });

    const noteField = field({
      label: 'ملاحظة', name: 'note', rows: 2, maxLength: LIMITS.note,
      placeholder: 'ملاحظة اختيارية عن الجرد',
    });

    const diffLine = h('p', { class: 'field__hint' });
    const updateDiff = () => {
      const counted = parseQuantity(countedField.value);
      if (Number.isNaN(counted)) { diffLine.textContent = 'أدخل عدداً صحيحاً غير سالب'; return; }
      const delta = counted - product.quantity;
      diffLine.textContent = delta === 0
        ? 'لا فرق — لن تُسجَّل حركة'
        : `الفرق: ${delta > 0 ? '+' : ''}${delta} ${product.unit}`;
      diffLine.style.color = delta === 0 ? 'var(--text-3)' : delta > 0 ? 'var(--green)' : 'var(--red)';
    };
    countedField.input.addEventListener('input', updateDiff);
    updateDiff();

    async function submit() {
      const counted = parseQuantity(countedField.value);
      if (Number.isNaN(counted)) {
        countedField.setError('أدخل عدداً صحيحاً غير سالب');
        return;
      }

      try {
        const result = await recordStocktake({
          productId: product.id,
          countedQuantity: counted,
          note: noteField.value,
        });
        modal.close();
        if (result.delta === 0) {
          toastOk('الجرد مطابق — لم تُسجَّل أي حركة');
        } else {
          notifyDataChanged();
          toastOk(`تم تسجيل الجرد. الفرق ${result.delta > 0 ? '+' : ''}${result.delta}`);
          refresh();
        }
      } catch (error) {
        toastError(error.message);
      }
    }

    const modal = openModal({
      title: `جرد: ${product.name}`,
      body: [
        alertBox('الجرد يضبط الكمية على ما عددته فعلياً ويسجّل الفرق كحركة بسبب «جرد».', 'info'),
        countedField.element,
        diffLine,
        noteField.element,
      ],
      footer: [
        h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'حفظ الجرد', on: { click: submit } }),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });
  }

  /* ------------------------------ سجل الحركات ------------------------------ */

  async function openHistory(product) {
    const movements = await movementsForProduct(product.id, 100);

    const modal = openModal({
      title: `سجل حركات: ${product.name}`,
      size: 'lg',
      body: dataTable({
        caption: 'سجل الحركات',
        columns: [
          { key: 'createdAt', label: 'التاريخ', render: (m) => ltr(formatDateTime(m.createdAt, s.dateFormat)) },
          { key: 'type', label: 'النوع', render: (m) => badge(MOVEMENT_LABEL[m.type] || m.type, m.quantity >= 0 ? 'green' : 'amber') },
          {
            key: 'quantity',
            label: 'الكمية',
            render: (m) => h('span', {
              style: { color: m.quantity >= 0 ? 'var(--green)' : 'var(--red)', 'font-weight': '600' },
            }, ltr(`${m.quantity >= 0 ? '+' : ''}${m.quantity}`)),
          },
          { key: 'balanceAfter', label: 'الرصيد', render: (m) => ltr(m.balanceAfter) },
          { key: 'reason', label: 'السبب' },
          { key: 'note', label: 'ملاحظة' },
        ],
        rows: movements,
        empty: { iconName: 'history', title: 'لا حركات', text: 'لم تُسجَّل أي حركة لهذا المنتج بعد.' },
      }),
      footer: [h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إغلاق', on: { click: () => modal.close() } })],
    });
  }

  /* ------------------------------ جرد شامل ------------------------------ */

  function openBulkStocktake() {
    const rows = filtered();
    if (rows.length === 0) {
      toastError('لا توجد منتجات مطابقة للفلاتر الحالية');
      return;
    }

    const inputs = new Map();
    const list = h('div', { class: 'table-wrap', style: { 'max-height': '52vh' } },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null,
          h('th', { text: 'المنتج' }),
          h('th', { text: 'المسجّل' }),
          h('th', { text: 'المعدود فعلياً' })
        )),
        h('tbody', null, ...rows.map((product) => {
          const input = h('input', {
            class: 'input',
            type: 'number',
            min: '0',
            value: String(product.quantity),
            style: { width: '110px' },
            attrs: { 'aria-label': `الكمية المعدودة لـ ${product.name}` },
          });
          inputs.set(product.id, input);

          return h('tr', null,
            h('td', null,
              h('div', { class: 'table__main', text: product.name }),
              h('div', { class: 'table__sub' }, ltr(product.sku))
            ),
            h('td', null, ltr(product.quantity)),
            h('td', null, input)
          );
        }))
      )
    );

    async function submit() {
      const changes = [];
      for (const product of rows) {
        const counted = parseQuantity(inputs.get(product.id).value);
        if (Number.isNaN(counted) || counted === product.quantity) continue;
        changes.push({ product, counted });
      }

      if (changes.length === 0) {
        modal.close();
        toastOk('الجرد مطابق لكل الأصناف — لا حركات مسجّلة');
        return;
      }

      let applied = 0;
      const failures = [];
      for (const { product, counted } of changes) {
        try {
          await recordStocktake({ productId: product.id, countedQuantity: counted, note: 'جرد شامل' });
          applied += 1;
        } catch (error) {
          failures.push(`${product.name}: ${error.message}`);
        }
      }

      notifyDataChanged();
      modal.close();
      if (failures.length > 0) toastError(`سُجّل ${applied} صنفاً، وفشل ${failures.length}. أول خطأ: ${failures[0]}`);
      else toastOk(`تم تسجيل الجرد لـ ${applied} صنفاً`);
      refresh();
    }

    const modal = openModal({
      title: 'جرد المخزون',
      size: 'lg',
      body: [
        alertBox(`سيتم جرد ${rows.length} صنفاً حسب الفلاتر الحالية. غيّر الكميات المعدودة ثم احفظ — تُسجَّل حركة لكل فرق فقط.`, 'info'),
        list,
      ],
      footer: [
        h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'حفظ الجرد', on: { click: submit } }),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });
  }

  /* -------------------------------- التركيب -------------------------------- */

  drawTable();

  return h('div', { class: 'stack' },
    h('div', { class: 'page__head' },
      h('span'),
      h('div', { class: 'page__actions' },
        h('button', {
          class: 'btn btn--primary',
          attrs: { type: 'button' },
          on: {
            click: () => {
              if (active.length === 0) { toastError('لا توجد منتجات'); return; }
              openAdjustPanel(active[0]);
            },
          },
        }, h('span', { text: 'تسوية مخزون' }), icon('sliders')),
        h('button', {
          class: 'btn btn--outline',
          attrs: { type: 'button' },
          on: { click: openBulkStocktake },
        }, h('span', { text: 'جرد المخزون' }), icon('clipboard')),
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: {
            click: async () => {
              try {
                const rows = filtered().map((product) => ({
                  ...product,
                  status: stockStatus(product),
                  categoryName: categoryById.get(product.categoryId)?.name || '',
                  stockValueMinor: product.quantity * product.costMinor,
                }));
                await exportInventory(rows);
                toastOk('تم تصدير المخزون إلى ملف Excel');
              } catch (error) {
                toastError(`تعذّر التصدير: ${error.message}`);
              }
            },
          },
        }, h('span', { text: 'تصدير Excel' }), icon('download'))
      )
    ),
    kpis,
    filterBar,
    tableHost
  );
}
