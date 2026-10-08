/**
 * منصة اختبار صغيرة تعمل داخل المتصفح مقابل IndexedDB حقيقي.
 *
 * لماذا في المتصفح وليس Node: المنتج كله مبني على واجهات المتصفح
 * (IndexedDB, CompressionStream, DOMParser, Blob). اختباره على محاكٍ في Node
 * يعني اختبار المحاكي لا المنتج. لا حاجة إلى npm install إطلاقاً.
 */

const suites = [];
let current = null;

export function describe(name, fn) {
  current = { name, tests: [], before: null, after: null };
  suites.push(current);
  fn();
  current = null;
}

export function it(name, fn) {
  if (!current) throw new Error('it() يجب أن تكون داخل describe()');
  current.tests.push({ name, fn });
}

export function beforeEach(fn) {
  if (!current) throw new Error('beforeEach() يجب أن تكون داخل describe()');
  current.before = fn;
}

export function afterEach(fn) {
  if (!current) throw new Error('afterEach() يجب أن تكون داخل describe()');
  current.after = fn;
}

/* ------------------------------ التأكيدات ------------------------------ */

class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

export const assert = {
  ok(value, message = 'التوقع أن تكون القيمة صادقة') {
    if (!value) throw new AssertionError(`${message} — القيمة: ${format(value)}`);
  },

  notOk(value, message = 'التوقع أن تكون القيمة كاذبة') {
    if (value) throw new AssertionError(`${message} — القيمة: ${format(value)}`);
  },

  equal(actual, expected, message = 'القيم غير متطابقة') {
    if (actual !== expected) {
      throw new AssertionError(`${message}\n  المتوقع: ${format(expected)}\n  الفعلي:  ${format(actual)}`);
    }
  },

  notEqual(actual, expected, message = 'القيم متطابقة والمفروض أن تختلف') {
    if (actual === expected) throw new AssertionError(`${message} — ${format(actual)}`);
  },

  deepEqual(actual, expected, message = 'الكائنات غير متطابقة') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new AssertionError(`${message}\n  المتوقع: ${b}\n  الفعلي:  ${a}`);
  },

  /** يتوقع أن ترمي الدالة خطأً، ويرجعه للفحص */
  async throws(fn, matcher, message = 'التوقع رمي خطأ') {
    let error = null;
    try {
      await fn();
    } catch (caught) {
      error = caught;
    }
    if (!error) throw new AssertionError(`${message} — لم يُرمَ أي خطأ`);
    if (matcher instanceof RegExp && !matcher.test(error.message)) {
      throw new AssertionError(`رسالة الخطأ لا تطابق ${matcher}\n  الرسالة: ${error.message}`);
    }
    if (typeof matcher === 'string' && !error.message.includes(matcher)) {
      throw new AssertionError(`رسالة الخطأ لا تحتوي "${matcher}"\n  الرسالة: ${error.message}`);
    }
    return error;
  },

  /** لا ترمي — مفيدة لتوثيق المسار السعيد صراحةً */
  async doesNotThrow(fn, message = 'لم يكن متوقعاً رمي خطأ') {
    try {
      return await fn();
    } catch (error) {
      throw new AssertionError(`${message} — ${error.message}`);
    }
  },
};

function format(value) {
  if (typeof value === 'string') return `"${value}"`;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* ------------------------------- التشغيل ------------------------------- */

/**
 * يشغّل كل المجموعات المسجّلة.
 * @param {(event:object)=>void} [onEvent] لبثّ التقدّم إلى الواجهة
 */
export async function runAll(onEvent = () => {}) {
  const results = { passed: 0, failed: 0, total: 0, failures: [], suites: [], durationMs: 0 };
  const started = performance.now();

  for (const suite of suites) {
    const suiteResult = { name: suite.name, tests: [] };
    results.suites.push(suiteResult);
    onEvent({ type: 'suite', name: suite.name });

    for (const test of suite.tests) {
      results.total += 1;
      const testStart = performance.now();

      try {
        if (suite.before) await suite.before();
        await test.fn();
        if (suite.after) await suite.after();

        results.passed += 1;
        const entry = { name: test.name, ok: true, ms: performance.now() - testStart };
        suiteResult.tests.push(entry);
        onEvent({ type: 'test', suite: suite.name, ...entry });
      } catch (error) {
        // نظّف حتى لا يتسرّب فشل اختبار إلى الذي يليه
        try { if (suite.after) await suite.after(); } catch { /* تجاهل */ }

        results.failed += 1;
        const entry = {
          name: test.name,
          ok: false,
          ms: performance.now() - testStart,
          error: error?.message || String(error),
          stack: error?.stack || '',
        };
        suiteResult.tests.push(entry);
        results.failures.push({ suite: suite.name, ...entry });
        onEvent({ type: 'test', suite: suite.name, ...entry });
      }
    }
  }

  results.durationMs = performance.now() - started;
  onEvent({ type: 'done', ...results });
  return results;
}

export const suiteCount = () => suites.length;
export const testCount = () => suites.reduce((sum, suite) => sum + suite.tests.length, 0);
