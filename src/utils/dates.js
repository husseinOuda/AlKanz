/**
 * التعامل مع التواريخ.
 * التخزين دائماً بصيغة ISO (UTC) في الحقل `createdAt`، ومعه `dayKey` محلي
 * بصيغة YYYY-MM-DD لأن التقارير اليومية يجب أن تتبع اليوم المحلي للمتجر
 * لا يوم UTC (وإلا انقسمت مبيعات المساء على يومين).
 */

const PAD = (n) => String(n).padStart(2, '0');

export function now() {
  return new Date();
}

export function toISO(date = new Date()) {
  return date.toISOString();
}

let lastStamp = 0;

/**
 * طابع زمني ISO **متزايد تماماً**.
 *
 * دقة Date تبلغ ميلي ثانية، وعمليات متتالية (ثلاث تسويات مخزون في حلقة واحدة)
 * تنتج طوابع متطابقة، فيصبح الترتيب حسب createdAt غير محدَّد ويظهر سجل الحركات
 * بترتيب خاطئ. هذه الدالة تضمن أن كل استدعاء يعطي قيمة أكبر من سابقتها.
 */
export function monotonicISO(date = new Date()) {
  const now = Math.max(date.getTime(), lastStamp + 1);
  lastStamp = now;
  return new Date(now).toISOString();
}

/** مفتاح اليوم المحلي YYYY-MM-DD */
export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

/** مفتاح الشهر المحلي YYYY-MM */
export function monthKey(date = new Date()) {
  return dayKey(date).slice(0, 7);
}

export function fromDayKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(date, days) {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfDay(date = new Date()) {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date = new Date()) {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

/** قائمة مفاتيح الأيام بين تاريخين (شاملة الطرفين) */
export function dayRange(fromKey, toKey) {
  const keys = [];
  let cursor = fromDayKey(fromKey);
  const end = fromDayKey(toKey);
  // حد أمان: سنتان كحد أقصى لمنع حلقة غير منتهية على مدخل خاطئ
  for (let i = 0; cursor <= end && i < 800; i += 1) {
    keys.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }
  return keys;
}

/** نطاقات جاهزة للفلاتر الزمنية */
export function presetRange(preset) {
  const today = new Date();
  switch (preset) {
    case 'today':
      return { from: dayKey(today), to: dayKey(today) };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: dayKey(y), to: dayKey(y) };
    }
    case 'last7':
      return { from: dayKey(addDays(today, -6)), to: dayKey(today) };
    case 'last30':
      return { from: dayKey(addDays(today, -29)), to: dayKey(today) };
    case 'month':
      return { from: `${monthKey(today)}-01`, to: dayKey(today) };
    case 'prevMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: dayKey(first), to: dayKey(last) };
    }
    case 'year':
      return { from: `${today.getFullYear()}-01-01`, to: dayKey(today) };
    default:
      return { from: dayKey(addDays(today, -6)), to: dayKey(today) };
  }
}

/** الفترة السابقة المماثلة في الطول (للمقارنة في التقارير) */
export function previousRange(fromKey, toKey) {
  const from = fromDayKey(fromKey);
  const to = fromDayKey(toKey);
  const days = Math.round((to - from) / 86400000) + 1;
  return { from: dayKey(addDays(from, -days)), to: dayKey(addDays(to, -days)) };
}

const DATE_PATTERNS = {
  'YYYY-MM-DD': (d) => `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`,
  'DD/MM/YYYY': (d) => `${PAD(d.getDate())}/${PAD(d.getMonth() + 1)}/${d.getFullYear()}`,
  'MM/DD/YYYY': (d) => `${PAD(d.getMonth() + 1)}/${PAD(d.getDate())}/${d.getFullYear()}`,
  'DD-MM-YYYY': (d) => `${PAD(d.getDate())}-${PAD(d.getMonth() + 1)}-${d.getFullYear()}`,
};

export const DATE_FORMATS = Object.keys(DATE_PATTERNS);

/** تنسيق تاريخ حسب إعداد المتجر */
export function formatDate(value, pattern = 'YYYY-MM-DD') {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return (DATE_PATTERNS[pattern] || DATE_PATTERNS['YYYY-MM-DD'])(d);
}

/** وقت 12 ساعة بالعربية: "10:30 ص" */
export function formatTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hours = d.getHours();
  const period = hours < 12 ? 'ص' : 'م';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${PAD(d.getMinutes())} ${period}`;
}

export function formatDateTime(value, pattern = 'YYYY-MM-DD') {
  if (!value) return '—';
  const time = formatTime(value);
  return time ? `${formatDate(value, pattern)} ${time}` : formatDate(value, pattern);
}

/** وصف نسبي مختصر: اليوم / أمس / منذ 3 أيام */
export function relativeDayLabel(key) {
  const todayKey = dayKey(new Date());
  if (key === todayKey) return 'اليوم';
  const diff = Math.round((fromDayKey(todayKey) - fromDayKey(key)) / 86400000);
  if (diff === 1) return 'أمس';
  if (diff === 2) return 'قبل أمس';
  if (diff > 2 && diff <= 10) return `منذ ${diff} أيام`;
  if (diff < 0) return key;
  return key;
}

/** طابع زمني صالح لاسم ملف: 2026-08-04-1530 */
export function fileStamp(date = new Date()) {
  return `${dayKey(date)}-${PAD(date.getHours())}${PAD(date.getMinutes())}`;
}

/** يتحقق أن النص مفتاح يوم صالح */
export function isDayKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const d = fromDayKey(value);
  return !Number.isNaN(d.getTime()) && dayKey(d) === value;
}
