/**
 * مشغّل الاختبارات في المتصفح.
 * افتح tests/index.html عبر خادم محلي، أو شغّل: npm test (node tools/run-tests.mjs)
 */

import { runAll, testCount, suiteCount } from './harness.js';

// استيراد المجموعات — ترتيب الاستيراد هو ترتيب التنفيذ
import './money.test.js';
import './products.test.js';
import './sales.test.js';
import './inventory.test.js';
import './reports.test.js';
import './backup.test.js';

const summary = document.getElementById('summary');
const results = document.getElementById('results');

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

const suiteNodes = new Map();

function suiteNode(name) {
  if (suiteNodes.has(name)) return suiteNodes.get(name);

  const wrapper = el('section', 'test-suite');
  const head = el('div', 'test-suite__head');
  head.append(el('span', null, name));
  const count = el('span', 'test-suite__count', '0/0');
  head.append(count);
  wrapper.append(head);

  const body = el('div');
  wrapper.append(body);
  results.append(wrapper);

  const entry = { wrapper, body, count, passed: 0, total: 0 };
  suiteNodes.set(name, entry);
  return entry;
}

summary.textContent = `جارٍ تشغيل ${testCount()} اختباراً في ${suiteCount()} مجموعة…`;

const report = await runAll((event) => {
  if (event.type === 'suite') {
    suiteNode(event.name);
    return;
  }

  if (event.type === 'test') {
    const suite = suiteNode(event.suite);
    suite.total += 1;
    if (event.ok) suite.passed += 1;
    suite.count.textContent = `${suite.passed}/${suite.total}`;

    const row = el('div', `test-case ${event.ok ? 'is-pass' : 'is-fail'}`);
    row.append(el('span', 'test-case__mark', event.ok ? '✓' : '✗'));

    const nameCell = el('div', 'test-case__name');
    nameCell.append(el('div', null, event.name));
    if (!event.ok) nameCell.append(el('pre', 'test-case__error', event.error));
    row.append(nameCell);

    row.append(el('span', 'test-case__ms', `${Math.round(event.ms)}ms`));
    suite.body.append(row);
  }
});

summary.textContent = report.failed === 0
  ? `✓ نجحت جميع الاختبارات (${report.passed}/${report.total}) في ${Math.round(report.durationMs)}ms`
  : `✗ فشل ${report.failed} من ${report.total} اختباراً`;
summary.classList.add(report.failed === 0 ? 'is-pass' : 'is-fail');

// يقرأها المشغّل الآلي بلا واجهة
window.__TEST_RESULTS__ = report;
document.title = report.failed === 0 ? `✓ ${report.passed} نجح` : `✗ ${report.failed} فشل`;
