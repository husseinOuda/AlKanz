import { h, ltr } from '../utils/dom.js';
import { card, emptyState, badge } from '../components/ui.js';
import { stockReport, stagnantProducts } from '../services/reports.js';
import { customerLedgers } from '../repositories/customers.js';
import { settings } from '../repositories/settings.js';
import { formatAmount } from '../utils/format.js';
import { dayKey } from '../utils/dates.js';

export async function render() {
  const s = settings(); const [stock, stagnant, ledgers] = await Promise.all([stockReport(), stagnantProducts(60), customerLedgers()]);
  const notices = [
    ...stock.out.map((p) => ({ tone: 'red', title: 'نفد المخزون', text: `${p.name} — الكمية 0`, href: '#/inventory?stock=out' })),
    ...stock.low.map((p) => ({ tone: 'amber', title: 'مخزون منخفض', text: `${p.name} — المتاح ${p.quantity}`, href: '#/inventory?stock=low' })),
    ...stagnant.map((p) => ({ tone: 'blue', title: 'منتج راكد', text: `${p.name} لم يسجل مبيعات حديثة`, href: '#/reports?type=stagnant' })),
    ...[...ledgers.entries()].filter(([, l]) => l.balanceMinor > 0).map(([id, l]) => ({ tone: 'red', title: 'ذمة عميل مستحقة', text: `المبلغ المستحق ${formatAmount(l.balanceMinor)} ${s.currencySymbol}`, href: `#/customers/${id}` })),
  ];
  const lastBackup = s.lastBackupAt ? new Date(s.lastBackupAt) : null;
  if (!lastBackup || (Date.now() - lastBackup.getTime()) > 7 * 86400000) notices.push({ tone: 'amber', title: 'نسخة احتياطية قديمة', text: 'أنشئ نسخة احتياطية لحماية بياناتك.', href: '#/backup' });
  return h('div', { class: 'stack' }, h('div', { class: 'page__head' }, h('div', null, h('h2', { text: 'مركز الإشعارات' }), h('p', { text: `مراجعة تلقائية للبيانات — ${dayKey(new Date())}` }))), notices.length === 0 ? card({ body: emptyState({ iconName: 'checkCircle', title: 'لا توجد تنبيهات', text: 'المخزون والذمم والنسخ الاحتياطي في حالة جيدة.' }) }) : card({ flush: true, body: h('div', { class: 'stack', style: { padding: '16px' } }, ...notices.map((notice) => h('a', { class: 'detail-row', href: notice.href, style: { 'text-decoration': 'none' } }, h('span', null, badge(notice.title, notice.tone)), h('span', { class: 'detail-row__value', text: notice.text })))) }));
}
