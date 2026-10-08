/** الإعدادات — مرجع: UI/12-settings.png */

import { h, render as renderInto, ltr } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, field, toggleField, badge, alertBox, progressBar, emptyState } from '../components/ui.js';
import { toastOk, toastError, confirmDialog, openModal } from '../components/feedback.js';
import { settings, saveSettings, loadSettings, DEFAULT_SETTINGS } from '../repositories/settings.js';
import { listCategories, createCategory, deleteCategory } from '../repositories/products.js';
import { listExpenseCategories, createExpenseCategory, deleteExpenseCategory } from '../repositories/expenses.js';
import { listReasons, createReason, deactivateReason } from '../repositories/inventory.js';
import { appState } from '../state/store.js';
import { applyUpdate, offlineCapability, readStorageEstimate, requestPersistentStorage } from '../services/pwa.js';
import { seedDemoData, isEmptyDatabase } from '../db/seed.js';
import { APP_VERSION, SCHEMA_VERSION } from '../db/schema.js';
import { DATE_FORMATS } from '../utils/dates.js';
import { bpToPercent, percentToBp } from '../utils/money.js';
import { formatBytes } from '../utils/format.js';
import { TEMPLATES, TEMPLATE_LABEL } from '../services/print.js';
import { refresh } from '../router.js';
import { notifyDataChanged } from '../state/store.js';

const SECTIONS = [
  { id: 'general', label: 'عام', icon: 'gear' },
  { id: 'store', label: 'بيانات المتجر', icon: 'store' },
  { id: 'invoices', label: 'الفواتير', icon: 'invoices' },
  { id: 'taxes', label: 'الضرائب', icon: 'percent' },
  { id: 'catalog', label: 'الفئات والأسباب', icon: 'tag' },
  { id: 'data', label: 'البيانات والأوفلاين', icon: 'database' },
];

const CURRENCIES = [
  { code: 'SAR', symbol: 'ر.س', label: 'ريال سعودي (SAR)' },
  { code: 'EGP', symbol: 'ج.م', label: 'جنيه مصري (EGP)' },
  { code: 'AED', symbol: 'د.إ', label: 'درهم إماراتي (AED)' },
  { code: 'KWD', symbol: 'د.ك', label: 'دينار كويتي (KWD)' },
  { code: 'QAR', symbol: 'ر.ق', label: 'ريال قطري (QAR)' },
  { code: 'JOD', symbol: 'د.أ', label: 'دينار أردني (JOD)' },
  { code: 'IQD', symbol: 'د.ع', label: 'دينار عراقي (IQD)' },
  { code: 'USD', symbol: '$', label: 'دولار أمريكي (USD)' },
  { code: 'ILS', symbol: '₪', label: 'شيكل إسرائيلي (ILS)' },
];

