/** المنتجات — مرجع: UI/03-products-list.png */

import { h, render as renderInto, ltr, debounce } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, badge, searchField, field, pagination, emptyState, alertBox } from '../components/ui.js';
import { dataTable, thumbCell, actionButtons, actionButton } from '../components/table.js';
import { openModal, toastOk, toastError, confirmDialog } from '../components/feedback.js';
import {
  listProducts, listCategories, deleteProduct, stockStatus,
  STOCK_LABEL, STOCK_TONE, STOCK_STATUS,
} from '../repositories/products.js';
import { settings } from '../repositories/settings.js';
import { formatAmount, formatInt } from '../utils/format.js';
import { notifyDataChanged } from '../state/store.js';
import { navigate, refresh, href } from '../router.js';
import { exportProducts, parseProductsFile, commitProductsImport, downloadProductTemplate } from '../services/excel.js';

export async function render(context) {
  const symbol = settings().currencySymbol;

  const [products, categories] = await Promise.all([listProducts(), listCategories()]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const state = {
    query: context.query.q || '',
    category: context.query.category || 'all',
    stock: context.query.stock || 'all',
    sort: { key: 'name', dir: 'asc' },
    page: 1,
    pageSize: 20,
  };

  const tableHost = h('div');
  const kpiHost = h('div');

  /* -------------------------------- الفلترة -------------------------------- */

  function filtered() {
    const term = state.query.trim().toLowerCase();

    let rows = products.filter((product) => {
      if (state.category !== 'all' && product.categoryId !== state.category) return false;
      if (state.stock !== 'all' && stockStatus(product) !== state.stock) return false;
      if (!term) return true;
      return `${product.nameLower || product.name.toLowerCase()} ${product.sku} ${product.barcode || ''}`
        .toLowerCase().includes(term);
    });

    const { key, dir } = state.sort;
    const factor = dir === 'asc' ? 1 : -1;
    rows = rows.slice().sort((a, b) => {
      let left = a[key];
      let right = b[key];
      if (key === 'categoryId') {
        left = categoryById.get(a.categoryId)?.name || '';
        right = categoryById.get(b.categoryId)?.name || '';
      }
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left ?? '').localeCompare(String(right ?? ''), 'ar') * factor;
    });

    return rows;
  }

  /* --------------------------------- KPIs --------------------------------- */

  function drawKpis() {
    const active = products.filter((product) => product.isActive !== false);
    const low = active.filter((product) => stockStatus(product) === STOCK_STATUS.LOW).length;
    const out = active.filter((product) => stockStatus(product) === STOCK_STATUS.OUT).length;
    const stockValue = active.reduce((sum, product) => sum + product.quantity * product.costMinor, 0);

    renderInto(kpiHost, kpiGrid(
      kpi({ label: 'إجمالي المنتجات', value: formatInt(active.length), unit: 'منتج', iconName: 'products', tone: 'teal' }),
      kpi({ label: 'قيمة المخزون', value: formatAmount(stockValue), unit: symbol, iconName: 'database', tone: 'blue' }),
      kpi({ label: 'مخزون منخفض', value: formatInt(low), unit: 'منتج', iconName: 'boxOpen', tone: 'amber' }),
      kpi({ label: 'غير متوفر', value: formatInt(out), unit: 'منتج', iconName: 'packageX', tone: 'red' })
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
          caption: 'قائمة المنتجات',
          sort: state.sort,
          onSort: (key) => {
            state.sort = state.sort.key === key
              ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
              : { key, dir: 'asc' };
            drawTable();
          },
          columns: [
            {
              key: 'image',
              label: 'صورة',
              render: (product) => thumbCell(product.image, product.name),
            },
            { key: 'sku', label: 'SKU', sortable: true, render: (product) => ltr(product.sku) },
            {
              key: 'name',
              label: 'اسم المنتج',
              sortable: true,
              render: (product) => h('div', null,
                h('div', { class: 'table__main', text: product.name }),
                product.isActive === false ? h('div', { class: 'table__sub', text: 'غير نشط' }) : null
              ),
            },
            {
              key: 'categoryId',
              label: 'الفئة',
              sortable: true,
              render: (product) => categoryById.get(product.categoryId)?.name || '—',
            },
            {
              key: 'priceMinor',
              label: 'سعر البيع',
              sortable: true,
              render: (product) => h('span', null, ltr(formatAmount(product.priceMinor)), ` ${symbol}`),
            },
            {
              key: 'quantity',
              label: 'المخزون',
              sortable: true,
              render: (product) => ltr(product.quantity),
            },
            {
              key: 'status',
              label: 'الحالة',
              render: (product) => {
                const status = stockStatus(product);
                return badge(STOCK_LABEL[status], STOCK_TONE[status]);
              },
            },
            {
              key: 'actions',
              label: 'الإجراءات',
              className: 'is-actions',
              render: (product) => actionButtons(
                actionButton({
                  label: 'تعديل',
                  iconName: 'pencil',
                  tone: 'primary',
                  onClick: () => navigate(`/products/${product.id}/edit`),
                }),
                actionButton({
                  label: 'حذف',
                  iconName: 'trash',
                  tone: 'danger',
                  onClick: () => removeProduct(product),
                }),
                actionButton({
                  label: 'عرض',
                  iconName: 'eye',
                  onClick: () => navigate(`/products/${product.id}`),
                })
              ),
            },
          ],
          rows: pageRows,
          empty: products.length === 0
            ? {
                iconName: 'products',
                title: 'لا توجد منتجات',
                text: 'ابدأ بإضافة أول منتج، أو استورد قائمتك من ملف Excel.',
              }
            : {
                iconName: 'search',
                title: 'لا نتائج مطابقة',
                text: 'جرّب تعديل البحث أو الفلاتر.',
              },
        }),
        total > 0
          ? pagination({
              page: state.page,
              pageSize: state.pageSize,
              total,
              unit: 'منتج',
              onPage: (page) => { state.page = page; drawTable(); },
              onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
            })
          : null
      ),
    }));
  }

  async function removeProduct(product) {
    const ok = await confirmDialog({
      title: 'حذف المنتج',
      message: `سيتم حذف "${product.name}" نهائياً. لا يمكن التراجع عن هذا الإجراء.`,
      confirmLabel: 'حذف',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await deleteProduct(product.id);
      notifyDataChanged();
      toastOk('تم حذف المنتج');
      refresh();
    } catch (error) {
      toastError(error.message);
    }
  }

  /* ------------------------------ شريط الفلاتر ------------------------------ */

  const search = searchField({
    placeholder: 'بحث باسم المنتج أو SKU',
    value: state.query,
    label: 'بحث في المنتجات',
    onInput: debounce((value) => {
      state.query = value;
      state.page = 1;
      drawTable();
    }, 200),
  });

  const categoryFilter = field({
    label: 'الفئة',
    name: 'category',
    value: state.category,
    options: [{ value: 'all', label: 'الكل' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
    onChange: (event) => { state.category = event.target.value; state.page = 1; drawTable(); },
  });

  const stockFilter = field({
    label: 'حالة المخزون',
    name: 'stock',
    value: state.stock,
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
        h('label', { class: 'field__label', for: search.input.id || undefined, text: 'بحث' }),
        search.element
      ),
      categoryFilter.element,
      stockFilter.element,
      h('div', { class: 'filter-bar__actions' },
        h('button', {
          class: 'btn btn--outline',
          attrs: { type: 'button' },
          on: { click: openImportDialog },
        }, h('span', { text: 'استيراد Excel' }), icon('upload')),
        h('button', {
          class: 'btn btn--outline',
          attrs: { type: 'button' },
          on: {
            click: async (event) => {
              const button = event.currentTarget;
              button.disabled = true;
              try {
                await exportProducts();
                toastOk('تم تصدير المنتجات إلى ملف Excel');
              } catch (error) {
                toastError(`تعذّر التصدير: ${error.message}`);
              } finally {
                button.disabled = false;
              }
            },
          },
        }, h('span', { text: 'تصدير Excel' }), icon('download'))
      )
    )
  );

  /* ------------------------------- الاستيراد ------------------------------- */

  function openImportDialog() {
    let parsed = null;
    let selectedFile = null;

    const resultHost = h('div');
    const fileInput = h('input', {
      type: 'file',
      accept: '.xlsx',
      attrs: { 'aria-label': 'اختر ملف Excel' },
      on: { change: (event) => handleFile(event.target.files[0]) },
    });

    const dropZone = h('label', { class: 'file-drop' },
      icon('excel', { class: 'file-drop__icon' }),
      h('span', { class: 'file-drop__title', text: 'اختر ملف Excel أو اسحبه هنا' }),
      h('span', { class: 'file-drop__hint', text: 'صيغة .xlsx فقط — الحد الأقصى 15 ميجابايت' }),
      fileInput
    );

    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('is-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-over'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-over');
      handleFile(event.dataTransfer.files[0]);
    });

    const modeField = field({
      label: 'المنتجات الموجودة مسبقاً (نفس SKU)',
      name: 'mode',
      value: 'skip',
      options: [
        { value: 'skip', label: 'تخطّيها وعدم تغييرها' },
        { value: 'update', label: 'تحديث بياناتها من الملف' },
      ],
    });

    const importButton = h('button', {
      class: 'btn btn--primary',
      attrs: { type: 'button' },
      disabled: true,
      text: 'استيراد',
      on: { click: doImport },
    });

    async function handleFile(file) {
      if (!file) return;
      selectedFile = file;
      renderInto(resultHost, h('p', { class: 'field__hint', text: 'جارٍ قراءة الملف…' }));
      importButton.disabled = true;

      try {
        parsed = await parseProductsFile(file);
        showPreview();
      } catch (error) {
        parsed = null;
        renderInto(resultHost, alertBox(error.message, 'error'));
      }
    }

    function showPreview() {
      const { valid, invalid, newCategories } = parsed;
      importButton.disabled = valid.length === 0;

      renderInto(resultHost,
        h('div', { class: 'stack', style: { gap: '12px' } },
          h('div', { class: 'row', style: { gap: '10px' } },
            badge(`${valid.length} صف صالح`, valid.length > 0 ? 'green' : 'gray'),
            invalid.length > 0 ? badge(`${invalid.length} صف مرفوض`, 'red') : null,
            newCategories.length > 0 ? badge(`${newCategories.length} فئة جديدة`, 'blue') : null
          ),
          newCategories.length > 0
            ? alertBox(`سيتم إنشاء الفئات التالية: ${newCategories.join('، ')}`, 'info')
            : null,
          invalid.length > 0
            ? h('div', { class: 'stack', style: { gap: '6px' } },
                h('p', { class: 'field__label', text: 'صفوف لن تُستورد:' }),
                h('div', { style: { 'max-height': '180px', 'overflow-y': 'auto' } },
                  ...invalid.slice(0, 40).map((row) =>
                    h('p', { class: 'field__error' }, `الصف ${row.row}: ${row.errors.join('، ')}`)
                  ),
                  invalid.length > 40
                    ? h('p', { class: 'field__hint', text: `و${invalid.length - 40} صفاً آخر…` })
                    : null
                )
              )
            : null,
          valid.length > 0 ? modeField.element : null
        )
      );
    }

    async function doImport() {
      if (!parsed || parsed.valid.length === 0) return;
      importButton.disabled = true;
      importButton.textContent = 'جارٍ الاستيراد…';

      try {
        const result = await commitProductsImport(parsed.valid, {
          mode: modeField.value,
          createCategories: true,
        });

        notifyDataChanged();
        modal.close();

        const parts = [];
        if (result.created) parts.push(`${result.created} منتجاً جديداً`);
        if (result.updated) parts.push(`${result.updated} منتجاً محدّثاً`);
        if (result.skipped) parts.push(`${result.skipped} متخطّى`);
        if (result.failed.length) parts.push(`${result.failed.length} فشل`);

        if (result.failed.length > 0) {
          toastError(`اكتمل الاستيراد مع أخطاء: ${parts.join('، ')}. أول خطأ: ${result.failed[0].error}`);
        } else {
          toastOk(`تم الاستيراد: ${parts.join('، ') || 'لا تغييرات'}`);
        }
        refresh();
      } catch (error) {
        toastError(`فشل الاستيراد: ${error.message}`);
        importButton.disabled = false;
        importButton.textContent = 'استيراد';
      }
    }

    const modal = openModal({
      title: 'استيراد منتجات من Excel',
      size: 'lg',
      body: [
        alertBox('يجب أن يحتوي الملف على الأعمدة: SKU، اسم المنتج، الفئة، الوحدة، سعر الشراء، سعر البيع. نزّل القالب لضمان التنسيق الصحيح.', 'info'),
        dropZone,
        resultHost,
      ],
      footer: [
        importButton,
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: {
            click: async () => {
              await downloadProductTemplate();
              toastOk('تم تنزيل القالب');
            },
          },
        }, icon('download'), h('span', { text: 'تنزيل القالب' })),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });
  }

  /* -------------------------------- التركيب -------------------------------- */

  drawKpis();
  drawTable();

  return h('div', { class: 'stack' },
    h('div', { class: 'page__head' },
      h('span'),
      h('div', { class: 'page__actions' },
        h('a', { class: 'btn btn--primary', href: '#/products/new' },
          h('span', { text: 'إضافة منتج' }), icon('plus'))
      )
    ),
    kpiHost,
    filterBar,
    tableHost
  );
}
