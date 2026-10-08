/** نموذج المنتج وعرض تفاصيله — مرجع: UI/04-product-form.png */

import { h, render as renderInto, ltr } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, field, toggleField, badge, alertBox, emptyState, detailRow } from '../components/ui.js';
import { dataTable } from '../components/table.js';
import { toastOk, toastError, confirmDialog, promptDialog } from '../components/feedback.js';
import {
  getProduct, createProduct, updateProduct, listCategories, createCategory,
  stockStatus, STOCK_LABEL, STOCK_TONE,
} from '../repositories/products.js';
import { applyMovement, MOVEMENT, MOVEMENT_LABEL, movementsForProduct } from '../repositories/inventory.js';
import { tx, add } from '../db/db.js';
import { STORES } from '../db/schema.js';
import { validateProduct, LIMITS } from '../validation/validators.js';
import { processImage } from '../services/images.js';
import { settings } from '../repositories/settings.js';
import { bpToPercent, percentToBp, toMajor } from '../utils/money.js';
import { formatAmount, formatBytes } from '../utils/format.js';
import { formatDateTime } from '../utils/dates.js';
import { notifyDataChanged } from '../state/store.js';
import { navigate, refresh } from '../router.js';

const UNITS = ['قطعة', 'عبوة', 'كيس', 'علبة', 'كرتون', 'حزمة', 'كجم', 'جرام', 'لتر', 'متر'];

const TAX_OPTIONS = [
  { value: '0', label: 'معفى (0%)' },
  { value: '5', label: '5%' },
  { value: '10', label: '10%' },
  { value: '14', label: '14%' },
  { value: '15', label: '15% - ضريبة القيمة المضافة' },
];

