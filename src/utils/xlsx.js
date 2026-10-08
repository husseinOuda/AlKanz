/**
 * قراءة وكتابة ملفات Excel (.xlsx) بدون أي مكتبة خارجية.
 *
 * ملف xlsx هو أرشيف ZIP يحتوي ملفات XML. نستخدم:
 *  - CompressionStream/DecompressionStream('deflate-raw') وهي واجهات متصفح أصلية
 *    (Baseline منذ 2023-05 — MDN)، فلا حاجة إلى مكتبة ضغط.
 *  - DOMParser الأصلي لتحليل XML.
 *
 * الكتابة تستخدم inline strings فتجنّبنا جدول النصوص المشتركة،
 * والقراءة تدعم sharedStrings و inlineStr و str والأرقام.
 */

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ */
/* CRC32                                                               */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* ضغط / فك ضغط                                                        */
/* ------------------------------------------------------------------ */

async function streamThrough(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const deflateRaw = (bytes) => streamThrough(bytes, new CompressionStream('deflate-raw'));
const inflateRaw = (bytes) => streamThrough(bytes, new DecompressionStream('deflate-raw'));

/* ------------------------------------------------------------------ */
/* كتابة ZIP                                                           */
/* ------------------------------------------------------------------ */

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * ينشئ أرشيف ZIP من مدخلات {name, data}.
 * @param {{name:string, data:Uint8Array}[]} entries
 * @returns {Promise<Blob>}
 */
async function buildZip(entries) {
  const { time, date } = dosDateTime(new Date());
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const raw = entry.data;
    const crc = crc32(raw);

    let compressed = await deflateRaw(raw);
    let method = 8;
    // إن لم يفد الضغط، خزّن الملف كما هو
    if (compressed.length >= raw.length) {
      compressed = raw;
      method = 0;
    }

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0, true);
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressed.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    parts.push(new Uint8Array(local.buffer), nameBytes, compressed);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, compressed.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);

    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/* ------------------------------------------------------------------ */
/* قراءة ZIP                                                           */
/* ------------------------------------------------------------------ */

async function readZip(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);

  // ابحث عن نهاية الدليل المركزي من آخر الملف (التعليق قد يصل إلى 64KB)
  let eocdOffset = -1;
  const scanStart = Math.max(0, bytes.length - 65558);
  for (let i = bytes.length - 22; i >= scanStart; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('الملف ليس أرشيف ZIP صالحاً');

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);

  const files = new Map();
  const decoder = new TextDecoder('utf-8');

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('دليل ZIP تالف');

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    files.set(name, { method, compressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  /** يقرأ محتوى ملف داخل الأرشيف كنص */
  async function readText(name) {
    const entry = files.get(name);
    if (!entry) return null;

    if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
      throw new Error('رأس ملف ZIP تالف');
    }
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const dataStart = entry.localOffset + 30 + nameLength + extraLength;
    const raw = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return decoder.decode(raw);
    if (entry.method === 8) return decoder.decode(await inflateRaw(raw));
    throw new Error(`طريقة ضغط غير مدعومة داخل الملف (${entry.method})`);
  }

  return { files, readText };
}

/* ------------------------------------------------------------------ */
/* أدوات XML                                                           */
/* ------------------------------------------------------------------ */

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // محارف تحكم غير مسموحة في XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** 0 → A، 25 → Z، 26 → AA */
export function columnLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

/** "AB12" → 27 */
function columnIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/)?.[0] || 'A';
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

