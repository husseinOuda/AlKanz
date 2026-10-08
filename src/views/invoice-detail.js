/** تفاصيل الفاتورة — مرجع: UI/07-invoice-detail.png */

import { h, ltr } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, badge, emptyState, detailRow, alertBox } from '../components/ui.js';
import { toastOk, toastError, confirmDialog, openModal } from '../components/feedback.js';
import { field } from '../components/ui.js';
import {
  getSaleWithItems, cancelSale,
  SALE_STATUS, SALE_STATUS_LABEL, SALE_STATUS_TONE, PAYMENT_TYPE_LABEL,
} from '../repositories/sales.js';
import { getCustomer } from '../repositories/customers.js';
import { settings } from '../repositories/settings.js';
import { formatAmount } from '../utils/format.js';
import { formatDateTime } from '../utils/dates.js';
import { bpToPercent } from '../utils/money.js';
import { notifyDataChanged } from '../state/store.js';
import { navigate, refresh } from '../router.js';
import { printInvoice, TEMPLATES, TEMPLATE_LABEL } from '../services/print.js';
import { exportReport, exportFileName } from '../services/excel.js';
import { toMajor } from '../utils/money.js';
import { returnAvailability, createReturn, returnsForSale, REFUND_METHOD_LABEL } from '../repositories/returns.js';

