/**
 * يبني `app.bundle.js` — نسخة سكربت كلاسيكي واحدة من كل وحدات ES.
 *
 * لماذا: المتصفح يحجب وحدات ES عبر `file://` (CORS، origin 'null')، بينما
 * السكربتات الكلاسيكية تُحمَّل بلا مشكلة. الحزمة تجعل التطبيق يعمل بالنقر
 * المزدوج على index.html مباشرة.
 *
 * التشغيل عبر خادم (http/https) يبقى يستخدم الوحدات الأصلية بلا أي بناء —
 * الحزمة تُستخدم فقط عند اكتشاف بروتوكول file:// (انظر src/boot-guard.js).
 *
 *   node tools/build.mjs [--check]
 *
 * `--check` لا يكتب شيئاً؛ يفشل إذا كانت الحزمة قديمة مقارنةً بالمصدر.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/app.js';
const OUTPUT = resolve(ROOT, 'app.bundle.js');
const CHECK_ONLY = process.argv.includes('--check');

/* ------------------------------------------------------------------ */
/* تحليل الوحدات                                                        */
/* ------------------------------------------------------------------ */

const IMPORT_RE = /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
const BARE_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]\s*;?[ \t]*$/gm;
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/** يحوّل مساراً نسبياً إلى مسار من جذر المشروع بصيغة POSIX */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    throw new Error(`مُحدِّد غير نسبي غير مدعوم: "${specifier}" في ${fromFile}`);
  }
  const abs = resolve(dirname(resolve(ROOT, fromFile)), specifier);
  return relative(ROOT, abs).split('\\').join('/');
}

const modules = new Map();

function loadModule(id) {
  if (modules.has(id)) return modules.get(id);

  const fullPath = resolve(ROOT, id);
  if (!existsSync(fullPath)) throw new Error(`وحدة غير موجودة: ${id}`);

  const source = readFileSync(fullPath, 'utf8');
  const record = { id, source, deps: new Set(), exports: [] };
  modules.set(id, record);

  // 1) الاستيرادات الثابتة { a, b as c }
  let body = source.replace(IMPORT_RE, (_match, names, specifier) => {
    const dep = resolveSpecifier(id, specifier);
    record.deps.add(dep);

    const bindings = names
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+as\s+/);
        return parts.length === 2 ? `${parts[0].trim()}: ${parts[1].trim()}` : parts[0].trim();
      });

    if (bindings.length === 0) return `__m(${JSON.stringify(dep)});`;
    return `const { ${bindings.join(', ')} } = __m(${JSON.stringify(dep)});`;
  });

  // 2) استيراد لأثر جانبي فقط
  body = body.replace(BARE_IMPORT_RE, (_match, specifier) => {
    const dep = resolveSpecifier(id, specifier);
    record.deps.add(dep);
    return `__m(${JSON.stringify(dep)});`;
  });

  // 3) الاستيراد الديناميكي — يصبح بحثاً في السجل يرجع وعداً محلولاً
  body = body.replace(DYNAMIC_RE, (_match, specifier) => {
    const dep = resolveSpecifier(id, specifier);
    record.deps.add(dep);
    return `__dyn(${JSON.stringify(dep)})`;
  });

  // 4) التصديرات: احذف الكلمة المفتاحية وسجّل الأسماء
  body = body.replace(/^([ \t]*)export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
    (_match, indent, keyword, name) => {
      record.exports.push(name);
      return `${indent}${keyword} ${name}`;
    });

  // 5) export { a, b };
  body = body.replace(/^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (_match, names) => {
    for (const entry of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      const parts = entry.split(/\s+as\s+/);
      record.exports.push((parts[1] || parts[0]).trim());
    }
    return '';
  });

  // تحقّق من عدم بقاء أي صيغة تصدير غير مدعومة
  const leftover = body.match(/^[ \t]*export\b.*$/gm);
  if (leftover) {
    throw new Error(`صيغة تصدير غير مدعومة في ${id}:\n  ${leftover.join('\n  ')}`);
  }

  record.body = body;
  for (const dep of record.deps) loadModule(dep);
  return record;
}

/* ------------------------------------------------------------------ */
/* بناء المخرجات                                                       */
/* ------------------------------------------------------------------ */

function build() {
  modules.clear();
  loadModule(ENTRY);

  const parts = [];
  parts.push(`/* ملف مُولَّد آلياً — لا تعدّله يدوياً.
 * المصدر: وحدات ES داخل مجلد src
 * أعد التوليد بـ: node tools/build.mjs
 *
 * الغرض: تشغيل التطبيق عبر file:// حيث تُحجب وحدات ES.
 * عند التشغيل من خادم (http/https) تُستخدم الوحدات الأصلية مباشرةً.
 */
(function () {
  'use strict';

  var __defs = {};
  var __cache = {};

  /** يعرّف وحدة */
  function __def(id, factory) { __defs[id] = factory; }

  /** يقيّم وحدة مرة واحدة ويرجع تصديراتها */
  function __m(id) {
    if (__cache[id]) return __cache[id].exports;

    var factory = __defs[id];
    if (!factory) throw new Error('وحدة غير معرّفة داخل الحزمة: ' + id);

    var mod = { exports: {} };
    __cache[id] = mod;          // يُسجَّل قبل التنفيذ لتحمّل الاعتماد الدائري
    factory(mod.exports, __m, __dyn);
    return mod.exports;
  }

  /** بديل الاستيراد الديناميكي: يرجع وعداً محلولاً بتصديرات الوحدة */
  function __dyn(id) {
    try { return Promise.resolve(__m(id)); }
    catch (error) { return Promise.reject(error); }
  }
`);

  // الوحدات بترتيب أبجدي — الترتيب لا يهم لأن __m يقيّم عند الطلب
  const ids = [...modules.keys()].sort();

  for (const id of ids) {
    const record = modules.get(id);
    const definitions = [...new Set(record.exports)]
      .map((name) => `    Object.defineProperty(__exports, ${JSON.stringify(name)}, { enumerable: true, get: function () { return ${name}; } });`)
      .join('\n');

    parts.push(`
  /* ${'='.repeat(66)} */
  /* ${id} */
  __def(${JSON.stringify(id)}, function (__exports, __m, __dyn) {
${record.body.split('\n').map((line) => (line.trim() ? `    ${line}` : '')).join('\n')}

${definitions}
  });
`);
  }

  parts.push(`
  /* نقطة الدخول */
  __m(${JSON.stringify(ENTRY)});
}());
`);

  return parts.join('');
}

/* ------------------------------------------------------------------ */

const output = build();

if (CHECK_ONLY) {
  const existing = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (existing !== output) {
    console.error('✗ app.bundle.js قديمة أو مفقودة. شغّل: node tools/build.mjs');
    process.exit(1);
  }
  console.log(`✓ app.bundle.js محدّثة (${modules.size} وحدة)`);
  process.exit(0);
}

writeFileSync(OUTPUT, output);
console.log(`✓ بُنيت app.bundle.js — ${modules.size} وحدة، ${(output.length / 1024).toFixed(0)}KB`);
