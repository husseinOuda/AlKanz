/**
 * الطباعة.
 *
 * لا نفتح نافذة جديدة (تحجبها المتصفحات وتفقد CSP). بدلاً من ذلك نبني المستند
 * داخل #print-region في نفس الصفحة، ويتكفّل print.css بإخفاء كل شيء آخر.
 * «حفظ PDF» هو نفس المسار — يختار المستخدم "حفظ كـ PDF" من مربع طباعة المتصفح.
 */

import { h, render, clear, ltr } from '../utils/dom.js';
import { formatAmount } from '../utils/format.js';
import { formatDateTime, formatDate } from '../utils/dates.js';
import { settings } from '../repositories/settings.js';
import { SALE_STATUS_LABEL, PAYMENT_TYPE_LABEL } from '../repositories/sales.js';

export const TEMPLATES = {
  A4: 'a4',
  THERMAL: 'thermal80',
  THERMAL_58: 'thermal58',
};

export const TEMPLATE_LABEL = {
  [TEMPLATES.A4]: 'A4',
  [TEMPLATES.THERMAL]: '80mm حراري',
  [TEMPLATES.THERMAL_58]: '58mm حراري',
};

/** يشغّل مربع الطباعة على محتوى معيّن ثم ينظّف */
function printNode(node, template) {
  const region = document.getElementById('print-region');
  const thermalSheet = document.getElementById('print-thermal-css');

  region.dataset.template = template;
  document.body.dataset.printing = template;
  // تبديل حجم الصفحة عبر media بدل حقن <style> (متوافق مع CSP)
  if (thermalSheet) thermalSheet.media = template === TEMPLATES.A4 ? 'not all' : 'print';
  render(region, node);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    clear(region);
    delete document.body.dataset.printing;
    if (thermalSheet) thermalSheet.media = 'not all';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // مهلة إطار واحد حتى يُرسم المحتوى قبل فتح المربع
  requestAnimationFrame(() => {
    window.print();
    // احتياط: بعض المتصفحات لا تطلق afterprint
    setTimeout(cleanup, 1500);
  });
}

const row = (label, value, options = {}) =>
  h('div', { class: ['pr-row', options.strong && 'pr-row--strong', options.className] },
    h('span', { text: label }),
    h('span', null, value)
  );

/* ------------------------------------------------------------------ */
/* فاتورة A4                                                            */
/* ------------------------------------------------------------------ */

function invoiceA4(sale, items) {
  const s = settings();
  const symbol = s.currencySymbol;
  const money = (minor) => h('span', null, ltr(formatAmount(minor)), ` ${symbol}`);

  return h('article', { class: 'pr pr--a4' },
    h('header', { class: 'pr__head' },
      h('div', null,
        h('h1', { class: 'pr__store', text: s.storeName }),
        s.storeAddress ? h('p', { class: 'pr__line', text: s.storeAddress }) : null,
        s.storePhone ? h('p', { class: 'pr__line' }, 'هاتف: ', ltr(s.storePhone)) : null,
        s.storeCrNumber ? h('p', { class: 'pr__line' }, 'السجل التجاري: ', ltr(s.storeCrNumber)) : null,
        s.storeTaxNumber ? h('p', { class: 'pr__line' }, 'الرقم الضريبي: ', ltr(s.storeTaxNumber)) : null
      ),
      h('div', { class: 'pr__meta' },
        h('h2', { class: 'pr__doctitle', text: 'فاتورة مبيعات' }),
        h('p', { class: 'pr__line' }, 'رقم: ', ltr(sale.number)),
        h('p', { class: 'pr__line' }, 'التاريخ: ', ltr(formatDateTime(sale.createdAt, s.dateFormat))),
        h('p', { class: 'pr__line', text: `الحالة: ${SALE_STATUS_LABEL[sale.status] || sale.status}` })
      )
    ),

    h('section', { class: 'pr__party' },
      h('strong', { text: 'العميل: ' }),
      h('span', { text: sale.customerName }),
      sale.paymentType
        ? h('span', { class: 'pr__pay', text: ` — ${PAYMENT_TYPE_LABEL[sale.paymentType] || ''}` })
        : null
    ),

    h('table', { class: 'pr__table' },
      h('thead', null,
        h('tr', null,
          h('th', { text: '#' }),
          h('th', { text: 'الصنف' }),
          h('th', { text: 'الكمية' }),
          h('th', { text: `سعر الوحدة (${symbol})` }),
          h('th', { text: `الإجمالي (${symbol})` })
        )
      ),
      h('tbody', null,
        ...items.map((item, index) =>
          h('tr', null,
            h('td', null, ltr(index + 1)),
            h('td', null,
              h('div', { text: item.name }),
              h('div', { class: 'pr__sku' }, ltr(item.sku))
            ),
            h('td', null, ltr(item.quantity)),
            h('td', null, ltr(formatAmount(item.unitPriceMinor))),
            h('td', null, ltr(formatAmount(item.lineTotalMinor)))
          )
        )
      )
    ),

    h('section', { class: 'pr__totals' },
      row('المجموع الفرعي', money(sale.subtotalMinor)),
      sale.discountMinor > 0
        ? row('الخصم', h('span', null, '−', ltr(formatAmount(sale.discountMinor)), ` ${symbol}`))
        : null,
      row(`الضريبة (${(sale.taxRateBp / 100).toFixed(sale.taxRateBp % 100 ? 2 : 0)}%)`, money(sale.taxMinor)),
      row('الإجمالي النهائي', money(sale.totalMinor), { strong: true }),
      sale.dueMinor > 0 ? row('المدفوع', money(sale.paidMinor)) : null,
      sale.dueMinor > 0 ? row('المتبقي', money(sale.dueMinor)) : null
    ),

    sale.note ? h('section', { class: 'pr__note' }, h('strong', { text: 'ملاحظة: ' }), h('span', { text: sale.note })) : null,

    h('footer', { class: 'pr__foot' },
      s.invoiceFooter ? h('p', { text: s.invoiceFooter }) : null,
      h('p', { class: 'pr__sku' }, ltr(`${formatDate(new Date(), s.dateFormat)}`))
    )
  );
}

