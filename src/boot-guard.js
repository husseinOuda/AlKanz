/**
 * حارس الإقلاع — سكربت كلاسيكي (ليس وحدة ES) عن قصد.
 *
 * السبب: وحدات ES لا تُحمَّل عبر بروتوكول file:// إطلاقاً — يحجبها CORS
 * (`origin 'null'`). في تلك الحالة لا يعمل app.js أبداً، وتبقى شاشة التحميل
 * تدور إلى ما لا نهاية بلا أي تفسير للمستخدم.
 *
 * السكربتات الكلاسيكية تُحمَّل عبر file:// بلا مشكلة، فيستطيع هذا الملف اكتشاف
 * الحالة وعرض سبب واضح مع طريقة التشغيل الصحيحة.
 *
 * لا يستخدم import ولا export ولا innerHTML.
 */

(function bootGuard() {
  'use strict';

  var BOOT_TIMEOUT_MS = 15000;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** يرسم شاشة خطأ بدل مؤشر التحميل */
  function showFailure(title, lines, commands) {
    var root = document.getElementById('app');
    if (!root) return;

    while (root.firstChild) root.removeChild(root.firstChild);
    root.removeAttribute('aria-busy');

    var box = el('div', 'boot boot--error');

    var badge = el('div', 'boot-guard__icon', '!');
    box.appendChild(badge);

    box.appendChild(el('h1', 'boot-guard__title', title));

    for (var i = 0; i < lines.length; i += 1) {
      box.appendChild(el('p', 'boot-guard__text', lines[i]));
    }

    if (commands && commands.length) {
      var listTitle = el('p', 'boot-guard__text boot-guard__strong',
        'شغّل أحد هذه الأوامر داخل مجلد المشروع، ثم افتح العنوان الذي يظهر:');
      box.appendChild(listTitle);

      var list = el('div', 'boot-guard__commands');
      for (var c = 0; c < commands.length; c += 1) {
        var row = el('div', 'boot-guard__command');
        row.appendChild(el('code', null, commands[c].cmd));
        row.appendChild(el('span', 'boot-guard__hint', commands[c].hint));
        list.appendChild(row);
      }
      box.appendChild(list);

      var url = el('p', 'boot-guard__text');
      url.appendChild(document.createTextNode('ثم افتح: '));
      var link = el('a', 'boot-guard__link', 'http://localhost:8000');
      link.href = 'http://localhost:8000';
      url.appendChild(link);
      box.appendChild(url);

      var shortcut = el('p', 'boot-guard__text boot-guard__muted',
        'أو انقر نقراً مزدوجاً على ملف "تشغيل-النظام.bat" الموجود في مجلد المشروع — يقوم بكل ذلك تلقائياً.');
      box.appendChild(shortcut);
    }

    root.appendChild(box);
  }

  /* ------------------------------------------------------------------ */
  /* 1) بروتوكول file:// — فشل مؤكّد، لا داعي للانتظار                    */
  /* ------------------------------------------------------------------ */

  var isFile = window.location.protocol === 'file:';
  var script = document.createElement('script');

  if (isFile) {
    // المتصفح يحجب وحدات ES هنا، فنحمّل الحزمة الكلاسيكية بدلاً منها.
    // app.bundle.js مُولَّدة بـ: node tools/build.mjs
    window.__RUN_FROM_FILE__ = true;
    script.src = 'app.bundle.js';

    script.onerror = function () {
      showFailure(
        'ملف الحزمة مفقود',
        [
          'فُتح التطبيق مباشرة من الملف (file://)، وهذا الوضع يحتاج ملف app.bundle.js لأن المتصفح يمنع تحميل وحدات JavaScript عبر هذا البروتوكول.',
          'الملف غير موجود في مجلد المشروع. أعد توليده، أو شغّل التطبيق عبر خادم محلي.',
        ],
        [
          { cmd: 'node tools/build.mjs', hint: 'لتوليد ملف الحزمة' },
          { cmd: 'python -m http.server 8000', hint: 'أو شغّله عبر خادم' },
        ]
      );
    };

  } else {
    script.type = 'module';
    script.src = 'src/app.js';

    // البيان و preload الخطوط يُحقنان هنا فقط:
    // جلبهما عبر file:// يفشل بخطأ CORS بلا أي فائدة (الخط يُحمَّل عبر @font-face على أي حال)
    var manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.webmanifest';
    document.head.appendChild(manifest);

    var preloads = ['tajawal-400-arabic.woff2', 'tajawal-700-arabic.woff2'];
    for (var p = 0; p < preloads.length; p += 1) {
      var font = document.createElement('link');
      font.rel = 'preload';
      font.as = 'font';
      font.type = 'font/woff2';
      font.crossOrigin = 'anonymous';
      font.href = 'assets/fonts/' + preloads[p];
      document.head.appendChild(font);
    }
  }

  script.defer = true;

  var attach = function () { document.head.appendChild(script); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  /* ------------------------------------------------------------------ */
  /* 2) بروتوكول صالح لكن الإقلاع تعثّر — مهلة ثم تشخيص                   */
  /* ------------------------------------------------------------------ */

  window.setTimeout(function () {
    if (window.__APP_BOOTED__) return;

    showFailure(
      'تعذّر تشغيل التطبيق',
      [
        'لم يكتمل تحميل التطبيق خلال المدة المتوقعة.',
        'تأكد أن جميع ملفات المشروع موجودة، وأن المتصفح يسمح بالتخزين لهذا الموقع (ليس في وضع التصفح الخاص).',
        'افتح أدوات المطوّر (F12) ثم تبويب Console لمعرفة السبب التقني.',
      ],
      null
    );

    var root = document.getElementById('app');
    if (!root) return;
    var retry = document.createElement('button');
    retry.className = 'btn btn--primary';
    retry.type = 'button';
    retry.textContent = 'إعادة المحاولة';
    retry.addEventListener('click', function () { window.location.reload(); });
    var box = root.querySelector('.boot');
    if (box) box.appendChild(retry);
  }, BOOT_TIMEOUT_MS);
}());