export async function render(context) {
  const s = await loadSettings({ force: true });
  const capability = offlineCapability();
  const storage = appState.get().storage || await readStorageEstimate();

  let activeSection = context.query.section || 'general';
  const formHost = h('div');
  const navHost = h('div', { class: 'settings-nav' });

  /* -------------------------------- الحقول -------------------------------- */

  const fields = {
    storeName: field({ label: 'اسم المتجر', name: 'storeName', value: s.storeName, required: true, placeholder: 'اسم المتجر' }),
    storePhone: field({ label: 'رقم الهاتف', name: 'storePhone', type: 'tel', value: s.storePhone, placeholder: '+966 50 123 4567' }),
    storeEmail: field({ label: 'البريد الإلكتروني', name: 'storeEmail', type: 'email', value: s.storeEmail, placeholder: 'info@store.com' }),
    storeAddress: field({ label: 'العنوان', name: 'storeAddress', value: s.storeAddress, placeholder: 'المدينة، الحي، الشارع' }),
    storeCrNumber: field({ label: 'السجل التجاري', name: 'storeCrNumber', value: s.storeCrNumber, placeholder: 'رقم السجل التجاري' }),
    storeTaxNumber: field({ label: 'الرقم الضريبي', name: 'storeTaxNumber', value: s.storeTaxNumber, placeholder: 'الرقم الضريبي' }),

    currencyCode: field({
      label: 'العملة', name: 'currencyCode', value: s.currencyCode,
      options: CURRENCIES.map((currency) => ({ value: currency.code, label: currency.label })),
      onChange: (event) => {
        const currency = CURRENCIES.find((item) => item.code === event.target.value);
        if (currency) fields.currencySymbol.value = currency.symbol;
      },
    }),
    currencySymbol: field({ label: 'رمز العملة', name: 'currencySymbol', value: s.currencySymbol, required: true }),
    currencyDecimalDigits: field({ label: 'المنازل العشرية', name: 'currencyDecimalDigits', type: 'number', min: '0', max: '3', value: String(s.currencyDecimalDigits ?? 2) }),
    currencySymbolPosition: field({ label: 'موضع الرمز', name: 'currencySymbolPosition', value: s.currencySymbolPosition || 'after', options: [{ value: 'after', label: 'بعد المبلغ' }, { value: 'before', label: 'قبل المبلغ' }] }),
    dateFormat: field({
      label: 'تنسيق التاريخ', name: 'dateFormat', value: s.dateFormat,
      options: DATE_FORMATS.map((format) => ({ value: format, label: format })),
    }),

    invoicePrefix: field({ label: 'بادئة الفاتورة', name: 'invoicePrefix', value: s.invoicePrefix, required: true }),
    invoiceNextNumber: field({
      label: 'الرقم التالي', name: 'invoiceNextNumber', type: 'number', min: '1',
      value: String(s.invoiceNextNumber),
      hint: 'تغيير هذا الرقم قد ينتج أرقام فواتير مكررة إن كان أقل من رقم مستخدم.',
    }),
    invoiceFooter: field({
      label: 'نص تذييل الفاتورة', name: 'invoiceFooter', value: s.invoiceFooter,
      placeholder: 'شكراً لتعاملكم معنا', maxLength: 200,
    }),
    printTemplate: field({
      label: 'قالب الطباعة الافتراضي', name: 'printTemplate', value: s.printTemplate,
      options: [
        { value: TEMPLATES.A4, label: TEMPLATE_LABEL[TEMPLATES.A4] },
        { value: TEMPLATES.THERMAL, label: TEMPLATE_LABEL[TEMPLATES.THERMAL] },
        { value: TEMPLATES.THERMAL_58, label: TEMPLATE_LABEL[TEMPLATES.THERMAL_58] },
      ],
    }),

    defaultTaxRate: field({
      label: 'الضريبة الافتراضية', name: 'defaultTaxRate',
      value: String(bpToPercent(s.defaultTaxRateBp)),
      options: [
        { value: '0', label: 'معفى (0%)' },
        { value: '5', label: '5%' },
        { value: '10', label: '10%' },
        { value: '14', label: '14% - ضريبة القيمة المضافة' },
        { value: '15', label: '15% - ضريبة القيمة المضافة' },
      ],
    }),
    maxDiscountPercent: field({
      label: 'الحد الأقصى للخصم', name: 'maxDiscountPercent', type: 'number', min: '0', max: '100',
      value: String(s.maxDiscountPercent), suffix: '%',
    }),
    lowStockDefault: field({
      label: 'حد المخزون المنخفض الافتراضي', name: 'lowStockDefault', type: 'number', min: '0',
      value: String(s.lowStockDefault),
      hint: 'يُستخدم كقيمة مبدئية عند إضافة منتج جديد.',
    }),
    backupReminder: field({
      label: 'تذكير النسخ الاحتياطي', name: 'backupReminder', value: s.backupReminder,
      options: [
        { value: 'off', label: 'معطّل' },
        { value: 'daily', label: 'يومي' },
        { value: 'weekly', label: 'أسبوعي' },
      ],
    }),
  };

  const toggles = {
    taxInclusive: toggleField({ label: 'الأسعار المدخلة شاملة الضريبة', name: 'taxInclusive', checked: s.taxInclusive }),
    allowDiscount: toggleField({ label: 'السماح بالخصم في نقطة البيع', name: 'allowDiscount', checked: s.allowDiscount }),
    allowNegativeStock: toggleField({ label: 'السماح بالبيع عند نفاد المخزون', name: 'allowNegativeStock', checked: s.allowNegativeStock }),
  };

  /* -------------------------------- الأقسام -------------------------------- */

  function sectionContent() {
    switch (activeSection) {
      case 'store':
        return card({
          title: 'بيانات المتجر',
          titleIcon: 'store',
          body: h('div', { class: 'stack' },
            h('div', { class: 'form-grid' },
              fields.storeName.element, fields.storePhone.element, fields.storeEmail.element),
            fields.storeAddress.element,
            h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
              fields.storeCrNumber.element, fields.storeTaxNumber.element),
            alertBox('هذه البيانات تظهر في رأس الفواتير المطبوعة.', 'info')
          ),
        });

      case 'invoices':
        return card({
          title: 'الفواتير',
          titleIcon: 'invoices',
          body: h('div', { class: 'stack' },
            h('div', { class: 'form-grid' },
              fields.dateFormat.element, fields.invoicePrefix.element, fields.invoiceNextNumber.element),
            fields.invoiceFooter.element,
            h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
              fields.printTemplate.element,
              h('div', { class: 'field' },
                h('span', { class: 'field__label', text: 'السماح بالخصم' }),
                toggles.allowDiscount.element)
            ),
            alertBox(
              `شكل رقم الفاتورة القادم: ${s.invoicePrefix}-${new Date().getFullYear()}-${String(s.invoiceNextNumber).padStart(5, '0')}`,
              'info'
            )
          ),
        });

      case 'taxes':
        return card({
          title: 'الضرائب والخصم',
          titleIcon: 'percent',
          body: h('div', { class: 'stack' },
            h('div', { class: 'form-grid' },
              fields.defaultTaxRate.element, fields.maxDiscountPercent.element, fields.lowStockDefault.element),
            h('div', { class: 'stack', style: { gap: '14px' } },
              toggles.taxInclusive.element,
              toggles.allowNegativeStock.element),
            alertBox('تغيير نسبة الضريبة يؤثر على الفواتير الجديدة فقط. الفواتير السابقة تحتفظ بالنسبة المستخدمة وقت إصدارها.', 'warn')
          ),
        });

      case 'catalog':
        return catalogSection();

      case 'data':
        return dataSection();

      case 'general':
      default:
        return h('div', { class: 'stack' },
          card({
            title: 'بيانات المتجر',
            titleIcon: 'store',
            body: h('div', { class: 'stack' },
              h('div', { class: 'form-grid' },
                fields.storeName.element, fields.storePhone.element, fields.storeEmail.element),
              fields.storeAddress.element,
              h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                fields.currencyCode.element, fields.currencySymbol.element),
              h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                fields.currencyDecimalDigits.element, fields.currencySymbolPosition.element)
            ),
          }),
          card({
            title: 'الفواتير',
            titleIcon: 'invoices',
            body: h('div', { class: 'stack' },
              h('div', { class: 'form-grid' },
                fields.dateFormat.element, fields.invoicePrefix.element, fields.invoiceNextNumber.element),
              fields.invoiceFooter.element,
              h('div', { class: 'form-grid' },
                fields.defaultTaxRate.element,
                h('div', { class: 'field' },
                  h('span', { class: 'field__label', text: 'السماح بالخصم' }),
                  toggles.allowDiscount.element),
                fields.printTemplate.element)
            ),
          })
        );
    }
  }

  /* --------------------------- الفئات والأسباب --------------------------- */

  function catalogSection() {
    const host = h('div', { class: 'stack' });

    async function draw() {
      const [productCategories, expenseCategories, reasons] = await Promise.all([
        listCategories(), listExpenseCategories(), listReasons(),
      ]);

      renderInto(host,
        listCard('فئات المنتجات', 'tag', productCategories, {
          onAdd: async (name) => { await createCategory({ name, sortOrder: productCategories.length + 1 }); },
          onDelete: async (item) => { await deleteCategory(item.id); },
          deleteLabel: 'حذف',
        }),
        listCard('فئات المصروفات', 'expenses', expenseCategories, {
          onAdd: async (name) => { await createExpenseCategory({ name }); },
          onDelete: async (item) => { await deleteExpenseCategory(item.id); },
          deleteLabel: 'حذف',
        }),
        listCard('أسباب تسوية المخزون', 'sliders', reasons, {
          onAdd: async (name) => { await createReason(name); },
          onDelete: async (item) => { await deactivateReason(item.id); },
          deleteLabel: 'تعطيل',
          note: 'الأسباب المستخدمة في حركات مسجّلة تُعطَّل ولا تُحذف، حفاظاً على قابلية قراءة السجل التاريخي.',
        })
      );
    }

    function listCard(title, iconName, items, { onAdd, onDelete, deleteLabel, note }) {
      let input;

      return card({
        title,
        titleIcon: iconName,
        body: h('div', { class: 'stack' },
          note ? alertBox(note, 'info') : null,
          h('div', { class: 'chips' },
            ...items.map((item) =>
              h('span', { class: 'chip', style: { cursor: 'default' } },
                item.color
                  ? h('span', { class: 'badge__dot', style: { background: item.color, width: '9px', height: '9px' } })
                  : null,
                h('span', { text: item.name }),
                h('button', {
                  class: 'icon-btn',
                  style: { width: '24px', height: '24px' },
                  attrs: { type: 'button', 'aria-label': `${deleteLabel} ${item.name}` },
                  on: {
                    click: async () => {
                      const ok = await confirmDialog({
                        title: `${deleteLabel} "${item.name}"`,
                        message: `هل تريد ${deleteLabel} هذا العنصر؟`,
                        confirmLabel: deleteLabel,
                        tone: 'danger',
                      });
                      if (!ok) return;
                      try {
                        await onDelete(item);
                        toastOk('تم التنفيذ');
                        draw();
                      } catch (error) {
                        toastError(error.message);
                      }
                    },
                  },
                }, icon('close'))
              )
            ),
            items.length === 0 ? h('p', { class: 'field__hint', text: 'لا عناصر.' }) : null
          ),
          h('form', {
            class: 'row',
            on: {
              submit: async (event) => {
                event.preventDefault();
                const name = input.value.trim();
                if (!name) return;
                try {
                  await onAdd(name);
                  input.value = '';
                  toastOk(`تمت إضافة "${name}"`);
                  draw();
                } catch (error) {
                  toastError(error.message);
                }
              },
            },
          },
            h('input', {
              class: 'input',
              placeholder: 'اسم جديد',
              style: { flex: '1' },
              attrs: { 'aria-label': `إضافة إلى ${title}` },
              ref: (el) => { input = el; },
            }),
            h('button', { class: 'btn btn--outline', attrs: { type: 'submit' } },
              icon('plus'), h('span', { text: 'إضافة' }))
          )
        ),
      });
    }

    draw();
    return host;
  }

  /* --------------------------- البيانات والأوفلاين --------------------------- */

  function dataSection() {
    const usageRatio = storage?.quota > 0 ? storage.usage / storage.quota : 0;

    return h('div', { class: 'stack' },
      card({
        title: 'العمل دون اتصال',
        titleIcon: 'cloudUp',
        body: h('div', { class: 'stack' },
          capability.ok
            ? alertBox('التطبيق مؤهّل للعمل دون اتصال. بعد أول زيارة تُخزَّن ملفاته محلياً ويعمل بلا إنترنت.', 'ok')
            : alertBox(capability.message, 'warn'),
          h('div', { class: 'stack', style: { gap: '2px' } },
            settingRow('حالة Service Worker', swBadge()),
            settingRow('إصدار Cache', ltr(appState.get().cacheVersion || 'غير متاح')),
            settingRow('إصدار التطبيق', ltr(`v${APP_VERSION}`)),
            settingRow('إصدار مخطط البيانات', ltr(String(SCHEMA_VERSION))),
            settingRow('السياق آمن (HTTPS/localhost)', badge(window.isSecureContext ? 'نعم' : 'لا',
              window.isSecureContext ? 'green' : 'red'))
          ),
          appState.get().updateAvailable
            ? h('div', { class: 'stack' },
                alertBox('تحديث متاح — نسخة جديدة من التطبيق جاهزة للتفعيل.', 'info'),
                h('button', {
                  class: 'btn btn--success',
                  attrs: { type: 'button' },
                  on: { click: () => applyUpdate() },
                }, icon('refresh'), h('span', { text: 'تحديث الآن' }))
              )
            : null
        ),
      }),

      card({
        title: 'مساحة التخزين المحلي',
        titleIcon: 'database',
        body: h('div', { class: 'stack' },
          storage?.quota
            ? h('div', { class: 'stack', style: { gap: '10px' } },
                h('div', { class: 'row', style: { 'justify-content': 'space-between' } },
                  h('span', { class: 'field__hint' },
                    `${formatBytes(storage.usage)} من ${formatBytes(storage.quota)}`),
                  h('span', { style: { 'font-weight': '700' }, text: `${Math.round(usageRatio * 100)}%` })
                ),
                progressBar(usageRatio)
              )
            : alertBox('تقدير مساحة التخزين غير متاح في هذا المتصفح.', 'warn'),

          settingRow('التخزين الدائم', badge(storage?.persisted ? 'مفعّل' : 'غير مفعّل',
            storage?.persisted ? 'green' : 'amber')),

          !storage?.persisted
            ? h('div', { class: 'stack' },
                alertBox('بدون التخزين الدائم قد يحذف المتصفح البيانات عند ضغط مساحة الجهاز. التفعيل يتطلب نقرة منك.', 'warn'),
                h('button', {
                  class: 'btn btn--outline',
                  attrs: { type: 'button' },
                  on: {
                    click: async () => {
                      const result = await requestPersistentStorage();
                      if (result.granted) toastOk(result.message);
                      else toastError(result.message);
                      refresh();
                    },
                  },
                }, icon('shield'), h('span', { text: 'طلب تخزين دائم' }))
              )
            : null
        ),
      }),

      card({
        title: 'النسخ الاحتياطي',
        titleIcon: 'shield',
        body: h('div', { class: 'stack' },
          fields.backupReminder.element,
          alertBox('بياناتك محفوظة في متصفح هذا الجهاز على هذا النطاق (Origin) فقط. مسح بيانات المتصفح أو استخدام متصفح آخر يعني عدم وجود البيانات. النسخ الاحتياطي مسؤولية تشغيلية أساسية.', 'warn'),
          h('a', { class: 'btn btn--navy', href: '#/backup' },
            icon('cloudUp'), h('span', { text: 'إدارة النسخ الاحتياطي' }))
        ),
      }),

      card({
        title: 'بيانات تجريبية',
        titleIcon: 'zap',
        body: h('div', { class: 'stack' },
          h('p', { class: 'field__hint', text: 'أضف منتجات وعملاء ومبيعات للتجربة. لا تفعل هذا على قاعدة بيانات حقيقية.' }),
          h('button', {
            class: 'btn btn--outline',
            attrs: { type: 'button' },
            on: {
              click: async (event) => {
                // احفظ المرجع قبل أي await — المتصفح يصفّر currentTarget بعد انتهاء الإرسال
                const button = event.currentTarget;
                if (!(await isEmptyDatabase())) {
                  const ok = await confirmDialog({
                    title: 'قاعدة البيانات غير فارغة',
                    message: 'ستُضاف بيانات تجريبية فوق بياناتك الحالية. يُنصح بإنشاء نسخة احتياطية أولاً.',
                    confirmLabel: 'إضافة على أي حال',
                    tone: 'danger',
                  });
                  if (!ok) return;
                }
                button.disabled = true;
                try {
                  const result = await seedDemoData();
                  notifyDataChanged();
                  toastOk(`تمت إضافة ${result.products} منتجاً و${result.sales} فاتورة.`);
                  refresh();
                } catch (error) {
                  toastError(error.message);
                  button.disabled = false;
                }
              },
            },
          }, icon('zap'), h('span', { text: 'إضافة بيانات تجريبية' }))
        ),
      })
    );
  }

  function settingRow(label, value) {
    return h('div', { class: 'detail-row' },
      h('span', { class: 'detail-row__label', text: label }),
      h('span', { class: 'detail-row__value' }, value)
    );
  }

  function swBadge() {
    const status = appState.get().swStatus;
    const map = {
      active: ['نشط', 'green'],
      unsupported: ['غير مدعوم', 'red'],
      insecure: ['يتطلب HTTPS', 'amber'],
      file: ['وضع الملف المحلي', 'amber'],
      failed: ['فشل التسجيل', 'red'],
      unknown: ['جارٍ الفحص', 'gray'],
    };
    const [label, tone] = map[status] || map.unknown;
    return badge(label, tone);
  }

  /* -------------------------------- الحفظ -------------------------------- */

  async function save() {
    for (const item of Object.values(fields)) item.setError(null);

    const storeName = fields.storeName.value.trim();
    if (!storeName) {
      fields.storeName.setError('اسم المتجر مطلوب');
      activeSection = 'general';
      drawAll();
      fields.storeName.focus();
      return;
    }

    const symbol = fields.currencySymbol.value.trim();
    if (!symbol) {
      fields.currencySymbol.setError('رمز العملة مطلوب');
      return;
    }

    const nextNumber = Number(fields.invoiceNextNumber.value);
    if (!Number.isInteger(nextNumber) || nextNumber < 1) {
      fields.invoiceNextNumber.setError('الرقم التالي يجب أن يكون عدداً صحيحاً أكبر من صفر');
      return;
    }

    const maxDiscount = Number(fields.maxDiscountPercent.value);
    if (!Number.isFinite(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) {
      fields.maxDiscountPercent.setError('يجب أن يكون بين 0 و100');
      return;
    }

    const patch = {
      storeName,
      storePhone: fields.storePhone.value.trim(),
      storeEmail: fields.storeEmail.value.trim(),
      storeAddress: fields.storeAddress.value.trim(),
      storeCrNumber: fields.storeCrNumber.value.trim(),
      storeTaxNumber: fields.storeTaxNumber.value.trim(),
      currencyCode: fields.currencyCode.value,
      currencySymbol: symbol,
      currencyDecimalDigits: Math.max(0, Math.min(3, Number(fields.currencyDecimalDigits.value) || 0)),
      currencySymbolPosition: fields.currencySymbolPosition.value === 'before' ? 'before' : 'after',
      dateFormat: fields.dateFormat.value,
      invoicePrefix: fields.invoicePrefix.value.trim().toUpperCase() || 'INV',
      invoiceNextNumber: nextNumber,
      invoiceFooter: fields.invoiceFooter.value.trim(),
      printTemplate: fields.printTemplate.value,
      defaultTaxRateBp: percentToBp(fields.defaultTaxRate.value),
      maxDiscountPercent: maxDiscount,
      lowStockDefault: Number(fields.lowStockDefault.value) || 0,
      backupReminder: fields.backupReminder.value,
      taxInclusive: toggles.taxInclusive.checked,
      allowDiscount: toggles.allowDiscount.checked,
      allowNegativeStock: toggles.allowNegativeStock.checked,
    };

    try {
      await saveSettings(patch);
      appState.set({ settings: settings() });
      toastOk('تم حفظ الإعدادات');
      refresh();
    } catch (error) {
      toastError(`تعذّر الحفظ: ${error.message}`);
    }
  }

  /* -------------------------------- التركيب -------------------------------- */

  function drawNav() {
    renderInto(navHost, ...SECTIONS.map((section) =>
      h('button', {
        class: 'settings-nav__item',
        attrs: { type: 'button', 'aria-current': String(section.id === activeSection) },
        on: {
          click: () => {
            activeSection = section.id;
            drawAll();
          },
        },
      }, icon(section.icon), h('span', { text: section.label }))
    ));
  }

  function drawAll() {
    drawNav();
    renderInto(formHost, sectionContent());
  }

  drawAll();

  const statusPanel = h('div', { class: 'settings-layout__side stack' },
    card({
      title: 'حالة التطبيق',
      body: h('div', { class: 'stack', style: { gap: '2px' } },
        settingRow('Service Worker', swBadge()),
        settingRow('إصدار Cache', ltr(appState.get().cacheVersion || '—'))
      ),
    }),
    capability.ok
      ? card({
          body: h('div', { class: 'alert alert--ok', style: { border: 'none' } },
            icon('checkCircle'),
            h('div', null,
              h('div', { style: { 'font-weight': '700', 'margin-bottom': '3px' }, text: 'جاهز دون اتصال' }),
              h('div', { text: 'يمكنك متابعة العمل بلا إنترنت. كل البيانات محلية.' })
            )
          ),
        })
      : card({ body: alertBox(capability.message, 'warn') }),
    appState.get().updateAvailable
      ? card({
          title: 'تحديث متاح',
          titleIcon: 'arrowUp',
          body: h('div', { class: 'stack' },
            h('p', { class: 'field__hint' }, 'الإصدار الحالي: ', ltr(`v${APP_VERSION}`)),
            h('button', {
              class: 'btn btn--success btn--block',
              attrs: { type: 'button' },
              on: { click: () => applyUpdate() },
            }, h('span', { text: 'تحديث الآن' }))
          ),
        })
      : null,
    storage?.quota
      ? card({
          title: 'مساحة التخزين المحلي',
          body: h('div', { class: 'stack', style: { gap: '10px' } },
            progressBar(storage.usage / storage.quota),
            h('p', { class: 'field__hint' },
              `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)} (${Math.round((storage.usage / storage.quota) * 100)}%)`)
          ),
        })
      : null
  );

  return h('div', null,
    h('div', { class: 'settings-layout' },
      navHost,
      formHost,
      statusPanel
    ),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn--success', attrs: { type: 'button' }, on: { click: save } },
        icon('save'), h('span', { text: 'حفظ التغييرات' })),
      h('button', {
        class: 'btn btn--ghost',
        attrs: { type: 'button' },
        text: 'إلغاء',
        on: { click: () => refresh() },
      })
    )
  );
}