export async function render(context) {
  const productId = context.params.id || null;
  const isEdit = Boolean(productId);
  const s = settings();
  const symbol = s.currencySymbol;

  const [categories, existing] = await Promise.all([
    listCategories(),
    productId ? getProduct(productId) : Promise.resolve(null),
  ]);

  if (isEdit && !existing) {
    return card({
      body: emptyState({
        iconName: 'search',
        title: 'المنتج غير موجود',
        text: 'ربما حُذف هذا المنتج.',
        action: h('a', { class: 'btn btn--primary', href: '#/products' }, h('span', { text: 'العودة إلى المنتجات' })),
      }),
    });
  }

  /* -------------------------------- الحقول -------------------------------- */

  let imageData = existing?.image || null;

  const nameField = field({
    label: 'اسم المنتج', name: 'name', required: true,
    placeholder: 'أدخل اسم المنتج', value: existing?.name || '', maxLength: LIMITS.name,
  });

  const skuField = field({
    label: 'SKU', name: 'sku', required: true,
    placeholder: 'أدخل SKU', value: existing?.sku || '', maxLength: LIMITS.sku,
    hint: 'رمز فريد لا يتكرر بين المنتجات',
  });

  const barcodeField = field({
    label: 'Barcode', name: 'barcode',
    placeholder: 'أدخل الباركود', value: existing?.barcode || '', maxLength: LIMITS.barcode,
  });

  const categoryField = field({
    label: 'الفئة', name: 'categoryId', required: true,
    value: existing?.categoryId || '',
    options: [
      { value: '', label: 'اختر الفئة' },
      ...categories.map((category) => ({ value: category.id, label: category.name })),
      { value: '__new', label: '+ فئة جديدة…' },
    ],
    onChange: async (event) => {
      if (event.target.value !== '__new') return;
      event.target.value = existing?.categoryId || '';

      const name = await promptDialog({
        title: 'فئة جديدة',
        label: 'اسم الفئة',
        hint: 'ستُضاف إلى قائمة الفئات وتصبح متاحة لكل المنتجات.',
        confirmLabel: 'إضافة',
      });
      if (!name?.trim()) return;

      try {
        const created = await createCategory({ name: name.trim(), sortOrder: categories.length + 1 });
        categories.push(created);
        const option = h('option', { value: created.id, text: created.name });
        event.target.insertBefore(option, event.target.lastElementChild);
        event.target.value = created.id;
        toastOk(`تمت إضافة الفئة "${created.name}"`);
      } catch (error) {
        toastError(error.message);
      }
    },
  });

  const unitField = field({
    label: 'الوحدة', name: 'unit', required: true,
    value: existing?.unit || '',
    options: [{ value: '', label: 'اختر الوحدة' }, ...UNITS.map((unit) => ({ value: unit, label: unit }))],
  });

  const descriptionField = field({
    label: 'الوصف', name: 'description', rows: 3,
    placeholder: 'أدخل وصف المنتج (اختياري)',
    value: existing?.description || '', maxLength: LIMITS.description, counter: true,
  });

  const costField = field({
    label: 'سعر الشراء', name: 'cost', required: true,
    placeholder: 'أدخل سعر الشراء', suffix: symbol,
    value: existing ? String(toMajor(existing.costMinor)) : '',
  });

  const priceField = field({
    label: 'سعر البيع', name: 'price', required: true,
    placeholder: 'أدخل سعر البيع', suffix: symbol,
    value: existing ? String(toMajor(existing.priceMinor)) : '',
  });

  const taxField = field({
    label: 'الضريبة', name: 'tax', required: true,
    value: String(bpToPercent(existing?.taxRateBp ?? s.defaultTaxRateBp)),
    options: TAX_OPTIONS,
  });

  const quantityField = field({
    label: 'الكمية الحالية', name: 'quantity', required: true, type: 'number', min: '0',
    value: String(existing?.quantity ?? 0),
    hint: isEdit ? 'التعديل هنا يُسجَّل كحركة مخزون بسبب «خطأ إدخال»' : 'الرصيد الافتتاحي',
  });

  const lowStockField = field({
    label: 'حد المخزون المنخفض', name: 'lowStockThreshold', type: 'number', min: '0',
    placeholder: 'أدخل حد المخزون المنخفض',
    value: String(existing?.lowStockThreshold ?? s.lowStockDefault),
  });

  const minimumStockField = field({
    label: 'الحد الأدنى للمخزون', name: 'minimumStock', type: 'number', min: '0',
    value: String(existing?.minimumStock ?? existing?.lowStockThreshold ?? s.lowStockDefault),
  });
  const maximumStockField = field({
    label: 'الحد الأقصى للمخزون', name: 'maximumStock', type: 'number', min: '0',
    value: String(existing?.maximumStock ?? 0), hint: '0 يعني غير محدد',
  });
  const reorderPointField = field({
    label: 'نقطة إعادة الطلب', name: 'reorderPoint', type: 'number', min: '0',
    value: String(existing?.reorderPoint ?? existing?.lowStockThreshold ?? s.lowStockDefault),
    hint: 'يظهر تنبيه إعادة الطلب عند وصول المخزون إلى هذه الكمية أو أقل.',
  });

  const activeToggle = toggleField({ label: 'نشط', name: 'isActive', checked: existing?.isActive !== false });

  /* ------------------------------ رفع الصورة ------------------------------ */

  const imageHost = h('div');

  function drawImage() {
    if (imageData) {
      renderInto(imageHost,
        h('div', { class: 'stack', style: { gap: '10px' } },
          h('img', {
            src: imageData,
            alt: 'معاينة صورة المنتج',
            style: { width: '100%', 'max-height': '200px', 'object-fit': 'contain', 'border-radius': '8px', background: 'var(--surface-2)' },
          }),
          h('button', {
            class: 'btn btn--sm btn--outline-danger btn--block',
            attrs: { type: 'button' },
            on: {
              click: () => {
                imageData = null;
                drawImage();
              },
            },
          }, icon('trash'), h('span', { text: 'إزالة الصورة' }))
        )
      );
      return;
    }

    const input = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      attrs: { 'aria-label': 'اختر صورة المنتج' },
      on: { change: (event) => handleImage(event.target.files[0]) },
    });

    const drop = h('label', { class: 'file-drop' },
      icon('cloudUp', { class: 'file-drop__icon' }),
      h('span', { class: 'file-drop__title', text: 'اختر صورة' }),
      h('span', { class: 'file-drop__hint', text: 'PNG, JPG, WEBP حتى 5MB' }),
      input
    );

    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      drop.classList.remove('is-over');
      handleImage(event.dataTransfer.files[0]);
    });

    renderInto(imageHost, drop);
  }

  async function handleImage(file) {
    if (!file) return;
    try {
      const processed = await processImage(file);
      imageData = processed.dataUrl;
      drawImage();
      toastOk(`تم رفع الصورة (${formatBytes(processed.bytes)} بعد الضغط)`);
    } catch (error) {
      toastError(error.message);
    }
  }

  drawImage();

  /* -------------------------------- الحفظ -------------------------------- */

  const allFields = {
    name: nameField, sku: skuField, categoryId: categoryField, unit: unitField,
    cost: costField, price: priceField, taxRate: taxField,
    quantity: quantityField, lowStockThreshold: lowStockField,
    minimumStock: minimumStockField, maximumStock: maximumStockField, reorderPoint: reorderPointField,
  };

  function clearErrors() {
    for (const item of Object.values(allFields)) item.setError(null);
  }

  function collect() {
    return {
      name: nameField.value,
      sku: skuField.value,
      barcode: barcodeField.value,
      categoryId: categoryField.value,
      unit: unitField.value,
      description: descriptionField.value,
      cost: costField.value,
      price: priceField.value,
      taxRate: taxField.value,
      quantity: quantityField.value,
      lowStockThreshold: lowStockField.value,
      minimumStock: minimumStockField.value,
      maximumStock: maximumStockField.value,
      reorderPoint: reorderPointField.value,
      isActive: activeToggle.checked,
      image: imageData,
    };
  }

  async function save({ andAnother = false } = {}) {
    clearErrors();

    const result = validateProduct(collect());
    if (!result.ok) {
      for (const [key, message] of Object.entries(result.errors)) {
        allFields[key]?.setError(message);
      }
      const firstKey = Object.keys(result.errors)[0];
      allFields[firstKey]?.focus();
      toastError('راجع الحقول المميزة بالأحمر');
      return;
    }

    // تحذير تجاري: البيع بأقل من التكلفة
    if (result.value.priceMinor < result.value.costMinor) {
      const ok = await confirmDialog({
        title: 'سعر البيع أقل من سعر الشراء',
        message: 'سيؤدي هذا إلى خسارة في كل عملية بيع لهذا المنتج. هل تريد المتابعة؟',
        confirmLabel: 'متابعة على أي حال',
      });
      if (!ok) return;
    }

    try {
      if (isEdit) {
        await updateProduct(productId, result.value);

        // تغيير الكمية يدوياً يمر عبر حركة مخزون مسجّلة، لا كتابة مباشرة
        const delta = result.value.quantity - existing.quantity;
        if (delta !== 0) {
          await tx([STORES.products, STORES.inventoryMovements], 'readwrite', (stores) =>
            applyMovement(stores, {
              productId,
              delta,
              type: delta > 0 ? MOVEMENT.IN : MOVEMENT.OUT,
              reason: 'خطأ إدخال',
              note: 'تعديل الكمية من نموذج المنتج',
              refType: 'product-form',
              refId: productId,
              allowNegative: true,
            })
          );
        }
        notifyDataChanged();
        toastOk('تم حفظ التعديلات');
        navigate('/products');
      } else {
        const created = await createProduct(result.value);

        if (created.quantity > 0) {
          await tx(STORES.inventoryMovements, 'readwrite', async (stores) => {
            // الكمية كُتبت مع المنتج؛ نسجّل الحركة فقط بدون تغيير الرصيد مرة أخرى
            await add(stores[STORES.inventoryMovements], {
              id: `mov_${created.id}`,
              productId: created.id,
              sku: created.sku,
              productName: created.name,
              type: MOVEMENT.INITIAL,
              quantity: created.quantity,
              balanceAfter: created.quantity,
              reason: 'رصيد افتتاحي',
              note: '',
              refType: 'product-create',
              refId: created.id,
              actor: 'المستخدم',
              createdAt: created.createdAt,
              dayKey: created.createdAt.slice(0, 10),
            });
          });
        }

        notifyDataChanged();
        toastOk(`تمت إضافة "${created.name}"`);

        if (andAnother) refresh();
        else navigate('/products');
      }
    } catch (error) {
      if (error.name === 'ConstraintError') {
        skuField.setError(error.message);
        skuField.focus();
      }
      toastError(error.message || 'تعذّر حفظ المنتج');
    }
  }

  /* -------------------------------- التخطيط -------------------------------- */

  const form = h('form', {
    attrs: { novalidate: '' },
    on: { submit: (event) => { event.preventDefault(); save(); } },
  },
    h('div', { class: 'form-layout' },
      card({
        body: h('div', { class: 'stack', style: { gap: '24px' } },
          h('div', { class: 'form-section' },
            h('h2', { class: 'form-section__title', text: 'البيانات الأساسية' }),
            h('div', { class: 'form-grid' }, nameField.element, skuField.element, barcodeField.element),
            h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
              categoryField.element, unitField.element),
            descriptionField.element
          ),
          h('div', { class: 'form-section' },
            h('h2', { class: 'form-section__title', text: 'التسعير' }),
            h('div', { class: 'form-grid' }, costField.element, priceField.element, taxField.element)
          )
        ),
      }),

      h('div', { class: 'stack' },
        card({ title: 'صورة المنتج', body: imageHost }),
        card({
          title: 'المخزون',
          body: h('div', { class: 'stack' }, quantityField.element, minimumStockField.element, maximumStockField.element, reorderPointField.element),
        }),
        card({
          body: h('div', { class: 'row', style: { 'justify-content': 'space-between' } },
            h('span', { style: { 'font-weight': '700' }, text: 'الحالة' }),
            activeToggle.element
          ),
        })
      )
    ),

    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn--primary', attrs: { type: 'submit' } },
        icon('save'), h('span', { text: isEdit ? 'حفظ التعديلات' : 'حفظ المنتج' })),
      !isEdit
        ? h('button', {
            class: 'btn btn--outline',
            attrs: { type: 'button' },
            text: 'حفظ وإضافة آخر',
            on: { click: () => save({ andAnother: true }) },
          })
        : null,
      h('a', { class: 'btn btn--ghost', href: '#/products', text: 'إلغاء' })
    )
  );

  return h('div', null,
    h('nav', { class: 'breadcrumb', attrs: { 'aria-label': 'مسار التنقل' } },
      h('a', { href: '#/products', text: 'المنتجات' }),
      icon('chevronLeft'),
      h('span', { text: isEdit ? 'تعديل المنتج' : 'إضافة منتج جديد' })
    ),
    h('div', { class: 'title-row' },
      h('div', { class: 'title-row__icon' }, icon('products')),
      h('h2', { class: 'page__title', text: isEdit ? `تعديل: ${existing.name}` : 'إضافة منتج جديد' })
    ),
    form
  );
}