export async function render(context) {
  const data = await getSaleWithItems(context.params.id);

  if (!data) {
    return card({
      body: emptyState({
        iconName: 'search',
        title: 'الفاتورة غير موجودة',
        text: 'الرابط الذي فتحته لا يطابق أي فاتورة.',
        action: h('a', { class: 'btn btn--primary', href: '#/invoices' }, h('span', { text: 'العودة إلى الفواتير' })),
      }),
    });
  }

  const { sale, items } = data;
  const returns = await returnsForSale(sale.id);
  const s = settings();
  const symbol = s.currencySymbol;
  const customer = sale.customerId ? await getCustomer(sale.customerId) : null;
  const isCancelled = sale.status === SALE_STATUS.CANCELLED;

  const money = (minor) => h('span', null, ltr(formatAmount(minor)), ` ${symbol}`);

  /* ------------------------------- الإجراءات ------------------------------- */

  function openPrintDialog() {
    let template = s.printTemplate;

    const templateField = field({
      label: 'قالب الطباعة',
      name: 'template',
      value: template,
      options: [
        { value: TEMPLATES.A4, label: TEMPLATE_LABEL[TEMPLATES.A4] },
        { value: TEMPLATES.THERMAL, label: TEMPLATE_LABEL[TEMPLATES.THERMAL] },
      ],
      onChange: (event) => { template = event.target.value; },
    });

    const modal = openModal({
      title: 'طباعة الفاتورة',
      body: [
        templateField.element,
        alertBox('لحفظ الفاتورة كملف PDF، اختر «حفظ كـ PDF» من قائمة الطابعات في مربع الطباعة.', 'info'),
      ],
      footer: [
        h('button', {
          class: 'btn btn--primary',
          attrs: { type: 'button' },
          on: {
            click: () => {
              modal.close();
              printInvoice(sale, items, template);
            },
          },
        }, icon('printer'), h('span', { text: 'طباعة' })),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });
  }

  async function doCancel() {
    const ok = await confirmDialog({
      title: 'إلغاء الفاتورة',
      message: `سيتم إرجاع ${items.length} صنفاً إلى المخزون وتسجيل حركة لكل صنف. الفاتورة تبقى في السجل بحالة «ملغاة» ولا تُحذف نهائياً.`,
      confirmLabel: 'إلغاء الفاتورة',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      const result = await cancelSale(sale.id, 'إلغاء من شاشة الفاتورة');
      notifyDataChanged();
      toastOk(`تم إلغاء الفاتورة وإرجاع ${result.restoredLines} صنفاً إلى المخزون`);
      refresh();
    } catch (error) {
      toastError(error.message);
    }
  }

  async function openReturnDialog() {
    const available = await returnAvailability(sale.id);
    if (!available.some((item) => item.availableQuantity > 0)) {
      toastError('تم إرجاع كامل كميات هذه الفاتورة بالفعل');
      return;
    }
    const quantities = new Map();
    const reasonField = field({ label: 'سبب المرتجع', name: 'reason', placeholder: 'مثال: عيب في المنتج أو تغيير رأي العميل', maxLength: 200 });
    const methodField = field({ label: 'طريقة إعادة المبلغ', name: 'refundMethod', value: 'cash', options: Object.entries(REFUND_METHOD_LABEL).map(([value, label]) => ({ value, label })) });
    const noteField = field({ label: 'ملاحظة', name: 'note', rows: 2, maxLength: 300 });
    const rows = available.filter((item) => item.availableQuantity > 0).map((item) => {
      const qty = field({ label: `${item.name} — المتاح ${item.availableQuantity}`, name: `return-${item.id}`, type: 'number', min: '0', max: String(item.availableQuantity), value: '0', suffix: item.unit || 'وحدة' });
      quantities.set(item.id, qty);
      return qty.element;
    });
    const modal = openModal({
      title: `إرجاع من الفاتورة ${sale.number}`,
      body: [alertBox('سيُعاد المخزون فوراً، ويُحفظ المرتجع كحركة مستقلة دون إلغاء الفاتورة.', 'info'), ...rows, reasonField.element, methodField.element, noteField.element],
      footer: [
        h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'تأكيد الإرجاع', on: { click: async () => {
          const lines = available.map((item) => ({ saleItemId: item.id, quantity: Number(quantities.get(item.id)?.value || 0) })).filter((line) => line.quantity > 0);
          try {
            const result = await createReturn({ saleId: sale.id, lines, reason: reasonField.value, refundMethod: methodField.value, note: noteField.value });
            modal.close(); notifyDataChanged(); toastOk(`تم تسجيل المرتجع بقيمة ${formatAmount(result.return.refundMinor)} ${symbol}`); refresh();
          } catch (error) { toastError(error.message); }
        } } }),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
      ],
    });
  }

  async function doExport() {
    try {
      await exportReport({
        title: `فاتورة ${sale.number}`,
        fileName: exportFileName(`فاتورة-${sale.number}`),
        header: ['الصنف', 'SKU', 'الكمية', `سعر الوحدة (${symbol})`, `الخصم (${symbol})`, `الإجمالي (${symbol})`],
        rows: items.map((item) => [
          item.name, item.sku, item.quantity,
          toMajor(item.unitPriceMinor), toMajor(item.lineDiscountMinor), toMajor(item.lineTotalMinor),
        ]),
      });
      toastOk('تم تصدير الفاتورة إلى ملف Excel');
    } catch (error) {
      toastError(`تعذّر التصدير: ${error.message}`);
    }
  }

  /* ------------------------------- المستند ------------------------------- */

  const document_ = card({
    className: 'invoice-doc-card',
    body: h('article', { class: 'invoice-doc' },
      h('header', { class: 'invoice-doc__head' }, icon('receipt'), h('span', { text: 'فاتورة مبيعات' })),

      h('div', { class: 'invoice-parties' },
        h('div', { class: 'invoice-parties__col' },
          h('div', { class: 'invoice-parties__title' }, icon('store'), h('span', { text: 'بيانات المتجر' })),
          h('div', { class: 'invoice-parties__name', text: s.storeName }),
          s.storeAddress ? h('div', { class: 'invoice-parties__line', text: s.storeAddress }) : null,
          s.storePhone ? h('div', { class: 'invoice-parties__line' }, 'هاتف: ', ltr(s.storePhone)) : null,
          s.storeCrNumber ? h('div', { class: 'invoice-parties__line' }, 'السجل التجاري: ', ltr(s.storeCrNumber)) : null,
          s.storeTaxNumber ? h('div', { class: 'invoice-parties__line' }, 'الرقم الضريبي: ', ltr(s.storeTaxNumber)) : null
        ),
        h('div', { class: 'invoice-parties__col' },
          h('div', { class: 'invoice-parties__title' }, icon('user'), h('span', { text: 'بيانات العميل' })),
          h('div', { class: 'invoice-parties__name', text: sale.customerName }),
          customer?.phone
            ? h('div', { class: 'invoice-parties__line' }, 'هاتف: ', ltr(customer.phone))
            : h('div', { class: 'invoice-parties__line', text: 'عميل نقدي - مبيعات فورية' }),
          customer
            ? h('a', { class: 'invoice-parties__line', href: `#/customers/${customer.id}`, text: 'عرض كشف الحساب' })
            : null
        )
      ),

      h('div', { class: 'table-wrap' },
        h('table', { class: 'table' },
          h('thead', null, h('tr', null,
            h('th', { text: 'الصنف' }),
            h('th', { text: 'الكمية' }),
            h('th', { text: 'سعر الوحدة' }),
            h('th', { text: 'الإجمالي' })
          )),
          h('tbody', null, ...items.map((item) =>
            h('tr', null,
              h('td', null,
                h('div', { class: 'table__main', text: item.name }),
                h('div', { class: 'table__sub' }, ltr(item.sku))
              ),
              h('td', null, ltr(item.quantity)),
              h('td', null, money(item.unitPriceMinor)),
              h('td', null, money(item.lineTotalMinor))
            )
          ))
        )
      ),

      h('div', { class: 'invoice-totals' },
        h('div', { class: 'invoice-totals__row' },
          h('span', { text: 'المجموع الفرعي' }), money(sale.subtotalMinor)),
        sale.discountMinor > 0
          ? h('div', { class: 'invoice-totals__row' },
              h('span', { text: 'الخصم' }),
              h('span', null, '−', ltr(formatAmount(sale.discountMinor)), ` ${symbol}`))
          : null,
        h('div', { class: 'invoice-totals__row' },
          h('span', { text: `الضريبة (${bpToPercent(sale.taxRateBp)}%)` }), money(sale.taxMinor)),
        h('div', { class: 'invoice-totals__row invoice-totals__row--final' },
          h('span', { text: 'الإجمالي النهائي' }), money(sale.totalMinor))
      ),

      sale.note
        ? h('div', { class: 'invoice-note' },
            h('div', { class: 'invoice-note__label', text: 'ملاحظة' }),
            h('div', { class: 'invoice-note__text', text: sale.note }))
        : s.invoiceFooter
          ? h('div', { class: 'invoice-note' },
              h('div', { class: 'invoice-note__label', text: 'ملاحظة' }),
              h('div', { class: 'invoice-note__text', text: s.invoiceFooter }))
          : null
    ),
  });

  /* -------------------------------- الجانب -------------------------------- */

  const timeline = [
    {
      title: 'تم إنشاء الفاتورة',
      at: sale.createdAt,
      actor: 'المستخدم',
    },
    {
      title: 'تم تخفيض المخزون',
      at: sale.createdAt,
      actor: 'النظام',
    },
    ...(isCancelled
      ? [{
          title: 'تم إلغاء الفاتورة وإرجاع المخزون',
          at: sale.cancelledAt,
          actor: 'المستخدم',
          tone: 'red',
        }]
      : []),
  ];

  const sidebar = h('div', { class: 'stack' },
    card({
      title: 'ملخص الدفع',
      titleIcon: 'wallet',
      body: h('div', { class: 'stack', style: { gap: '2px' } },
        detailRow('نوع الدفع', PAYMENT_TYPE_LABEL[sale.paymentType] || '—'),
        detailRow('المبلغ المدفوع', h('span', { style: { color: 'var(--green)', 'font-weight': '700' } },
          ltr(formatAmount(sale.paidMinor)), ` ${symbol}`)),
        detailRow('المتبقي', h('span', {
          style: { color: sale.dueMinor > 0 ? 'var(--red)' : 'var(--text)', 'font-weight': sale.dueMinor > 0 ? '700' : '600' },
        }, ltr(formatAmount(sale.dueMinor)), ` ${symbol}`))
      ),
      footer: sale.dueMinor > 0 && customer
        ? h('a', { class: 'btn btn--sm btn--success btn--block', href: `#/customers/${customer.id}` },
            icon('banknote'), h('span', { text: 'تسجيل دفعة من العميل' }))
        : null,
    }),

    card({
      title: 'معلومات الفاتورة',
      titleIcon: 'info',
      body: h('div', { class: 'stack', style: { gap: '2px' } },
        detailRow('رقم الفاتورة', ltr(sale.number)),
        detailRow('تاريخ الإنشاء', ltr(formatDateTime(sale.createdAt, s.dateFormat))),
        detailRow('آخر تحديث', ltr(formatDateTime(sale.updatedAt, s.dateFormat))),
        detailRow('عدد الأصناف', ltr(sale.itemCount)),
        detailRow('عدد الوحدات', ltr(sale.unitCount ?? items.reduce((sum, item) => sum + item.quantity, 0)))
      ),
    }),

    card({
      title: 'سجل الفاتورة',
      titleIcon: 'history',
      body: h('div', { class: 'timeline' },
        ...timeline.map((entry) =>
          h('div', { class: 'timeline__item' },
            h('div', {
              class: 'timeline__dot',
              style: entry.tone === 'red'
                ? { background: 'var(--red)', 'box-shadow': '0 0 0 3px var(--red-soft)' }
                : null,
            }),
            h('div', null,
              h('div', { class: 'timeline__title', text: entry.title }),
              h('div', { class: 'timeline__meta' }, ltr(formatDateTime(entry.at, s.dateFormat))),
              h('div', { class: 'timeline__meta', text: entry.actor })
            )
          )
        )
      ),
    })
  );

  /* -------------------------------- التركيب -------------------------------- */

  return h('div', { class: 'stack' },
    h('nav', { class: 'breadcrumb' },
      h('a', { href: '#/invoices', text: 'الفواتير' }),
      icon('chevronLeft'),
      h('span', null, ltr(sale.number))
    ),

    h('div', { class: 'page__head' },
      h('div', { class: 'invoice-hero' },
        h('div', null,
          h('p', { style: { color: 'var(--text-2)', 'font-size': '14px' }, text: 'تفاصيل الفاتورة' }),
          h('h2', { class: 'invoice-hero__num' }, ltr(sale.number))
        ),
        badge(SALE_STATUS_LABEL[sale.status], SALE_STATUS_TONE[sale.status], {
          iconName: isCancelled ? 'xCircle' : 'checkCircle',
        })
      ),
      h('div', { class: 'page__actions' },
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: openPrintDialog } },
          h('span', { text: 'طباعة' }), icon('printer')),
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: { click: openPrintDialog },
        }, h('span', { text: 'حفظ PDF' }), icon('file')),
        h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: doExport } },
          h('span', { text: 'تصدير Excel' }), icon('download')),
        !isCancelled
          ? [
              h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: openReturnDialog } }, h('span', { text: 'إرجاع' }), icon('undo')),
              h('button', { class: 'btn btn--outline-danger', attrs: { type: 'button' }, on: { click: doCancel } }, h('span', { text: 'إلغاء الفاتورة' }), icon('trash')),
            ]
          : null
      )
    ),

    isCancelled
      ? alertBox(
          `أُلغيت هذه الفاتورة في ${formatDateTime(sale.cancelledAt, s.dateFormat)}${sale.cancelReason ? ` — ${sale.cancelReason}` : ''}. أُعيدت كل الأصناف إلى المخزون.`,
          'warn'
        )
      : null,

    returns.length > 0
      ? alertBox(`سُجلت ${returns.length} عملية مرتجع لهذه الفاتورة بقيمة إجمالية ${formatAmount(returns.reduce((sum, item) => sum + item.refundMinor, 0))} ${symbol}.`, 'info')
      : null,

    h('div', { class: 'split-layout' }, document_, h('div', { class: 'detail-panel' }, sidebar))
  );
}