/* ------------------------------------------------------------------ */
/* إيصال حراري 80mm                                                     */
/* ------------------------------------------------------------------ */

function invoiceThermal(sale, items) {
  const s = settings();
  const symbol = s.currencySymbol;

  return h('article', { class: 'pr pr--thermal' },
    h('header', { class: 'pr__head' },
      h('h1', { class: 'pr__store', text: s.storeName }),
      s.storeAddress ? h('p', { class: 'pr__line', text: s.storeAddress }) : null,
      s.storePhone ? h('p', { class: 'pr__line' }, ltr(s.storePhone)) : null,
      s.storeTaxNumber ? h('p', { class: 'pr__line' }, 'ض.ر: ', ltr(s.storeTaxNumber)) : null
    ),

    h('div', { class: 'pr__rule' }),

    h('div', { class: 'pr__kv' },
      h('p', { class: 'pr__line' }, 'فاتورة: ', ltr(sale.number)),
      h('p', { class: 'pr__line' }, ltr(formatDateTime(sale.createdAt, s.dateFormat))),
      h('p', { class: 'pr__line', text: `العميل: ${sale.customerName}` }),
      h('p', { class: 'pr__line', text: `الدفع: ${PAYMENT_TYPE_LABEL[sale.paymentType] || ''}` })
    ),

    h('div', { class: 'pr__rule' }),

    h('div', { class: 'pr__items' },
      ...items.map((item) =>
        h('div', { class: 'pr__item' },
          h('div', { class: 'pr__item-name', text: item.name }),
          h('div', { class: 'pr__item-line' },
            h('span', null, ltr(`${item.quantity} × ${formatAmount(item.unitPriceMinor)}`)),
            h('span', null, ltr(formatAmount(item.lineTotalMinor)))
          )
        )
      )
    ),

    h('div', { class: 'pr__rule' }),

    h('section', { class: 'pr__totals' },
      row('المجموع', h('span', null, ltr(formatAmount(sale.subtotalMinor)))),
      sale.discountMinor > 0 ? row('الخصم', h('span', null, '−', ltr(formatAmount(sale.discountMinor)))) : null,
      row('الضريبة', h('span', null, ltr(formatAmount(sale.taxMinor)))),
      row('الإجمالي', h('span', null, ltr(`${formatAmount(sale.totalMinor)} ${symbol}`)), { strong: true }),
      sale.dueMinor > 0 ? row('المتبقي', h('span', null, ltr(formatAmount(sale.dueMinor)))) : null
    ),

    h('div', { class: 'pr__rule' }),

    h('footer', { class: 'pr__foot' },
      s.invoiceFooter ? h('p', { text: s.invoiceFooter }) : null
    )
  );
}

/**
 * يطبع فاتورة بالقالب المطلوب (أو القالب الافتراضي من الإعدادات).
 */
export function printInvoice(sale, items, template = settings().printTemplate) {
  const node = template === TEMPLATES.THERMAL || template === TEMPLATES.THERMAL_58 ? invoiceThermal(sale, items) : invoiceA4(sale, items);
  printNode(node, template);
}

/* ------------------------------------------------------------------ */
/* طباعة تقرير                                                          */
/* ------------------------------------------------------------------ */

/**
 * يطبع تقريراً عاماً: عنوان + فترة + بطاقات ملخص + جداول.
 * @param {{title:string, subtitle?:string, stats?:{label:string,value:string}[], tables:{title:string, header:string[], rows:(string|number)[][]}[]}} config
 */
export function printReport({ title, subtitle, stats = [], tables = [] }) {
  const s = settings();

  const node = h('article', { class: 'pr pr--a4 pr--report' },
    h('header', { class: 'pr__head' },
      h('div', null,
        h('h1', { class: 'pr__store', text: s.storeName }),
        h('h2', { class: 'pr__doctitle', text: title }),
        subtitle ? h('p', { class: 'pr__line', text: subtitle }) : null
      ),
      h('div', { class: 'pr__meta' },
        h('p', { class: 'pr__line' }, 'تاريخ الطباعة: ', ltr(formatDateTime(new Date(), s.dateFormat)))
      )
    ),

    stats.length > 0
      ? h('section', { class: 'pr__stats' },
          ...stats.map((stat) =>
            h('div', { class: 'pr__stat' },
              h('div', { class: 'pr__stat-label', text: stat.label }),
              h('div', { class: 'pr__stat-value' }, ltr(stat.value))
            )
          )
        )
      : null,

    ...tables.map((table) =>
      h('section', { class: 'pr__section' },
        h('h3', { class: 'pr__subtitle', text: table.title }),
        table.rows.length === 0
          ? h('p', { class: 'pr__line', text: 'لا توجد بيانات في هذه الفترة.' })
          : h('table', { class: 'pr__table' },
              h('thead', null, h('tr', null, ...table.header.map((label) => h('th', { text: label })))),
              h('tbody', null,
                ...table.rows.map((cells) =>
                  h('tr', null, ...cells.map((cell) =>
                    h('td', null, typeof cell === 'number' ? ltr(cell) : cell)
                  ))
                )
              )
            )
      )
    )
  );

  printNode(node, TEMPLATES.A4);
}
