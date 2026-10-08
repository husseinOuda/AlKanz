/** تنسيق الأرقام والتواريخ والنصوص للعرض. */

import { toMajor } from './money.js';

// أرقام لاتينية داخل نص عربي — أوضح للقراءة في الجداول المالية
const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFormatter = new Intl.NumberFormat('en-US');

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** مبلغ بوحدة صغرى → نص "1,250.00" (بدون رمز العملة) */
export function formatAmount(minor, digits = 2) {
  const value = toMajor(minor ?? 0);
  if (digits === 2) return numberFormatter.format(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** مبلغ بوحدة صغرى → نص "1,250.00 ر.س" */
export function formatMoney(minor, currencySymbol = '', { decimals = 2, symbolPosition = 'after' } = {}) {
  const amount = formatAmount(minor, decimals);
  if (!currencySymbol) return amount;
  return symbolPosition === 'before' ? `${currencySymbol} ${amount}` : `${amount} ${currencySymbol}`;
}

export function formatInt(value) {
  return intFormatter.format(value ?? 0);
}

export function formatCompact(value) {
  return compactFormatter.format(value ?? 0);
}

export function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0%';
  return `${num.toFixed(digits).replace(/\.0+$/, '')}%`;
}

/** حجم بالبايت → نص عربي مقروء */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 بايت';
  const units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت', 'تيرابايت'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
}

/** تنسيق كمية: يحذف الأصفار العشرية غير المفيدة */
export function formatQty(value) {
  const num = Number(value ?? 0);
  return Number.isInteger(num) ? intFormatter.format(num) : num.toFixed(3).replace(/\.?0+$/, '');
}

/** الحرف/الحرفان الأولان من الاسم للأفاتار */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[1][0];
}

/** يقصّ نصاً طويلاً */
export function truncate(text, max = 60) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

export function pluralAr(count, one, two, few, many) {
  if (count === 1) return one;
  if (count === 2) return two;
  if (count >= 3 && count <= 10) return few;
  return many;
}

/** "3 أصناف" / "صنف واحد" */
export function itemsLabel(count) {
  if (count === 0) return 'لا أصناف';
  if (count === 1) return 'صنف واحد';
  if (count === 2) return 'صنفان';
  if (count <= 10) return `${count} أصناف`;
  return `${count} صنف`;
}

export function invoicesLabel(count) {
  if (count === 0) return 'لا فواتير';
  if (count === 1) return 'فاتورة واحدة';
  if (count === 2) return 'فاتورتان';
  if (count <= 10) return `${count} فواتير`;
  return `${count} فاتورة`;
}