/* ------------------------------------------------------------------ */
/* كتابة xlsx                                                          */
/* ------------------------------------------------------------------ */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** نمطان فقط: 0 عادي، 1 رأس عريض بخلفية، 2 رقم بمنزلتين عشريتين */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0C2444"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function cellXml(ref, value, styleIndex) {
  const style = styleIndex ? ` s="${styleIndex}"` : '';

  if (value == null || value === '') return `<c r="${ref}"${style}/>`;

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${style || ' s="2"'}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows, columnWidths) {
  const cols = columnWidths?.length
    ? `<cols>${columnWidths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) =>
      cellXml(`${columnLetter(colIndex)}${rowIndex + 1}`, value, rowIndex === 0 ? 1 : 0)
    ).join('');
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="22" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');

  const lastRef = `${columnLetter(Math.max(0, (rows[0]?.length || 1) - 1))}${Math.max(rows.length, 1)}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${body}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
</worksheet>`;
}

/**
 * ينشئ ملف xlsx من صفوف.
 * الصف الأول يُعامل كرأس ويُنسَّق تلقائياً.
 *
 * @param {(string|number|boolean|null)[][]} rows
 * @param {{sheetName?:string, columnWidths?:number[]}} [options]
 * @returns {Promise<Blob>}
 */
export async function writeXlsx(rows, { sheetName = 'البيانات', columnWidths } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('لا توجد بيانات للتصدير');

  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(sheetName)) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', data: encoder.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml(rows, columnWidths)) },
  ];

  return buildZip(files);
}

/* ------------------------------------------------------------------ */
/* قراءة xlsx                                                          */
/* ------------------------------------------------------------------ */

function textOfSharedString(siElement) {
  // <si><t>نص</t></si> أو <si><r><t>جزء</t></r><r><t>جزء</t></r></si>
  const parts = siElement.getElementsByTagName('t');
  let text = '';
  for (const part of parts) {
    // تجاهل <rPh> (نطق ياباني) إن وُجد
    if (part.parentElement?.tagName === 'rPh') continue;
    text += part.textContent;
  }
  return text;
}

/**
 * يقرأ أول ورقة في ملف xlsx ويعيدها كمصفوفة صفوف.
 *
 * @param {File|Blob|ArrayBuffer} source
 * @param {{maxRows?:number}} [options]
 * @returns {Promise<(string|number|null)[][]>}
 */
export async function readXlsx(source, { maxRows = 20000 } = {}) {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const zip = await readZip(buffer);

  const parser = new DOMParser();

  const parse = (text, what) => {
    const doc = parser.parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      throw new Error(`تعذّر تحليل ${what} داخل الملف`);
    }
    return doc;
  };

  // النصوص المشتركة (اختيارية)
  const sharedText = await zip.readText('xl/sharedStrings.xml');
  const shared = [];
  if (sharedText) {
    const doc = parse(sharedText, 'جدول النصوص');
    for (const si of doc.getElementsByTagName('si')) shared.push(textOfSharedString(si));
  }

  // اسم أول ورقة من علاقات المصنّف
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (!zip.files.has(sheetPath)) {
    const found = [...zip.files.keys()].find((name) => /^xl\/worksheets\/.+\.xml$/.test(name));
    if (!found) throw new Error('لا توجد أوراق عمل داخل الملف');
    sheetPath = found;
  }

  const sheetText = await zip.readText(sheetPath);
  if (!sheetText) throw new Error('تعذّر قراءة ورقة العمل');

  const doc = parse(sheetText, 'ورقة العمل');
  const rows = [];

  for (const rowElement of doc.getElementsByTagName('row')) {
    if (rows.length >= maxRows) break;

    const cells = [];
    for (const cell of rowElement.getElementsByTagName('c')) {
      const index = columnIndex(cell.getAttribute('r') || `${columnLetter(cells.length)}1`);
      const type = cell.getAttribute('t');

      let value = null;
      if (type === 'inlineStr') {
        const is = cell.getElementsByTagName('is')[0];
        value = is ? textOfSharedString(is) : '';
      } else {
        const v = cell.getElementsByTagName('v')[0];
        const raw = v ? v.textContent : '';
        if (type === 's') {
          value = shared[Number(raw)] ?? '';
        } else if (type === 'b') {
          value = raw === '1';
        } else if (type === 'str' || type === 'e') {
          value = raw;
        } else {
          value = raw === '' ? null : Number(raw);
          if (Number.isNaN(value)) value = raw;
        }
      }

      while (cells.length < index) cells.push(null);
      cells[index] = value;
    }
    rows.push(cells);
  }

  // احذف الصفوف الفارغة تماماً من النهاية
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c == null || c === '')) rows.pop();

  return rows;
}

/**
 * ينزّل Blob كملف. يحرّر الرابط بعد الاستخدام لتفادي تسريب الذاكرة.
 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // إبطاء بسيط حتى يبدأ التنزيل قبل إبطال الرابط
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