/* ------------------------------------------------------------------ */
/* عرض تفاصيل المنتج                                                    */
/* ------------------------------------------------------------------ */

export async function renderView(context) {
  const product = await getProduct(context.params.id);
  if (!product) {
    return card({
      body: emptyState({ iconName: 'search', title: 'المنتج غير موجود', text: 'ربما حُذف هذا المنتج.' }),
    });
  }

  const s = settings();
  const symbol = s.currencySymbol;
  const [categories, movements] = await Promise.all([
    listCategories(),
    movementsForProduct(product.id, 50),
  ]);

  const category = categories.find((c) => c.id === product.categoryId);
  const status = stockStatus(product);
  const marginMinor = product.priceMinor - product.costMinor;
  const marginPercent = product.costMinor > 0 ? (marginMinor / product.costMinor) * 100 : 0;

  return h('div', null,
    h('nav', { class: 'breadcrumb' },
      h('a', { href: '#/products', text: 'المنتجات' }),
      icon('chevronLeft'),
      h('span', { text: product.name })
    ),

    h('div', { class: 'page__head' },
      h('div', { class: 'row' },
        h('h2', { class: 'page__title', text: product.name }),
        badge(STOCK_LABEL[status], STOCK_TONE[status]),
        product.isActive === false ? badge('غير نشط', 'gray') : null
      ),
      h('div', { class: 'page__actions' },
        h('a', { class: 'btn btn--primary', href: `#/products/${product.id}/edit` },
          icon('pencil'), h('span', { text: 'تعديل' })),
        h('a', { class: 'btn btn--ghost', href: '#/inventory', text: 'تسوية المخزون' })
      )
    ),

    h('div', { class: 'split-layout' },
      h('div', { class: 'stack' },
        card({
          title: 'سجل حركات المخزون',
          titleIcon: 'history',
          flush: true,
          body: dataTable({
            caption: `حركات مخزون ${product.name}`,
            columns: [
              {
                key: 'createdAt',
                label: 'التاريخ',
                render: (movement) => ltr(formatDateTime(movement.createdAt, s.dateFormat)),
              },
              {
                key: 'type',
                label: 'النوع',
                render: (movement) => badge(
                  MOVEMENT_LABEL[movement.type] || movement.type,
                  movement.quantity >= 0 ? 'green' : 'amber'
                ),
              },
              {
                key: 'quantity',
                label: 'الكمية',
                render: (movement) => h('span', {
                  style: { color: movement.quantity >= 0 ? 'var(--green)' : 'var(--red)', 'font-weight': '600' },
                }, ltr(`${movement.quantity >= 0 ? '+' : ''}${movement.quantity}`)),
              },
              { key: 'balanceAfter', label: 'الرصيد بعدها', render: (movement) => ltr(movement.balanceAfter) },
              { key: 'reason', label: 'السبب' },
              { key: 'note', label: 'ملاحظة' },
            ],
            rows: movements,
            empty: { iconName: 'history', title: 'لا حركات مسجّلة', text: 'ستظهر هنا كل إضافة وسحب وبيع لهذا المنتج.' },
          }),
        })
      ),

      h('div', { class: 'detail-panel stack' },
        card({
          body: h('div', { class: 'stack', style: { gap: '4px' } },
            product.image
              ? h('img', {
                  src: product.image, alt: '',
                  style: { width: '100%', 'max-height': '180px', 'object-fit': 'contain', 'margin-bottom': '12px' },
                })
              : null,
            detailRow('SKU', ltr(product.sku), { iconName: 'barcode' }),
            product.barcode ? detailRow('الباركود', ltr(product.barcode), { iconName: 'barcode' }) : null,
            detailRow('الفئة', category?.name || '—', { iconName: 'tag' }),
            detailRow('الوحدة', product.unit),
            detailRow('الكمية الحالية', ltr(product.quantity)),
            detailRow('حد المخزون المنخفض', ltr(product.lowStockThreshold))
          ),
        }),
        card({
          title: 'التسعير',
          body: h('div', { class: 'stack', style: { gap: '4px' } },
            detailRow('سعر الشراء', h('span', null, ltr(formatAmount(product.costMinor)), ` ${symbol}`)),
            detailRow('سعر البيع', h('span', null, ltr(formatAmount(product.priceMinor)), ` ${symbol}`)),
            detailRow('هامش الربح', h('span', {
              style: { color: marginMinor >= 0 ? 'var(--green)' : 'var(--red)' },
            }, ltr(formatAmount(marginMinor)), ` ${symbol} (${marginPercent.toFixed(1)}%)`)),
            detailRow('الضريبة', `${bpToPercent(product.taxRateBp)}%`),
            detailRow('قيمة المخزون', h('span', null,
              ltr(formatAmount(product.quantity * product.costMinor)), ` ${symbol}`))
          ),
        })
      )
    )
  );
}
