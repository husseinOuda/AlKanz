/** النسخ الاحتياطي والاستعادة — مرجع: UI/11-backup-restore.png */

import { h, render as renderInto, ltr } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, kpi, kpiGrid, badge, alertBox, progressBar, checkboxField, emptyState, pagination } from '../components/ui.js';
import { dataTable } from '../components/table.js';
import { toastOk, toastError, confirmDialog, openModal } from '../components/feedback.js';
import {
  createBackup, listBackups, downloadBackup, deleteBackup,
  inspectBackupFile, restoreBackup, clearAllData, BACKUP_KIND,
} from '../services/backup.js';
import { readStorageEstimate, requestPersistentStorage } from '../services/pwa.js';
import { settings, loadSettings, saveSettings } from '../repositories/settings.js';
import { appState, notifyDataChanged } from '../state/store.js';
import { APP_VERSION, SCHEMA_VERSION } from '../db/schema.js';
import { formatBytes, formatInt } from '../utils/format.js';
import { formatDateTime, formatDate } from '../utils/dates.js';
import { refresh } from '../router.js';

export async function render(context) {
  const s = settings();
  const backups = await listBackups();
  const storage = appState.get().storage || await readStorageEstimate();

  const state = { page: 1, pageSize: 5 };
  const logHost = h('div');

  /* --------------------------------- KPIs --------------------------------- */

  const lastBackup = backups[0];
  const usageRatio = storage?.quota > 0 ? storage.usage / storage.quota : 0;

  const kpis = kpiGrid(
    kpi({
      variant: 'stacked',
      label: 'آخر نسخة',
      value: h('span', { style: { 'font-size': '19px' } },
        lastBackup ? formatDateTime(lastBackup.createdAt, s.dateFormat) : 'لا توجد'),
      iconName: 'calendar',
      tone: lastBackup ? 'blue' : 'amber',
      subtext: lastBackup ? formatDate(lastBackup.createdAt, s.dateFormat) : 'أنشئ نسختك الأولى',
    }),
    kpi({
      variant: 'stacked',
      label: 'التخزين المحلي',
      value: formatBytes(storage?.usage || 0),
      iconName: 'database',
      tone: 'teal',
      subtext: storage?.quota
        ? `${Math.round(usageRatio * 100)}% مستخدم من ${formatBytes(storage.quota)}`
        : 'غير متاح',
    }),
    kpi({
      variant: 'stacked',
      label: 'إصدار البيانات',
      value: `v${APP_VERSION}`,
      iconName: 'layers',
      tone: 'violet',
      subtext: `مخطط قاعدة البيانات ${SCHEMA_VERSION}`,
    }),
    kpi({
      variant: 'stacked',
      label: 'تذكير النسخ',
      value: { off: 'معطّل', daily: 'يومي', weekly: 'أسبوعي' }[s.backupReminder] || 'أسبوعي',
      iconName: 'bell',
      tone: s.backupReminder === 'off' ? 'amber' : 'green',
      subtext: s.backupReminder === 'off' ? 'التذكير معطّل' : 'التذكير مفعّل',
    })
  );

  /* ---------------------------- إنشاء نسخة ---------------------------- */

  const createCard = card({
    title: 'إنشاء نسخة احتياطية',
    titleIcon: 'cloudUp',
    body: h('div', { class: 'stack' },
      h('div', null,
        h('h3', { style: { 'font-size': '15px', 'font-weight': '700', 'margin-bottom': '4px' }, text: 'تصدير كامل' }),
        h('p', { class: 'field__hint', text: 'يشمل المنتجات والعملاء والمبيعات والمصروفات وحركات المخزون والإعدادات.' })
      ),
      h('button', {
        class: 'btn btn--navy btn--lg btn--block',
        attrs: { type: 'button' },
        on: {
          click: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await createBackup({ kind: BACKUP_KIND.MANUAL, download: true });
              toastOk(`تم إنشاء النسخة: ${result.fileName} (${formatBytes(result.blob.size)})`);
              refresh();
            } catch (error) {
              toastError(`تعذّر إنشاء النسخة: ${error.message}`);
            } finally {
              button.disabled = false;
            }
          },
        },
      }, h('span', { text: 'تنزيل ملف JSON' }), icon('download')),
      alertBox('يُحفظ الملف على جهازك فقط ولا يُرسل إلى أي خادم. انسخه إلى وسيط خارجي أو تخزين سحابي بنفسك.', 'info')
    ),
  });

  /* ---------------------------- استعادة نسخة ---------------------------- */

  let inspected = null;
  let selectedFile = null;

  const autoBackupCheck = checkboxField({
    label: 'أنشئ نسخة تلقائية من البيانات الحالية قبل الاستعادة',
    name: 'autoBackup',
    checked: true,
  });

  const inspectionHost = h('div');

  const restoreButton = h('button', {
    class: 'btn btn--danger btn--block',
    attrs: { type: 'button' },
    disabled: true,
    on: { click: doRestore },
  }, h('span', { text: 'استعادة البيانات' }), icon('upload'));

  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    attrs: { 'aria-label': 'اختر ملف النسخة الاحتياطية' },
    on: { change: (event) => handleFile(event.target.files[0]) },
  });

  const dropZone = h('label', { class: 'file-drop' },
    icon('cloudUp', { class: 'file-drop__icon' }),
    h('span', { class: 'file-drop__title', text: 'اختر ملف JSON أو اسحبه هنا' }),
    h('span', { class: 'file-drop__hint', text: 'الحد الأقصى للحجم: 100 ميجابايت' }),
    fileInput
  );

  dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-over'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-over');
    handleFile(event.dataTransfer.files[0]);
  });

  async function handleFile(file) {
    if (!file) return;
    selectedFile = file;
    inspected = null;
    restoreButton.disabled = true;
    renderInto(inspectionHost, h('p', { class: 'field__hint', text: 'جارٍ فحص الملف…' }));

    try {
      inspected = await inspectBackupFile(file);
      showInspection();
    } catch (error) {
      renderInto(inspectionHost, alertBox(`تعذّر فحص الملف: ${error.message}`, 'error'));
    }
  }

  function showInspection() {
    const { ok, errors, warnings, summary } = inspected;
    restoreButton.disabled = !ok;

    renderInto(inspectionHost,
      h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'file-preview' },
          h('div', { class: 'table__thumb table__thumb--ph', style: { width: '54px', height: '54px', color: ok ? 'var(--green)' : 'var(--red)' } },
            icon(ok ? 'checkCircle' : 'xCircle')),
          h('div', { style: { flex: '1', 'min-width': '0' } },
            h('div', { class: 'file-preview__name', text: summary.fileName || selectedFile.name }),
            h('div', { class: 'file-preview__meta' },
              formatBytes(summary.fileSize || selectedFile.size),
              summary.exportedAt ? ` · أُنشئت ${formatDateTime(summary.exportedAt, s.dateFormat)}` : '')
          )
        ),

        ok
          ? alertBox(`الملف صالح. يحتوي على ${formatInt(summary.totalRecords)} سجلاً وسيستبدل كل البيانات الحالية.`, 'ok')
          : h('div', { class: 'stack', style: { gap: '6px' } },
              ...errors.map((error) => alertBox(error, 'error'))
            ),

        ...warnings.map((warning) => alertBox(warning, 'warn')),

        ok
          ? h('div', { class: 'table-wrap' },
              h('table', { class: 'table' },
                h('thead', null, h('tr', null, h('th', { text: 'البيانات' }), h('th', { text: 'عدد السجلات' }))),
                h('tbody', null,
                  ...STORE_LABELS.filter(([key]) => summary[key] != null).map(([key, label]) =>
                    h('tr', null, h('td', { text: label }), h('td', null, ltr(formatInt(summary[key]))))
                  )
                )
              )
            )
          : null
      )
    );
  }

  async function doRestore() {
    if (!inspected?.ok) return;

    const confirmed = await confirmDialog({
      title: 'تأكيد الاستعادة',
      message: 'سيتم استبدال جميع البيانات الحالية ببيانات الملف. هذا الإجراء لا يمكن التراجع عنه إلا باستعادة نسخة أخرى.',
      confirmLabel: 'استبدال البيانات',
      tone: 'danger',
      extra: autoBackupCheck.checked
        ? alertBox('سيتم إنشاء نسخة تلقائية من بياناتك الحالية قبل الاستبدال.', 'info')
        : alertBox('لن تُنشأ نسخة تلقائية. بياناتك الحالية ستُفقد نهائياً.', 'warn'),
    });
    if (!confirmed) return;

    restoreButton.disabled = true;
    restoreButton.textContent = 'جارٍ الاستعادة…';

    try {
      const result = await restoreBackup(inspected.payload, { autoBackup: autoBackupCheck.checked });
      const total = Object.values(result.restored).reduce((sum, count) => sum + count, 0);

      notifyDataChanged();
      toastOk(`تمت الاستعادة بنجاح: ${formatInt(total)} سجلاً.`);
      // إعادة تحميل كاملة حتى تعكس كل الشاشات البيانات الجديدة
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      // المعاملة أُجهضت — البيانات الحالية سليمة
      toastError(`فشلت الاستعادة ولم تتغيّر بياناتك الحالية: ${error.message}`);
      restoreButton.disabled = false;
      restoreButton.textContent = 'استعادة البيانات';
    }
  }

  const restoreCard = card({
    title: 'استعادة نسخة',
    titleIcon: 'download',
    body: h('div', { class: 'stack' },
      dropZone,
      inspectionHost,
      alertBox('لن تُستبدل البيانات قبل نجاح التحقق من الملف بالكامل.', 'warn'),
      autoBackupCheck.element,
      restoreButton
    ),
  });

  /* ---------------------------- إجراءات التعافي ---------------------------- */

  const recoveryCard = card({
    title: 'إجراءات التعافي',
    titleIcon: 'shield',
    body: h('div', { class: 'stack' },
      alertBox('في حال حدوث مشكلة بعد الاستعادة، يمكنك استخدام أحدث نسخة احتياطية من السجل أدناه لاسترجاع بياناتك.', 'info'),

      h('button', {
        class: 'btn btn--ghost btn--block',
        attrs: { type: 'button' },
        disabled: !lastBackup,
        on: {
          click: async () => {
            try {
              const name = await downloadBackup(lastBackup.id);
              toastOk(`تم تنزيل ${name}`);
            } catch (error) {
              toastError(error.message);
            }
          },
        },
      }, icon('download'), h('span', { text: 'تنزيل أحدث نسخة محفوظة' })),

      h('button', {
        class: 'btn btn--ghost btn--block',
        attrs: { type: 'button' },
        on: {
          click: async () => {
            const result = await requestPersistentStorage();
            if (result.granted) toastOk(result.message);
            else toastError(result.message);
            refresh();
          },
        },
      }, icon('shield'), h('span', { text: 'طلب تخزين دائم للمتصفح' })),

      h('button', {
        class: 'btn btn--outline-danger btn--block',
        attrs: { type: 'button' },
        on: { click: doClearAll },
      }, icon('trash'), h('span', { text: 'مسح جميع البيانات المحلية' }))
    ),
  });

  async function doClearAll() {
    const first = await confirmDialog({
      title: 'مسح جميع البيانات',
      message: 'سيتم حذف كل المنتجات والعملاء والفواتير والمصروفات وحركات المخزون نهائياً من هذا المتصفح.',
      confirmLabel: 'متابعة',
      tone: 'danger',
    });
    if (!first) return;

    const second = await confirmDialog({
      title: 'تأكيد نهائي',
      message: 'هل أنشأت نسخة احتياطية؟ بعد المسح لا يمكن استرجاع البيانات إلا من ملف نسخة احتياطية.',
      confirmLabel: 'نعم، امسح كل شيء',
      tone: 'danger',
      extra: alertBox('سيبقى سجل النسخ الاحتياطية المحفوظة محلياً كي تتمكّن من الاستعادة.', 'info'),
    });
    if (!second) return;

    try {
      await clearAllData({ keepBackups: true });
      toastOk('تم مسح جميع البيانات');
      setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toastError(`تعذّر المسح: ${error.message}`);
    }
  }

  /* ------------------------------ سجل النسخ ------------------------------ */

  function drawLog() {
    const total = backups.length;
    const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > maxPage) state.page = maxPage;
    const pageRows = backups.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

    renderInto(logHost, card({
      title: 'سجل النسخ',
      titleIcon: 'history',
      flush: true,
      body: h('div', null,
        dataTable({
          caption: 'سجل النسخ الاحتياطية',
          columns: [
            {
              key: 'fileName',
              label: 'اسم الملف',
              render: (row) => h('span', { class: 'row', style: { gap: '8px', 'flex-wrap': 'nowrap' } },
                icon('file'), ltr(row.fileName)),
            },
            { key: 'createdAt', label: 'التاريخ', render: (row) => ltr(formatDateTime(row.createdAt, s.dateFormat)) },
            { key: 'sizeBytes', label: 'الحجم', render: (row) => formatBytes(row.sizeBytes) },
            {
              key: 'kind',
              label: 'النوع',
              render: (row) => badge(row.kind === BACKUP_KIND.AUTO ? 'تلقائية' : 'يدوية',
                row.kind === BACKUP_KIND.AUTO ? 'blue' : 'gray'),
            },
            {
              key: 'status',
              label: 'الحالة',
              render: (row) => badge(row.hasPayload ? 'محفوظة' : 'سجل فقط',
                row.hasPayload ? 'green' : 'gray', { iconName: row.hasPayload ? 'checkCircle' : null }),
            },
            {
              key: 'actions',
              label: 'الإجراءات',
              className: 'is-actions',
              render: (row) => h('div', { class: 'table__actions' },
                h('button', {
                  class: 'icon-btn',
                  attrs: { type: 'button', 'aria-label': `تنزيل ${row.fileName}` },
                  disabled: !row.hasPayload || undefined,
                  on: {
                    click: async () => {
                      try {
                        await downloadBackup(row.id);
                        toastOk('تم التنزيل');
                      } catch (error) {
                        toastError(error.message);
                      }
                    },
                  },
                }, icon('download')),
                h('button', {
                  class: 'icon-btn icon-btn--danger',
                  attrs: { type: 'button', 'aria-label': `حذف ${row.fileName}` },
                  on: {
                    click: async () => {
                      const ok = await confirmDialog({
                        title: 'حذف النسخة',
                        message: `سيتم حذف "${row.fileName}" من السجل المحلي. الملف الذي نزّلته سابقاً لن يتأثر.`,
                        confirmLabel: 'حذف',
                        tone: 'danger',
                      });
                      if (!ok) return;
                      await deleteBackup(row.id);
                      toastOk('تم حذف النسخة من السجل');
                      refresh();
                    },
                  },
                }, icon('trash'))
              ),
            },
          ],
          rows: pageRows,
          empty: {
            iconName: 'cloudUp',
            title: 'لا نسخ محفوظة',
            text: 'أنشئ نسختك الأولى — يُحتفظ بآخر 5 نسخ داخل المتصفح.',
          },
        }),
        total > 0
          ? pagination({
              page: state.page, pageSize: state.pageSize, total, unit: 'نسخة',
              sizes: [5, 10],
              onPage: (page) => { state.page = page; drawLog(); },
            })
          : null
      ),
    }));
  }

  drawLog();

  /* -------------------------------- التركيب -------------------------------- */

  return h('div', { class: 'stack' },
    kpis,
    storage?.quota
      ? card({
          body: h('div', { class: 'stack', style: { gap: '10px' } },
            h('div', { class: 'row', style: { 'justify-content': 'space-between' } },
              h('span', { style: { 'font-weight': '600' }, text: 'استهلاك التخزين المحلي' }),
              h('span', { class: 'field__hint' },
                `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`)
            ),
            progressBar(usageRatio),
            storage.persisted
              ? alertBox('التخزين الدائم مفعّل — لن يحذف المتصفح بياناتك تلقائياً عند ضغط المساحة.', 'ok')
              : alertBox('التخزين الدائم غير مفعّل. قد يحذف المتصفح البيانات عند امتلاء مساحة الجهاز. فعّله من «إجراءات التعافي».', 'warn')
          ),
        })
      : null,
    h('div', { class: 'backup-grid' }, restoreCard, createCard),
    h('div', { class: 'backup-grid' }, recoveryCard, logHost)
  );
}

const STORE_LABELS = [
  ['products', 'المنتجات'],
  ['categories', 'الفئات'],
  ['customers', 'العملاء'],
  ['sales', 'الفواتير'],
  ['saleItems', 'سطور الفواتير'],
  ['payments', 'المدفوعات'],
  ['expenses', 'المصروفات'],
  ['expenseCategories', 'فئات المصروفات'],
  ['inventoryMovements', 'حركات المخزون'],
  ['suspendedSales', 'البيوع المعلّقة'],
  ['adjustmentReasons', 'أسباب التسوية'],
  ['settings', 'الإعدادات'],
];
