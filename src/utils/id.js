/** معرفات مستقرة وفريدة. */

/**
 * معرّف عشوائي. crypto.randomUUID متاح في السياقات الآمنة فقط،
 * ونستخدم getRandomValues كبديل حتى يعمل الاختبار على http://localhost في كل الحالات.
 */
export function uid(prefix = '') {
  let id;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID();
  } else {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return prefix ? `${prefix}_${id}` : id;
}

/** رقم فاتورة: INV-2026-00126 */
export function formatInvoiceNumber(prefix, sequence, year, padding = 5) {
  const seq = String(sequence).padStart(padding, '0');
  return year ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`;
}
