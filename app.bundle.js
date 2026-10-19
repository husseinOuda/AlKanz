/* ملف مُولَّد آلياً — لا تعدّله يدوياً.
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

  /* ================================================================== */
  /* src/app.js */
  __def("src/app.js", function (__exports, __m, __dyn) {
    /** نقطة دخول التطبيق. */

    const { render } = __m("src/utils/dom.js");
    const { startRouter, navigate } = __m("src/router.js");
    const { registerRoutes } = __m("src/routes.js");
    const { buildShell, mountShell, bootError } = __m("src/components/shell.js");
    const { closeOverlays, toastError, toast } = __m("src/components/feedback.js");
    const { appState, notifyDataChanged } = __m("src/state/store.js");
    const { loadSettings } = __m("src/repositories/settings.js");
    const { ensureBaseData } = __m("src/db/seed.js");
    const { countSuspended } = __m("src/repositories/sales.js");
    const { registerServiceWorker, readStorageEstimate, watchConnection, applyUpdate, offlineCapability } = __m("src/services/pwa.js");
    const { backupReminderDue } = __m("src/services/backup.js");
    const { icon } = __m("src/components/icons.js");
    const { h } = __m("src/utils/dom.js");

    const root = document.getElementById('app');

    async function boot() {
      // 1) قاعدة البيانات والإعدادات — بدونها لا تعمل أي شاشة
      await ensureBaseData();
      const settings = await loadSettings({ force: true });
      appState.set({ settings });

      // 2) الهيكل
      const shell = buildShell({
        onSearch: (term) => navigate(`/products?q=${encodeURIComponent(term)}`),
      });
      mountShell(root, shell);

      // 3) المسارات
      registerRoutes();
      await startRouter({
        mount: shell.main,
        onChange: (context) => {
          closeOverlays();
          appState.set({ sidebarOpen: false });
          shell.setActiveRoute(context.path, context.meta.title);
        },
      });

      // أعلن نجاح الإقلاع حتى لا يعرض حارس الإقلاع شاشة تشخيص بعد المهلة
      window.__APP_BOOTED__ = true;

      // 4) الخدمات الجانبية — لا تحجب أول رسم
      watchConnection();
      refreshSuspendedCount();

      registerServiceWorker().then(readStorageEstimate);

      // تحديث عدّاد البيوع المعلّقة وحجم التخزين بعد كل تغيير بيانات
      let lastVersion = appState.get().dataVersion;
      appState.subscribe((state) => {
        if (state.dataVersion === lastVersion) return;
        lastVersion = state.dataVersion;
        refreshSuspendedCount();
        readStorageEstimate();
      });

      watchForUpdate();
      scheduleBackupReminder(settings);
      warnIfInsecureContext();
    }

    async function refreshSuspendedCount() {
      try {
        appState.set({ suspendedCount: await countSuspended() });
      } catch (error) {
        console.warn('[app] تعذّر قراءة عدد البيوع المعلّقة:', error);
      }
    }

    /** يعرض شريط «تحديث متاح» عند جهوزية نسخة جديدة من Service Worker */
    function watchForUpdate() {
      let shown = false;
      appState.subscribe((state) => {
        if (!state.updateAvailable || shown) return;
        shown = true;

        toast('', {
          tone: 'info',
          duration: 0,
          title: 'تحديث متاح',
        });

        // نستبدل محتوى آخر إشعار بزر تفعيل صريح
        const region = document.getElementById('toast-region');
        const last = region.lastElementChild;
        if (!last) return;

        const body = last.querySelector('.toast__body');
        render(body,
          h('div', { class: 'toast__title', text: 'تحديث متاح' }),
          h('div', { text: 'نسخة جديدة من التطبيق جاهزة. سيُعاد تحميل الصفحة عند التفعيل.' }),
          h('button', {
            class: 'btn btn--sm btn--primary',
            style: { 'margin-top': '10px' },
            attrs: { type: 'button' },
            text: 'تحديث الآن',
            on: { click: () => applyUpdate() },
          })
        );
      });
    }

    /** تذكير دوري بالنسخ الاحتياطي خارج الجهاز */
    function scheduleBackupReminder(settings) {
      const reminder = backupReminderDue(settings);
      if (!reminder?.due) return;

      setTimeout(() => {
        const dismiss = toast('', { tone: 'warn', duration: 0 });
        const region = document.getElementById('toast-region');
        const body = region.lastElementChild?.querySelector('.toast__body');
        if (!body) return;

        render(body,
          h('div', { class: 'toast__title', text: 'تذكير بالنسخ الاحتياطي' }),
          h('div', { text: reminder.message }),
          h('button', {
            class: 'btn btn--sm btn--ghost',
            style: { 'margin-top': '10px' },
            attrs: { type: 'button' },
            text: 'إنشاء نسخة الآن',
            on: {
              click: () => {
                dismiss();
                navigate('/backup');
              },
            },
          })
        );
      }, 2500);
    }

    /** ينبّه بوضوح إذا فُتح التطبيق بطريقة لا يعمل فيها الأوفلاين */
    function warnIfInsecureContext() {
      const capability = offlineCapability();
      if (capability.ok) return;

      // وضع الملف المحلي مدعوم بالكامل عبر الحزمة الكلاسيكية — لا داعي لإنذار
      if (capability.status === 'file') return;

      setTimeout(() => {
        toast(capability.message, { tone: 'warn', title: 'العمل دون اتصال غير مفعّل', duration: 0 });
      }, 1200);
    }

    /* ------------------------------------------------------------------ */

    boot().catch((error) => {
      console.error('[app] فشل الإقلاع:', error);
      render(root, bootError(
        error?.name === 'AbortError' || /قاعدة البيانات/.test(error?.message || '')
          ? error.message
          : 'حدث خطأ أثناء تهيئة قاعدة البيانات المحلية. تأكد أن المتصفح يسمح بالتخزين لهذا الموقع (ليس في وضع التصفح الخاص).',
        error?.message
      ));
    });

    // أخطاء غير ملتقطة: نعرضها للمستخدم بدل تركها في الطرفية فقط
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[app] وعد مرفوض دون معالجة:', event.reason);
      const message = event.reason?.message || 'حدث خطأ غير متوقع';
      // تجاهل الإلغاءات المتعمّدة
      if (event.reason?.name === 'AbortError' && /أُجهضت/.test(message)) return;
      toastError(message);
    });




    Object.defineProperty(__exports, "notifyDataChanged", { enumerable: true, get: function () { return notifyDataChanged; } });
  });

  /* ================================================================== */
  /* src/components/charts.js */
  __def("src/components/charts.js", function (__exports, __m, __dyn) {
    /**
     * مخططات SVG مكتوبة يدوياً.
     * القرار موثّق في docs/design-decisions.md: نحتاج ثلاثة أنواع فقط
     * (خطي بمساحة، دائري مفرّغ، أعمدة مجمّعة)، وكتابتها بـ SVG أصغر بكثير من
     * تضمين مكتبة رسوم كاملة، وتعطي تحكماً كاملاً في الاتجاه والوصولية.
     *
     * المخططات تُرسم بمحاور LTR (الأقدم يساراً والأحدث يميناً) مطابقةً للصور المرجعية،
     * بينما تبقى النصوص والأساطير عربية RTL.
     */

    const { h } = __m("src/utils/dom.js");
    const { formatCompact, formatAmount } = __m("src/utils/format.js");

    const CHART_COLORS = [
      '#0E9C8A', '#1B63E3', '#D97706', '#7C5CE0', '#12855A',
      '#DC2626', '#0EA5E9', '#EC4899', '#94A3B8', '#65A30D',
    ];

    const AXIS_COLOR = '#94A3B8';
    const GRID_COLOR = '#EEF2F7';

    /** يحسب تدرّج محور Y بقيم مقروءة (1، 2، 2.5، 5 × 10^n) */
    function niceScale(maxValue, tickCount = 5) {
      if (!Number.isFinite(maxValue) || maxValue <= 0) return { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };

      const rawStep = maxValue / tickCount;
      const magnitude = 10 ** Math.floor(Math.log10(rawStep));
      const normalized = rawStep / magnitude;
      const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;

      const max = Math.ceil(maxValue / niceStep) * niceStep;
      const ticks = [];
      for (let value = 0; value <= max + niceStep / 2; value += niceStep) ticks.push(value);
      return { max: max || 1, step: niceStep, ticks };
    }

    function svgRoot(width, height, extra = {}) {
      return h('svg:svg', {
        class: 'chart',
        attrs: {
          viewBox: `0 0 ${width} ${height}`,
          preserveAspectRatio: 'xMidYMid meet',
          role: 'img',
          direction: 'ltr',
          ...extra,
        },
        style: { direction: 'ltr' },
      });
    }

    /* ------------------------------------------------------------------ */
    /* مخطط خطي بمساحة                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * @param {object} config
     * @param {{label:string, value:number}[]} config.points
     * @param {string} [config.color]
     * @param {boolean} [config.showValues] كتابة القيمة فوق كل نقطة
     * @param {(v:number)=>string} [config.formatValue]
     * @param {string} config.title وصف نصي للوصولية
     */
    function lineChart({
      points, color = CHART_COLORS[0], showValues = false, formatValue = formatCompact,
      title = 'مخطط خطي', height = 240, curved = true,
    }) {
      const width = 640;
      const pad = { top: showValues ? 28 : 16, right: 16, bottom: 34, left: 52 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const values = points.map((p) => p.value || 0);
      const { max, ticks } = niceScale(Math.max(...values, 0));

      const x = (i) => (points.length <= 1 ? pad.left + plotW / 2 : pad.left + (i / (points.length - 1)) * plotW);
      const y = (v) => pad.top + plotH - (v / max) * plotH;

      const svg = svgRoot(width, height, { 'aria-label': title });

      // شبكة أفقية + تسميات محور Y
      for (const tick of ticks) {
        const ty = y(tick);
        svg.appendChild(h('svg:line', {
          attrs: { x1: pad.left, y1: ty, x2: width - pad.right, y2: ty, stroke: GRID_COLOR, 'stroke-width': 1, 'stroke-dasharray': tick === 0 ? '0' : '4 4' },
        }));
        svg.appendChild(h('svg:text', {
          attrs: { x: pad.left - 8, y: ty + 4, 'text-anchor': 'end', 'font-size': 11, fill: AXIS_COLOR },
          text: formatValue(tick),
        }));
      }

      if (points.length > 0) {
        // مسار الخط: منحنى Catmull-Rom مبسّط أو خطوط مستقيمة
        const coords = points.map((p, i) => [x(i), y(p.value || 0)]);
        let linePath = `M ${coords[0][0]} ${coords[0][1]}`;
        for (let i = 1; i < coords.length; i += 1) {
          const [px, py] = coords[i - 1];
          const [cx, cy] = coords[i];
          if (curved) {
            const midX = (px + cx) / 2;
            linePath += ` C ${midX} ${py}, ${midX} ${cy}, ${cx} ${cy}`;
          } else {
            linePath += ` L ${cx} ${cy}`;
          }
        }

        const gradientId = `grad-${Math.random().toString(36).slice(2, 9)}`;
        const defs = h('svg:defs', null,
          h('svg:linearGradient', { attrs: { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' } },
            h('svg:stop', { attrs: { offset: '0%', 'stop-color': color, 'stop-opacity': '0.28' } }),
            h('svg:stop', { attrs: { offset: '100%', 'stop-color': color, 'stop-opacity': '0.02' } })
          )
        );
        svg.appendChild(defs);

        const baseline = y(0);
        svg.appendChild(h('svg:path', {
          attrs: {
            d: `${linePath} L ${coords[coords.length - 1][0]} ${baseline} L ${coords[0][0]} ${baseline} Z`,
            fill: `url(#${gradientId})`,
          },
        }));

        svg.appendChild(h('svg:path', {
          attrs: { d: linePath, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
        }));

        points.forEach((point, i) => {
          svg.appendChild(h('svg:circle', {
            attrs: { cx: x(i), cy: y(point.value || 0), r: 4, fill: '#fff', stroke: color, 'stroke-width': 2.5 },
          }));
          if (showValues) {
            svg.appendChild(h('svg:text', {
              attrs: { x: x(i), y: y(point.value || 0) - 12, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#0F2745', 'font-weight': 600 },
              text: formatValue(point.value || 0),
            }));
          }
        });
      }

      // تسميات محور X — تخطٍّ ذكي عند الازدحام
      const skip = Math.ceil(points.length / 10);
      points.forEach((point, i) => {
        if (i % skip !== 0 && i !== points.length - 1) return;
        svg.appendChild(h('svg:text', {
          attrs: { x: x(i), y: height - 12, 'text-anchor': 'middle', 'font-size': 10.5, fill: AXIS_COLOR },
          text: point.label,
        }));
      });

      return withTable(svg, title, points, formatValue);
    }

    /* ------------------------------------------------------------------ */
    /* مخطط دائري مفرّغ                                                     */
    /* ------------------------------------------------------------------ */

    function arcPath(cx, cy, outerR, innerR, startAngle, endAngle) {
      const polar = (r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
      const [x1, y1] = polar(outerR, startAngle);
      const [x2, y2] = polar(outerR, endAngle);
      const [x3, y3] = polar(innerR, endAngle);
      const [x4, y4] = polar(innerR, startAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

      return [
        `M ${x1} ${y1}`,
        `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${x3} ${y3}`,
        `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
        'Z',
      ].join(' ');
    }

    /**
     * @param {{label:string, value:number, color?:string}[]} slices
     */
    function donutChart({ slices, title = 'مخطط دائري', size = 220, showPercentInside = true }) {
      const total = slices.reduce((sum, slice) => sum + (slice.value || 0), 0);
      const cx = size / 2;
      const cy = size / 2;
      const outerR = size / 2 - 4;
      const innerR = outerR * 0.58;

      const svg = svgRoot(size, size, { 'aria-label': title });

      if (total <= 0) {
        svg.appendChild(h('svg:circle', {
          attrs: { cx, cy, r: (outerR + innerR) / 2, fill: 'none', stroke: GRID_COLOR, 'stroke-width': outerR - innerR },
        }));
        return svg;
      }

      let angle = -Math.PI / 2; // البداية من الأعلى

      slices.forEach((slice, index) => {
        const value = slice.value || 0;
        if (value <= 0) return;

        const fraction = value / total;
        // فجوة بصرية صغيرة بين القطاعات إلا إذا كان قطاعاً واحداً
        const sweep = fraction * Math.PI * 2;
        const end = angle + sweep;
        const color = slice.color || CHART_COLORS[index % CHART_COLORS.length];

        svg.appendChild(h('svg:path', {
          attrs: { d: arcPath(cx, cy, outerR, innerR, angle, end), fill: color },
        }, h('svg:title', { text: `${slice.label}: ${formatAmount(slice.value)}` })));

        if (showPercentInside && fraction >= 0.05) {
          const mid = angle + sweep / 2;
          const labelR = (outerR + innerR) / 2;
          svg.appendChild(h('svg:text', {
            attrs: {
              x: cx + labelR * Math.cos(mid),
              y: cy + labelR * Math.sin(mid) + 4,
              'text-anchor': 'middle',
              'font-size': 12,
              'font-weight': 700,
              fill: '#fff',
            },
            text: `${Math.round(fraction * 100)}%`,
          }));
        }

        angle = end;
      });

      return svg;
    }

    /* ------------------------------------------------------------------ */
    /* مخطط أعمدة مجمّعة                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * @param {string[]} config.labels
     * @param {{name:string, color:string, values:number[]}[]} config.series
     */
    function barChart({
      labels, series, title = 'مخطط أعمدة', height = 240, showValues = true, formatValue = formatCompact,
    }) {
      const width = 640;
      const pad = { top: showValues ? 26 : 14, right: 16, bottom: 34, left: 56 };
      const plotW = width - pad.left - pad.right;
      const plotH = height - pad.top - pad.bottom;

      const allValues = series.flatMap((s) => s.values);
      const { max, ticks } = niceScale(Math.max(...allValues, 0));

      const groupWidth = plotW / Math.max(labels.length, 1);
      const barGap = 3;
      const barWidth = Math.max(4, Math.min(26, (groupWidth * 0.62 - barGap * (series.length - 1)) / series.length));

      const y = (v) => pad.top + plotH - (v / max) * plotH;

      const svg = svgRoot(width, height, { 'aria-label': title });

      for (const tick of ticks) {
        const ty = y(tick);
        svg.appendChild(h('svg:line', {
          attrs: { x1: pad.left, y1: ty, x2: width - pad.right, y2: ty, stroke: GRID_COLOR, 'stroke-width': 1 },
        }));
        svg.appendChild(h('svg:text', {
          attrs: { x: pad.left - 8, y: ty + 4, 'text-anchor': 'end', 'font-size': 11, fill: AXIS_COLOR },
          text: formatValue(tick),
        }));
      }

      labels.forEach((label, groupIndex) => {
        const groupCenter = pad.left + groupWidth * (groupIndex + 0.5);
        const clusterWidth = series.length * barWidth + (series.length - 1) * barGap;
        const startX = groupCenter - clusterWidth / 2;

        series.forEach((s, seriesIndex) => {
          const value = s.values[groupIndex] || 0;
          const barX = startX + seriesIndex * (barWidth + barGap);
          const barY = y(value);
          const barH = Math.max(0, pad.top + plotH - barY);

          svg.appendChild(h('svg:rect', {
            attrs: {
              x: barX, y: barY, width: barWidth, height: barH,
              fill: s.color || CHART_COLORS[seriesIndex % CHART_COLORS.length],
              rx: Math.min(3, barWidth / 2),
            },
          }, h('svg:title', { text: `${label} — ${s.name}: ${formatAmount(value)}` })));

          if (showValues && value > 0) {
            svg.appendChild(h('svg:text', {
              attrs: { x: barX + barWidth / 2, y: barY - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#0F2745', 'font-weight': 600 },
              text: formatValue(value),
            }));
          }
        });

        const skip = Math.ceil(labels.length / 9);
        if (groupIndex % skip === 0 || groupIndex === labels.length - 1) {
          svg.appendChild(h('svg:text', {
            attrs: { x: groupCenter, y: height - 12, 'text-anchor': 'middle', 'font-size': 10.5, fill: AXIS_COLOR },
            text: label,
          }));
        }
      });

      return svg;
    }

    /* ------------------------------------------------------------------ */
    /* الأساطير والتخطيط                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * أسطورة رأسية (نمط بطاقة «المصروفات حسب الفئة»).
     * @param {{label:string, value?:string, color:string}[]} items
     */
    function chartLegend(items) {
      return h('ul', { class: 'chart-legend' },
        ...items.map((item) =>
          h('li', { class: 'chart-legend__item' },
            h('span', { class: 'chart-legend__dot', style: { background: item.color } }),
            h('span', { class: 'chart-legend__label', text: item.label }),
            item.value != null ? h('span', { class: 'chart-legend__value', text: item.value }) : null
          )
        )
      );
    }

    /** أسطورة أفقية أعلى المخطط (نمط شاشة التقارير) */
    function inlineLegend(items) {
      return h('div', { class: 'row', style: { gap: '18px', 'justify-content': 'center', 'margin-bottom': '8px' } },
        ...items.map((item) =>
          h('span', { class: 'chart-legend__item' },
            h('span', { class: 'chart-legend__dot', style: { background: item.color, 'border-radius': '3px' } }),
            h('span', { class: 'chart-legend__label', text: item.label })
          )
        )
      );
    }

    /** يضع المخطط والأسطورة جنباً إلى جنب */
    const chartWithLegend = (chart, legend) =>
      h('div', { class: 'chart-layout' }, chart, legend);

    /**
     * يرفق بالمخطط جدولاً مخفياً بصرياً يحمل نفس البيانات.
     * الوصولية: المخطط وحده لا ينقل المعلومة لقارئ الشاشة.
     */
    function withTable(svg, title, points, formatValue) {
      return h('div', { class: 'chart-holder' },
        svg,
        h('table', { class: 'sr-only' },
          h('caption', { text: title }),
          h('thead', null, h('tr', null, h('th', { text: 'الفترة' }), h('th', { text: 'القيمة' }))),
          h('tbody', null,
            ...points.map((point) =>
              h('tr', null,
                h('td', { text: point.label }),
                h('td', { text: formatValue(point.value || 0) })
              )
            )
          )
        )
      );
    }

    /** يرفق جدولاً نصياً بأي مخطط (للدائري والأعمدة) */
    function chartAccessibleTable(title, rows) {
      return h('table', { class: 'sr-only' },
        h('caption', { text: title }),
        h('tbody', null,
          ...rows.map(([label, value]) =>
            h('tr', null, h('td', { text: label }), h('td', { text: String(value) }))
          )
        )
      );
    }


    Object.defineProperty(__exports, "CHART_COLORS", { enumerable: true, get: function () { return CHART_COLORS; } });
    Object.defineProperty(__exports, "lineChart", { enumerable: true, get: function () { return lineChart; } });
    Object.defineProperty(__exports, "donutChart", { enumerable: true, get: function () { return donutChart; } });
    Object.defineProperty(__exports, "barChart", { enumerable: true, get: function () { return barChart; } });
    Object.defineProperty(__exports, "chartLegend", { enumerable: true, get: function () { return chartLegend; } });
    Object.defineProperty(__exports, "inlineLegend", { enumerable: true, get: function () { return inlineLegend; } });
    Object.defineProperty(__exports, "chartWithLegend", { enumerable: true, get: function () { return chartWithLegend; } });
    Object.defineProperty(__exports, "chartAccessibleTable", { enumerable: true, get: function () { return chartAccessibleTable; } });
  });

  /* ================================================================== */
  /* src/components/feedback.js */
  __def("src/components/feedback.js", function (__exports, __m, __dyn) {
    /** إشعارات منبثقة، نوافذ، لوحات جانبية، وتأكيدات. */

    const { h, render, trapFocus } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");

    /* ------------------------------- Toast ------------------------------- */

    const TOAST_ICON = { ok: 'checkCircle', error: 'error', warn: 'warning', info: 'info' };

    let toastRegion = null;

    function region() {
      if (!toastRegion) toastRegion = document.getElementById('toast-region');
      return toastRegion;
    }

    /**
     * يعرض إشعاراً مؤقتاً.
     * @param {string} message
     * @param {{tone?:'ok'|'error'|'warn'|'info', title?:string, duration?:number}} [options]
     */
    function toast(message, { tone = 'ok', title = '', duration = 4000 } = {}) {
      const host = region();
      if (!host) return () => {};

      let timer;
      const element = h('div', { class: ['toast', `toast--${tone}`], attrs: { role: tone === 'error' ? 'alert' : 'status' } },
        icon(TOAST_ICON[tone] || 'info'),
        h('div', { class: 'toast__body' },
          title ? h('div', { class: 'toast__title', text: title }) : null,
          h('div', { text: message })
        ),
        h('button', {
          class: 'toast__close',
          attrs: { type: 'button', 'aria-label': 'إغلاق الإشعار' },
          on: { click: () => dismiss() },
        }, icon('close'))
      );

      function dismiss() {
        clearTimeout(timer);
        element.remove();
      }

      host.appendChild(element);
      // الأخطاء تبقى حتى يغلقها المستخدم
      if (duration > 0 && tone !== 'error') timer = setTimeout(dismiss, duration);
      return dismiss;
    }

    const toastOk = (message, options) => toast(message, { tone: 'ok', ...options });
    const toastError = (message, options) => toast(message, { tone: 'error', title: 'خطأ', duration: 0, ...options });
    const toastWarn = (message, options) => toast(message, { tone: 'warn', ...options });

    /* ------------------------------- Modal ------------------------------- */

    let activeModal = null;

    /**
     * يفتح نافذة. يرجع { close, element }.
     * @param {{title:string, body:Node|Node[], footer?:Node[], size?:'md'|'lg', onClose?:Function, closable?:boolean}} config
     */
    function openModal({ title, body, footer = [], size = 'md', onClose, closable = true }) {
      closeModal();

      const host = document.getElementById('modal-region');
      const dialog = h('div', {
        class: ['modal', size === 'lg' && 'modal--lg'],
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      },
        h('div', { class: 'modal__head' },
          h('h2', { class: 'modal__title', text: title }),
          closable
            ? h('button', {
                class: 'icon-btn',
                attrs: { type: 'button', 'aria-label': 'إغلاق' },
                on: { click: () => close() },
              }, icon('close'))
            : null
        ),
        h('div', { class: 'modal__body' }, body),
        footer.length > 0 ? h('div', { class: 'modal__foot' }, footer) : null
      );

      render(host, dialog);
      host.hidden = false;

      const releaseFocus = trapFocus(dialog, closable ? () => close() : null);

      const onBackdrop = (event) => {
        if (event.target === host && closable) close();
      };
      host.addEventListener('pointerdown', onBackdrop);

      function close() {
        if (activeModal !== state) return;
        host.removeEventListener('pointerdown', onBackdrop);
        releaseFocus();
        host.hidden = true;
        render(host);
        activeModal = null;
        onClose?.();
      }

      const state = { close, element: dialog };
      activeModal = state;
      return state;
    }

    function closeModal() {
      activeModal?.close();
    }

    /**
     * نافذة تأكيد. ترجع Promise<boolean>.
     */
    function confirmDialog({
      title = 'تأكيد',
      message,
      confirmLabel = 'تأكيد',
      cancelLabel = 'إلغاء',
      tone = 'primary',
      extra = null,
    } = {}) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          modal.close();
          resolve(value);
        };

        const modal = openModal({
          title,
          body: [
            h('p', { text: message, style: { 'line-height': '1.7' } }),
            extra,
          ],
          footer: [
            h('button', {
              class: ['btn', tone === 'danger' ? 'btn--danger' : 'btn--primary'],
              attrs: { type: 'button' },
              text: confirmLabel,
              on: { click: () => finish(true) },
            }),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              text: cancelLabel,
              on: { click: () => finish(false) },
            }),
          ],
          onClose: () => finish(false),
        });
      });
    }

    /**
     * نافذة إدخال نص/رقم بسيطة. ترجع Promise<string|null>.
     */
    function promptDialog({ title, label, value = '', type = 'text', hint = '', confirmLabel = 'حفظ' }) {
      return new Promise((resolve) => {
        let settled = false;
        let input;

        const finish = (result) => {
          if (settled) return;
          settled = true;
          modal.close();
          resolve(result);
        };

        const form = h('form', {
          on: { submit: (event) => { event.preventDefault(); finish(input.value); } },
        },
          h('div', { class: 'field' },
            h('label', { class: 'field__label', for: 'prompt-input', text: label }),
            h('input', {
              class: 'input',
              id: 'prompt-input',
              type,
              value,
              ref: (el) => { input = el; },
            }),
            hint ? h('p', { class: 'field__hint', text: hint }) : null
          )
        );

        const modal = openModal({
          title,
          body: form,
          footer: [
            h('button', {
              class: 'btn btn--primary',
              attrs: { type: 'button' },
              text: confirmLabel,
              on: { click: () => finish(input.value) },
            }),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              text: 'إلغاء',
              on: { click: () => finish(null) },
            }),
          ],
          onClose: () => finish(null),
        });

        requestAnimationFrame(() => input?.select());
      });
    }

    /* ---------------------------- لوحة جانبية ---------------------------- */

    let activePanel = null;

    /**
     * يفتح لوحة جانبية منزلقة (نمط شاشتي المخزون والمصروفات).
     * @returns {{close:Function, element:HTMLElement}}
     */
    function openPanel({ title, body, footer = [], onClose }) {
      closePanel();

      const backdrop = h('div', { class: 'panel-backdrop', on: { pointerdown: () => close() } });

      const panel = h('aside', {
        class: 'panel',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      },
        h('div', { class: 'panel__head' },
          h('button', {
            class: 'icon-btn',
            attrs: { type: 'button', 'aria-label': 'إغلاق' },
            on: { click: () => close() },
          }, icon('close')),
          h('h2', { class: 'panel__title', text: title })
        ),
        h('div', { class: 'panel__body' }, body),
        footer.length > 0 ? h('div', { class: 'panel__foot' }, footer) : null
      );

      document.body.append(backdrop, panel);
      const releaseFocus = trapFocus(panel, () => close());

      function close() {
        if (activePanel !== state) return;
        releaseFocus();
        backdrop.remove();
        panel.remove();
        activePanel = null;
        onClose?.();
      }

      const state = { close, element: panel };
      activePanel = state;
      return state;
    }

    function closePanel() {
      activePanel?.close();
    }

    /** يغلق كل الطبقات العائمة — يُستدعى عند تغيير المسار */
    function closeOverlays() {
      closeModal();
      closePanel();
    }


    Object.defineProperty(__exports, "toast", { enumerable: true, get: function () { return toast; } });
    Object.defineProperty(__exports, "toastOk", { enumerable: true, get: function () { return toastOk; } });
    Object.defineProperty(__exports, "toastError", { enumerable: true, get: function () { return toastError; } });
    Object.defineProperty(__exports, "toastWarn", { enumerable: true, get: function () { return toastWarn; } });
    Object.defineProperty(__exports, "openModal", { enumerable: true, get: function () { return openModal; } });
    Object.defineProperty(__exports, "closeModal", { enumerable: true, get: function () { return closeModal; } });
    Object.defineProperty(__exports, "confirmDialog", { enumerable: true, get: function () { return confirmDialog; } });
    Object.defineProperty(__exports, "promptDialog", { enumerable: true, get: function () { return promptDialog; } });
    Object.defineProperty(__exports, "openPanel", { enumerable: true, get: function () { return openPanel; } });
    Object.defineProperty(__exports, "closePanel", { enumerable: true, get: function () { return closePanel; } });
    Object.defineProperty(__exports, "closeOverlays", { enumerable: true, get: function () { return closeOverlays; } });
  });

  /* ================================================================== */
  /* src/components/icons.js */
  __def("src/components/icons.js", function (__exports, __m, __dyn) {
    /**
     * أيقونات SVG مضمّنة.
     * سبب عدم استخدام مكتبة أيقونات خارجية موثّق في docs/design-decisions.md:
     * نحتاج ~60 أيقونة فقط، ومجموعة كاملة تعني ملفاً محلياً أكبر بكثير بلا فائدة.
     * كل الأيقونات بنمط stroke على شبكة 24×24.
     */

    const { h } = __m("src/utils/dom.js");

    // كل قيمة: مصفوفة من ['tag', {attrs}]
    const PATHS = {
      // التنقل
      dashboard: [['rect', { x: 3, y: 3, width: 7, height: 9, rx: 1.5 }], ['rect', { x: 14, y: 3, width: 7, height: 5, rx: 1.5 }], ['rect', { x: 14, y: 12, width: 7, height: 9, rx: 1.5 }], ['rect', { x: 3, y: 16, width: 7, height: 5, rx: 1.5 }]],
      cart: [['circle', { cx: 9, cy: 20, r: 1.4 }], ['circle', { cx: 18, cy: 20, r: 1.4 }], ['path', { d: 'M2 3h2.2l2.4 11.4a2 2 0 0 0 2 1.6h8.3a2 2 0 0 0 2-1.55L21.5 7H6' }]],
      box: [['path', { d: 'M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5A2 2 0 0 1 21 8.5z' }], ['path', { d: 'm5.3 7.4 7.7 4.4 7.7-4.4M13 21v-9.2' }]],
      layers: [['path', { d: 'm12 2 9 5-9 5-9-5 9-5z' }], ['path', { d: 'm3 12 9 5 9-5' }], ['path', { d: 'm3 17 9 5 9-5' }]],
      file: [['path', { d: 'M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5z' }], ['path', { d: 'M14 2v5h5M9 13h6M9 17h4' }]],
      users: [['path', { d: 'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20' }], ['circle', { cx: 9, cy: 7, r: 3.2 }], ['path', { d: 'M22 20v-1.5a4 4 0 0 0-3-3.85M16.5 4.2a4 4 0 0 1 0 5.9' }]],
      wallet: [['path', { d: 'M19 8V6.5A1.5 1.5 0 0 0 17.5 5H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7' }], ['circle', { cx: 16.5, cy: 14, r: 1.2 }]],
      chart: [['path', { d: 'M4 21V10M10 21V4M16 21v-7M22 21H2' }]],
      cloudUp: [['path', { d: 'M18 16.5a4 4 0 0 0-1.2-7.8 5.5 5.5 0 0 0-10.5 1.6A3.7 3.7 0 0 0 6.5 17.5' }], ['path', { d: 'M12 21v-8M9 15.5l3-3 3 3' }]],
      gear: [['circle', { cx: 12, cy: 12, r: 3 }], ['path', { d: 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z' }]],

      // إجراءات
      search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'm20 20-3.6-3.6' }]],
      menu: [['path', { d: 'M3 6h18M3 12h18M3 18h18' }]],
      bell: [['path', { d: 'M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17S18 15 18 8.5' }], ['path', { d: 'M13.7 20.5a2 2 0 0 1-3.4 0' }]],
      user: [['circle', { cx: 12, cy: 8, r: 3.6 }], ['path', { d: 'M4.5 20.5a7.5 7.5 0 0 1 15 0' }]],
      plus: [['path', { d: 'M12 5v14M5 12h14' }]],
      minus: [['path', { d: 'M5 12h14' }]],
      trash: [['path', { d: 'M3.5 6h17M8.5 6V4.5A1.5 1.5 0 0 1 10 3h4a1.5 1.5 0 0 1 1.5 1.5V6' }], ['path', { d: 'M18.5 6v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6M10 11v6M14 11v6' }]],
      pencil: [['path', { d: 'M17 3.5a2.1 2.1 0 0 1 3 3L7.5 19 3 20.5 4.5 16 17 3.5z' }]],
      eye: [['path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z' }], ['circle', { cx: 12, cy: 12, r: 3 }]],
      x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
      check: [['path', { d: 'M20 6 9 17l-5-5' }]],
      checkCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm8.5 12 2.5 2.5 4.5-5' }]],
      xCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'm15 9-6 6M9 9l6 6' }]],
      alert: [['path', { d: 'M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }], ['path', { d: 'M12 9v4.5M12 17.5h.01' }]],
      alertCircle: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5V13M12 16.5h.01' }]],
      info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 16.5V11M12 7.5h.01' }]],
      download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7.5 10.5 4.5 4.5 4.5-4.5M12 15V3' }]],
      upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['path', { d: 'm7.5 7.5 4.5-4.5 4.5 4.5M12 3v12' }]],
      printer: [['path', { d: 'M6 9V3.5A.5.5 0 0 1 6.5 3h11a.5.5 0 0 1 .5.5V9' }], ['path', { d: 'M6 18H4.5A1.5 1.5 0 0 1 3 16.5v-5A2.5 2.5 0 0 1 5.5 9h13A2.5 2.5 0 0 1 21 11.5v5a1.5 1.5 0 0 1-1.5 1.5H18' }], ['rect', { x: 6, y: 14, width: 12, height: 7, rx: 1 }]],
      barcode: [['path', { d: 'M3 6V4.5A1.5 1.5 0 0 1 4.5 3H6M18 3h1.5A1.5 1.5 0 0 1 21 4.5V6M21 18v1.5a1.5 1.5 0 0 1-1.5 1.5H18M6 21H4.5A1.5 1.5 0 0 1 3 19.5V18' }], ['path', { d: 'M7 8v8M10 8v8M13 8v8M16.5 8v8' }]],
      calendar: [['rect', { x: 3, y: 5, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 10h18M8 3v4M16 3v4' }]],
      clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5.2l3.2 1.9' }]],
      tag: [['path', { d: 'M20.6 12.6 12 21.2a2 2 0 0 1-2.8 0l-6.4-6.4a2 2 0 0 1 0-2.8L11.4 3.4a2 2 0 0 1 1.4-.6h5.8a2 2 0 0 1 2 2v5.8a2 2 0 0 1-.6 1.4z' }], ['circle', { cx: 16.5, cy: 7.5, r: 1.2 }]],
      banknote: [['rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ['circle', { cx: 12, cy: 12, r: 2.6 }], ['path', { d: 'M6 10v4M18 10v4' }]],
      creditCard: [['rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }], ['path', { d: 'M2 10h20M6 15h3' }]],
      database: [['ellipse', { cx: 12, cy: 5.5, rx: 8, ry: 3 }], ['path', { d: 'M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13' }], ['path', { d: 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }]],
      trendUp: [['path', { d: 'm3 17 6-6 4 4 8-8' }], ['path', { d: 'M15 7h6v6' }]],
      trendDown: [['path', { d: 'm3 7 6 6 4-4 8 8' }], ['path', { d: 'M15 17h6v-6' }]],
      arrowUp: [['path', { d: 'M12 20V5M6 11l6-6 6 6' }]],
      arrowDown: [['path', { d: 'M12 4v15M6 13l6 6 6-6' }]],
      arrowUpDown: [['path', { d: 'M8 3v18M4.5 6.5 8 3l3.5 3.5' }], ['path', { d: 'M16 21V3M12.5 17.5 16 21l3.5-3.5' }]],
      chevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
      chevronUp: [['path', { d: 'm18 15-6-6-6 6' }]],
      chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
      chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
      chevronsRight: [['path', { d: 'm6 17 5-5-5-5M13 17l5-5-5-5' }]],
      chevronsLeft: [['path', { d: 'm18 17-5-5 5-5M11 17l-5-5 5-5' }]],
      moreVertical: [['circle', { cx: 12, cy: 5, r: 1.4 }], ['circle', { cx: 12, cy: 12, r: 1.4 }], ['circle', { cx: 12, cy: 19, r: 1.4 }]],
      pause: [['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }], ['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }]],
      filter: [['path', { d: 'M3 5h18l-7 8.2V20l-4-2.2v-4.6L3 5z' }]],
      refresh: [['path', { d: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1' }], ['path', { d: 'M20.5 4v5h-5' }]],
      save: [['path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' }], ['path', { d: 'M7 3v5h8M8 21v-6h8v6' }]],
      image: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['circle', { cx: 8.5, cy: 9.5, r: 1.6 }], ['path', { d: 'm4 17 5-4.5 4 3.5 3-2.5 4 3.5' }]],
      folder: [['path', { d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5z' }]],
      sliders: [['path', { d: 'M4 21v-7M4 10V3M12 21v-10M12 7V3M20 21v-4M20 13V3' }], ['path', { d: 'M1.5 14h5M9.5 7h5M17.5 17h5' }]],
      clipboard: [['rect', { x: 5, y: 4, width: 14, height: 17, rx: 2 }], ['path', { d: 'M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1' }], ['path', { d: 'M9 11h6M9 15h4' }]],
      phone: [['path', { d: 'M21 16.5v2.6a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19 19 0 0 1-5.9-5.9 19.5 19.5 0 0 1-3-8.6A2 2 0 0 1 3.4 2H6a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.8a15 15 0 0 0 5.6 5.6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z' }]],
      store: [['path', { d: 'M3.5 9 5 3.5h14L20.5 9' }], ['path', { d: 'M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0' }], ['path', { d: 'M5 11v8.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V11' }]],
      home: [['path', { d: 'm3 10.5 9-7.5 9 7.5' }], ['path', { d: 'M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5' }], ['path', { d: 'M9.5 21v-6h5v6' }]],
      grid: [['rect', { x: 3, y: 3, width: 8, height: 8, rx: 1.5 }], ['rect', { x: 13, y: 3, width: 8, height: 8, rx: 1.5 }], ['rect', { x: 3, y: 13, width: 8, height: 8, rx: 1.5 }], ['rect', { x: 13, y: 13, width: 8, height: 8, rx: 1.5 }]],
      pieChart: [['path', { d: 'M21 12a9 9 0 1 1-9-9v9h9z' }]],
      percent: [['path', { d: 'M19 5 5 19' }], ['circle', { cx: 7.5, cy: 7.5, r: 2.5 }], ['circle', { cx: 16.5, cy: 16.5, r: 2.5 }]],
      palette: [['path', { d: 'M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2 2 0 0 0-1.4 3.4A2 2 0 0 1 13.7 21H12z' }], ['circle', { cx: 7.5, cy: 12, r: 1.2 }], ['circle', { cx: 10, cy: 7.8, r: 1.2 }], ['circle', { cx: 15, cy: 8.2, r: 1.2 }]],
      shield: [['path', { d: 'M12 21s7.5-3.5 7.5-9V5.5L12 3 4.5 5.5V12c0 5.5 7.5 9 7.5 9z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
      hardDrive: [['rect', { x: 2, y: 13, width: 20, height: 7, rx: 2 }], ['path', { d: 'm5.5 13 2.6-7A2 2 0 0 1 10 4.5h4a2 2 0 0 1 1.9 1.5l2.6 7' }], ['path', { d: 'M6.5 16.5h.01M10 16.5h.01' }]],
      receipt: [['path', { d: 'M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5z' }], ['path', { d: 'M9 8h6M9 12h6' }]],
      coffee: [['path', { d: 'M4 8h13v6.5A4.5 4.5 0 0 1 12.5 19h-4A4.5 4.5 0 0 1 4 14.5V8z' }], ['path', { d: 'M17 9.5h1.5a2.5 2.5 0 0 1 0 5H17M6 2.5v2M10 2.5v2M14 2.5v2' }]],
      basket: [['path', { d: 'M4 9h16l-1.4 9.3a2 2 0 0 1-2 1.7H7.4a2 2 0 0 1-2-1.7L4 9z' }], ['path', { d: 'm8 9 2.5-5M16 9l-2.5-5M10 13v3M14 13v3' }]],
      spray: [['path', { d: 'M9 8h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z' }], ['path', { d: 'M10 8V4.5A1.5 1.5 0 0 1 11.5 3h1A1.5 1.5 0 0 1 14 4.5V8' }], ['path', { d: 'M18 4h.01M20.5 6.5h.01M18 9h.01' }]],
      logOut: [['path', { d: 'M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9' }], ['path', { d: 'm15.5 16.5 4.5-4.5-4.5-4.5M20 12H9' }]],
      package: [['path', { d: 'M16.5 9.4 7.5 4.2' }], ['path', { d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' }], ['path', { d: 'm3.3 7 8.7 5 8.7-5M12 22V12' }]],
      boxOpen: [['path', { d: 'M2.5 8.5 12 3l9.5 5.5v7L12 21l-9.5-5.5v-7z' }], ['path', { d: 'M2.5 8.5 12 14l9.5-5.5' }]],
      packageX: [['path', { d: 'M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7' }], ['path', { d: 'm5.3 7.4 6.7 3.8 6.7-3.8' }], ['path', { d: 'M15.5 2.5 21 8M21 2.5 15.5 8' }]],
      list: [['path', { d: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01' }]],
      externalLink: [['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }], ['path', { d: 'M15 3h6v6M10 14 21 3' }]],
      fileSpreadsheet: [['path', { d: 'M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5z' }], ['path', { d: 'M14 2v5h5' }], ['path', { d: 'M8 12h8M8 16h8M12 12v6' }]],
      history: [['path', { d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1' }], ['path', { d: 'M3.5 4v5h5M12 7.5V12l3 2' }]],
      zap: [['path', { d: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z' }]],
    };

    const ALIASES = {
      dashboard: 'dashboard', pos: 'cart', products: 'box', inventory: 'layers',
      invoices: 'file', customers: 'users', expenses: 'wallet', reports: 'chart',
      backup: 'cloudUp', settings: 'gear', edit: 'pencil', delete: 'trash', view: 'eye',
      close: 'x', warning: 'alert', error: 'alertCircle', success: 'checkCircle',
      cash: 'banknote', credit: 'creditCard', more: 'moreVertical', excel: 'fileSpreadsheet',
    };

    /**
     * ينشئ أيقونة SVG.
     * @param {string} name اسم الأيقونة
     * @param {{size?:number, class?:string, filled?:boolean}} [options]
     */
    function icon(name, options = {}) {
      const key = ALIASES[name] || name;
      const shapes = PATHS[key];

      if (!shapes) {
        // أيقونة مفقودة: مربع محايد بدل رمي خطأ يكسر الشاشة
        console.warn(`[icons] أيقونة غير معرّفة: ${name}`);
        return h('svg:svg', {
          class: ['icon', options.class],
          attrs: { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
        }, h('svg:rect', { attrs: { x: 4, y: 4, width: 16, height: 16, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 } }));
      }

      const svg = h('svg:svg', {
        class: ['icon', options.class],
        attrs: {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': options.strokeWidth || 1.8,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          ...(options.size ? { width: options.size, height: options.size } : {}),
        },
      });

      for (const [tag, attrs] of shapes) {
        svg.appendChild(h(`svg:${tag}`, { attrs }));
      }
      return svg;
    }

    const hasIcon = (name) => Boolean(PATHS[ALIASES[name] || name]);


    Object.defineProperty(__exports, "icon", { enumerable: true, get: function () { return icon; } });
    Object.defineProperty(__exports, "hasIcon", { enumerable: true, get: function () { return hasIcon; } });
  });

  /* ================================================================== */
  /* src/components/shell.js */
  __def("src/components/shell.js", function (__exports, __m, __dyn) {
    /** هيكل التطبيق: الشريط الجانبي، الشريط العلوي، شريط التنقل السفلي للهاتف. */

    const { h, render, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { appState } = __m("src/state/store.js");
    const { formatBytes } = __m("src/utils/format.js");
    const { navigate } = __m("src/router.js");

    const NAV_ITEMS = [
      { path: '/dashboard', label: 'لوحة التحكم', icon: 'dashboard' },
      { path: '/pos', label: 'نقطة البيع', icon: 'pos' },
      { path: '/products', label: 'المنتجات', icon: 'products' },
      { path: '/inventory', label: 'المخزون', icon: 'inventory' },
      { path: '/reorder', label: 'المطلوب شراؤها', icon: 'products' },
      { path: '/purchases', label: 'الموردون والمشتريات', icon: 'expenses' },
      { path: '/invoices', label: 'الفواتير', icon: 'invoices' },
      { path: '/customers', label: 'العملاء', icon: 'customers' },
      { path: '/expenses', label: 'المصروفات', icon: 'expenses' },
      { path: '/shifts', label: 'الورديات والصندوق', icon: 'cash' },
      { path: '/reports', label: 'التقارير', icon: 'reports' },
      { path: '/backup', label: 'النسخ الاحتياطي', icon: 'backup' },
      { path: '/settings', label: 'الإعدادات', icon: 'settings' },
    ];

    /** عناصر شريط التنقل السفلي على الهاتف (13-mobile-pos-draft.png) */
    const TAB_ITEMS = [
      { path: '/dashboard', label: 'الرئيسية', icon: 'home' },
      { path: '/pos', label: 'البيع', icon: 'pos' },
      { path: '/products', label: 'المنتجات', icon: 'products' },
      { path: '/invoices', label: 'الفواتير', icon: 'invoices' },
      { path: '__more', label: 'المزيد', icon: 'more' },
    ];

    /** شعار التطبيق — أعمدة بيانية صاعدة كما في الصور */
    function brandMark() {
      return h('svg:svg', {
        class: 'brand__mark',
        attrs: { viewBox: '0 0 48 48', fill: 'none', 'aria-hidden': 'true' },
      },
        h('svg:rect', { attrs: { x: 6, y: 20, width: 8, height: 20, rx: 2, fill: 'currentColor' } }),
        h('svg:rect', { attrs: { x: 19, y: 12, width: 8, height: 28, rx: 2, fill: '#ffffff' } }),
        h('svg:rect', { attrs: { x: 32, y: 4, width: 8, height: 36, rx: 2, fill: 'currentColor' } }),
        h('svg:path', {
          attrs: { d: 'M6 30 L20 18 L28 24 L42 8', stroke: '#ffffff', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none', opacity: '0.9' },
        })
      );
    }

    function buildShell({ onSearch }) {
      const navList = h('nav', { class: 'nav', attrs: { 'aria-label': 'التنقل الرئيسي' } });
      const navLinks = new Map();

      // الأيقونة أولاً ⇒ تظهر في أقصى اليمين (RTL) مطابقةً للصور المرجعية،
      // وتصطفّ كل الأيقونات على محور رأسي واحد.
      for (const item of NAV_ITEMS) {
        const link = h('a', { class: 'nav__item', href: `#${item.path}` },
          icon(item.icon),
          h('span', { class: 'nav__label', text: item.label })
        );
        navLinks.set(item.path, link);
        navList.appendChild(link);
      }

      const storageFill = h('div', { class: 'storage-widget__fill', style: { width: '0%' } });
      const storageText = h('div', { class: 'storage-widget__text', text: 'جارٍ الحساب…' });

      const sidebar = h('aside', { class: 'sidebar', id: 'app-sidebar' },
        h('div', { class: 'brand' }, brandMark(), h('span', { class: 'brand__name', text: 'نظام المبيعات' })),
        navList,
        h('div', { class: 'storage-widget' },
          icon('database'),
          h('div', { class: 'storage-widget__body' },
            h('div', { class: 'storage-widget__label', text: 'التخزين المحلي' }),
            h('div', { class: 'storage-widget__bar' }, storageFill),
            storageText
          )
        )
      );

      /* ------------------------------ الشريط العلوي ------------------------------ */

      const pageTitle = h('h1', { class: 'topbar__title', text: 'لوحة التحكم' });

      const connDot = h('span', { class: 'conn-status__dot' });
      const connLabel = h('span', { text: 'جاهز دون اتصال' });
      const connStatus = h('div', {
        class: 'conn-status',
        dataset: { online: 'true' },
        attrs: { role: 'status', title: 'حالة الاتصال' },
      }, icon('checkCircle'), connLabel);

      const notifBadge = h('span', { class: 'icon-btn__badge', text: '0', hidden: true });
      const notifButton = h('button', {
        class: 'icon-btn',
        attrs: { type: 'button', 'aria-label': 'التنبيهات' },
        on: { click: () => navigate('/notifications') },
      }, icon('bell'), notifBadge);

      const searchInput = h('input', {
        class: 'input',
        type: 'search',
        placeholder: 'بحث',
        attrs: { 'aria-label': 'بحث عام في المنتجات والفواتير والعملاء' },
        on: {
          keydown: (event) => {
            if (event.key === 'Enter' && event.target.value.trim()) {
              onSearch?.(event.target.value.trim());
            }
          },
        },
      });

      const topbar = h('header', { class: 'topbar' },
        h('button', {
          class: 'topbar__burger',
          attrs: { type: 'button', 'aria-label': 'إظهار القائمة', 'aria-controls': 'app-sidebar', 'aria-expanded': 'false' },
          on: {
            click: () => appState.set((state) => ({ sidebarOpen: !state.sidebarOpen })),
          },
        }, icon('menu')),
        pageTitle,
        h('div', { class: 'topbar__search' }, h('div', { class: 'search' }, icon('search', { class: 'search__icon' }), searchInput)),
        h('div', { class: 'topbar__actions' },
          connStatus,
          notifButton,
          h('button', {
            class: 'icon-btn',
            attrs: { type: 'button', 'aria-label': 'الإعدادات' },
            on: { click: () => navigate('/settings') },
          }, icon('settings')),
          h('button', {
            class: 'user-chip',
            attrs: { type: 'button', 'aria-label': 'حساب المستخدم' },
            on: { click: () => navigate('/settings') },
          },
            h('span', { class: 'user-chip__avatar' }, icon('user')),
            h('span', { class: 'user-chip__name', text: 'المستخدم' }),
            icon('chevronDown', { class: 'icon-chev' })
          )
        )
      );

      /* --------------------------------- المحتوى -------------------------------- */

      const main = h('main', { class: 'main', id: 'main-content', attrs: { tabindex: '-1' } });

      /* --------------------------- شريط التنقل السفلي --------------------------- */

      const tabLinks = new Map();
      const tabbar = h('nav', { class: 'tabbar', attrs: { 'aria-label': 'التنقل السريع' } },
        ...TAB_ITEMS.map((item) => {
          if (item.path === '__more') {
            return h('button', {
              class: 'tabbar__item',
              attrs: { type: 'button' },
              on: { click: () => appState.set({ sidebarOpen: true }) },
            }, icon(item.icon), h('span', { text: item.label }));
          }
          const link = h('a', { class: 'tabbar__item', href: `#${item.path}` },
            icon(item.icon), h('span', { text: item.label }));
          tabLinks.set(item.path, link);
          return link;
        })
      );

      /* --------------------------------- الحالة --------------------------------- */

      const burger = topbar.querySelector('.topbar__burger');

      appState.subscribe((state) => {
        // حالة الاتصال
        const online = state.online;
        connStatus.dataset.online = String(online);
        connLabel.textContent = online ? 'جاهز دون اتصال' : 'غير متصل — يعمل محلياً';

        // مساحة التخزين
        if (state.storage) {
          const { usage = 0, quota = 0 } = state.storage;
          const ratio = quota > 0 ? usage / quota : 0;
          storageFill.style.width = `${Math.min(100, ratio * 100)}%`;
          storageText.textContent = `${formatBytes(usage)} / ${formatBytes(quota)} (${Math.round(ratio * 100)}%)`;
        }

        // عدّاد البيوع المعلّقة كتنبيه
        const pending = state.suspendedCount || 0;
        notifBadge.hidden = pending === 0;
        notifBadge.textContent = String(pending);
        notifButton.setAttribute(
          'aria-label',
          pending > 0 ? `التنبيهات: ${pending} بيع معلّق` : 'التنبيهات'
        );

        // الشريط الجانبي على الشاشات الصغيرة
        sidebar.classList.toggle('is-open', Boolean(state.sidebarOpen));
        burger.setAttribute('aria-expanded', String(Boolean(state.sidebarOpen)));
      }, { immediate: true });

      /** يحدّث العنصر النشط وعنوان الصفحة */
      function setActiveRoute(path, title) {
        const base = `/${path.split('/').filter(Boolean)[0] || 'dashboard'}`;

        for (const [itemPath, link] of navLinks) {
          if (itemPath === base) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        }
        for (const [itemPath, link] of tabLinks) {
          if (itemPath === base) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        }

        const label = title || NAV_ITEMS.find((item) => item.path === base)?.label || 'نظام المبيعات';
        pageTitle.textContent = label;
        document.title = `${label} — نظام المبيعات`;
      }

      return { sidebar, topbar, main, tabbar, setActiveRoute, searchInput };
    }

    /** يركّب الهيكل داخل جذر التطبيق */
    function mountShell(root, shell) {
      root.removeAttribute('aria-busy');
      render(root, shell.topbar, shell.sidebar, shell.main, shell.tabbar);

      // إغلاق الشريط الجانبي عند النقر خارجه على الشاشات الصغيرة
      document.addEventListener('pointerdown', (event) => {
        if (!appState.get().sidebarOpen) return;
        if (shell.sidebar.contains(event.target)) return;
        if (event.target.closest('.topbar__burger, .tabbar__item')) return;
        appState.set({ sidebarOpen: false });
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && appState.get().sidebarOpen) {
          appState.set({ sidebarOpen: false });
        }
      });
    }

    /** شاشة خطأ عامة عند فشل الإقلاع */
    function bootError(message, detail) {
      return h('div', { class: 'boot boot--error' },
        h('div', { class: 'empty__icon', style: { background: 'var(--red-soft)', color: 'var(--red)' } }, icon('error')),
        h('h1', { style: { 'font-size': '18px' }, text: 'تعذّر تشغيل التطبيق' }),
        h('p', { style: { 'max-width': '460px', 'text-align': 'center' }, text: message }),
        detail ? h('p', { class: 'field__hint' }, ltr(detail)) : null,
        h('button', {
          class: 'btn btn--primary',
          attrs: { type: 'button' },
          text: 'إعادة المحاولة',
          on: { click: () => window.location.reload() },
        })
      );
    }


    Object.defineProperty(__exports, "NAV_ITEMS", { enumerable: true, get: function () { return NAV_ITEMS; } });
    Object.defineProperty(__exports, "buildShell", { enumerable: true, get: function () { return buildShell; } });
    Object.defineProperty(__exports, "mountShell", { enumerable: true, get: function () { return mountShell; } });
    Object.defineProperty(__exports, "bootError", { enumerable: true, get: function () { return bootError; } });
  });

  /* ================================================================== */
  /* src/components/table.js */
  __def("src/components/table.js", function (__exports, __m, __dyn) {
    /** جدول بيانات: رؤوس قابلة للفرز، حالة فارغة، تحديد صف، وإجراءات. */

    const { h } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { emptyState } = __m("src/components/ui.js");

    /**
     * @param {object} config
     * @param {{key:string,label:string,render?:Function,sortable?:boolean,className?:string,width?:string}[]} config.columns
     * @param {object[]} config.rows
     * @param {{key:string,dir:'asc'|'desc'}} [config.sort]
     * @param {(key:string)=>void} [config.onSort]
     * @param {(row:object)=>string} [config.rowKey]
     * @param {(row:object)=>boolean} [config.isSelected]
     * @param {(row:object)=>void} [config.onRowClick]
     * @param {object} [config.empty] إعدادات الحالة الفارغة
     * @param {string} [config.caption] وصف للقارئات الشاشية
     */
    function dataTable({
      columns, rows, sort, onSort, rowKey, isSelected, onRowClick, empty, caption,
    }) {
      if (!rows || rows.length === 0) {
        return emptyState(empty || { title: 'لا توجد بيانات', text: 'لم يتم العثور على سجلات مطابقة.' });
      }

      const headerCell = (column) => {
        const isSorted = sort?.key === column.key;
        const ariaSort = isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

        if (!column.sortable || !onSort) {
          return h('th', {
            class: column.className,
            attrs: { scope: 'col', ...(column.width ? { style: null } : {}) },
            style: column.width ? { width: column.width } : null,
            text: column.label,
          });
        }

        return h('th', {
          class: column.className,
          attrs: { scope: 'col', 'aria-sort': ariaSort },
          style: column.width ? { width: column.width } : null,
        },
          h('button', {
            class: 'table__sort',
            attrs: { type: 'button', 'aria-sort': ariaSort },
            on: { click: () => onSort(column.key) },
          },
            h('span', { text: column.label }),
            icon(isSorted ? (sort.dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'arrowUpDown')
          )
        );
      };

      return h('div', { class: 'table-wrap' },
        h('table', { class: 'table' },
          caption ? h('caption', { class: 'sr-only', text: caption }) : null,
          h('thead', null, h('tr', null, ...columns.map(headerCell))),
          h('tbody', null,
            ...rows.map((row, index) => {
              const selected = isSelected?.(row);
              return h('tr', {
                attrs: {
                  ...(selected ? { 'aria-selected': 'true' } : {}),
                  ...(onRowClick ? { tabindex: '0', role: 'button' } : {}),
                },
                dataset: rowKey ? { key: rowKey(row) } : null,
                style: onRowClick ? { cursor: 'pointer' } : null,
                on: onRowClick
                  ? {
                      click: (event) => {
                        // لا تفعّل تحديد الصف عند الضغط على زر أو رابط داخله
                        if (event.target.closest('button, a, input, select')) return;
                        onRowClick(row);
                      },
                      keydown: (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          if (event.target.closest('button, a, input, select')) return;
                          event.preventDefault();
                          onRowClick(row);
                        }
                      },
                    }
                  : {},
              },
                ...columns.map((column) => {
                  const content = column.render ? column.render(row, index) : row[column.key];
                  return h('td', { class: column.className },
                    content == null || content === '' ? '—' : content);
                })
              );
            })
          )
        )
      );
    }

    /** خلية بسطرين: عنوان + تفصيل */
    function twoLineCell(main, sub) {
      return h('div', null,
        h('div', { class: 'table__main', text: main }),
        sub ? h('div', { class: 'table__sub' }, sub) : null
      );
    }

    /** صورة مصغّرة في الجدول مع بديل عند عدم وجود صورة */
    function thumbCell(src, alt) {
      if (!src) {
        return h('div', { class: 'table__thumb table__thumb--ph', attrs: { role: 'img', 'aria-label': alt || 'لا توجد صورة' } },
          icon('image'));
      }
      return h('img', { class: 'table__thumb', src, alt: alt || '', loading: 'lazy', decoding: 'async' });
    }

    /** مجموعة أزرار إجراءات صغيرة (نمط شاشة المنتجات) */
    function actionButtons(...buttons) {
      return h('div', { class: 'table__actions' }, ...buttons.filter(Boolean));
    }

    function actionButton({ label, iconName, tone = 'ghost', onClick, title }) {
      const toneClass = {
        ghost: 'btn--ghost',
        primary: 'btn--outline',
        danger: 'btn--outline-danger',
      }[tone] || 'btn--ghost';

      return h('button', {
        class: ['btn', 'btn--sm', toneClass],
        attrs: { type: 'button', title: title || label },
        on: { click: onClick },
      }, h('span', { text: label }), icon(iconName));
    }


    Object.defineProperty(__exports, "dataTable", { enumerable: true, get: function () { return dataTable; } });
    Object.defineProperty(__exports, "twoLineCell", { enumerable: true, get: function () { return twoLineCell; } });
    Object.defineProperty(__exports, "thumbCell", { enumerable: true, get: function () { return thumbCell; } });
    Object.defineProperty(__exports, "actionButtons", { enumerable: true, get: function () { return actionButtons; } });
    Object.defineProperty(__exports, "actionButton", { enumerable: true, get: function () { return actionButton; } });
  });

  /* ================================================================== */
  /* src/components/ui.js */
  __def("src/components/ui.js", function (__exports, __m, __dyn) {
    /** مكوّنات واجهة مشتركة مبنية على design tokens المستخرجة من الصور المرجعية. */

    const { h, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { formatAmount, formatInt, formatPercent } = __m("src/utils/format.js");

    /* ------------------------------- بطاقة ------------------------------- */

    function card({ title, titleIcon, actions, body, footer, flush = false, className } = {}) {
      return h('section', { class: ['card', flush && 'card--flush', className] },
        title || actions
          ? h('div', { class: 'card__head' },
              h('h2', { class: 'card__title' }, titleIcon ? icon(titleIcon) : null, title || ''),
              actions ? h('div', { class: 'row' }, actions) : null
            )
          : null,
        body ? h('div', { class: 'card__body' }, body) : null,
        footer ? h('div', { class: 'card__foot' }, footer) : null
      );
    }

    /* ------------------------------- شارة ------------------------------- */

    function badge(text, tone = 'gray', { withDot = false, iconName } = {}) {
      return h('span', { class: ['badge', `badge--${tone}`] },
        withDot ? h('span', { class: 'badge__dot' }) : null,
        iconName ? icon(iconName) : null,
        h('span', { text })
      );
    }

    /* ------------------------------ بطاقة KPI ---------------------------- */

    /**
     * @param {object} config
     * @param {string} config.label
     * @param {string|Node} config.value
     * @param {string} [config.unit]
     * @param {string} config.iconName
     * @param {string} [config.tone] teal|blue|green|amber|red|violet
     * @param {{percent:number, label?:string}} [config.delta]
     * @param {string} [config.variant] 'default' | 'stacked' | 'tinted'
     * @param {{label:string, href:string}} [config.link]
     */
    function kpi({
      label, value, unit, iconName, tone = 'blue', delta, variant = 'default', link, subtext,
    }) {
      const iconBox = h('div', { class: ['kpi__icon', `kpi__icon--${tone}`] }, icon(iconName));

      const deltaNode = delta
        ? (() => {
            const direction = delta.percent > 0 ? 'up' : delta.percent < 0 ? 'down' : 'flat';
            return h('div', { class: ['kpi__delta', `kpi__delta--${direction}`] },
              direction !== 'flat' ? icon(direction === 'up' ? 'trendUp' : 'trendDown') : null,
              h('span', { text: formatPercent(Math.abs(delta.percent)), style: { color: 'inherit' } }),
              h('span', { text: delta.label || 'عن أمس' })
            );
          })()
        : null;

      const valueNode = typeof value === 'string' || typeof value === 'number'
        ? h('div', { class: 'kpi__value' }, ltr(value))
        : h('div', { class: 'kpi__value' }, value);

      if (variant === 'stacked') {
        return h('article', { class: 'kpi kpi--stacked' },
          h('div', { class: 'kpi__top' }, iconBox, h('div', { class: 'kpi__label', text: label })),
          h('div', { class: 'kpi__body' },
            valueNode,
            unit ? h('div', { class: 'kpi__unit', text: unit }) : null,
            subtext ? h('div', { class: 'kpi__unit', text: subtext }) : null
          ),
          link ? h('a', { class: 'kpi__link', href: link.href, text: link.label }) : null
        );
      }

      if (variant === 'tinted') {
        return h('article', { class: ['kpi', 'kpi--tinted', `is-${tone}`] },
          h('div', { class: 'kpi__body' },
            h('div', { class: 'kpi__label', text: label }),
            valueNode,
            subtext ? h('div', { class: 'kpi__unit', text: subtext }) : null
          ),
          h('div', { class: 'kpi__icon' }, icon(iconName))
        );
      }

      return h('article', { class: 'kpi' },
        h('div', { class: 'kpi__body' },
          h('div', { class: 'kpi__label', text: label }),
          valueNode,
          unit ? h('div', { class: 'kpi__unit', text: unit }) : null,
          subtext ? h('div', { class: 'kpi__unit', text: subtext }) : null,
          deltaNode
        ),
        iconBox
      );
    }

    const kpiGrid = (...cards) => h('div', { class: 'kpi-grid' }, cards);

    /** يحسب نسبة التغير بأمان (يتجنّب القسمة على صفر) */
    function deltaPercent(current, previous) {
      if (!previous) return current > 0 ? 100 : 0;
      return ((current - previous) / Math.abs(previous)) * 100;
    }

    /* ------------------------------- حقول ------------------------------- */

    let fieldCounter = 0;

    /**
     * حقل نموذج كامل: تسمية فعلية مرتبطة، رسالة خطأ مرتبطة عبر aria-describedby.
     * @returns {{element:HTMLElement, input:HTMLElement, setError:Function, value:Function}}
     */
    function field({
      label, name, type = 'text', value = '', placeholder = '', required = false,
      hint = '', options = null, rows = null, suffix = null, min, max, step,
      disabled = false, autofocus = false, maxLength, onInput, onChange, counter = false,
    }) {
      fieldCounter += 1;
      const id = `f${fieldCounter}-${name || type}`;
      const errorId = `${id}-error`;
      const hintId = `${id}-hint`;

      let input;
      const describedBy = [];
      if (hint) describedBy.push(hintId);

      const shared = {
        id,
        name: name || id,
        disabled: disabled || undefined,
        'aria-required': required ? 'true' : undefined,
        ref: (el) => { input = el; },
        on: {
          ...(onInput ? { input: onInput } : {}),
          ...(onChange ? { change: onChange } : {}),
        },
      };

      let control;
      if (options) {
        control = h('select', { class: 'select', ...shared },
          ...options.map((option) =>
            h('option', {
              value: option.value,
              selected: String(option.value) === String(value) || undefined,
              text: option.label,
            })
          )
        );
      } else if (rows) {
        control = h('textarea', {
          class: 'textarea', rows, placeholder, maxlength: maxLength, ...shared,
        }, value || '');
      } else {
        control = h('input', {
          class: 'input', type, value, placeholder, min, max, step, maxlength: maxLength,
          autofocus: autofocus || undefined, ...shared,
        });
      }

      const counterNode = counter && maxLength
        ? h('div', { class: 'field__counter', text: `${String(value || '').length} / ${maxLength}` })
        : null;

      if (counterNode) {
        control.addEventListener('input', () => {
          counterNode.textContent = `${control.value.length} / ${maxLength}`;
        });
      }

      const errorNode = h('p', { class: 'field__error', id: errorId, attrs: { role: 'alert' }, hidden: true });

      const controlWrap = suffix
        ? h('div', { class: 'input-affix' }, control, h('span', { class: 'input-affix__suffix', text: suffix }))
        : control;

      const element = h('div', { class: 'field' },
        h('label', { class: 'field__label', for: id },
          label,
          required ? h('span', { class: 'field__req', text: '*', attrs: { 'aria-hidden': 'true' } }) : null
        ),
        controlWrap,
        hint ? h('p', { class: 'field__hint', id: hintId, text: hint }) : null,
        counterNode,
        errorNode
      );

      if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '));

      function setError(message) {
        if (message) {
          errorNode.textContent = message;
          errorNode.hidden = false;
          control.setAttribute('aria-invalid', 'true');
          control.setAttribute('aria-describedby', [errorId, ...describedBy].join(' '));
        } else {
          errorNode.hidden = true;
          errorNode.textContent = '';
          control.removeAttribute('aria-invalid');
          if (describedBy.length > 0) control.setAttribute('aria-describedby', describedBy.join(' '));
          else control.removeAttribute('aria-describedby');
        }
      }

      return {
        element,
        input: control,
        setError,
        get value() { return control.value; },
        set value(next) {
          control.value = next;
          if (counterNode) counterNode.textContent = `${control.value.length} / ${maxLength}`;
        },
        focus: () => control.focus(),
      };
    }

    /** مفتاح تبديل */
    function toggleField({ label, name, checked = false, onChange }) {
      let input;
      const element = h('label', { class: 'toggle' },
        h('input', {
          type: 'checkbox', name, checked: checked || undefined,
          ref: (el) => { input = el; },
          on: onChange ? { change: (event) => onChange(event.target.checked) } : {},
        }),
        h('span', { class: 'toggle__track', attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'toggle__label', text: label })
      );
      return { element, input, get checked() { return input.checked; }, set checked(v) { input.checked = v; } };
    }

    /** خانة اختيار */
    function checkboxField({ label, name, checked = false, onChange }) {
      let input;
      const element = h('label', { class: 'checkbox' },
        h('input', {
          type: 'checkbox', name, checked: checked || undefined,
          ref: (el) => { input = el; },
          on: onChange ? { change: (event) => onChange(event.target.checked) } : {},
        }),
        h('span', { text: label })
      );
      return { element, input, get checked() { return input.checked; } };
    }

    /** حقل بحث مع زر مسح */
    function searchField({ placeholder = 'بحث', value = '', onInput, label = 'بحث' }) {
      let input;
      const clear = h('button', {
        class: 'search__clear',
        attrs: { type: 'button', 'aria-label': 'مسح البحث' },
        hidden: !value,
        on: {
          click: () => {
            input.value = '';
            clear.hidden = true;
            onInput?.('');
            input.focus();
          },
        },
      }, icon('close'));

      const element = h('div', { class: 'search' },
        icon('search', { class: 'search__icon' }),
        h('input', {
          class: 'input',
          type: 'search',
          placeholder,
          value,
          attrs: { 'aria-label': label },
          ref: (el) => { input = el; },
          on: {
            input: (event) => {
              clear.hidden = !event.target.value;
              onInput?.(event.target.value);
            },
          },
        }),
        clear
      );

      return { element, input, get value() { return input.value; } };
    }

    /* ------------------------------ حالات ------------------------------ */

    function emptyState({ title, text, iconName = 'boxOpen', action }) {
      return h('div', { class: 'empty' },
        h('div', { class: 'empty__icon' }, icon(iconName)),
        h('p', { class: 'empty__title', text: title }),
        text ? h('p', { class: 'empty__text', text }) : null,
        action || null
      );
    }

    function errorState(message, { onRetry } = {}) {
      return h('div', { class: 'state-error', attrs: { role: 'alert' } },
        icon('error'),
        h('div', null,
          h('p', { class: 'state-error__title', text: 'تعذّر إتمام العملية' }),
          h('p', { text: message }),
          onRetry
            ? h('button', {
                class: 'btn btn--sm btn--ghost',
                attrs: { type: 'button' },
                text: 'إعادة المحاولة',
                style: { 'margin-top': '10px' },
                on: { click: onRetry },
              })
            : null
        )
      );
    }

    function alertBox(message, tone = 'info', iconName) {
      const icons = { info: 'info', warn: 'warning', error: 'error', ok: 'checkCircle' };
      return h('div', { class: ['alert', `alert--${tone}`] },
        icon(iconName || icons[tone] || 'info'),
        h('div', typeof message === 'string' ? { text: message } : null,
          typeof message === 'string' ? null : message)
      );
    }

    /** هيكل تحميل لجدول */
    function tableSkeleton(rows = 6, columns = 5) {
      return h('div', { style: { padding: '16px' }, attrs: { 'aria-hidden': 'true' } },
        ...Array.from({ length: rows }, () =>
          h('div', { class: 'row', style: { gap: '16px', 'margin-bottom': '14px' } },
            ...Array.from({ length: columns }, (_, i) =>
              h('div', { class: 'skeleton', style: { flex: i === 0 ? '2' : '1' } })
            )
          )
        )
      );
    }

    /* ---------------------------- ترقيم الصفحات ---------------------------- */

    /**
     * @param {{page:number, pageSize:number, total:number, onPage:Function, onPageSize?:Function, unit?:string}} config
     */
    function pagination({ page, pageSize, total, onPage, onPageSize, unit = 'عنصر', sizes = [10, 20, 50, 100] }) {
      const pageCount = Math.max(1, Math.ceil(total / pageSize));
      const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      const to = Math.min(page * pageSize, total);

      const pageButton = (n) => h('button', {
        class: 'pager__btn',
        attrs: { type: 'button', ...(n === page ? { 'aria-current': 'page' } : {}), 'aria-label': `صفحة ${n}` },
        text: String(n),
        on: { click: () => n !== page && onPage(n) },
      });

      const navButton = (iconName, label, targetPage, disabled) => h('button', {
        class: 'pager__btn',
        attrs: { type: 'button', 'aria-label': label },
        disabled: disabled || undefined,
        on: { click: () => !disabled && onPage(targetPage) },
      }, icon(iconName));

      // نافذة أرقام حول الصفحة الحالية مع اختصار بالنقاط
      const numbers = [];
      const window_ = 1;
      let last = 0;
      for (let n = 1; n <= pageCount; n += 1) {
        const inWindow = n === 1 || n === pageCount || Math.abs(n - page) <= window_;
        if (!inWindow) continue;
        if (last && n - last > 1) numbers.push(h('span', { class: 'pager__gap', text: '…' }));
        numbers.push(pageButton(n));
        last = n;
      }

      return h('div', { class: 'pager' },
        h('p', { class: 'pager__info' },
          total === 0 ? 'لا توجد نتائج' : `عرض ${from} إلى ${to} من ${formatInt(total)} ${unit}`
        ),
        h('nav', { class: 'pager__controls', attrs: { 'aria-label': 'ترقيم الصفحات' } },
          navButton('chevronsRight', 'الصفحة الأولى', 1, page === 1),
          navButton('chevronRight', 'الصفحة السابقة', page - 1, page === 1),
          ...numbers,
          navButton('chevronLeft', 'الصفحة التالية', page + 1, page >= pageCount),
          navButton('chevronsLeft', 'الصفحة الأخيرة', pageCount, page >= pageCount)
        ),
        onPageSize
          ? h('label', { class: 'pager__size' },
              h('span', { text: 'لكل صفحة' }),
              h('select', {
                class: 'select',
                attrs: { 'aria-label': 'عدد العناصر لكل صفحة' },
                on: { change: (event) => onPageSize(Number(event.target.value)) },
              }, ...sizes.map((size) =>
                h('option', { value: size, selected: size === pageSize || undefined, text: String(size) })
              ))
            )
          : null
      );
    }

    /* ------------------------------ متنوعات ------------------------------ */

    function progressBar(ratio, { tone } = {}) {
      const clamped = Math.max(0, Math.min(1, ratio || 0));
      const auto = clamped > 0.9 ? 'is-danger' : clamped > 0.75 ? 'is-warn' : '';
      return h('div', {
        class: 'progress',
        attrs: {
          role: 'progressbar',
          'aria-valuenow': Math.round(clamped * 100),
          'aria-valuemin': '0',
          'aria-valuemax': '100',
        },
      }, h('div', { class: ['progress__fill', tone || auto], style: { width: `${clamped * 100}%` } }));
    }

    function avatar(name, { small = false } = {}) {
      const letters = String(name || '؟').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
      return h('div', { class: ['avatar', small && 'avatar--sm'], attrs: { 'aria-hidden': 'true' }, text: letters });
    }

    /** مبلغ منسّق مع رمز العملة، بأرقام لاتينية معزولة الاتجاه */
    function money(minor, symbol, { tone, decimals = 2, symbolPosition = 'after' } = {}) {
      const text = formatAmount(minor, decimals);
      const content = symbol
        ? (symbolPosition === 'before' ? `${symbol} ${text}` : `${text} ${symbol}`)
        : text;
      return h('span', {
        class: tone ? `is-${tone}` : null,
        style: tone === 'green' ? { color: 'var(--green)' } : tone === 'red' ? { color: 'var(--red)' } : null,
      }, ltr(content));
    }

    function detailRow(label, value, { iconName } = {}) {
      return h('div', { class: 'detail-row' },
        h('span', { class: 'detail-row__label' }, iconName ? icon(iconName) : null, label),
        h('span', { class: 'detail-row__value' }, value)
      );
    }

    /** رقاقات تصفية */
    function chipGroup({ items, active, onSelect, label = 'تصفية' }) {
      return h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': label } },
        ...items.map((item) =>
          h('button', {
            class: 'chip',
            attrs: { type: 'button', 'aria-pressed': String(item.value === active) },
            on: { click: () => onSelect(item.value) },
          },
            item.icon ? icon(item.icon) : null,
            h('span', { text: item.label })
          )
        )
      );
    }

    /** قائمة إجراءات صف (زر ⋮) */
    function rowMenu(items, { label = 'إجراءات' } = {}) {
      let list;
      let cleanup = null;

      const close = () => {
        list.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        cleanup?.();
        cleanup = null;
      };

      const button = h('button', {
        class: 'row-menu__btn',
        attrs: { type: 'button', 'aria-label': label, 'aria-expanded': 'false', 'aria-haspopup': 'menu' },
        on: {
          click: (event) => {
            event.stopPropagation();
            const willOpen = list.hidden;
            // أغلق أي قائمة أخرى مفتوحة
            document.querySelectorAll('.row-menu__list:not([hidden])').forEach((el) => { el.hidden = true; });
            list.hidden = !willOpen;
            button.setAttribute('aria-expanded', String(willOpen));
            if (willOpen) {
              const onDocClick = (e) => { if (!wrapper.contains(e.target)) close(); };
              const onKey = (e) => { if (e.key === 'Escape') { close(); button.focus(); } };
              document.addEventListener('pointerdown', onDocClick);
              document.addEventListener('keydown', onKey);
              cleanup = () => {
                document.removeEventListener('pointerdown', onDocClick);
                document.removeEventListener('keydown', onKey);
              };
            } else {
              close();
            }
          },
        },
      }, icon('more'));

      list = h('div', { class: 'row-menu__list', hidden: true, attrs: { role: 'menu' } },
        ...items.filter(Boolean).map((item) =>
          h('button', {
            class: ['row-menu__item', item.danger && 'row-menu__item--danger'],
            attrs: { type: 'button', role: 'menuitem' },
            on: {
              click: () => {
                close();
                item.onSelect();
              },
            },
          },
            item.icon ? icon(item.icon) : null,
            h('span', { text: item.label })
          )
        )
      );

      const wrapper = h('div', { class: 'row-menu' }, button, list);
      return wrapper;
    }


    Object.defineProperty(__exports, "card", { enumerable: true, get: function () { return card; } });
    Object.defineProperty(__exports, "badge", { enumerable: true, get: function () { return badge; } });
    Object.defineProperty(__exports, "kpi", { enumerable: true, get: function () { return kpi; } });
    Object.defineProperty(__exports, "kpiGrid", { enumerable: true, get: function () { return kpiGrid; } });
    Object.defineProperty(__exports, "deltaPercent", { enumerable: true, get: function () { return deltaPercent; } });
    Object.defineProperty(__exports, "field", { enumerable: true, get: function () { return field; } });
    Object.defineProperty(__exports, "toggleField", { enumerable: true, get: function () { return toggleField; } });
    Object.defineProperty(__exports, "checkboxField", { enumerable: true, get: function () { return checkboxField; } });
    Object.defineProperty(__exports, "searchField", { enumerable: true, get: function () { return searchField; } });
    Object.defineProperty(__exports, "emptyState", { enumerable: true, get: function () { return emptyState; } });
    Object.defineProperty(__exports, "errorState", { enumerable: true, get: function () { return errorState; } });
    Object.defineProperty(__exports, "alertBox", { enumerable: true, get: function () { return alertBox; } });
    Object.defineProperty(__exports, "tableSkeleton", { enumerable: true, get: function () { return tableSkeleton; } });
    Object.defineProperty(__exports, "pagination", { enumerable: true, get: function () { return pagination; } });
    Object.defineProperty(__exports, "progressBar", { enumerable: true, get: function () { return progressBar; } });
    Object.defineProperty(__exports, "avatar", { enumerable: true, get: function () { return avatar; } });
    Object.defineProperty(__exports, "money", { enumerable: true, get: function () { return money; } });
    Object.defineProperty(__exports, "detailRow", { enumerable: true, get: function () { return detailRow; } });
    Object.defineProperty(__exports, "chipGroup", { enumerable: true, get: function () { return chipGroup; } });
    Object.defineProperty(__exports, "rowMenu", { enumerable: true, get: function () { return rowMenu; } });
  });

  /* ================================================================== */
  /* src/db/db.js */
  __def("src/db/db.js", function (__exports, __m, __dyn) {
    /**
     * طبقة الوصول إلى IndexedDB.
     *
     * قاعدة حرجة (موثّقة في MDN — IDBTransaction):
     * المعاملة تلتزم تلقائياً عندما تصبح خاملة. انتظار وعد مرتبط بطلب IndexedDB
     * آمن لأن الوعد يُحلّ داخل مهمة معالج success. أما انتظار أي شيء آخر
     * (fetch أو setTimeout أو FileReader) داخل معاملة فيؤدي إلى التزامها قبل
     * اكتمال العمل. لذلك: كل التحويلات غير المتزامنة تتم **قبل** فتح المعاملة.
     */

    const { DB_NAME, SCHEMA_VERSION, runMigrations } = __m("src/db/schema.js");

    let dbPromise = null;
    let dbName = DB_NAME;

    /** يسمح للاختبارات بالعمل على قاعدة معزولة */
    function configureDatabase(name) {
      dbName = name;
      dbPromise = null;
    }

    function currentDatabaseName() {
      return dbName;
    }

    /** يحوّل IDBRequest إلى Promise */
    function req(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function openDB(version = SCHEMA_VERSION, name = dbName) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);

        request.onupgradeneeded = (event) => {
          try {
            runMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
          } catch (error) {
            request.transaction.abort();
            reject(error);
          }
        };

        request.onsuccess = () => {
          const db = request.result;
          // إذا فتحت نافذة أخرى إصداراً أحدث، نغلق هذا الاتصال حتى لا نحجب الترقية
          db.onversionchange = () => {
            db.close();
            dbPromise = null;
          };
          resolve(db);
        };

        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('قاعدة البيانات مفتوحة في نافذة أخرى. أغلق بقية النوافذ ثم أعد المحاولة.'));
      });
    }

    function getDB() {
      if (!dbPromise) {
        dbPromise = openDB().catch((error) => {
          dbPromise = null;
          throw error;
        });
      }
      return dbPromise;
    }

    async function closeDB() {
      if (!dbPromise) return;
      const db = await dbPromise.catch(() => null);
      db?.close();
      dbPromise = null;
    }

    /**
     * يشغّل عملاً داخل معاملة واحدة.
     *
     * @param {string|string[]} storeNames
     * @param {'readonly'|'readwrite'} mode
     * @param {(stores: Record<string, IDBObjectStore>, transaction: IDBTransaction) => any} work
     * @returns {Promise<any>} نتيجة `work` بعد التزام المعاملة فعلياً
     *
     * إن رمى `work` أو رُفض وعده، تُجهض المعاملة بالكامل ولا يُكتب أي شيء.
     */
    async function tx(storeNames, mode, work) {
      const db = await getDB();
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const transaction = db.transaction(names, mode);

      const stores = {};
      for (const name of names) stores[name] = transaction.objectStore(name);

      let result;
      let workError = null;

      const settled = new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('فشلت المعاملة'));
        transaction.onabort = () => reject(
          workError || transaction.error || new DOMException('أُجهضت المعاملة', 'AbortError')
        );
      });

      try {
        result = await work(stores, transaction);
      } catch (error) {
        workError = error;
        try { transaction.abort(); } catch { /* أُجهضت أو التزمت مسبقاً */ }
        await settled.catch(() => {});
        throw error;
      }

      await settled;
      return result;
    }

    /* ------------------------------------------------------------------ */
    /* مساعدات على مستوى المتجر (كلها تُستدعى داخل tx)                      */
    /* ------------------------------------------------------------------ */

    const get = (store, key) => req(store.get(key));
    const getAll = (store, query, count) => req(store.getAll(query, count));
    const put = (store, value) => req(store.put(value));
    const add = (store, value) => req(store.add(value));
    const del = (store, key) => req(store.delete(key));
    const count = (store, query) => req(store.count(query));
    const clearStore = (store) => req(store.clear());

    const getByIndex = (store, indexName, key) => req(store.index(indexName).get(key));
    const getAllByIndex = (store, indexName, query, limit) =>
      req(store.index(indexName).getAll(query, limit));
    const countByIndex = (store, indexName, query) => req(store.index(indexName).count(query));

    /**
     * يمرّ على سجلات (أو فهرس) ويستدعي `visit` لكل سجل.
     * أرجع `false` من `visit` لإيقاف المرور مبكراً.
     */
    function iterate(source, query, visit, direction = 'next') {
      return new Promise((resolve, reject) => {
        const request = source.openCursor(query, direction);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { resolve(); return; }
          let keepGoing;
          try {
            keepGoing = visit(cursor.value, cursor);
          } catch (error) {
            reject(error);
            return;
          }
          if (keepGoing === false) { resolve(); return; }
          cursor.continue();
        };
      });
    }

    /** يجمع سجلات فهرس ضمن نطاق مع فلترة وترقيم داخل المؤشر (بلا تحميل كل شيء) */
    async function pageByIndex(store, indexName, {
      query = null, direction = 'prev', offset = 0, limit = 20, filter = null,
    } = {}) {
      const items = [];
      let matched = 0;

      await iterate(store.index(indexName), query, (value) => {
        if (filter && !filter(value)) return true;
        matched += 1;
        if (matched > offset && items.length < limit) items.push(value);
        return true;
      }, direction);

      return { items, total: matched };
    }

    /** يحذف قاعدة البيانات بالكامل (مسح جميع البيانات المحلية) */
    async function deleteDatabase(name = dbName) {
      await closeDB();
      return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('تعذّر حذف قاعدة البيانات لأنها مفتوحة في نافذة أخرى.'));
      });
    }


    Object.defineProperty(__exports, "configureDatabase", { enumerable: true, get: function () { return configureDatabase; } });
    Object.defineProperty(__exports, "currentDatabaseName", { enumerable: true, get: function () { return currentDatabaseName; } });
    Object.defineProperty(__exports, "req", { enumerable: true, get: function () { return req; } });
    Object.defineProperty(__exports, "openDB", { enumerable: true, get: function () { return openDB; } });
    Object.defineProperty(__exports, "getDB", { enumerable: true, get: function () { return getDB; } });
    Object.defineProperty(__exports, "closeDB", { enumerable: true, get: function () { return closeDB; } });
    Object.defineProperty(__exports, "tx", { enumerable: true, get: function () { return tx; } });
    Object.defineProperty(__exports, "get", { enumerable: true, get: function () { return get; } });
    Object.defineProperty(__exports, "getAll", { enumerable: true, get: function () { return getAll; } });
    Object.defineProperty(__exports, "put", { enumerable: true, get: function () { return put; } });
    Object.defineProperty(__exports, "add", { enumerable: true, get: function () { return add; } });
    Object.defineProperty(__exports, "del", { enumerable: true, get: function () { return del; } });
    Object.defineProperty(__exports, "count", { enumerable: true, get: function () { return count; } });
    Object.defineProperty(__exports, "clearStore", { enumerable: true, get: function () { return clearStore; } });
    Object.defineProperty(__exports, "getByIndex", { enumerable: true, get: function () { return getByIndex; } });
    Object.defineProperty(__exports, "getAllByIndex", { enumerable: true, get: function () { return getAllByIndex; } });
    Object.defineProperty(__exports, "countByIndex", { enumerable: true, get: function () { return countByIndex; } });
    Object.defineProperty(__exports, "iterate", { enumerable: true, get: function () { return iterate; } });
    Object.defineProperty(__exports, "pageByIndex", { enumerable: true, get: function () { return pageByIndex; } });
    Object.defineProperty(__exports, "deleteDatabase", { enumerable: true, get: function () { return deleteDatabase; } });
  });

  /* ================================================================== */
  /* src/db/schema.js */
  __def("src/db/schema.js", function (__exports, __m, __dyn) {
    /**
     * مخطط IndexedDB وترقياته.
     *
     * قاعدة الترقية: كل إصدار دالة واحدة تنتقل من (الإصدار−1) إلى الإصدار.
     * الدوال تعمل داخل معاملة `versionchange` التي يوفّرها المتصفح، فلا يجوز
     * داخلها انتظار أي وعد غير مرتبط بطلب IndexedDB (وإلا التزمت المعاملة تلقائياً).
     */

    const DB_NAME = 'sales-system';
    const SCHEMA_VERSION = 5;
    const APP_VERSION = '1.0.3';

    const STORES = {
      products: 'products',
      categories: 'categories',
      customers: 'customers',
      sales: 'sales',
      saleItems: 'saleItems',
      payments: 'payments',
      expenses: 'expenses',
      expenseCategories: 'expenseCategories',
      inventoryMovements: 'inventoryMovements',
      suspendedSales: 'suspendedSales',
      settings: 'settings',
      backupRecords: 'backupRecords',
      adjustmentReasons: 'adjustmentReasons',
      returns: 'returns',
      returnItems: 'returnItems',
      shifts: 'shifts',
      suppliers: 'suppliers',
      purchases: 'purchases',
      purchaseItems: 'purchaseItems',
      purchasePayments: 'purchasePayments',
      purchaseOrders: 'purchaseOrders',
    };

    /** كل المتاجر التي تدخل في النسخ الاحتياطي والاستعادة */
    const BACKUP_STORES = Object.values(STORES);

    const migrations = {
      /** الإصدار 1: البنية الأساسية */
      1(db) {
        const products = db.createObjectStore(STORES.products, { keyPath: 'id' });
        products.createIndex('sku', 'sku', { unique: true });
        products.createIndex('barcode', 'barcode', { unique: true });
        products.createIndex('categoryId', 'categoryId');
        products.createIndex('name', 'name');
        products.createIndex('createdAt', 'createdAt');

        const categories = db.createObjectStore(STORES.categories, { keyPath: 'id' });
        categories.createIndex('name', 'name', { unique: true });
        categories.createIndex('sortOrder', 'sortOrder');

        const customers = db.createObjectStore(STORES.customers, { keyPath: 'id' });
        customers.createIndex('name', 'name');
        customers.createIndex('phone', 'phone');
        customers.createIndex('createdAt', 'createdAt');

        const sales = db.createObjectStore(STORES.sales, { keyPath: 'id' });
        sales.createIndex('number', 'number', { unique: true });
        sales.createIndex('dayKey', 'dayKey');
        sales.createIndex('customerId', 'customerId');
        sales.createIndex('status', 'status');
        sales.createIndex('createdAt', 'createdAt');

        const saleItems = db.createObjectStore(STORES.saleItems, { keyPath: 'id' });
        saleItems.createIndex('saleId', 'saleId');
        saleItems.createIndex('productId', 'productId');
        saleItems.createIndex('dayKey', 'dayKey');

        const payments = db.createObjectStore(STORES.payments, { keyPath: 'id' });
        payments.createIndex('customerId', 'customerId');
        payments.createIndex('saleId', 'saleId');
        payments.createIndex('createdAt', 'createdAt');

        const expenses = db.createObjectStore(STORES.expenses, { keyPath: 'id' });
        expenses.createIndex('dayKey', 'dayKey');
        expenses.createIndex('categoryId', 'categoryId');
        expenses.createIndex('createdAt', 'createdAt');

        const expenseCategories = db.createObjectStore(STORES.expenseCategories, { keyPath: 'id' });
        expenseCategories.createIndex('name', 'name', { unique: true });

        const movements = db.createObjectStore(STORES.inventoryMovements, { keyPath: 'id' });
        movements.createIndex('productId', 'productId');
        movements.createIndex('createdAt', 'createdAt');
        movements.createIndex('dayKey', 'dayKey');
        movements.createIndex('type', 'type');
        movements.createIndex('refId', 'refId');

        const suspended = db.createObjectStore(STORES.suspendedSales, { keyPath: 'id' });
        suspended.createIndex('createdAt', 'createdAt');

        db.createObjectStore(STORES.settings, { keyPath: 'key' });

        const backups = db.createObjectStore(STORES.backupRecords, { keyPath: 'id' });
        backups.createIndex('createdAt', 'createdAt');
      },

      /**
       * الإصدار 2:
       *  - متجر أسباب التسوية (نمط Zoho: أسباب مُدارة لا نص حر)
       *  - فهرس dayKey على المدفوعات لتقارير الفترة
       *  - حقل nameLower على المنتجات لبحث غير حسّاس لحالة الأحرف
       */
      2(db, transaction) {
        if (!db.objectStoreNames.contains(STORES.adjustmentReasons)) {
          const reasons = db.createObjectStore(STORES.adjustmentReasons, { keyPath: 'id' });
          reasons.createIndex('name', 'name', { unique: true });
        }

        const payments = transaction.objectStore(STORES.payments);
        if (!payments.indexNames.contains('dayKey')) {
          payments.createIndex('dayKey', 'dayKey');
        }

        const products = transaction.objectStore(STORES.products);
        if (!products.indexNames.contains('nameLower')) {
          products.createIndex('nameLower', 'nameLower');
        }

        // ترحيل البيانات القائمة: تعبئة nameLower للسجلات القديمة
        products.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          const value = cursor.value;
          if (value.nameLower == null) {
            value.nameLower = String(value.name || '').toLowerCase();
            cursor.update(value);
          }
          cursor.continue();
        };
      },

      /** الإصدار 3: المرتجعات مرتبطة بالفاتورة والسطور الأصلية ولا تعدّلها. */
      3(db) {
        const returns = db.createObjectStore(STORES.returns, { keyPath: 'id' });
        returns.createIndex('saleId', 'saleId');
        returns.createIndex('dayKey', 'dayKey');
        returns.createIndex('createdAt', 'createdAt');
        const returnItems = db.createObjectStore(STORES.returnItems, { keyPath: 'id' });
        returnItems.createIndex('returnId', 'returnId');
        returnItems.createIndex('saleItemId', 'saleItemId');
        returnItems.createIndex('saleId', 'saleId');
      },
      4(db) {
        const shifts = db.createObjectStore(STORES.shifts, { keyPath: 'id' });
        shifts.createIndex('status', 'status');
        shifts.createIndex('openedAt', 'openedAt');
        shifts.createIndex('dayKey', 'dayKey');
      },
      /** الإصدار 5: الموردون وأوامر الشراء والفواتير والمدفوعات */
      5(db) {
        const suppliers = db.createObjectStore(STORES.suppliers, { keyPath: 'id' });
        suppliers.createIndex('name', 'name'); suppliers.createIndex('phone', 'phone');
        const purchases = db.createObjectStore(STORES.purchases, { keyPath: 'id' });
        purchases.createIndex('number', 'number', { unique: true }); purchases.createIndex('supplierId', 'supplierId'); purchases.createIndex('dayKey', 'dayKey'); purchases.createIndex('status', 'status');
        const items = db.createObjectStore(STORES.purchaseItems, { keyPath: 'id' });
        items.createIndex('purchaseId', 'purchaseId'); items.createIndex('productId', 'productId');
        const payments = db.createObjectStore(STORES.purchasePayments, { keyPath: 'id' });
        payments.createIndex('supplierId', 'supplierId'); payments.createIndex('purchaseId', 'purchaseId'); payments.createIndex('createdAt', 'createdAt'); payments.createIndex('dayKey', 'dayKey');
        const orders = db.createObjectStore(STORES.purchaseOrders, { keyPath: 'id' });
        orders.createIndex('supplierId', 'supplierId'); orders.createIndex('status', 'status'); orders.createIndex('createdAt', 'createdAt');
      },
    };

    /** يشغّل كل الترقيات اللازمة من oldVersion إلى newVersion */
    function runMigrations(db, transaction, oldVersion, newVersion) {
      for (let version = oldVersion + 1; version <= newVersion; version += 1) {
        const migrate = migrations[version];
        if (!migrate) throw new Error(`لا توجد ترقية معرّفة للإصدار ${version}`);
        migrate(db, transaction);
      }
    }

    const MIGRATION_VERSIONS = Object.keys(migrations).map(Number).sort((a, b) => a - b);


    Object.defineProperty(__exports, "DB_NAME", { enumerable: true, get: function () { return DB_NAME; } });
    Object.defineProperty(__exports, "SCHEMA_VERSION", { enumerable: true, get: function () { return SCHEMA_VERSION; } });
    Object.defineProperty(__exports, "APP_VERSION", { enumerable: true, get: function () { return APP_VERSION; } });
    Object.defineProperty(__exports, "STORES", { enumerable: true, get: function () { return STORES; } });
    Object.defineProperty(__exports, "BACKUP_STORES", { enumerable: true, get: function () { return BACKUP_STORES; } });
    Object.defineProperty(__exports, "runMigrations", { enumerable: true, get: function () { return runMigrations; } });
    Object.defineProperty(__exports, "MIGRATION_VERSIONS", { enumerable: true, get: function () { return MIGRATION_VERSIONS; } });
  });

  /* ================================================================== */
  /* src/db/seed.js */
  __def("src/db/seed.js", function (__exports, __m, __dyn) {
    /**
     * بيانات أولية.
     *
     * `ensureBaseData` تعمل دائماً وتنشئ ما لا غنى عنه (فئات المصروفات، أسباب التسوية،
     * الإعدادات الافتراضية) حتى تبدأ الشاشات بقاعدة صالحة.
     * `seedDemoData` اختيارية بالكامل ولا تعمل إلا بطلب صريح من المستخدم.
     */

    const { tx, add, getAll, put } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, dayKey, addDays } = __m("src/utils/dates.js");
    const { DEFAULT_EXPENSE_CATEGORIES } = __m("src/repositories/expenses.js");
    const { DEFAULT_REASONS, MOVEMENT } = __m("src/repositories/inventory.js");
    const { loadSettings, saveSettings, DEFAULT_SETTINGS } = __m("src/repositories/settings.js");

    const PRODUCT_CATEGORIES = [
      { name: 'مشروبات', color: '#1B63E3', icon: 'coffee', sortOrder: 1 },
      { name: 'مواد غذائية', color: '#0E9C8A', icon: 'basket', sortOrder: 2 },
      { name: 'منظفات', color: '#7C5CE0', icon: 'spray', sortOrder: 3 },
      { name: 'ألبان', color: '#0EA5E9', icon: 'coffee', sortOrder: 4 },
      { name: 'معلبات', color: '#D97706', icon: 'package', sortOrder: 5 },
      { name: 'عناية شخصية', color: '#EC4899', icon: 'spray', sortOrder: 6 },
    ];

    /** منتجات مأخوذة من الشاشات المرجعية — للتجربة فقط */
    const DEMO_PRODUCTS = [
      ['SKU-1001', 'مياه معدنية 1.5 لتر', 'مشروبات', 'عبوة', 500, 800, 120, 24],
      ['SKU-1002', 'حليب كامل الدسم 1 لتر', 'ألبان', 'عبوة', 1800, 2400, 45, 15],
      ['SKU-1003', 'زيت عباد الشمس 1 لتر', 'مواد غذائية', 'عبوة', 2500, 3200, 37, 12],
      ['SKU-1004', 'سكر أبيض 1 كجم', 'مواد غذائية', 'كيس', 1400, 1800, 60, 20],
      ['SKU-1005', 'شاي ناعم 250 جم', 'مشروبات', 'علبة', 1900, 2500, 88, 25],
      ['SKU-1006', 'مكرونة 400 جم', 'مواد غذائية', 'كيس', 850, 1200, 75, 20],
      ['SKU-1007', 'أرز مصري 1 كجم', 'مواد غذائية', 'كيس', 2100, 2800, 8, 15],
      ['SKU-1008', 'صلصة طماطم 300 جم', 'معلبات', 'علبة', 1000, 1500, 52, 18],
      ['SKU-1009', 'سائل غسيل أطباق 750 مل', 'منظفات', 'عبوة', 1400, 2000, 34, 12],
      ['SKU-1010', 'مسحوق غسيل 2.5 كجم', 'منظفات', 'كيس', 4200, 5500, 6, 10],
      ['SKU-1011', 'شامبو 400 مل', 'عناية شخصية', 'عبوة', 2200, 3000, 41, 12],
      ['SKU-1012', 'معجون أسنان 100 مل', 'عناية شخصية', 'علبة', 1250, 1800, 66, 20],
      ['SKU-1013', 'مناديل تواليت 10 رول', 'منظفات', 'حزمة', 2600, 3500, 25, 10],
      ['SKU-1014', 'مطهر أرضيات 1 لتر', 'منظفات', 'عبوة', 1900, 2700, 29, 12],
      ['SKU-1015', 'بطاطس شيبس 60 جم', 'مواد غذائية', 'كيس', 650, 1000, 93, 30],
      ['SKU-1016', 'قهوة عربية 250 جم', 'مشروبات', 'علبة', 1800, 2500, 44, 15],
      ['SKU-1017', 'تمور سكري فاخر 1 كجم', 'مواد غذائية', 'علبة', 3400, 4500, 18, 10],
      ['SKU-1018', 'جبن شرائح 200 جم', 'ألبان', 'علبة', 1500, 2100, 0, 12],
    ];

    const DEMO_CUSTOMERS = [
      ['أحمد محمد', '0555123456'],
      ['سالم عبدالله', '0501122334'],
      ['محمد الحربي', '0556677889'],
      ['ناصر العتيبي', '0509988776'],
      ['خالد السبيعي', '0553344556'],
      ['مؤسسة الهدى التجارية', '0112233445'],
      ['شركة النور للتجارة', '0113344556'],
    ];

    /* ------------------------------------------------------------------ */

    /** ينشئ البيانات المرجعية التي لا يعمل التطبيق بدونها */
    async function ensureBaseData() {
      await tx(
        [STORES.expenseCategories, STORES.adjustmentReasons, STORES.categories],
        'readwrite',
        async (stores) => {
          const existingExpenseCats = await getAll(stores[STORES.expenseCategories]);
          if (existingExpenseCats.length === 0) {
            for (const category of DEFAULT_EXPENSE_CATEGORIES) {
              await add(stores[STORES.expenseCategories], {
                id: uid('ecat'), ...category, createdAt: toISO(),
              });
            }
          }

          const existingReasons = await getAll(stores[STORES.adjustmentReasons]);
          if (existingReasons.length === 0) {
            for (const reason of DEFAULT_REASONS) {
              await add(stores[STORES.adjustmentReasons], {
                id: uid('rsn'), ...reason, isActive: true, createdAt: toISO(),
              });
            }
          }

          const existingCategories = await getAll(stores[STORES.categories]);
          if (existingCategories.length === 0) {
            for (const category of PRODUCT_CATEGORIES) {
              await add(stores[STORES.categories], { id: uid('cat'), ...category, createdAt: toISO() });
            }
          }
        }
      );

      // اكتب الإعدادات الافتراضية الناقصة مرة واحدة فقط
      const current = await loadSettings({ force: true });
      const missing = {};
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (current[key] === undefined) missing[key] = value;
      }
      if (Object.keys(missing).length > 0) await saveSettings(missing);
    }

    /** هل القاعدة فارغة من بيانات العمل؟ */
    async function isEmptyDatabase() {
      return tx([STORES.products, STORES.sales], 'readonly', async (stores) => {
        const products = await getAll(stores[STORES.products], null, 1);
        const sales = await getAll(stores[STORES.sales], null, 1);
        return products.length === 0 && sales.length === 0;
      });
    }

    /**
     * بيانات تجريبية اختيارية. تُستدعى بطلب المستخدم فقط.
     * تنشئ منتجات وعملاء ومصروفات ومبيعات موزّعة على آخر 7 أيام.
     */
    async function seedDemoData() {
      const categories = await tx(STORES.categories, 'readonly', (stores) => getAll(stores[STORES.categories]));
      const categoryByName = new Map(categories.map((category) => [category.name, category]));

      const expenseCategories = await tx(STORES.expenseCategories, 'readonly', (stores) =>
        getAll(stores[STORES.expenseCategories]));

      const settings = await loadSettings();
      const stamp = toISO();

      /* ---------------------------- المنتجات ---------------------------- */
      const products = DEMO_PRODUCTS.map(([sku, name, categoryName, unit, costMinor, priceMinor, quantity, lowStockThreshold]) => ({
        id: uid('prd'),
        sku,
        barcode: undefined,
        name,
        nameLower: name.toLowerCase(),
        categoryId: categoryByName.get(categoryName)?.id || categories[0].id,
        unit,
        costMinor,
        priceMinor,
        taxRateBp: settings.defaultTaxRateBp,
        quantity,
        lowStockThreshold,
        description: '',
        image: null,
        isActive: true,
        createdAt: stamp,
        updatedAt: stamp,
      }));

      await tx([STORES.products, STORES.inventoryMovements], 'readwrite', async (stores) => {
        for (const product of products) {
          await add(stores[STORES.products], product);
          if (product.quantity > 0) {
            await add(stores[STORES.inventoryMovements], {
              id: uid('mov'),
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              type: MOVEMENT.INITIAL,
              quantity: product.quantity,
              balanceAfter: product.quantity,
              reason: 'رصيد افتتاحي',
              note: 'بيانات تجريبية',
              refType: 'seed',
              refId: 'seed',
              actor: 'النظام',
              createdAt: stamp,
              dayKey: dayKey(new Date()),
            });
          }
        }
      });

      /* ----------------------------- العملاء ----------------------------- */
      const customers = DEMO_CUSTOMERS.map(([name, phone]) => ({
        id: uid('cus'), name, phone, note: '', isActive: true, createdAt: stamp, updatedAt: stamp,
      }));

      await tx(STORES.customers, 'readwrite', async (stores) => {
        for (const customer of customers) await add(stores[STORES.customers], customer);
      });

      /* ---------------------------- المصروفات ---------------------------- */
      const expenseSamples = [
        ['إيجار', 'إيجار المحل', 240000, 'bank', 0],
        ['رواتب', 'رواتب الموظفين', 150000, 'bank', 0],
        ['مشتريات', 'شراء بضاعة متنوعة', 45025, 'cash', 1],
        ['نقل ومواصلات', 'مصاريف نقل وتوصيل', 12000, 'cash', 2],
        ['مصروفات إدارية', 'مصاريف متنوعة', 4890, 'cash', 3],
        ['كهرباء وماء', 'فاتورة الكهرباء', 32000, 'bank', 4],
      ];

      await tx(STORES.expenses, 'readwrite', async (stores) => {
        for (const [categoryName, title, amountMinor, method, daysAgo] of expenseSamples) {
          const date = addDays(new Date(), -daysAgo);
          const category = expenseCategories.find((c) => c.name === categoryName) || expenseCategories[0];
          await add(stores[STORES.expenses], {
            id: uid('exp'),
            dayKey: dayKey(date),
            categoryId: category.id,
            title,
            amountMinor,
            method,
            reference: '',
            note: '',
            attachment: null,
            createdAt: toISO(date),
            updatedAt: toISO(date),
          });
        }
      });

      /* ----------------------------- المبيعات ----------------------------- */
      // مبيعات موزّعة على آخر 7 أيام، تُخصم من المخزون بحركات حقيقية
      const stock = new Map(products.map((product) => [product.id, product.quantity]));
      let sequence = Number(settings.invoiceNextNumber) || 1;
      const salesCreated = [];

      for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
        const date = addDays(new Date(), -daysAgo);
        const invoiceCount = 2 + ((daysAgo * 3) % 4); // 2..5 فواتير في اليوم

        for (let n = 0; n < invoiceCount; n += 1) {
          const lineCount = 1 + ((daysAgo + n) % 3);
          const lines = [];

          for (let l = 0; l < lineCount; l += 1) {
            const product = products[(daysAgo * 5 + n * 3 + l * 7) % products.length];
            const available = stock.get(product.id) || 0;
            const quantity = Math.min(1 + ((n + l) % 3), available);
            if (quantity <= 0) continue;
            if (lines.some((line) => line.productId === product.id)) continue;
            stock.set(product.id, available - quantity);
            lines.push({ product, quantity });
          }
          if (lines.length === 0) continue;

          const isCredit = n % 4 === 3;
          const customer = isCredit ? customers[(daysAgo + n) % customers.length] : null;

          const subtotalMinor = lines.reduce((sum, line) => sum + line.product.priceMinor * line.quantity, 0);
          // الخصم لا يتجاوز المجموع الفرعي أبداً — وإلا نتج إجمالي سالب
          const discountMinor = n % 5 === 0 ? Math.min(1000, subtotalMinor) : 0;
          const net = subtotalMinor - discountMinor;
          const taxMinor = Math.round((net * settings.defaultTaxRateBp) / 10000);
          const totalMinor = net + taxMinor;
          const paidMinor = isCredit ? 0 : totalMinor;

          const saleId = uid('sal');
          const createdAt = toISO(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9 + n, 15 * (n % 4)));

          salesCreated.push({
            sale: {
              id: saleId,
              number: `${settings.invoicePrefix}-${date.getFullYear()}-${String(sequence).padStart(5, '0')}`,
              status: 'completed',
              paymentType: isCredit ? 'credit' : 'cash',
              customerId: customer?.id || null,
              customerName: customer?.name || 'عميل نقدي',
              subtotalMinor,
              discountType: 'amount',
              discountValue: discountMinor,
              discountMinor,
              taxRateBp: settings.defaultTaxRateBp,
              taxInclusive: false,
              taxMinor,
              totalMinor,
              paidMinor,
              dueMinor: totalMinor - paidMinor,
              itemCount: lines.length,
              unitCount: lines.reduce((sum, line) => sum + line.quantity, 0),
              costMinor: lines.reduce((sum, line) => sum + line.product.costMinor * line.quantity, 0),
              note: '',
              createdAt,
              updatedAt: createdAt,
              dayKey: dayKey(date),
              cancelledAt: null,
              cancelReason: null,
            },
            lines,
            createdAt,
          });
          sequence += 1;
        }
      }

      await tx(
        [STORES.sales, STORES.saleItems, STORES.products, STORES.inventoryMovements],
        'readwrite',
        async (stores) => {
          for (const { sale, lines, createdAt } of salesCreated) {
            await add(stores[STORES.sales], sale);

            for (const { product, quantity } of lines) {
              await add(stores[STORES.saleItems], {
                id: uid('sit'),
                saleId: sale.id,
                productId: product.id,
                sku: product.sku,
                name: product.name,
                unit: product.unit,
                quantity,
                unitPriceMinor: product.priceMinor,
                unitCostMinor: product.costMinor,
                lineDiscountMinor: 0,
                lineTotalMinor: product.priceMinor * quantity,
                dayKey: sale.dayKey,
                createdAt,
              });

              await add(stores[STORES.inventoryMovements], {
                id: uid('mov'),
                productId: product.id,
                sku: product.sku,
                productName: product.name,
                type: MOVEMENT.SALE,
                quantity: -quantity,
                balanceAfter: 0, // يُصحَّح بعد قليل من الرصيد النهائي
                reason: 'بيع',
                note: `فاتورة ${sale.number}`,
                refType: 'sale',
                refId: sale.id,
                actor: 'النظام',
                createdAt,
                dayKey: sale.dayKey,
              });
            }
          }

          // اضبط الكميات النهائية على ما تبقّى بعد كل المبيعات
          for (const product of products) {
            await put(stores[STORES.products], { ...product, quantity: stock.get(product.id) ?? product.quantity });
          }
        }
      );

      await saveSettings({ invoiceNextNumber: sequence, seeded: true });

      return {
        products: products.length,
        customers: customers.length,
        sales: salesCreated.length,
        expenses: expenseSamples.length,
      };
    }


    Object.defineProperty(__exports, "ensureBaseData", { enumerable: true, get: function () { return ensureBaseData; } });
    Object.defineProperty(__exports, "isEmptyDatabase", { enumerable: true, get: function () { return isEmptyDatabase; } });
    Object.defineProperty(__exports, "seedDemoData", { enumerable: true, get: function () { return seedDemoData; } });
  });

  /* ================================================================== */
  /* src/repositories/customers.js */
  __def("src/repositories/customers.js", function (__exports, __m, __dyn) {
    /**
     * مستودع العملاء والذمم.
     *
     * الرصيد **محسوب دائماً** من الفواتير الآجلة والمدفوعات، ولا يوجد حقل رصيد
     * محفوظ يمكن أن ينحرف عن الحركات.
     */

    const { tx, get, getAll, put, add, del, getAllByIndex, iterate } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, dayKey } = __m("src/utils/dates.js");
    const { returnsForSale } = __m("src/repositories/returns.js");

    /** عميل نقدي افتراضي — ليس سجلاً في قاعدة البيانات */
    const WALK_IN = Object.freeze({
      id: null,
      name: 'عميل نقدي',
      phone: '',
      isWalkIn: true,
    });

    const listCustomers = () =>
      tx(STORES.customers, 'readonly', (stores) => getAll(stores[STORES.customers]));

    const getCustomer = (id) =>
      tx(STORES.customers, 'readonly', (stores) => get(stores[STORES.customers], id));

    async function createCustomer(value) {
      const record = { id: uid('cus'), ...value, createdAt: toISO(), updatedAt: toISO() };
      await tx(STORES.customers, 'readwrite', (stores) => add(stores[STORES.customers], record));
      return record;
    }

    async function updateCustomer(id, patch) {
      return tx(STORES.customers, 'readwrite', async (stores) => {
        const store = stores[STORES.customers];
        const existing = await get(store, id);
        if (!existing) throw new Error('العميل غير موجود');
        const record = { ...existing, ...patch, id, updatedAt: toISO() };
        await put(store, record);
        return record;
      });
    }

    /** حذف عميل — يُمنع إن كان له فواتير أو مدفوعات (حماية السجل المالي) */
    async function deleteCustomer(id) {
      return tx([STORES.customers, STORES.sales, STORES.payments], 'readwrite', async (stores) => {
        const sales = await getAll(stores[STORES.sales].index('customerId'), id, 1);
        if (sales.length > 0) {
          throw new Error('لا يمكن حذف عميل له فواتير. يمكنك تعطيله بدل حذفه.');
        }
        const payments = await getAll(stores[STORES.payments].index('customerId'), id, 1);
        if (payments.length > 0) {
          throw new Error('لا يمكن حذف عميل له مدفوعات مسجّلة.');
        }
        await del(stores[STORES.customers], id);
        return true;
      });
    }

    /* ------------------------------ الذمم ------------------------------ */

    /**
     * يحسب ملخصاً مالياً لكل عميل في مسح واحد.
     * @returns {Promise<Map<string, {balanceMinor, purchasesMinor, invoiceCount, lastPurchaseAt, monthPurchasesMinor}>>}
     */
    async function customerLedgers() {
      const ledgers = new Map();
      const monthPrefix = dayKey(new Date()).slice(0, 7);

      const ensure = (id) => {
        if (!ledgers.has(id)) {
          ledgers.set(id, {
            balanceMinor: 0,
            purchasesMinor: 0,
            paidMinor: 0,
            invoiceCount: 0,
            monthPurchasesMinor: 0,
            lastPurchaseAt: null,
          });
        }
        return ledgers.get(id);
      };

      await tx([STORES.sales, STORES.payments, STORES.returns], 'readonly', async (stores) => {
        await iterate(stores[STORES.sales], null, (sale) => {
          if (!sale.customerId || sale.status === 'cancelled') return true;
          const ledger = ensure(sale.customerId);
          ledger.invoiceCount += 1;
          ledger.purchasesMinor += sale.totalMinor;
          ledger.balanceMinor += sale.dueMinor || 0;
          if (sale.dayKey?.startsWith(monthPrefix)) ledger.monthPurchasesMinor += sale.totalMinor;
          if (!ledger.lastPurchaseAt || sale.createdAt > ledger.lastPurchaseAt) {
            ledger.lastPurchaseAt = sale.createdAt;
          }
          return true;
        });

        await iterate(stores[STORES.payments], null, (payment) => {
          if (!payment.customerId) return true;
          const ledger = ensure(payment.customerId);
          ledger.balanceMinor -= payment.amountMinor;
          ledger.paidMinor += payment.amountMinor;
          return true;
        });
        await iterate(stores[STORES.returns], null, (returnRecord) => {
          if (!returnRecord.customerId || returnRecord.refundMethod !== 'credit') return true;
          const ledger = ensure(returnRecord.customerId);
          ledger.balanceMinor -= returnRecord.refundMinor;
          ledger.paidMinor += returnRecord.refundMinor;
          return true;
        });
      });

      return ledgers;
    }

    async function customerBalance(customerId) {
      const ledgers = await customerLedgers();
      return ledgers.get(customerId)?.balanceMinor ?? 0;
    }

    /** يسجّل دفعة من عميل */
    async function recordPayment({ customerId, amountMinor, method, reference, note, saleId = null }) {
      const stamp = new Date();
      const record = {
        id: uid('pay'),
        customerId,
        saleId,
        amountMinor,
        method: method || 'cash',
        reference: reference || '',
        note: note || '',
        createdAt: toISO(stamp),
        dayKey: dayKey(stamp),
      };

      await tx([STORES.customers, STORES.payments], 'readwrite', async (stores) => {
        const customer = await get(stores[STORES.customers], customerId);
        if (!customer) throw new Error('العميل غير موجود');
        await add(stores[STORES.payments], record);
      });

      return record;
    }

    const paymentsForCustomer = (customerId) =>
      tx(STORES.payments, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.payments], 'customerId', customerId)
      ).then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    const paymentsInRange = (fromKey, toKey) =>
      tx(STORES.payments, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.payments], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
      );

    /**
     * كشف حساب: الفواتير والمدفوعات مرتبة زمنياً مع رصيد تراكمي.
     */
    async function customerStatement(customerId) {
      const [sales, payments] = await Promise.all([
        tx(STORES.sales, 'readonly', (stores) => getAllByIndex(stores[STORES.sales], 'customerId', customerId)),
        paymentsForCustomer(customerId),
      ]);
      const returns = (await Promise.all(sales.map((sale) => returnsForSale(sale.id)))).flat()
        .filter((returnRecord) => returnRecord.customerId === customerId && returnRecord.refundMethod === 'credit');

      const entries = [
        ...sales
          .filter((sale) => sale.status !== 'cancelled')
          .map((sale) => ({
            at: sale.createdAt,
            kind: 'invoice',
            label: sale.number,
            debitMinor: sale.dueMinor || 0,
            creditMinor: 0,
            totalMinor: sale.totalMinor,
            ref: sale.id,
          })),
        ...payments.map((payment) => ({
          at: payment.createdAt,
          kind: 'payment',
          label: payment.reference || 'دفعة',
          debitMinor: 0,
          creditMinor: payment.amountMinor,
          ref: payment.id,
        })),
        ...returns.map((returnRecord) => ({
          at: returnRecord.createdAt,
          kind: 'return',
          label: `مرتجع ${returnRecord.saleNumber}`,
          debitMinor: 0,
          creditMinor: returnRecord.refundMinor,
          ref: returnRecord.id,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at));

      let running = 0;
      for (const entry of entries) {
        running += entry.debitMinor - entry.creditMinor;
        entry.balanceMinor = running;
      }

      return { entries, balanceMinor: running };
    }


    Object.defineProperty(__exports, "WALK_IN", { enumerable: true, get: function () { return WALK_IN; } });
    Object.defineProperty(__exports, "listCustomers", { enumerable: true, get: function () { return listCustomers; } });
    Object.defineProperty(__exports, "getCustomer", { enumerable: true, get: function () { return getCustomer; } });
    Object.defineProperty(__exports, "createCustomer", { enumerable: true, get: function () { return createCustomer; } });
    Object.defineProperty(__exports, "updateCustomer", { enumerable: true, get: function () { return updateCustomer; } });
    Object.defineProperty(__exports, "deleteCustomer", { enumerable: true, get: function () { return deleteCustomer; } });
    Object.defineProperty(__exports, "customerLedgers", { enumerable: true, get: function () { return customerLedgers; } });
    Object.defineProperty(__exports, "customerBalance", { enumerable: true, get: function () { return customerBalance; } });
    Object.defineProperty(__exports, "recordPayment", { enumerable: true, get: function () { return recordPayment; } });
    Object.defineProperty(__exports, "paymentsForCustomer", { enumerable: true, get: function () { return paymentsForCustomer; } });
    Object.defineProperty(__exports, "paymentsInRange", { enumerable: true, get: function () { return paymentsInRange; } });
    Object.defineProperty(__exports, "customerStatement", { enumerable: true, get: function () { return customerStatement; } });
  });

  /* ================================================================== */
  /* src/repositories/expenses.js */
  __def("src/repositories/expenses.js", function (__exports, __m, __dyn) {
    /** مستودع المصروفات وفئاتها. */

    const { tx, get, getAll, put, add, del, getAllByIndex } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO } = __m("src/utils/dates.js");

    const PAYMENT_METHODS = [
      { value: 'cash', label: 'نقدي' },
      { value: 'bank', label: 'تحويل بنكي' },
      { value: 'card', label: 'بطاقة' },
      { value: 'cheque', label: 'شيك' },
      { value: 'wallet', label: 'محفظة إلكترونية' },
      { value: 'credit', label: 'آجل' },
    ];

    const methodLabel = (value) =>
      PAYMENT_METHODS.find((m) => m.value === value)?.label || value || '—';

    const DEFAULT_EXPENSE_CATEGORIES = [
      { name: 'إيجار', color: '#7C5CE0' },
      { name: 'رواتب', color: '#12855A' },
      { name: 'مشتريات', color: '#1B63E3' },
      { name: 'نقل ومواصلات', color: '#D97706' },
      { name: 'مصروفات إدارية', color: '#0E9C8A' },
      { name: 'كهرباء وماء', color: '#0EA5E9' },
      { name: 'صيانة', color: '#EC4899' },
      { name: 'أخرى', color: '#94A3B8' },
    ];

    const listExpenses = (limit = 1000) =>
      tx(STORES.expenses, 'readonly', (stores) => getAll(stores[STORES.expenses]))
        .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));

    const expensesInRange = (fromKey, toKey) =>
      tx(STORES.expenses, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.expenses], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
      );

    const getExpense = (id) =>
      tx(STORES.expenses, 'readonly', (stores) => get(stores[STORES.expenses], id));

    async function createExpense(value) {
      const record = { id: uid('exp'), ...value, createdAt: toISO(), updatedAt: toISO() };
      await tx(STORES.expenses, 'readwrite', (stores) => add(stores[STORES.expenses], record));
      return record;
    }

    async function updateExpense(id, patch) {
      return tx(STORES.expenses, 'readwrite', async (stores) => {
        const store = stores[STORES.expenses];
        const existing = await get(store, id);
        if (!existing) throw new Error('المصروف غير موجود');
        const record = { ...existing, ...patch, id, updatedAt: toISO() };
        await put(store, record);
        return record;
      });
    }

    const deleteExpense = (id) =>
      tx(STORES.expenses, 'readwrite', (stores) => del(stores[STORES.expenses], id));

    /* ------------------------------ الفئات ------------------------------ */

    const listExpenseCategories = () =>
      tx(STORES.expenseCategories, 'readonly', (stores) => getAll(stores[STORES.expenseCategories]));

    async function createExpenseCategory({ name, color = '#94A3B8' }) {
      const record = { id: uid('ecat'), name, color, createdAt: toISO() };
      try {
        await tx(STORES.expenseCategories, 'readwrite', (stores) => add(stores[STORES.expenseCategories], record));
      } catch (error) {
        if (error?.name === 'ConstraintError') throw new Error(`الفئة "${name}" موجودة بالفعل`);
        throw error;
      }
      return record;
    }

    async function deleteExpenseCategory(id) {
      return tx([STORES.expenseCategories, STORES.expenses], 'readwrite', async (stores) => {
        const used = await getAll(stores[STORES.expenses].index('categoryId'), id, 1);
        if (used.length > 0) throw new Error('لا يمكن حذف فئة مرتبطة بمصروفات');
        await del(stores[STORES.expenseCategories], id);
        return true;
      });
    }

    async function expenseCategoryMap() {
      const rows = await listExpenseCategories();
      return new Map(rows.map((row) => [row.id, row]));
    }


    Object.defineProperty(__exports, "PAYMENT_METHODS", { enumerable: true, get: function () { return PAYMENT_METHODS; } });
    Object.defineProperty(__exports, "methodLabel", { enumerable: true, get: function () { return methodLabel; } });
    Object.defineProperty(__exports, "DEFAULT_EXPENSE_CATEGORIES", { enumerable: true, get: function () { return DEFAULT_EXPENSE_CATEGORIES; } });
    Object.defineProperty(__exports, "listExpenses", { enumerable: true, get: function () { return listExpenses; } });
    Object.defineProperty(__exports, "expensesInRange", { enumerable: true, get: function () { return expensesInRange; } });
    Object.defineProperty(__exports, "getExpense", { enumerable: true, get: function () { return getExpense; } });
    Object.defineProperty(__exports, "createExpense", { enumerable: true, get: function () { return createExpense; } });
    Object.defineProperty(__exports, "updateExpense", { enumerable: true, get: function () { return updateExpense; } });
    Object.defineProperty(__exports, "deleteExpense", { enumerable: true, get: function () { return deleteExpense; } });
    Object.defineProperty(__exports, "listExpenseCategories", { enumerable: true, get: function () { return listExpenseCategories; } });
    Object.defineProperty(__exports, "createExpenseCategory", { enumerable: true, get: function () { return createExpenseCategory; } });
    Object.defineProperty(__exports, "deleteExpenseCategory", { enumerable: true, get: function () { return deleteExpenseCategory; } });
    Object.defineProperty(__exports, "expenseCategoryMap", { enumerable: true, get: function () { return expenseCategoryMap; } });
  });

  /* ================================================================== */
  /* src/repositories/inventory.js */
  __def("src/repositories/inventory.js", function (__exports, __m, __dyn) {
    /**
     * مستودع حركات المخزون.
     *
     * قاعدة ثابتة: كمية المنتج لا تتغير أبداً إلا عبر `applyMovement`، ومعها
     * سجل حركة في نفس المعاملة. لا يوجد مسار آخر يكتب `product.quantity`.
     */

    const { tx, get, getAll, put, add, getAllByIndex, iterate } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, dayKey, monotonicISO } = __m("src/utils/dates.js");

    const MOVEMENT = {
      IN: 'in',
      OUT: 'out',
      SALE: 'sale',
      CANCEL: 'cancel',
      COUNT: 'count',
      DAMAGE: 'damage',
      RETURN: 'return',
      INITIAL: 'initial',
    };

    const MOVEMENT_LABEL = {
      [MOVEMENT.IN]: 'إضافة',
      [MOVEMENT.OUT]: 'سحب',
      [MOVEMENT.SALE]: 'بيع',
      [MOVEMENT.CANCEL]: 'إلغاء فاتورة',
      [MOVEMENT.COUNT]: 'جرد',
      [MOVEMENT.DAMAGE]: 'تلف',
      [MOVEMENT.RETURN]: 'مرتجع',
      [MOVEMENT.INITIAL]: 'رصيد افتتاحي',
    };

    const DEFAULT_REASONS = [
      { name: 'جرد', system: true },
      { name: 'تلف', system: true },
      { name: 'مرتجع من عميل', system: true },
      { name: 'مرتجع إلى مورد', system: true },
      { name: 'شراء جديد', system: true },
      { name: 'خطأ إدخال', system: true },
      { name: 'فقد أو سرقة', system: true },
      { name: 'هدية أو عينة', system: true },
    ];

    /**
     * يطبّق حركة مخزون **داخل معاملة قائمة**.
     * يجب أن تشمل المعاملة متجري products و inventoryMovements.
     *
     * @param {Record<string, IDBObjectStore>} stores
     * @param {object} movement
     * @param {string} movement.productId
     * @param {number} movement.delta التغيير الموقّع (+ إضافة / − سحب)
     * @param {string} movement.type
     * @param {string} [movement.reason]
     * @param {string} [movement.note]
     * @param {string} [movement.refType] 'sale' | 'adjustment' | 'import' | ...
     * @param {string} [movement.refId]
     * @param {boolean} [movement.allowNegative]
     * @returns {Promise<{movement:object, product:object}>}
     * @throws إذا كان المنتج غير موجود أو الرصيد سيصبح سالباً بلا إذن
     */
    async function applyMovement(stores, {
      productId, delta, type, reason = '', note = '', refType = '', refId = '',
      allowNegative = false, actor = 'المستخدم',
    }) {
      const productStore = stores[STORES.products];
      const movementStore = stores[STORES.inventoryMovements];

      const product = await get(productStore, productId);
      if (!product) throw new Error(`المنتج غير موجود (${productId})`);

      if (!Number.isInteger(delta)) throw new Error('كمية الحركة يجب أن تكون عدداً صحيحاً');

      const balanceAfter = (product.quantity || 0) + delta;
      if (balanceAfter < 0 && !allowNegative) {
        throw new Error(`الكمية المتاحة من "${product.name}" غير كافية (المتاح ${product.quantity})`);
      }

      const stamp = new Date();
      // طابع متزايد تماماً: حركات متتالية في نفس الميلي ثانية يجب أن تبقى مرتَّبة
      const createdAt = monotonicISO(stamp);
      const record = {
        id: uid('mov'),
        productId,
        sku: product.sku,
        productName: product.name,
        type,
        quantity: delta,
        balanceAfter,
        reason,
        note,
        refType,
        refId,
        actor,
        createdAt,
        dayKey: dayKey(stamp),
      };

      await put(productStore, { ...product, quantity: balanceAfter, updatedAt: createdAt });
      await add(movementStore, record);

      return { movement: record, product: { ...product, quantity: balanceAfter } };
    }

    /** تسوية مخزون يدوية بسبب إلزامي — معاملة مستقلة */
    async function recordAdjustment({ productId, quantity, reason, note, allowNegative = false }) {
      return tx([STORES.products, STORES.inventoryMovements], 'readwrite', (stores) =>
        applyMovement(stores, {
          productId,
          delta: quantity,
          type: quantity >= 0 ? MOVEMENT.IN : MOVEMENT.OUT,
          reason,
          note,
          refType: 'adjustment',
          refId: uid('adj'),
          allowNegative,
        })
      );
    }

    /**
     * جرد: يضبط الكمية على القيمة الفعلية المعدودة ويسجّل الفرق كحركة واحدة.
     * لا يفعل شيئاً إذا كان الفرق صفراً.
     */
    async function recordStocktake({ productId, countedQuantity, note = '' }) {
      return tx([STORES.products, STORES.inventoryMovements], 'readwrite', async (stores) => {
        const product = await get(stores[STORES.products], productId);
        if (!product) throw new Error('المنتج غير موجود');

        const delta = countedQuantity - (product.quantity || 0);
        if (delta === 0) return { movement: null, product, delta: 0 };

        const result = await applyMovement(stores, {
          productId,
          delta,
          type: MOVEMENT.COUNT,
          reason: 'جرد',
          note: note || `الكمية المعدودة ${countedQuantity} مقابل المسجّلة ${product.quantity}`,
          refType: 'stocktake',
          refId: uid('stk'),
          allowNegative: true, // نتيجة العدّ هي الحقيقة
        });
        return { ...result, delta };
      });
    }

    /* ------------------------------- قراءة ------------------------------- */

    const listMovements = (limit = 200) =>
      tx(STORES.inventoryMovements, 'readonly', async (stores) => {
        const items = [];
        await iterate(stores[STORES.inventoryMovements].index('createdAt'), null, (movement) => {
          items.push(movement);
          return items.length < limit;
        }, 'prev');
        return items;
      });

    const movementsForProduct = (productId, limit = 100) =>
      tx(STORES.inventoryMovements, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.inventoryMovements], 'productId', productId, limit)
      ).then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    const movementsInRange = (fromKey, toKey) =>
      tx(STORES.inventoryMovements, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.inventoryMovements], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
      );

    /** آخر حركة لكل منتج — لعمود «آخر حركة» في شاشة المخزون */
    async function lastMovementByProduct() {
      const map = new Map();
      await tx(STORES.inventoryMovements, 'readonly', (stores) =>
        iterate(stores[STORES.inventoryMovements].index('createdAt'), null, (movement) => {
          if (!map.has(movement.productId)) map.set(movement.productId, movement);
          return true;
        }, 'prev')
      );
      return map;
    }

    /* --------------------------- أسباب التسوية --------------------------- */

    const listReasons = () =>
      tx(STORES.adjustmentReasons, 'readonly', (stores) => getAll(stores[STORES.adjustmentReasons]))
        .then((rows) => rows.filter((r) => r.isActive !== false));

    async function createReason(name) {
      const record = { id: uid('rsn'), name, isActive: true, system: false, createdAt: toISO() };
      try {
        await tx(STORES.adjustmentReasons, 'readwrite', (stores) => add(stores[STORES.adjustmentReasons], record));
      } catch (error) {
        if (error?.name === 'ConstraintError') throw new Error(`السبب "${name}" موجود بالفعل`);
        throw error;
      }
      return record;
    }

    /**
     * تعطيل سبب. لا يُحذف أبداً إن كان مستخدماً في حركة (نمط Zoho)،
     * لأن حذفه يفسد قابلية قراءة السجل التاريخي.
     */
    async function deactivateReason(id) {
      return tx([STORES.adjustmentReasons, STORES.inventoryMovements], 'readwrite', async (stores) => {
        const store = stores[STORES.adjustmentReasons];
        const reason = await get(store, id);
        if (!reason) throw new Error('السبب غير موجود');
        await put(store, { ...reason, isActive: false });
        return true;
      });
    }


    Object.defineProperty(__exports, "MOVEMENT", { enumerable: true, get: function () { return MOVEMENT; } });
    Object.defineProperty(__exports, "MOVEMENT_LABEL", { enumerable: true, get: function () { return MOVEMENT_LABEL; } });
    Object.defineProperty(__exports, "DEFAULT_REASONS", { enumerable: true, get: function () { return DEFAULT_REASONS; } });
    Object.defineProperty(__exports, "applyMovement", { enumerable: true, get: function () { return applyMovement; } });
    Object.defineProperty(__exports, "recordAdjustment", { enumerable: true, get: function () { return recordAdjustment; } });
    Object.defineProperty(__exports, "recordStocktake", { enumerable: true, get: function () { return recordStocktake; } });
    Object.defineProperty(__exports, "listMovements", { enumerable: true, get: function () { return listMovements; } });
    Object.defineProperty(__exports, "movementsForProduct", { enumerable: true, get: function () { return movementsForProduct; } });
    Object.defineProperty(__exports, "movementsInRange", { enumerable: true, get: function () { return movementsInRange; } });
    Object.defineProperty(__exports, "lastMovementByProduct", { enumerable: true, get: function () { return lastMovementByProduct; } });
    Object.defineProperty(__exports, "listReasons", { enumerable: true, get: function () { return listReasons; } });
    Object.defineProperty(__exports, "createReason", { enumerable: true, get: function () { return createReason; } });
    Object.defineProperty(__exports, "deactivateReason", { enumerable: true, get: function () { return deactivateReason; } });
  });

  /* ================================================================== */
  /* src/repositories/products.js */
  __def("src/repositories/products.js", function (__exports, __m, __dyn) {
    /** مستودع المنتجات والفئات. */

    const { tx, get, getAll, put, add, del, getByIndex, iterate } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO } = __m("src/utils/dates.js");

    const STOCK_STATUS = { OUT: 'out', LOW: 'low', OK: 'ok' };

    function stockStatus(product) {
      if (!product) return STOCK_STATUS.OUT;
      if (product.quantity <= 0) return STOCK_STATUS.OUT;
      if (product.quantity <= (product.reorderPoint ?? product.minimumStock ?? product.lowStockThreshold ?? 0)) return STOCK_STATUS.LOW;
      return STOCK_STATUS.OK;
    }

    const STOCK_LABEL = {
      [STOCK_STATUS.OUT]: 'نفد المخزون',
      [STOCK_STATUS.LOW]: 'يحتاج إلى إعادة طلب',
      [STOCK_STATUS.OK]: 'متوفر',
    };

    const STOCK_TONE = {
      [STOCK_STATUS.OUT]: 'red',
      [STOCK_STATUS.LOW]: 'amber',
      [STOCK_STATUS.OK]: 'green',
    };

    /* ------------------------------- قراءة ------------------------------- */

    const listProducts = () =>
      tx(STORES.products, 'readonly', (stores) => getAll(stores[STORES.products]));

    const getProduct = (id) =>
      tx(STORES.products, 'readonly', (stores) => get(stores[STORES.products], id));

    const findBySku = (sku) =>
      tx(STORES.products, 'readonly', (stores) => getByIndex(stores[STORES.products], 'sku', sku));

    const findByBarcode = (barcode) =>
      tx(STORES.products, 'readonly', (stores) => getByIndex(stores[STORES.products], 'barcode', barcode));

    /** بحث سريع بالاسم أو SKU أو الباركود — مطابقة دقيقة للباركود أولاً */
    async function searchProducts(term, { limit = 50, activeOnly = true } = {}) {
      const query = String(term || '').trim().toLowerCase();
      if (!query) return [];

      return tx(STORES.products, 'readonly', async (stores) => {
        const store = stores[STORES.products];

        const exact = await getByIndex(store, 'barcode', query.toUpperCase())
          || await getByIndex(store, 'sku', query.toUpperCase());
        if (exact) return [exact];

        const results = [];
        await iterate(store, null, (product) => {
          if (activeOnly && product.isActive === false) return true;
          const haystack = `${product.nameLower || ''} ${product.sku || ''} ${product.barcode || ''}`.toLowerCase();
          if (haystack.includes(query)) results.push(product);
          return results.length < limit;
        });
        return results;
      });
    }

    async function productsToReorder() {
      const products = await listProducts();
      return products.filter((p) => p.isActive !== false).map((product) => {
        const minimumStock = product.minimumStock ?? product.lowStockThreshold ?? 0;
        const reorderPoint = product.reorderPoint ?? product.lowStockThreshold ?? minimumStock;
        const threshold = Math.max(minimumStock, reorderPoint);
        const maximumStock = product.maximumStock ?? 0;
        const targetStock = maximumStock > threshold ? maximumStock : threshold;
        return { ...product, minimumStock, reorderPoint, targetStock, suggestedPurchase: Math.max(1, targetStock - (product.quantity || 0)) };
      }).filter((product) => product.quantity <= product.reorderPoint)
        .sort((a, b) => (a.quantity - a.reorderPoint) - (b.quantity - b.reorderPoint));
    }

    async function lowStockProducts(limit = 100) {
      const products = await listProducts();
      return products
        .filter((p) => p.isActive !== false && stockStatus(p) !== STOCK_STATUS.OK)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, limit);
    }

    /* ------------------------------- كتابة ------------------------------- */

    /**
     * ينشئ منتجاً. يفشل إن كان SKU أو الباركود مكرراً (فهرس فريد على مستوى القاعدة).
     * @throws {Error} برسالة عربية مفهومة عند التكرار
     */
    async function createProduct(value) {
      const record = {
        id: uid('prd'),
        ...value,
        createdAt: toISO(),
        updatedAt: toISO(),
      };

      try {
        await tx(STORES.products, 'readwrite', (stores) => add(stores[STORES.products], record));
      } catch (error) {
        throw translateConstraintError(error, record);
      }
      return record;
    }

    async function updateProduct(id, patch) {
      let updated;
      try {
        updated = await tx(STORES.products, 'readwrite', async (stores) => {
          const store = stores[STORES.products];
          const existing = await get(store, id);
          if (!existing) throw new Error('المنتج غير موجود');

          const record = { ...existing, ...patch, id, updatedAt: toISO() };
          // الكمية تتغير عبر حركات المخزون فقط، لا عبر تعديل المنتج مباشرة
          record.quantity = existing.quantity;
          await put(store, record);
          return record;
        });
      } catch (error) {
        throw translateConstraintError(error, patch);
      }
      return updated;
    }

    /** حذف منتج — يُمنع إن كان مستخدماً في أي فاتورة (حماية التقارير التاريخية) */
    async function deleteProduct(id) {
      return tx([STORES.products, STORES.saleItems], 'readwrite', async (stores) => {
        const used = await getAll(stores[STORES.saleItems].index('productId'), id, 1);
        if (used.length > 0) {
          throw new Error('لا يمكن حذف منتج مرتبط بفواتير. يمكنك تعطيله بدل حذفه.');
        }
        await del(stores[STORES.products], id);
        return true;
      });
    }

    async function setProductActive(id, isActive) {
      return tx(STORES.products, 'readwrite', async (stores) => {
        const store = stores[STORES.products];
        const existing = await get(store, id);
        if (!existing) throw new Error('المنتج غير موجود');
        const record = { ...existing, isActive: Boolean(isActive), updatedAt: toISO() };
        await put(store, record);
        return record;
      });
    }

    function translateConstraintError(error, record) {
      if (error?.name === 'ConstraintError') {
        const message = record?.barcode
          ? `رمز SKU "${record.sku}" أو الباركود "${record.barcode}" مستخدم بالفعل`
          : `رمز SKU "${record?.sku ?? ''}" مستخدم بالفعل`;
        const wrapped = new Error(message);
        wrapped.name = 'ConstraintError';
        wrapped.cause = error;
        return wrapped;
      }
      return error;
    }

    /* ------------------------------ الفئات ------------------------------ */

    const listCategories = () =>
      tx(STORES.categories, 'readonly', (stores) => getAll(stores[STORES.categories]))
        .then((rows) => rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));

    async function createCategory({ name, color = '#0E9C8A', icon = 'tag', sortOrder = 0 }) {
      const record = { id: uid('cat'), name, color, icon, sortOrder, createdAt: toISO() };
      try {
        await tx(STORES.categories, 'readwrite', (stores) => add(stores[STORES.categories], record));
      } catch (error) {
        if (error?.name === 'ConstraintError') throw new Error(`الفئة "${name}" موجودة بالفعل`);
        throw error;
      }
      return record;
    }

    async function updateCategory(id, patch) {
      return tx(STORES.categories, 'readwrite', async (stores) => {
        const store = stores[STORES.categories];
        const existing = await get(store, id);
        if (!existing) throw new Error('الفئة غير موجودة');
        const record = { ...existing, ...patch, id };
        await put(store, record);
        return record;
      });
    }

    /** حذف فئة — يُمنع إن كانت مستخدمة */
    async function deleteCategory(id) {
      return tx([STORES.categories, STORES.products], 'readwrite', async (stores) => {
        const used = await getAll(stores[STORES.products].index('categoryId'), id, 1);
        if (used.length > 0) throw new Error('لا يمكن حذف فئة مرتبطة بمنتجات');
        await del(stores[STORES.categories], id);
        return true;
      });
    }

    /** خريطة id → فئة لتفادي استعلام لكل صف */
    async function categoryMap() {
      const categories = await listCategories();
      return new Map(categories.map((c) => [c.id, c]));
    }


    Object.defineProperty(__exports, "STOCK_STATUS", { enumerable: true, get: function () { return STOCK_STATUS; } });
    Object.defineProperty(__exports, "stockStatus", { enumerable: true, get: function () { return stockStatus; } });
    Object.defineProperty(__exports, "STOCK_LABEL", { enumerable: true, get: function () { return STOCK_LABEL; } });
    Object.defineProperty(__exports, "STOCK_TONE", { enumerable: true, get: function () { return STOCK_TONE; } });
    Object.defineProperty(__exports, "listProducts", { enumerable: true, get: function () { return listProducts; } });
    Object.defineProperty(__exports, "getProduct", { enumerable: true, get: function () { return getProduct; } });
    Object.defineProperty(__exports, "findBySku", { enumerable: true, get: function () { return findBySku; } });
    Object.defineProperty(__exports, "findByBarcode", { enumerable: true, get: function () { return findByBarcode; } });
    Object.defineProperty(__exports, "searchProducts", { enumerable: true, get: function () { return searchProducts; } });
    Object.defineProperty(__exports, "productsToReorder", { enumerable: true, get: function () { return productsToReorder; } });
    Object.defineProperty(__exports, "lowStockProducts", { enumerable: true, get: function () { return lowStockProducts; } });
    Object.defineProperty(__exports, "createProduct", { enumerable: true, get: function () { return createProduct; } });
    Object.defineProperty(__exports, "updateProduct", { enumerable: true, get: function () { return updateProduct; } });
    Object.defineProperty(__exports, "deleteProduct", { enumerable: true, get: function () { return deleteProduct; } });
    Object.defineProperty(__exports, "setProductActive", { enumerable: true, get: function () { return setProductActive; } });
    Object.defineProperty(__exports, "listCategories", { enumerable: true, get: function () { return listCategories; } });
    Object.defineProperty(__exports, "createCategory", { enumerable: true, get: function () { return createCategory; } });
    Object.defineProperty(__exports, "updateCategory", { enumerable: true, get: function () { return updateCategory; } });
    Object.defineProperty(__exports, "deleteCategory", { enumerable: true, get: function () { return deleteCategory; } });
    Object.defineProperty(__exports, "categoryMap", { enumerable: true, get: function () { return categoryMap; } });
  });

  /* ================================================================== */
  /* src/repositories/purchasing.js */
  __def("src/repositories/purchasing.js", function (__exports, __m, __dyn) {
    /** دورة الموردين وأوامر الشراء والاستلام والذمم. */
    const { tx, get, getAll, add, put, getAllByIndex } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, dayKey } = __m("src/utils/dates.js");
    const { applyMovement, MOVEMENT } = __m("src/repositories/inventory.js");

    const listSuppliers = () => tx(STORES.suppliers,'readonly',s=>getAll(s[STORES.suppliers]));
    async function saveSupplier(value){const stamp=toISO();const rec={id:value.id||uid('sup'),name:value.name.trim(),phone:value.phone||'',email:value.email||'',address:value.address||'',note:value.note||'',createdAt:value.createdAt||stamp,updatedAt:stamp};await tx(STORES.suppliers,'readwrite',s=>put(s[STORES.suppliers],rec));return rec;}
    async function supplierLedger(){const map=new Map();await tx([STORES.purchases,STORES.purchasePayments], 'readonly', async s=>{for(const p of await getAll(s[STORES.purchases])){if(p.status!=='received')continue;let x=map.get(p.supplierId)||{balanceMinor:0,purchasesMinor:0,lastPurchaseAt:null};x.purchasesMinor+=p.totalMinor;x.balanceMinor+=p.totalMinor;if(!x.lastPurchaseAt||p.createdAt>x.lastPurchaseAt)x.lastPurchaseAt=p.createdAt;map.set(p.supplierId,x)}for(const p of await getAll(s[STORES.purchasePayments])){let x=map.get(p.supplierId)||{balanceMinor:0,purchasesMinor:0,lastPurchaseAt:null};x.balanceMinor-=p.amountMinor;map.set(p.supplierId,x)}});return map;}
    const listOrders=()=>tx(STORES.purchaseOrders,'readonly',s=>getAll(s[STORES.purchaseOrders])).then(a=>a.sort((x,y)=>y.createdAt.localeCompare(x.createdAt)));
    async function createOrder({supplierId,invoiceNumber='',lines,note=''}){if(!supplierId||!lines.length)throw new Error('اختر المورد وأضف صنفاً واحداً على الأقل');if(lines.some(x=>!Number.isInteger(x.quantity)||x.quantity<=0||!Number.isInteger(x.unitCostMinor)||x.unitCostMinor<0))throw new Error('تحقق من كمية الصنف وسعر شرائه');const rec={id:uid('po'),number:'PO-'+Date.now().toString().slice(-8),supplierId,invoiceNumber,lines:lines.map(x=>({...x})),note,status:'ordered',createdAt:toISO(),dayKey:dayKey(new Date())};await tx(STORES.purchaseOrders,'readwrite',s=>add(s[STORES.purchaseOrders],rec));return rec;}
    async function receiveOrder(orderId,{paidMinor=0,taxRateBp=0,discountMinor=0}={}){if(!Number.isInteger(taxRateBp)||taxRateBp<0||taxRateBp>10000)throw new Error('نسبة الضريبة غير صالحة');if(!Number.isInteger(paidMinor)||!Number.isInteger(discountMinor))throw new Error('قيمة الدفع أو الخصم غير صالحة');return tx([STORES.purchaseOrders,STORES.purchases,STORES.purchaseItems,STORES.purchasePayments,STORES.products,STORES.inventoryMovements],'readwrite',async s=>{const order=await get(s[STORES.purchaseOrders],orderId);if(!order||order.status!=='ordered')throw new Error('أمر الشراء غير موجود أو تم استلامه');let subtotal=0;for(const l of order.lines)subtotal+=l.quantity*l.unitCostMinor;discountMinor=Math.min(Math.max(0,discountMinor),subtotal);const taxable=subtotal-discountMinor,taxMinor=Math.round(taxable*taxRateBp/10000),totalMinor=taxable+taxMinor;paidMinor=Math.min(Math.max(0,paidMinor),totalMinor);const stamp=toISO(),id=uid('pur');const purchase={id,number:'PUR-'+Date.now().toString().slice(-8),supplierId:order.supplierId,supplierInvoiceNumber:order.invoiceNumber,orderId:order.id,subtotalMinor:subtotal,discountMinor,taxRateBp,taxMinor,totalMinor,paidMinor,dueMinor:totalMinor-paidMinor,status:'received',createdAt:stamp,dayKey:dayKey(new Date()),note:order.note};await add(s[STORES.purchases],purchase);for(const l of order.lines){const prod=await get(s[STORES.products],l.productId);if(!prod)throw new Error('أحد المنتجات غير موجود');await add(s[STORES.purchaseItems],{id:uid('pitem'),purchaseId:id,productId:l.productId,sku:prod.sku,name:prod.name,quantity:l.quantity,unitCostMinor:l.unitCostMinor,lineTotalMinor:l.quantity*l.unitCostMinor});await put(s[STORES.products],{...prod,costMinor:l.unitCostMinor,updatedAt:stamp});await applyMovement(s,{productId:l.productId,delta:l.quantity,type:MOVEMENT.IN,reason:'شراء جديد',note:'استلام '+purchase.number,refType:'purchase',refId:id});}if(paidMinor)await add(s[STORES.purchasePayments],{id:uid('ppay'),supplierId:order.supplierId,purchaseId:id,amountMinor:paidMinor,method:'cash',reference:purchase.number,note:'دفعة عند الاستلام',createdAt:stamp,dayKey:purchase.dayKey});order.status='received';order.purchaseId=id;order.receivedAt=stamp;await put(s[STORES.purchaseOrders],order);return purchase;});}
    async function paySupplier({supplierId,purchaseId=null,amountMinor,method='cash',reference='',note=''}){if(!Number.isInteger(amountMinor)||amountMinor<=0)throw new Error('أدخل مبلغاً صحيحاً');const rec={id:uid('ppay'),supplierId,purchaseId,amountMinor,method,reference,note,createdAt:toISO(),dayKey:dayKey(new Date())};await tx([STORES.suppliers,STORES.purchasePayments],'readwrite',async s=>{if(!await get(s[STORES.suppliers],supplierId))throw new Error('المورد غير موجود');await add(s[STORES.purchasePayments],rec)});return rec;}


    Object.defineProperty(__exports, "listSuppliers", { enumerable: true, get: function () { return listSuppliers; } });
    Object.defineProperty(__exports, "saveSupplier", { enumerable: true, get: function () { return saveSupplier; } });
    Object.defineProperty(__exports, "supplierLedger", { enumerable: true, get: function () { return supplierLedger; } });
    Object.defineProperty(__exports, "listOrders", { enumerable: true, get: function () { return listOrders; } });
    Object.defineProperty(__exports, "createOrder", { enumerable: true, get: function () { return createOrder; } });
    Object.defineProperty(__exports, "receiveOrder", { enumerable: true, get: function () { return receiveOrder; } });
    Object.defineProperty(__exports, "paySupplier", { enumerable: true, get: function () { return paySupplier; } });
  });

  /* ================================================================== */
  /* src/repositories/returns.js */
  __def("src/repositories/returns.js", function (__exports, __m, __dyn) {
    /** مرتجعات المبيعات: عملية مستقلة تحفظ أثرها المالي والمخزني. */
    const { tx, get, getAll, add, getAllByIndex } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, dayKey } = __m("src/utils/dates.js");
    const { roundHalfUp } = __m("src/utils/money.js");
    const { applyMovement, MOVEMENT } = __m("src/repositories/inventory.js");
    const { SALE_STATUS } = __m("src/repositories/sales.js");

    const REFUND_METHOD_LABEL = {
      cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك', wallet: 'محفظة إلكترونية', credit: 'تخفيض ذمة العميل',
    };

    async function returnsForSale(saleId) {
      return tx(STORES.returns, 'readonly', (stores) => getAllByIndex(stores[STORES.returns], 'saleId', saleId))
        .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }

    const returnsInRange = (fromKey, toKey) =>
      tx(STORES.returns, 'readonly', (stores) => getAllByIndex(stores[STORES.returns], 'dayKey', IDBKeyRange.bound(fromKey, toKey)));

    async function returnAvailability(saleId) {
      return tx([STORES.saleItems, STORES.returnItems], 'readonly', async (stores) => {
        const items = await getAllByIndex(stores[STORES.saleItems], 'saleId', saleId);
        const returned = await getAllByIndex(stores[STORES.returnItems], 'saleId', saleId);
        const quantityByItem = new Map();
        for (const item of returned) quantityByItem.set(item.saleItemId, (quantityByItem.get(item.saleItemId) || 0) + item.quantity);
        return items.map((item) => ({ ...item, returnedQuantity: quantityByItem.get(item.id) || 0, availableQuantity: item.quantity - (quantityByItem.get(item.id) || 0) }));
      });
    }

    async function createReturn({ saleId, lines, reason = '', refundMethod = 'cash', note = '' }) {
      if (!Array.isArray(lines) || lines.length === 0) throw new Error('اختر صنفاً واحداً على الأقل للإرجاع');
      if (!REFUND_METHOD_LABEL[refundMethod]) throw new Error('طريقة إعادة المبلغ غير صالحة');
      return tx([STORES.sales, STORES.saleItems, STORES.returnItems, STORES.returns, STORES.products, STORES.inventoryMovements], 'readwrite', async (stores) => {
        const sale = await get(stores[STORES.sales], saleId);
        if (!sale || sale.status === SALE_STATUS.CANCELLED) throw new Error('لا يمكن إرجاع فاتورة غير موجودة أو ملغاة');
        const saleItems = await getAllByIndex(stores[STORES.saleItems], 'saleId', saleId);
        const previous = await getAllByIndex(stores[STORES.returnItems], 'saleId', saleId);
        const returned = new Map();
        for (const item of previous) returned.set(item.saleItemId, (returned.get(item.saleItemId) || 0) + item.quantity);
        const selected = [];
        for (const line of lines) {
          const source = saleItems.find((item) => item.id === line.saleItemId);
          const quantity = Math.trunc(Number(line.quantity));
          if (!source || quantity <= 0 || quantity > source.quantity - (returned.get(source.id) || 0)) throw new Error('كمية المرتجع تتجاوز الكمية المتاحة');
          selected.push({ source, quantity });
        }
        const weights = selected.map(({ source, quantity }) => source.lineTotalMinor * quantity / source.quantity);
        const sumWeights = weights.reduce((sum, value) => sum + value, 0);
        const refundMinor = sumWeights > 0 ? Math.min(sale.totalMinor, roundHalfUp(sale.totalMinor * sumWeights / Math.max(1, sale.subtotalMinor - sale.discountMinor))) : 0;
        const stamp = new Date(); const createdAt = toISO(stamp); const returnId = uid('ret');
        const record = { id: returnId, saleId, saleNumber: sale.number, customerId: sale.customerId || null, refundMinor, refundMethod, reason: reason.trim(), note: note.trim(), createdAt, dayKey: dayKey(stamp) };
        await add(stores[STORES.returns], record);
        const items = [];
        for (const { source, quantity } of selected) {
          const item = { id: uid('rit'), returnId, saleId, saleItemId: source.id, productId: source.productId, name: source.name, sku: source.sku, quantity, refundMinor: roundHalfUp(refundMinor * (source.lineTotalMinor * quantity / source.quantity) / Math.max(1, sumWeights)), createdAt };
          items.push(item); await add(stores[STORES.returnItems], item);
          await applyMovement(stores, { productId: source.productId, delta: quantity, type: MOVEMENT.RETURN, reason: reason || 'مرتجع من عميل', note: `مرتجع ${sale.number}`, refType: 'return', refId: returnId, allowNegative: true });
        }
        return { return: record, items };
      });
    }


    Object.defineProperty(__exports, "REFUND_METHOD_LABEL", { enumerable: true, get: function () { return REFUND_METHOD_LABEL; } });
    Object.defineProperty(__exports, "returnsForSale", { enumerable: true, get: function () { return returnsForSale; } });
    Object.defineProperty(__exports, "returnsInRange", { enumerable: true, get: function () { return returnsInRange; } });
    Object.defineProperty(__exports, "returnAvailability", { enumerable: true, get: function () { return returnAvailability; } });
    Object.defineProperty(__exports, "createReturn", { enumerable: true, get: function () { return createReturn; } });
  });

  /* ================================================================== */
  /* src/repositories/sales.js */
  __def("src/repositories/sales.js", function (__exports, __m, __dyn) {
    /**
     * مستودع المبيعات.
     *
     * `completeSale` و`cancelSale` تنفّذان كل شيء داخل معاملة IndexedDB واحدة:
     * إنشاء الفاتورة وسطورها، وتخفيض المخزون، وتسجيل الحركات، وزيادة عدّاد الترقيم.
     * أي فشل في أي خطوة يُجهض المعاملة بالكامل فلا تبقى فاتورة جزئية ولا مخزون غير متسق.
     */

    const { tx, get, getAll, put, add, del, count, getAllByIndex, iterate } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid, formatInvoiceNumber } = __m("src/utils/id.js");
    const { toISO, dayKey } = __m("src/utils/dates.js");
    const { computeTotals, allocateProportionally, roundHalfUp } = __m("src/utils/money.js");
    const { applyMovement, MOVEMENT } = __m("src/repositories/inventory.js");
    const { readSettingIn, writeSettingIn, DEFAULT_SETTINGS } = __m("src/repositories/settings.js");

    const SALE_STATUS = { COMPLETED: 'completed', CANCELLED: 'cancelled', PENDING: 'pending' };

    const SALE_STATUS_LABEL = {
      [SALE_STATUS.COMPLETED]: 'مكتملة',
      [SALE_STATUS.PENDING]: 'معلقة',
      [SALE_STATUS.CANCELLED]: 'ملغاة',
    };

    const SALE_STATUS_TONE = {
      [SALE_STATUS.COMPLETED]: 'green',
      [SALE_STATUS.PENDING]: 'amber',
      [SALE_STATUS.CANCELLED]: 'red',
    };

    const PAYMENT_TYPE = {
      CASH: 'cash', BANK: 'bank', CARD: 'card', CHEQUE: 'cheque', WALLET: 'wallet', CREDIT: 'credit', MIXED: 'mixed',
    };
    const PAYMENT_TYPE_LABEL = {
      [PAYMENT_TYPE.CASH]: 'نقدي', [PAYMENT_TYPE.BANK]: 'تحويل بنكي', [PAYMENT_TYPE.CARD]: 'بطاقة',
      [PAYMENT_TYPE.CHEQUE]: 'شيك', [PAYMENT_TYPE.WALLET]: 'محفظة إلكترونية', [PAYMENT_TYPE.CREDIT]: 'آجل',
      [PAYMENT_TYPE.MIXED]: 'دفع مختلط',
    };

    /* ------------------------------------------------------------------ */
    /* إتمام البيع                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * @param {object} input
     * @param {{productId:string, quantity:number, unitPriceMinor?:number}[]} input.lines
     * @param {{id:string|null, name:string}} [input.customer]
     * @param {{type:'percent'|'amount', value:number}} [input.discount]
     * @param {number} [input.taxRateBp]
     * @param {boolean} [input.taxInclusive]
     * @param {string} [input.paymentType]
     * @param {number} [input.paidMinor] المدفوع فعلياً (للآجل)
     * @param {{method:string, amountMinor:number}[]} [input.paymentBreakdown] دفعات الفاتورة
     * @param {string} [input.note]
     * @param {boolean} [input.allowNegativeStock]
     * @returns {Promise<{sale:object, items:object[]}>}
     */
    async function completeSale({
      lines,
      customer = { id: null, name: 'عميل نقدي' },
      discount = { type: 'amount', value: 0 },
      taxRateBp = 0,
      taxInclusive = false,
      paymentType = PAYMENT_TYPE.CASH,
      paidMinor = null,
      paymentBreakdown = [],
      note = '',
      allowNegativeStock = false,
    }) {
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error('لا يمكن إتمام بيع بعربة فارغة');
      }
      if ((paymentType === PAYMENT_TYPE.CREDIT || Number(paidMinor) < 0) && !customer?.id) {
        throw new Error('البيع الآجل يتطلب اختيار عميل مسجّل');
      }

      return tx(
        [STORES.products, STORES.inventoryMovements, STORES.sales, STORES.saleItems, STORES.settings],
        'readwrite',
        async (stores) => {
          const productStore = stores[STORES.products];

          // 1) قراءة المنتجات والتحقق منها قبل أي كتابة
          const resolved = [];
          for (const line of lines) {
            const product = await get(productStore, line.productId);
            if (!product) throw new Error('أحد المنتجات في العربة لم يعد موجوداً');

            const quantity = Number(line.quantity);
            if (!Number.isInteger(quantity) || quantity <= 0) {
              throw new Error(`كمية غير صالحة للمنتج "${product.name}"`);
            }
            if (!allowNegativeStock && product.quantity < quantity) {
              throw new Error(`الكمية المتاحة من "${product.name}" غير كافية (المتاح ${product.quantity})`);
            }

            resolved.push({
              product,
              quantity,
              unitPriceMinor: line.unitPriceMinor ?? product.priceMinor,
              unitCostMinor: product.costMinor ?? 0,
            });
          }

          // 2) الحسابات المالية (وحدات صغرى صحيحة)
          const totals = computeTotals(
            resolved.map((r) => ({ unitPriceMinor: r.unitPriceMinor, quantity: r.quantity })),
            discount,
            taxRateBp,
            taxInclusive
          );

          const lineGross = resolved.map((r) => roundHalfUp(r.unitPriceMinor * r.quantity));
          const lineDiscounts = allocateProportionally(totals.discountMinor, lineGross);

          // 3) ترقيم الفاتورة من داخل نفس المعاملة (يمنع تكرار الرقم)
          const settingsStore = stores[STORES.settings];
          const prefix = await readSettingIn(settingsStore, 'invoicePrefix') ?? DEFAULT_SETTINGS.invoicePrefix;
          const includeYear = await readSettingIn(settingsStore, 'invoiceIncludeYear');
          const nextNumber = Number(await readSettingIn(settingsStore, 'invoiceNextNumber')) || 1;

          const stamp = new Date();
          const number = formatInvoiceNumber(
            prefix,
            nextNumber,
            includeYear === false ? null : stamp.getFullYear()
          );

          const saleId = uid('sal');
          const createdAt = toISO(stamp);
          const today = dayKey(stamp);

          const normalizedBreakdown = (paymentBreakdown || [])
            .map((entry) => ({ method: entry.method, amountMinor: Math.max(0, Math.round(Number(entry.amountMinor) || 0)) }))
            .filter((entry) => entry.amountMinor > 0 && PAYMENT_TYPE_LABEL[entry.method] && entry.method !== PAYMENT_TYPE.CREDIT);
          const breakdownPaid = normalizedBreakdown.reduce((sum, entry) => sum + entry.amountMinor, 0);
          const paid = normalizedBreakdown.length > 0
            ? Math.min(breakdownPaid, totals.totalMinor)
            : paymentType === PAYMENT_TYPE.CREDIT
              ? Math.min(Math.max(Number(paidMinor) || 0, 0), totals.totalMinor)
              : totals.totalMinor;
          if (paid < totals.totalMinor && !customer?.id) {
            throw new Error('الدفع الجزئي يتطلب اختيار عميل مسجّل');
          }

          const sale = {
            id: saleId,
            number,
            status: SALE_STATUS.COMPLETED,
            paymentType,
            paymentBreakdown: normalizedBreakdown,
            customerId: customer?.id || null,
            customerName: customer?.name || 'عميل نقدي',
            subtotalMinor: totals.subtotalMinor,
            discountType: discount?.type || 'amount',
            discountValue: discount?.value || 0,
            discountMinor: totals.discountMinor,
            taxRateBp,
            taxInclusive: Boolean(taxInclusive),
            taxMinor: totals.taxMinor,
            totalMinor: totals.totalMinor,
            paidMinor: paid,
            dueMinor: totals.totalMinor - paid,
            itemCount: resolved.length,
            unitCount: resolved.reduce((sum, r) => sum + r.quantity, 0),
            costMinor: resolved.reduce((sum, r) => sum + roundHalfUp(r.unitCostMinor * r.quantity), 0),
            note: note || '',
            createdAt,
            updatedAt: createdAt,
            dayKey: today,
            cancelledAt: null,
            cancelReason: null,
          };

          // 4) الكتابة: الفاتورة ثم السطور ثم حركات المخزون
          await add(stores[STORES.sales], sale);

          const items = [];
          for (let i = 0; i < resolved.length; i += 1) {
            const r = resolved[i];
            const item = {
              id: uid('sit'),
              saleId,
              productId: r.product.id,
              sku: r.product.sku,
              name: r.product.name,          // لقطة: تغيير اسم المنتج لاحقاً لا يغيّر الفاتورة
              unit: r.product.unit,
              quantity: r.quantity,
              unitPriceMinor: r.unitPriceMinor,
              unitCostMinor: r.unitCostMinor, // لقطة التكلفة لحماية تقارير الربح
              lineDiscountMinor: lineDiscounts[i],
              lineTotalMinor: lineGross[i] - lineDiscounts[i],
              dayKey: today,
              createdAt,
            };
            items.push(item);
            await add(stores[STORES.saleItems], item);

            await applyMovement(stores, {
              productId: r.product.id,
              delta: -r.quantity,
              type: MOVEMENT.SALE,
              reason: 'بيع',
              note: `فاتورة ${number}`,
              refType: 'sale',
              refId: saleId,
              allowNegative: allowNegativeStock,
            });
          }

          // 5) زيادة العدّاد — آخر خطوة، داخل نفس المعاملة
          await writeSettingIn(settingsStore, 'invoiceNextNumber', nextNumber + 1);

          return { sale, items };
        }
      );
    }

    /* ------------------------------------------------------------------ */
    /* إلغاء الفاتورة                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * إلغاء بعملية تعويض ذرّية: يعيد كل كمية إلى المخزون ويسجّل حركة لكل سطر،
     * ويحدّث حالة الفاتورة. الفاتورة **لا تُحذف** أبداً.
     */
    async function cancelSale(saleId, reason = '') {
      return tx(
        [STORES.products, STORES.inventoryMovements, STORES.sales, STORES.saleItems],
        'readwrite',
        async (stores) => {
          const saleStore = stores[STORES.sales];
          const sale = await get(saleStore, saleId);
          if (!sale) throw new Error('الفاتورة غير موجودة');
          if (sale.status === SALE_STATUS.CANCELLED) throw new Error('الفاتورة ملغاة بالفعل');

          const items = await getAll(stores[STORES.saleItems].index('saleId'), saleId);
          if (items.length === 0) throw new Error('لا توجد سطور لهذه الفاتورة');

          for (const item of items) {
            await applyMovement(stores, {
              productId: item.productId,
              delta: item.quantity,
              type: MOVEMENT.CANCEL,
              reason: 'إلغاء فاتورة',
              note: `إلغاء ${sale.number}${reason ? ` — ${reason}` : ''}`,
              refType: 'sale-cancel',
              refId: saleId,
              allowNegative: true, // الإرجاع يزيد المخزون، لا يمكن أن يجعله سالباً
            });
          }

          const cancelledAt = toISO();
          const updated = {
            ...sale,
            status: SALE_STATUS.CANCELLED,
            cancelledAt,
            cancelReason: reason || '',
            updatedAt: cancelledAt,
            dueMinor: 0, // الفاتورة الملغاة لا تُحمّل على ذمة العميل
          };
          await put(saleStore, updated);

          return { sale: updated, restoredLines: items.length };
        }
      );
    }

    /* ------------------------------------------------------------------ */
    /* قراءة                                                                */
    /* ------------------------------------------------------------------ */

    const getSale = (id) =>
      tx(STORES.sales, 'readonly', (stores) => get(stores[STORES.sales], id));

    const getSaleItems = (saleId) =>
      tx(STORES.saleItems, 'readonly', (stores) => getAllByIndex(stores[STORES.saleItems], 'saleId', saleId));

    async function getSaleWithItems(saleId) {
      return tx([STORES.sales, STORES.saleItems], 'readonly', async (stores) => {
        const sale = await get(stores[STORES.sales], saleId);
        if (!sale) return null;
        const items = await getAll(stores[STORES.saleItems].index('saleId'), saleId);
        return { sale, items };
      });
    }

    const listSales = (limit = 500) =>
      tx(STORES.sales, 'readonly', async (stores) => {
        const items = [];
        await iterate(stores[STORES.sales].index('createdAt'), null, (sale) => {
          items.push(sale);
          return items.length < limit;
        }, 'prev');
        return items;
      });

    const salesInRange = (fromKey, toKey) =>
      tx(STORES.sales, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.sales], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
      );

    const saleItemsInRange = (fromKey, toKey) =>
      tx(STORES.saleItems, 'readonly', (stores) =>
        getAllByIndex(stores[STORES.saleItems], 'dayKey', IDBKeyRange.bound(fromKey, toKey))
      );

    const salesForCustomer = (customerId, limit = 50) =>
      tx(STORES.sales, 'readonly', (stores) => getAllByIndex(stores[STORES.sales], 'customerId', customerId))
        .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));

    /* ------------------------------------------------------------------ */
    /* البيوع المعلّقة                                                      */
    /* ------------------------------------------------------------------ */

    async function suspendSale(cart) {
      const record = {
        id: uid('sus'),
        label: cart.label || '',
        customerId: cart.customer?.id || null,
        customerName: cart.customer?.name || 'عميل نقدي',
        lines: cart.lines,
        discount: cart.discount || { type: 'amount', value: 0 },
        itemCount: cart.lines.length,
        totalMinor: cart.totalMinor || 0,
        createdAt: toISO(),
      };
      await tx(STORES.suspendedSales, 'readwrite', (stores) => add(stores[STORES.suspendedSales], record));
      return record;
    }

    const listSuspended = () =>
      tx(STORES.suspendedSales, 'readonly', (stores) => getAll(stores[STORES.suspendedSales]))
        .then((rows) => rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

    /** يستعيد بيعاً معلّقاً ويحذفه في نفس المعاملة حتى لا يُستعاد مرتين */
    async function resumeSuspended(id) {
      return tx(STORES.suspendedSales, 'readwrite', async (stores) => {
        const store = stores[STORES.suspendedSales];
        const record = await get(store, id);
        if (!record) throw new Error('البيع المعلّق غير موجود');
        await del(store, id);
        return record;
      });
    }

    const deleteSuspended = (id) =>
      tx(STORES.suspendedSales, 'readwrite', (stores) => del(stores[STORES.suspendedSales], id));

    const countSuspended = () =>
      tx(STORES.suspendedSales, 'readonly', (stores) => count(stores[STORES.suspendedSales]));


    Object.defineProperty(__exports, "SALE_STATUS", { enumerable: true, get: function () { return SALE_STATUS; } });
    Object.defineProperty(__exports, "SALE_STATUS_LABEL", { enumerable: true, get: function () { return SALE_STATUS_LABEL; } });
    Object.defineProperty(__exports, "SALE_STATUS_TONE", { enumerable: true, get: function () { return SALE_STATUS_TONE; } });
    Object.defineProperty(__exports, "PAYMENT_TYPE", { enumerable: true, get: function () { return PAYMENT_TYPE; } });
    Object.defineProperty(__exports, "PAYMENT_TYPE_LABEL", { enumerable: true, get: function () { return PAYMENT_TYPE_LABEL; } });
    Object.defineProperty(__exports, "completeSale", { enumerable: true, get: function () { return completeSale; } });
    Object.defineProperty(__exports, "cancelSale", { enumerable: true, get: function () { return cancelSale; } });
    Object.defineProperty(__exports, "getSale", { enumerable: true, get: function () { return getSale; } });
    Object.defineProperty(__exports, "getSaleItems", { enumerable: true, get: function () { return getSaleItems; } });
    Object.defineProperty(__exports, "getSaleWithItems", { enumerable: true, get: function () { return getSaleWithItems; } });
    Object.defineProperty(__exports, "listSales", { enumerable: true, get: function () { return listSales; } });
    Object.defineProperty(__exports, "salesInRange", { enumerable: true, get: function () { return salesInRange; } });
    Object.defineProperty(__exports, "saleItemsInRange", { enumerable: true, get: function () { return saleItemsInRange; } });
    Object.defineProperty(__exports, "salesForCustomer", { enumerable: true, get: function () { return salesForCustomer; } });
    Object.defineProperty(__exports, "suspendSale", { enumerable: true, get: function () { return suspendSale; } });
    Object.defineProperty(__exports, "listSuspended", { enumerable: true, get: function () { return listSuspended; } });
    Object.defineProperty(__exports, "resumeSuspended", { enumerable: true, get: function () { return resumeSuspended; } });
    Object.defineProperty(__exports, "deleteSuspended", { enumerable: true, get: function () { return deleteSuspended; } });
    Object.defineProperty(__exports, "countSuspended", { enumerable: true, get: function () { return countSuspended; } });
  });

  /* ================================================================== */
  /* src/repositories/settings.js */
  __def("src/repositories/settings.js", function (__exports, __m, __dyn) {
    /** مستودع الإعدادات — صفوف key/value مع ذاكرة مؤقتة في الذاكرة. */

    const { tx, get, put, getAll } = __m("src/db/db.js");
    const { STORES, APP_VERSION, SCHEMA_VERSION } = __m("src/db/schema.js");

    const DEFAULT_SETTINGS = {
      storeName: 'متجري',
      storePhone: '',
      storeEmail: '',
      storeAddress: '',
      storeCrNumber: '',
      storeTaxNumber: '',

      // الشيكل هو الإعداد الافتراضي للإصدار الحالي. كل المستندات تقرأ هذه القيم
      // من الإعدادات ولا تحتفظ برمز عملة ثابت داخلها.
      currencyCode: 'ILS',
      currencySymbol: '₪',
      currencyDecimalDigits: 2,
      currencySymbolPosition: 'after', // 'before' | 'after'
      dateFormat: 'YYYY-MM-DD',

      invoicePrefix: 'INV',
      invoiceIncludeYear: true,
      invoiceNextNumber: 1,
      invoiceFooter: 'شكراً لتعاملكم معنا',

      defaultTaxRateBp: 1500,      // 15%
      taxInclusive: false,
      allowDiscount: true,
      maxDiscountPercent: 100,

      printTemplate: 'a4',         // 'a4' | 'thermal80' | 'thermal58'
      printShowStoreLogo: true,
      printShowTaxNumber: true,
      printShowPayment: true,
      printShowPaidDue: true,
      printShowInvoiceBarcode: false,
      invoiceTitle: 'فاتورة مبيعات',
      invoiceFooterFontSize: 12,

      allowNegativeStock: false,
      lowStockDefault: 5,

      backupReminder: 'weekly',    // 'off' | 'daily' | 'weekly'
      lastBackupAt: null,
      storagePersisted: false,

      seeded: false,
      appVersion: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
    };

    let cache = null;

    /** يقرأ كل الإعدادات مدمجة مع القيم الافتراضية */
    async function loadSettings({ force = false } = {}) {
      if (cache && !force) return cache;

      const rows = await tx(STORES.settings, 'readonly', (stores) => getAll(stores[STORES.settings]));
      const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));

      cache = { ...DEFAULT_SETTINGS, ...stored };
      return cache;
    }

    /** القيم المحمّلة حالياً (متزامن). يجب استدعاء loadSettings مرة عند الإقلاع. */
    function settings() {
      return cache || DEFAULT_SETTINGS;
    }

    /** يحفظ مجموعة إعدادات دفعة واحدة داخل معاملة واحدة */
    async function saveSettings(patch) {
      const entries = Object.entries(patch);
      await tx(STORES.settings, 'readwrite', async (stores) => {
        for (const [key, value] of entries) {
          await put(stores[STORES.settings], { key, value });
        }
      });
      cache = { ...(cache || DEFAULT_SETTINGS), ...patch };
      return cache;
    }

    async function getSetting(key) {
      const row = await tx(STORES.settings, 'readonly', (stores) => get(stores[STORES.settings], key));
      return row ? row.value : DEFAULT_SETTINGS[key];
    }

    /** يقرأ إعداداً داخل معاملة قائمة (لا يفتح معاملة جديدة) */
    async function readSettingIn(store, key) {
      const row = await get(store, key);
      return row ? row.value : DEFAULT_SETTINGS[key];
    }

    /** يكتب إعداداً داخل معاملة قائمة */
    function writeSettingIn(store, key, value) {
      if (cache) cache[key] = value;
      return put(store, { key, value });
    }

    function invalidateSettingsCache() {
      cache = null;
    }

    /** رمز العملة الحالي للعرض */
    function currency() {
      return settings().currencySymbol || '';
    }

    function dateFormat() {
      return settings().dateFormat || 'YYYY-MM-DD';
    }


    Object.defineProperty(__exports, "DEFAULT_SETTINGS", { enumerable: true, get: function () { return DEFAULT_SETTINGS; } });
    Object.defineProperty(__exports, "loadSettings", { enumerable: true, get: function () { return loadSettings; } });
    Object.defineProperty(__exports, "settings", { enumerable: true, get: function () { return settings; } });
    Object.defineProperty(__exports, "saveSettings", { enumerable: true, get: function () { return saveSettings; } });
    Object.defineProperty(__exports, "getSetting", { enumerable: true, get: function () { return getSetting; } });
    Object.defineProperty(__exports, "readSettingIn", { enumerable: true, get: function () { return readSettingIn; } });
    Object.defineProperty(__exports, "writeSettingIn", { enumerable: true, get: function () { return writeSettingIn; } });
    Object.defineProperty(__exports, "invalidateSettingsCache", { enumerable: true, get: function () { return invalidateSettingsCache; } });
    Object.defineProperty(__exports, "currency", { enumerable: true, get: function () { return currency; } });
    Object.defineProperty(__exports, "dateFormat", { enumerable: true, get: function () { return dateFormat; } });
  });

  /* ================================================================== */
  /* src/repositories/shifts.js */
  __def("src/repositories/shifts.js", function (__exports, __m, __dyn) {
    /** وردية الكاشير: رصيد افتتاحي، حساب متوقع، وإقفال موثق بالفروقات. */
    const { tx, get, getAll, put, add, getAllByIndex } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, dayKey } = __m("src/utils/dates.js");

    const SHIFT_STATUS = { OPEN: 'open', CLOSED: 'closed' };

    const currentShift = () => tx(STORES.shifts, 'readonly', (stores) => getAllByIndex(stores[STORES.shifts], 'status', SHIFT_STATUS.OPEN, 1)).then((rows) => rows[0] || null);
    const listShifts = (limit = 100) => tx(STORES.shifts, 'readonly', (stores) => getAll(stores[STORES.shifts])).then((rows) => rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, limit));

    async function openShift({ openingMinor, cashierName = '', note = '' }) {
      const amount = Math.max(0, Math.round(Number(openingMinor) || 0));
      return tx(STORES.shifts, 'readwrite', async (stores) => {
        const open = await getAllByIndex(stores[STORES.shifts], 'status', SHIFT_STATUS.OPEN, 1);
        if (open[0]) throw new Error('توجد وردية مفتوحة بالفعل');
        const stamp = new Date(); const record = { id: uid('shf'), status: SHIFT_STATUS.OPEN, openingMinor: amount, cashierName: cashierName.trim(), note: note.trim(), openedAt: toISO(stamp), dayKey: dayKey(stamp) };
        await add(stores[STORES.shifts], record); return record;
      });
    }

    async function shiftSummary(shift) {
      if (!shift) return null;
      const end = shift.closedAt || toISO();
      const [sales, payments, expenses] = await Promise.all([
        tx(STORES.sales, 'readonly', (stores) => getAll(stores[STORES.sales])),
        tx(STORES.payments, 'readonly', (stores) => getAll(stores[STORES.payments])),
        tx(STORES.expenses, 'readonly', (stores) => getAll(stores[STORES.expenses])),
      ]);
      const inWindow = (row) => row.createdAt >= shift.openedAt && row.createdAt <= end;
      const cashSalesMinor = sales.filter((sale) => inWindow(sale) && sale.status === 'completed')
        .reduce((sum, sale) => sum + (sale.paymentBreakdown?.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amountMinor, 0) || (sale.paymentType === 'cash' ? sale.paidMinor : 0)), 0);
      const customerCashMinor = payments.filter((p) => inWindow(p) && p.method === 'cash').reduce((sum, p) => sum + p.amountMinor, 0);
      const cashExpensesMinor = expenses.filter((e) => inWindow(e) && e.method === 'cash').reduce((sum, e) => sum + e.amountMinor, 0);
      const expectedMinor = shift.openingMinor + cashSalesMinor + customerCashMinor - cashExpensesMinor;
      return { shift, cashSalesMinor, customerCashMinor, cashExpensesMinor, expectedMinor };
    }

    async function closeShift({ shiftId, countedMinor, note = '' }) {
      const open = await currentShift();
      if (!open || open.id !== shiftId) throw new Error('الوردية غير مفتوحة');
      const summary = await shiftSummary(open);
      return tx(STORES.shifts, 'readwrite', async (stores) => {
        const shift = await get(stores[STORES.shifts], shiftId);
        if (!shift || shift.status !== SHIFT_STATUS.OPEN) throw new Error('الوردية غير مفتوحة');
        const actual = Math.max(0, Math.round(Number(countedMinor) || 0)); const closedAt = toISO();
        const record = { ...shift, status: SHIFT_STATUS.CLOSED, expectedMinor: summary.expectedMinor, countedMinor: actual, differenceMinor: actual - summary.expectedMinor, closeNote: note.trim(), closedAt };
        await put(stores[STORES.shifts], record); return { shift: record, summary };
      });
    }


    Object.defineProperty(__exports, "SHIFT_STATUS", { enumerable: true, get: function () { return SHIFT_STATUS; } });
    Object.defineProperty(__exports, "currentShift", { enumerable: true, get: function () { return currentShift; } });
    Object.defineProperty(__exports, "listShifts", { enumerable: true, get: function () { return listShifts; } });
    Object.defineProperty(__exports, "openShift", { enumerable: true, get: function () { return openShift; } });
    Object.defineProperty(__exports, "shiftSummary", { enumerable: true, get: function () { return shiftSummary; } });
    Object.defineProperty(__exports, "closeShift", { enumerable: true, get: function () { return closeShift; } });
  });

  /* ================================================================== */
  /* src/router.js */
  __def("src/router.js", function (__exports, __m, __dyn) {
    /**
     * موجّه قائم على الـ hash.
     * سبب اختيار hash بدل History API: التطبيق يُنشر كملفات ثابتة، و`#/products`
     * يعمل بعد Refresh دون أي إعادة كتابة على الخادم (انظر docs/design-decisions.md).
     */

    const routes = new Map();
    let notFoundHandler = null;
    let current = null;
    let cleanup = null;
    let outlet = null;
    let onNavigate = null;

    /** يسجّل مساراً. النمط: '/products' أو '/products/:id' */
    function route(pattern, handler, meta = {}) {
      const paramNames = [];
      const regexSource = pattern
        .replace(/\/:([^/]+)/g, (_, name) => { paramNames.push(name); return '/([^/]+)'; })
        .replace(/\//g, '\\/');

      routes.set(pattern, {
        pattern,
        regex: new RegExp(`^${regexSource}$`),
        paramNames,
        handler,
        meta,
      });
    }

    function setNotFound(handler) {
      notFoundHandler = handler;
    }

    /** يفكّك '#/products/123?q=abc' إلى {path, query} */
    function parseHash() {
      const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
      const [path, queryString = ''] = raw.split('?');
      const query = Object.fromEntries(new URLSearchParams(queryString));
      return { path: path.replace(/\/+$/, '') || '/', query };
    }

    function match(path) {
      for (const entry of routes.values()) {
        const result = entry.regex.exec(path);
        if (!result) continue;

        const params = {};
        entry.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(result[index + 1]);
        });
        return { entry, params };
      }
      return null;
    }

    async function resolve() {
      const { path, query } = parseHash();
      const matched = match(path);

      // تنظيف الشاشة السابقة (إلغاء اشتراكات، إزالة مستمعين)
      if (typeof cleanup === 'function') {
        try { cleanup(); } catch (error) { console.error('[router] فشل تنظيف الشاشة:', error); }
      }
      cleanup = null;

      const context = {
        path,
        query,
        params: matched?.params || {},
        meta: matched?.entry.meta || {},
        /** تسجّل الشاشة دالة تنظيف تُستدعى عند مغادرتها */
        onCleanup(fn) { cleanup = fn; },
      };

      current = context;
      onNavigate?.(context);

      const handler = matched?.entry.handler || notFoundHandler;
      if (!handler) return;

      try {
        const view = await handler(context);
        // إن غيّر المستخدم المسار أثناء التحميل، تجاهل النتيجة القديمة
        if (current !== context) return;
        if (view && outlet) {
          outlet.replaceChildren(view);
          outlet.scrollTop = 0;
          window.scrollTo(0, 0);
        }
      } catch (error) {
        console.error('[router] فشل عرض الشاشة:', error);
        if (current === context) throw error;
      }
    }

    /** يبدأ الموجّه */
    function startRouter({ mount, onChange }) {
      outlet = mount;
      onNavigate = onChange;

      window.addEventListener('hashchange', () => { resolve(); });

      if (!window.location.hash) {
        window.location.replace('#/dashboard');
      }
      return resolve();
    }

    /** ينتقل إلى مسار. replace=true لا يضيف إدخالاً في سجل التصفح */
    function navigate(path, { replace = false } = {}) {
      const target = path.startsWith('#') ? path : `#${path}`;
      if (window.location.hash === target) {
        resolve();
        return;
      }
      if (replace) window.location.replace(target);
      else window.location.hash = target;
    }

    /** يعيد رسم الشاشة الحالية */
    const refresh = () => resolve();

    const currentRoute = () => current;

    /** يبني رابطاً مع معاملات استعلام */
    function href(path, query) {
      const params = new URLSearchParams(
        Object.entries(query || {}).filter(([, value]) => value != null && value !== '')
      );
      const suffix = params.toString();
      return `#${path}${suffix ? `?${suffix}` : ''}`;
    }


    Object.defineProperty(__exports, "route", { enumerable: true, get: function () { return route; } });
    Object.defineProperty(__exports, "setNotFound", { enumerable: true, get: function () { return setNotFound; } });
    Object.defineProperty(__exports, "startRouter", { enumerable: true, get: function () { return startRouter; } });
    Object.defineProperty(__exports, "navigate", { enumerable: true, get: function () { return navigate; } });
    Object.defineProperty(__exports, "refresh", { enumerable: true, get: function () { return refresh; } });
    Object.defineProperty(__exports, "currentRoute", { enumerable: true, get: function () { return currentRoute; } });
    Object.defineProperty(__exports, "href", { enumerable: true, get: function () { return href; } });
  });

  /* ================================================================== */
  /* src/routes.js */
  __def("src/routes.js", function (__exports, __m, __dyn) {
    /** تسجيل مسارات التطبيق. الشاشات تُحمَّل ديناميكياً لتقصير أول رسم. */

    const { route, setNotFound } = __m("src/router.js");
    const { h } = __m("src/utils/dom.js");
    const { emptyState } = __m("src/components/ui.js");
    const { icon } = __m("src/components/icons.js");

    /** يغلّف مُحمِّل شاشة برسالة خطأ مفهومة بدل شاشة بيضاء */
    function screen(loader, exportName = 'render') {
      return async (context) => {
        try {
          const module = await loader();
          return await module[exportName](context);
        } catch (error) {
          console.error('[routes] فشل تحميل الشاشة:', error);
          return h('div', { class: 'card' },
            h('div', { class: 'card__body' },
              emptyState({
                iconName: 'error',
                title: 'تعذّر عرض هذه الشاشة',
                text: error?.message || 'حدث خطأ غير متوقع أثناء تحميل الشاشة.',
                action: h('button', {
                  class: 'btn btn--primary',
                  attrs: { type: 'button' },
                  text: 'إعادة المحاولة',
                  on: { click: () => window.location.reload() },
                }),
              })
            )
          );
        }
      };
    }

    function registerRoutes() {
      route('/dashboard', screen(() => __dyn("src/views/dashboard.js")), { title: 'لوحة التحكم' });
      route('/pos', screen(() => __dyn("src/views/pos.js")), { title: 'نقطة البيع' });

      route('/products', screen(() => __dyn("src/views/products.js")), { title: 'المنتجات' });
      route('/products/new', screen(() => __dyn("src/views/product-form.js")), { title: 'إضافة منتج جديد' });
      route('/products/:id/edit', screen(() => __dyn("src/views/product-form.js")), { title: 'تعديل المنتج' });
      route('/products/:id', screen(() => __dyn("src/views/product-form.js"), 'renderView'), { title: 'تفاصيل المنتج' });

      route('/inventory', screen(() => __dyn("src/views/inventory.js")), { title: 'المخزون' });
      route('/reorder', screen(() => __dyn("src/views/reorder.js")), { title: 'المنتجات المطلوب شراؤها' });
      route('/purchases', screen(() => __dyn("src/views/purchases.js")), { title: 'الموردون والمشتريات' });

      route('/invoices', screen(() => __dyn("src/views/invoices.js")), { title: 'الفواتير' });
      route('/invoices/:id', screen(() => __dyn("src/views/invoice-detail.js")), { title: 'تفاصيل الفاتورة' });

      route('/customers', screen(() => __dyn("src/views/customers.js")), { title: 'العملاء' });
      route('/customers/:id', screen(() => __dyn("src/views/customers.js"), 'renderStatement'), { title: 'كشف حساب العميل' });

      route('/expenses', screen(() => __dyn("src/views/expenses.js")), { title: 'المصروفات' });
      route('/shifts', screen(() => __dyn("src/views/shifts.js")), { title: 'الورديات والصندوق' });
      route('/notifications', screen(() => __dyn("src/views/notifications.js")), { title: 'مركز الإشعارات' });
      route('/reports', screen(() => __dyn("src/views/reports.js")), { title: 'التقارير' });
      route('/backup', screen(() => __dyn("src/views/backup.js")), { title: 'النسخ الاحتياطي' });
      route('/settings', screen(() => __dyn("src/views/settings.js")), { title: 'الإعدادات' });

      setNotFound(() =>
        h('div', { class: 'card' },
          h('div', { class: 'card__body' },
            emptyState({
              iconName: 'search',
              title: 'الصفحة غير موجودة',
              text: 'الرابط الذي فتحته لا يطابق أي شاشة في النظام.',
              action: h('a', { class: 'btn btn--primary', href: '#/dashboard' },
                icon('dashboard'), h('span', { text: 'العودة إلى لوحة التحكم' })),
            })
          )
        )
      );
    }


    Object.defineProperty(__exports, "registerRoutes", { enumerable: true, get: function () { return registerRoutes; } });
  });

  /* ================================================================== */
  /* src/services/backup.js */
  __def("src/services/backup.js", function (__exports, __m, __dyn) {
    /**
     * النسخ الاحتياطي والاستعادة.
     *
     * ضمانات الاستعادة:
     *  1. يُفحص الملف بالكامل (النوع، الحجم، البنية، الإصدار، كل الحقول) قبل أي كتابة.
     *  2. تُنشأ نسخة تلقائية من البيانات الحالية قبل الاستبدال.
     *  3. المسح والكتابة يتمّان داخل معاملة IndexedDB واحدة — أي خطأ يُجهضها
     *     فتبقى البيانات الحالية كما هي بالضبط.
     *  4. لا يُدمج أي سجل ناقص أو مجهول بصمت؛ إما ملف صالح كامل أو رفض بسبب واضح.
     */

    const { tx, getAll, add, del, clearStore } = __m("src/db/db.js");
    const { STORES, BACKUP_STORES, SCHEMA_VERSION, APP_VERSION } = __m("src/db/schema.js");
    const { uid } = __m("src/utils/id.js");
    const { toISO, fileStamp, dayKey } = __m("src/utils/dates.js");
    const { LIMITS, validateFile } = __m("src/validation/validators.js");
    const { isSafeImageDataUrl, isSafeAttachmentDataUrl, fileToText } = __m("src/services/images.js");
    const { downloadBlob } = __m("src/utils/xlsx.js");
    const { invalidateSettingsCache, loadSettings, saveSettings } = __m("src/repositories/settings.js");

    const BACKUP_KIND = { MANUAL: 'manual', AUTO: 'auto-pre-restore' };

    /** أقصى عدد نسخ محفوظة داخل القاعدة — الأقدم يُحذف تلقائياً */
    const KEEP_BACKUPS = 5;

    /** أدنى إصدار مخطط يمكن استعادته */
    const MIN_SUPPORTED_SCHEMA = 1;

    /* ------------------------------------------------------------------ */
    /* التصدير                                                             */
    /* ------------------------------------------------------------------ */

    /** يقرأ كل المتاجر ويبني حمولة النسخة */
    async function buildBackupPayload() {
      const data = {};

      await tx(BACKUP_STORES, 'readonly', async (stores) => {
        for (const name of BACKUP_STORES) {
          data[name] = await getAll(stores[name]);
        }
      });

      const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]));

      return {
        format: 'sales-system-backup',
        schemaVersion: SCHEMA_VERSION,
        appVersion: APP_VERSION,
        exportedAt: toISO(),
        counts,
        data,
      };
    }

    /**
     * ينشئ نسخة احتياطية: يبني الحمولة، ويسجّلها، وينزّلها اختيارياً.
     * @param {{kind?:string, download?:boolean}} [options]
     */
    async function createBackup({ kind = BACKUP_KIND.MANUAL, download = true } = {}) {
      const payload = await buildBackupPayload();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });

      const fileName = kind === BACKUP_KIND.AUTO
        ? `backup-auto-${fileStamp()}.json`
        : `backup-${fileStamp()}.json`;

      const record = {
        id: uid('bkp'),
        fileName,
        kind,
        createdAt: payload.exportedAt,
        dayKey: dayKey(new Date()),
        sizeBytes: blob.size,
        schemaVersion: payload.schemaVersion,
        appVersion: payload.appVersion,
        counts: payload.counts,
        status: 'completed',
        // نحتفظ بالحمولة داخل القاعدة حتى تعمل الاستعادة والتنزيل لاحقاً فعلياً
        payload: json,
      };

      await tx(STORES.backupRecords, 'readwrite', async (stores) => {
        const store = stores[STORES.backupRecords];
        await add(store, record);

        // تقليم النسخ القديمة حتى لا تستهلك حصة التخزين بلا حد
        const all = await getAll(store);
        const sorted = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        for (const old of sorted.slice(KEEP_BACKUPS)) {
          await del(store, old.id);
        }
      });

      if (download) downloadBlob(blob, fileName);
      await saveSettings({ lastBackupAt: payload.exportedAt });

      return { record: { ...record, payload: undefined }, blob, fileName, payload };
    }

    const listBackups = () =>
      tx(STORES.backupRecords, 'readonly', (stores) => getAll(stores[STORES.backupRecords]))
        .then((rows) => rows
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(({ payload, ...rest }) => ({ ...rest, hasPayload: Boolean(payload) })));

    /** ينزّل نسخة محفوظة مسبقاً */
    async function downloadBackup(id) {
      const record = await tx(STORES.backupRecords, 'readonly', async (stores) => {
        const rows = await getAll(stores[STORES.backupRecords]);
        return rows.find((row) => row.id === id);
      });

      if (!record) throw new Error('النسخة غير موجودة');
      if (!record.payload) throw new Error('محتوى هذه النسخة لم يعد محفوظاً محلياً');

      downloadBlob(new Blob([record.payload], { type: 'application/json' }), record.fileName);
      return record.fileName;
    }

    const deleteBackup = (id) =>
      tx(STORES.backupRecords, 'readwrite', (stores) => del(stores[STORES.backupRecords], id));

    /* ------------------------------------------------------------------ */
    /* الفحص قبل الاستعادة                                                  */
    /* ------------------------------------------------------------------ */

    /** أشكال السجلات المتوقّعة لكل متجر: الحقول المطلوبة ونوعها */
    const RECORD_SHAPES = {
      [STORES.products]: { id: 'string', sku: 'string', name: 'string', priceMinor: 'int', costMinor: 'int', quantity: 'int' },
      [STORES.categories]: { id: 'string', name: 'string' },
      [STORES.customers]: { id: 'string', name: 'string' },
      [STORES.suppliers]: { id: 'string', name: 'string' },
      [STORES.purchases]: { id: 'string', number: 'string', supplierId: 'string', totalMinor: 'int', status: 'string', createdAt: 'string' },
      [STORES.purchaseItems]: { id: 'string', purchaseId: 'string', productId: 'string', quantity: 'int', unitCostMinor: 'int' },
      [STORES.purchasePayments]: { id: 'string', supplierId: 'string', amountMinor: 'int', createdAt: 'string' },
      [STORES.purchaseOrders]: { id: 'string', supplierId: 'string', status: 'string', createdAt: 'string' },
      [STORES.sales]: { id: 'string', number: 'string', totalMinor: 'int', dayKey: 'string', status: 'string', createdAt: 'string' },
      [STORES.saleItems]: { id: 'string', saleId: 'string', productId: 'string', quantity: 'int', unitPriceMinor: 'int' },
      [STORES.payments]: { id: 'string', customerId: 'string', amountMinor: 'int', createdAt: 'string' },
      [STORES.expenses]: { id: 'string', amountMinor: 'int', dayKey: 'string', categoryId: 'string' },
      [STORES.expenseCategories]: { id: 'string', name: 'string' },
      [STORES.inventoryMovements]: { id: 'string', productId: 'string', quantity: 'int', type: 'string', createdAt: 'string' },
      [STORES.suspendedSales]: { id: 'string', createdAt: 'string' },
      [STORES.settings]: { key: 'string' },
      [STORES.backupRecords]: { id: 'string', fileName: 'string' },
      [STORES.adjustmentReasons]: { id: 'string', name: 'string' },
    };

    function checkType(value, type) {
      if (type === 'string') return typeof value === 'string';
      if (type === 'int') return Number.isInteger(value);
      return true;
    }

    /**
     * يفحص ملف نسخة احتياطية بالكامل دون أي كتابة.
     * @param {File} file
     * @returns {Promise<{ok:boolean, errors:string[], warnings:string[], payload:object|null, summary:object}>}
     */
    async function inspectBackupFile(file) {
      const errors = [];
      const warnings = [];

      const fileCheck = validateFile(file, { types: null, maxBytes: LIMITS.backupBytes, label: 'ملف النسخة' });
      if (!fileCheck.ok) return { ok: false, errors: [fileCheck.error], warnings, payload: null, summary: {} };

      if (!/\.json$/i.test(file.name)) {
        return { ok: false, errors: ['الملف يجب أن يكون بصيغة JSON'], warnings, payload: null, summary: {} };
      }

      let payload;
      try {
        payload = JSON.parse(await fileToText(file));
      } catch {
        return { ok: false, errors: ['الملف ليس JSON صالحاً — قد يكون تالفاً'], warnings, payload: null, summary: {} };
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { ok: false, errors: ['بنية الملف غير متوقّعة'], warnings, payload: null, summary: {} };
      }

      if (payload.format !== 'sales-system-backup') {
        errors.push('هذا الملف ليس نسخة احتياطية من هذا النظام');
      }

      const schemaVersion = Number(payload.schemaVersion);
      if (!Number.isInteger(schemaVersion)) {
        errors.push('إصدار المخطط مفقود أو غير صالح');
      } else if (schemaVersion > SCHEMA_VERSION) {
        errors.push(`النسخة أُنشئت بإصدار أحدث (${schemaVersion}) من إصدار التطبيق الحالي (${SCHEMA_VERSION}). حدّث التطبيق أولاً.`);
      } else if (schemaVersion < MIN_SUPPORTED_SCHEMA) {
        errors.push(`إصدار المخطط ${schemaVersion} لم يعد مدعوماً`);
      } else if (schemaVersion < SCHEMA_VERSION) {
        warnings.push(`النسخة من إصدار أقدم (${schemaVersion}) وسيتم ترقيتها إلى ${SCHEMA_VERSION}`);
      }

      if (!payload.data || typeof payload.data !== 'object') {
        errors.push('الملف لا يحتوي على قسم البيانات');
        return { ok: false, errors, warnings, payload: null, summary: {} };
      }

      const summary = {};
      let totalRecords = 0;

      for (const store of BACKUP_STORES) {
        const rows = payload.data[store];

        if (rows === undefined) {
          // متجر أُضيف في إصدار أحدث من إصدار النسخة — مقبول ويبدأ فارغاً
          summary[store] = 0;
          if (schemaVersion === SCHEMA_VERSION) warnings.push(`المتجر "${store}" مفقود من الملف وسيبدأ فارغاً`);
          continue;
        }

        if (!Array.isArray(rows)) {
          errors.push(`المتجر "${store}" ليس مصفوفة`);
          continue;
        }

        summary[store] = rows.length;
        totalRecords += rows.length;

        const shape = RECORD_SHAPES[store];
        if (!shape) continue;

        // نفحص كل السجلات، لا عيّنة — البيانات المالية لا تحتمل فحصاً جزئياً
        for (let i = 0; i < rows.length; i += 1) {
          const record = rows[i];
          if (!record || typeof record !== 'object' || Array.isArray(record)) {
            errors.push(`سجل غير صالح في "${store}" عند الموضع ${i + 1}`);
            break;
          }
          for (const [field, type] of Object.entries(shape)) {
            if (!checkType(record[field], type)) {
              errors.push(`الحقل "${field}" غير صالح في "${store}" عند الموضع ${i + 1}`);
              break;
            }
          }
          if (errors.length > 12) break;
        }
      }

      // فحص data URLs — نرفض أي محتوى مضمّن لا يطابق نمطاً آمناً
      for (const product of payload.data[STORES.products] || []) {
        if (product.image && !isSafeImageDataUrl(product.image)) {
          errors.push(`صورة غير صالحة في المنتج "${product.sku || product.id}"`);
          break;
        }
      }
      for (const expense of payload.data[STORES.expenses] || []) {
        const url = expense.attachment?.dataUrl;
        if (url && !isSafeAttachmentDataUrl(url)) {
          errors.push('مرفق غير صالح في أحد المصروفات');
          break;
        }
      }

      // فحص تكامل مرجعي أساسي
      const productIds = new Set((payload.data[STORES.products] || []).map((p) => p.id));
      const saleIds = new Set((payload.data[STORES.sales] || []).map((s) => s.id));
      const orphanItems = (payload.data[STORES.saleItems] || []).filter((item) => !saleIds.has(item.saleId));
      if (orphanItems.length > 0) {
        errors.push(`${orphanItems.length} سطر فاتورة بلا فاتورة مرتبطة`);
      }
      const orphanProducts = (payload.data[STORES.saleItems] || []).filter((item) => !productIds.has(item.productId));
      if (orphanProducts.length > 0) {
        warnings.push(`${orphanProducts.length} سطر فاتورة يشير إلى منتج محذوف (سيُستعاد كما هو)`);
      }

      return {
        ok: errors.length === 0,
        errors,
        warnings,
        payload: errors.length === 0 ? payload : null,
        summary: {
          ...summary,
          totalRecords,
          exportedAt: payload.exportedAt,
          appVersion: payload.appVersion,
          schemaVersion,
          fileName: file.name,
          fileSize: file.size,
        },
      };
    }

    /* ------------------------------------------------------------------ */
    /* الاستعادة                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * يستعيد نسخة تم فحصها مسبقاً.
     * المسح والكتابة داخل معاملة واحدة؛ أي خطأ يعيد كل شيء كما كان.
     *
     * @param {object} payload مخرجات inspectBackupFile().payload
     * @param {{autoBackup?:boolean}} [options]
     */
    async function restoreBackup(payload, { autoBackup = true } = {}) {
      if (!payload?.data) throw new Error('لا توجد بيانات صالحة للاستعادة');

      // نسخة أمان من الوضع الحالي — خارج معاملة الاستعادة
      let safetyBackup = null;
      if (autoBackup) {
        safetyBackup = await createBackup({ kind: BACKUP_KIND.AUTO, download: false });
      }

      // نحتفظ بسجلات النسخ الحالية حتى لا تفقد نسخة الأمان نفسها بالاستعادة
      const preservedBackups = await tx(STORES.backupRecords, 'readonly', (stores) =>
        getAll(stores[STORES.backupRecords]));

      const restored = {};

      await tx(BACKUP_STORES, 'readwrite', async (stores) => {
        for (const name of BACKUP_STORES) {
          const store = stores[name];
          await clearStore(store);

          if (name === STORES.backupRecords) {
            // سجل النسخ لا يُستورد من الملف — نعيد سجلاتنا المحلية
            for (const record of preservedBackups) await add(store, record);
            restored[name] = preservedBackups.length;
            continue;
          }

          const rows = payload.data[name] || [];
          for (const row of rows) await add(store, row);
          restored[name] = rows.length;
        }
      });

      invalidateSettingsCache();
      await loadSettings({ force: true });

      return { restored, safetyBackup: safetyBackup?.record || null };
    }

    /** يمسح كل بيانات العمل ويُبقي سجل النسخ */
    async function clearAllData({ keepBackups = true } = {}) {
      const preserved = keepBackups
        ? await tx(STORES.backupRecords, 'readonly', (stores) => getAll(stores[STORES.backupRecords]))
        : [];

      await tx(BACKUP_STORES, 'readwrite', async (stores) => {
        for (const name of BACKUP_STORES) {
          await clearStore(stores[name]);
        }
        for (const record of preserved) await add(stores[STORES.backupRecords], record);
      });

      invalidateSettingsCache();
      return true;
    }

    /* ------------------------------------------------------------------ */
    /* تذكير النسخ                                                          */
    /* ------------------------------------------------------------------ */

    /** هل حان وقت تذكير المستخدم بأخذ نسخة خارج الجهاز؟ */
    function backupReminderDue(settingsValue) {
      const { backupReminder, lastBackupAt } = settingsValue;
      if (backupReminder === 'off') return null;

      if (!lastBackupAt) {
        return { due: true, days: null, message: 'لم تُنشئ أي نسخة احتياطية بعد. بياناتك محفوظة على هذا المتصفح فقط.' };
      }

      const days = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / 86400000);
      const threshold = backupReminder === 'daily' ? 1 : 7;

      if (days >= threshold) {
        return {
          due: true,
          days,
          message: days === 0
            ? 'أنشئ نسخة احتياطية جديدة واحفظها خارج الجهاز.'
            : `مرّ ${days} يوماً على آخر نسخة احتياطية. احفظ نسخة خارج الجهاز.`,
        };
      }
      return { due: false, days, message: '' };
    }


    Object.defineProperty(__exports, "BACKUP_KIND", { enumerable: true, get: function () { return BACKUP_KIND; } });
    Object.defineProperty(__exports, "buildBackupPayload", { enumerable: true, get: function () { return buildBackupPayload; } });
    Object.defineProperty(__exports, "createBackup", { enumerable: true, get: function () { return createBackup; } });
    Object.defineProperty(__exports, "listBackups", { enumerable: true, get: function () { return listBackups; } });
    Object.defineProperty(__exports, "downloadBackup", { enumerable: true, get: function () { return downloadBackup; } });
    Object.defineProperty(__exports, "deleteBackup", { enumerable: true, get: function () { return deleteBackup; } });
    Object.defineProperty(__exports, "inspectBackupFile", { enumerable: true, get: function () { return inspectBackupFile; } });
    Object.defineProperty(__exports, "restoreBackup", { enumerable: true, get: function () { return restoreBackup; } });
    Object.defineProperty(__exports, "clearAllData", { enumerable: true, get: function () { return clearAllData; } });
    Object.defineProperty(__exports, "backupReminderDue", { enumerable: true, get: function () { return backupReminderDue; } });
  });

  /* ================================================================== */
  /* src/services/excel.js */
  __def("src/services/excel.js", function (__exports, __m, __dyn) {
    /**
     * استيراد وتصدير Excel (.xlsx).
     *
     * قرار المستخدم: لا يُستخدم CSV في أي مكان — كل جداول التصدير والاستيراد بصيغة Excel.
     * التنفيذ يعتمد على src/utils/xlsx.js (ZIP + deflate-raw أصلي، بلا مكتبات).
     */

    const { writeXlsx, readXlsx, downloadBlob, XLSX_MIME } = __m("src/utils/xlsx.js");
    const { toMajor, bpToPercent } = __m("src/utils/money.js");
    const { validateProduct, validateFile } = __m("src/validation/validators.js");
    const { listProducts, listCategories, createProduct, updateProduct, findBySku, categoryMap, createCategory } = __m("src/repositories/products.js");
    const { fileStamp, formatDateTime } = __m("src/utils/dates.js");
    const { settings } = __m("src/repositories/settings.js");

    const XLSX_TYPES = [
      XLSX_MIME,
      'application/vnd.ms-excel',
      'application/octet-stream', // بعض المتصفحات لا تتعرّف على النوع
      '',
    ];

    const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

    /** ينشئ اسم ملف واضح يتضمن التاريخ والوقت */
    const exportFileName = (base) => `${base}-${fileStamp()}.xlsx`;

    /** يصدّر صفوفاً إلى ملف Excel وينزّله */
    async function exportRows(rows, { fileName, sheetName, columnWidths }) {
      const blob = await writeXlsx(rows, { sheetName, columnWidths });
      downloadBlob(blob, fileName);
      return blob;
    }

    /* ------------------------------------------------------------------ */
    /* المنتجات                                                            */
    /* ------------------------------------------------------------------ */

    const PRODUCT_COLUMNS = [
      'SKU', 'اسم المنتج', 'الباركود', 'الفئة', 'الوحدة',
      'سعر الشراء', 'سعر البيع', 'الضريبة %', 'الكمية', 'حد المخزون المنخفض',
      'الوصف', 'نشط',
    ];

    async function exportProducts() {
      const [products, categories] = await Promise.all([listProducts(), categoryMap()]);

      const rows = [PRODUCT_COLUMNS];
      for (const product of products) {
        rows.push([
          product.sku,
          product.name,
          product.barcode || '',
          categories.get(product.categoryId)?.name || '',
          product.unit,
          toMajor(product.costMinor),
          toMajor(product.priceMinor),
          bpToPercent(product.taxRateBp),
          product.quantity,
          product.lowStockThreshold,
          product.description || '',
          product.isActive === false ? 'لا' : 'نعم',
        ]);
      }

      return exportRows(rows, {
        fileName: exportFileName('المنتجات'),
        sheetName: 'المنتجات',
        columnWidths: [14, 32, 16, 16, 10, 12, 12, 10, 10, 16, 30, 8],
      });
    }

    /** ملف نموذجي للاستيراد — رأس + صف مثال */
    async function downloadProductTemplate() {
      const categories = await listCategories();
      const rows = [
        PRODUCT_COLUMNS,
        ['SKU-2001', 'اسم المنتج هنا', '6281000000001', categories[0]?.name || 'مواد غذائية', 'عبوة', 10, 15, 15, 100, 10, 'وصف اختياري', 'نعم'],
      ];
      return exportRows(rows, {
        fileName: 'قالب-استيراد-المنتجات.xlsx',
        sheetName: 'المنتجات',
        columnWidths: [14, 32, 16, 16, 10, 12, 12, 10, 10, 16, 30, 8],
      });
    }

    /**
     * يقرأ ملف Excel ويحوّله إلى صفوف مُتحقَّق منها **دون الكتابة إلى القاعدة**.
     * الكتابة تتم في خطوة منفصلة بعد أن يراجع المستخدم النتيجة.
     *
     * @returns {Promise<{valid:object[], invalid:{row:number, errors:string[], raw:any[]}[], newCategories:string[]}>}
     */
    async function parseProductsFile(file) {
      const check = validateFile(file, { types: null, maxBytes: MAX_IMPORT_BYTES, label: 'ملف Excel' });
      if (!check.ok) throw new Error(check.error);
      if (!/\.xlsx$/i.test(file.name)) {
        throw new Error('الملف يجب أن يكون بصيغة Excel (.xlsx)');
      }

      const rows = await readXlsx(file);
      if (rows.length < 2) throw new Error('الملف لا يحتوي على بيانات بعد صف العناوين');

      const header = rows[0].map((cell) => String(cell ?? '').trim());
      const columnIndex = (name) => header.findIndex((cell) => cell === name);

      const idx = {
        sku: columnIndex('SKU'),
        name: columnIndex('اسم المنتج'),
        barcode: columnIndex('الباركود'),
        category: columnIndex('الفئة'),
        unit: columnIndex('الوحدة'),
        cost: columnIndex('سعر الشراء'),
        price: columnIndex('سعر البيع'),
        tax: columnIndex('الضريبة %'),
        quantity: columnIndex('الكمية'),
        lowStock: columnIndex('حد المخزون المنخفض'),
        description: columnIndex('الوصف'),
        active: columnIndex('نشط'),
      };

      const required = ['sku', 'name', 'category', 'unit', 'cost', 'price'];
      const missing = required.filter((key) => idx[key] < 0);
      if (missing.length > 0) {
        const labels = { sku: 'SKU', name: 'اسم المنتج', category: 'الفئة', unit: 'الوحدة', cost: 'سعر الشراء', price: 'سعر البيع' };
        throw new Error(`أعمدة مفقودة في الملف: ${missing.map((key) => labels[key]).join('، ')}`);
      }

      const categories = await listCategories();
      const categoryByName = new Map(categories.map((category) => [category.name.trim(), category]));

      const cell = (row, key) => (idx[key] >= 0 ? row[idx[key]] : undefined);

      const valid = [];
      const invalid = [];
      const seenSkus = new Set();
      const newCategories = new Set();
      const defaultTax = bpToPercent(settings().defaultTaxRateBp);

      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;

        const categoryName = String(cell(row, 'category') ?? '').trim();
        const existingCategory = categoryByName.get(categoryName);

        const result = validateProduct({
          sku: cell(row, 'sku'),
          name: cell(row, 'name'),
          barcode: cell(row, 'barcode'),
          // نمرّر معرّفاً مؤقتاً حتى يمر التحقق، ويُستبدل بالمعرّف الحقيقي عند الحفظ
          categoryId: existingCategory?.id || (categoryName ? `new:${categoryName}` : ''),
          unit: cell(row, 'unit'),
          cost: cell(row, 'cost'),
          price: cell(row, 'price'),
          taxRate: cell(row, 'tax') ?? defaultTax,
          quantity: cell(row, 'quantity') ?? 0,
          lowStockThreshold: cell(row, 'lowStock') ?? 0,
          description: cell(row, 'description'),
          isActive: String(cell(row, 'active') ?? 'نعم').trim() !== 'لا',
        });

        if (!result.ok) {
          invalid.push({ row: i + 1, errors: Object.values(result.errors), raw: row });
          continue;
        }

        if (seenSkus.has(result.value.sku)) {
          invalid.push({ row: i + 1, errors: [`رمز SKU "${result.value.sku}" مكرر داخل الملف`], raw: row });
          continue;
        }
        seenSkus.add(result.value.sku);

        if (!existingCategory && categoryName) newCategories.add(categoryName);
        valid.push({ ...result.value, categoryName, row: i + 1 });
      }

      return { valid, invalid, newCategories: [...newCategories], totalRows: rows.length - 1 };
    }

    /**
     * يكتب نتيجة الاستيراد.
     * @param {object[]} products مخرجات parseProductsFile().valid
     * @param {{mode:'skip'|'update', createCategories:boolean}} options
     */
    async function commitProductsImport(products, { mode = 'skip', createCategories = true } = {}) {
      const categories = await listCategories();
      const categoryByName = new Map(categories.map((category) => [category.name.trim(), category]));

      // أنشئ الفئات الجديدة أولاً (خارج حلقة المنتجات حتى لا تتكرر)
      if (createCategories) {
        const needed = new Set(products.map((p) => p.categoryName).filter((name) => name && !categoryByName.has(name)));
        let order = categories.length;
        for (const name of needed) {
          order += 1;
          const created = await createCategory({ name, sortOrder: order });
          categoryByName.set(name, created);
        }
      }

      const result = { created: 0, updated: 0, skipped: 0, failed: [] };

      for (const product of products) {
        const category = categoryByName.get(product.categoryName);
        if (!category) {
          result.failed.push({ row: product.row, sku: product.sku, error: `الفئة "${product.categoryName}" غير موجودة` });
          continue;
        }

        const { categoryName, row, ...fields } = product;
        const payload = { ...fields, categoryId: category.id };

        try {
          const existing = await findBySku(payload.sku);
          if (existing) {
            if (mode === 'update') {
              await updateProduct(existing.id, payload);
              result.updated += 1;
            } else {
              result.skipped += 1;
            }
          } else {
            await createProduct(payload);
            result.created += 1;
          }
        } catch (error) {
          result.failed.push({ row, sku: payload.sku, error: error.message });
        }
      }

      return result;
    }

    /* ------------------------------------------------------------------ */
    /* الفواتير والتقارير                                                   */
    /* ------------------------------------------------------------------ */

    async function exportInvoices(sales) {
      const symbol = settings().currencySymbol;
      const rows = [[
        'رقم الفاتورة', 'التاريخ', 'العميل', 'عدد الأصناف', 'نوع الدفع', 'الحالة',
        `المجموع الفرعي (${symbol})`, `الخصم (${symbol})`, `الضريبة (${symbol})`,
        `الإجمالي (${symbol})`, `المدفوع (${symbol})`, `المتبقي (${symbol})`,
      ]];

      const statusLabel = { completed: 'مكتملة', cancelled: 'ملغاة', pending: 'معلقة' };

      for (const sale of sales) {
        rows.push([
          sale.number,
          formatDateTime(sale.createdAt, settings().dateFormat),
          sale.customerName,
          sale.itemCount,
          sale.paymentType === 'credit' ? 'آجل' : 'نقدي',
          statusLabel[sale.status] || sale.status,
          toMajor(sale.subtotalMinor),
          toMajor(sale.discountMinor),
          toMajor(sale.taxMinor),
          toMajor(sale.totalMinor),
          toMajor(sale.paidMinor),
          toMajor(sale.dueMinor),
        ]);
      }

      return exportRows(rows, {
        fileName: exportFileName('الفواتير'),
        sheetName: 'الفواتير',
        columnWidths: [20, 20, 26, 12, 12, 12, 16, 14, 14, 16, 14, 14],
      });
    }

    async function exportCustomers(customers, ledgers) {
      const symbol = settings().currencySymbol;
      const rows = [[
        'الاسم', 'الهاتف', 'عدد الفواتير', `إجمالي المشتريات (${symbol})`,
        `الرصيد (${symbol})`, 'آخر شراء', 'الحالة', 'ملاحظة',
      ]];

      for (const customer of customers) {
        const ledger = ledgers.get(customer.id) || {};
        rows.push([
          customer.name,
          customer.phone || '',
          ledger.invoiceCount || 0,
          toMajor(ledger.purchasesMinor || 0),
          toMajor(ledger.balanceMinor || 0),
          ledger.lastPurchaseAt ? formatDateTime(ledger.lastPurchaseAt, settings().dateFormat) : '',
          customer.isActive === false ? 'غير نشط' : 'نشط',
          customer.note || '',
        ]);
      }

      return exportRows(rows, {
        fileName: exportFileName('العملاء'),
        sheetName: 'العملاء',
        columnWidths: [28, 16, 12, 20, 16, 20, 10, 30],
      });
    }

    async function exportExpenses(expenses, categories) {
      const symbol = settings().currencySymbol;
      const methodLabels = { cash: 'نقدي', bank: 'تحويل بنكي', card: 'بطاقة', cheque: 'شيك' };

      const rows = [['التاريخ', 'الفئة', 'البيان', `المبلغ (${symbol})`, 'طريقة الدفع', 'رقم المرجع', 'ملاحظة']];

      for (const expense of expenses) {
        rows.push([
          formatDateTime(expense.createdAt, settings().dateFormat),
          categories.get(expense.categoryId)?.name || '',
          expense.title || '',
          toMajor(expense.amountMinor),
          methodLabels[expense.method] || expense.method,
          expense.reference || '',
          expense.note || '',
        ]);
      }

      return exportRows(rows, {
        fileName: exportFileName('المصروفات'),
        sheetName: 'المصروفات',
        columnWidths: [20, 18, 32, 14, 14, 16, 30],
      });
    }

    async function exportInventory(products) {
      const symbol = settings().currencySymbol;
      const statusLabels = { ok: 'متوفر', low: 'منخفض', out: 'نفد المخزون' };

      const rows = [[
        'SKU', 'اسم المنتج', 'الفئة', 'الكمية الحالية', 'الحد الأدنى', 'الحالة',
        `سعر الشراء (${symbol})`, `سعر البيع (${symbol})`, `قيمة المخزون (${symbol})`,
      ]];

      for (const product of products) {
        rows.push([
          product.sku,
          product.name,
          product.categoryName || '',
          product.quantity,
          product.lowStockThreshold,
          statusLabels[product.status] || '',
          toMajor(product.costMinor),
          toMajor(product.priceMinor),
          toMajor(product.stockValueMinor ?? product.quantity * product.costMinor),
        ]);
      }

      return exportRows(rows, {
        fileName: exportFileName('المخزون'),
        sheetName: 'المخزون',
        columnWidths: [14, 32, 18, 14, 12, 14, 16, 16, 18],
      });
    }

    /** تصدير تقرير عام: عنوان + جدول */
    async function exportReport({ title, header, rows, fileName }) {
      return exportRows([header, ...rows], {
        fileName: fileName || exportFileName(title),
        sheetName: title.slice(0, 30),
        columnWidths: header.map((label) => Math.max(12, Math.min(32, String(label).length + 8))),
      });
    }


    Object.defineProperty(__exports, "XLSX_TYPES", { enumerable: true, get: function () { return XLSX_TYPES; } });
    Object.defineProperty(__exports, "exportFileName", { enumerable: true, get: function () { return exportFileName; } });
    Object.defineProperty(__exports, "exportRows", { enumerable: true, get: function () { return exportRows; } });
    Object.defineProperty(__exports, "PRODUCT_COLUMNS", { enumerable: true, get: function () { return PRODUCT_COLUMNS; } });
    Object.defineProperty(__exports, "exportProducts", { enumerable: true, get: function () { return exportProducts; } });
    Object.defineProperty(__exports, "downloadProductTemplate", { enumerable: true, get: function () { return downloadProductTemplate; } });
    Object.defineProperty(__exports, "parseProductsFile", { enumerable: true, get: function () { return parseProductsFile; } });
    Object.defineProperty(__exports, "commitProductsImport", { enumerable: true, get: function () { return commitProductsImport; } });
    Object.defineProperty(__exports, "exportInvoices", { enumerable: true, get: function () { return exportInvoices; } });
    Object.defineProperty(__exports, "exportCustomers", { enumerable: true, get: function () { return exportCustomers; } });
    Object.defineProperty(__exports, "exportExpenses", { enumerable: true, get: function () { return exportExpenses; } });
    Object.defineProperty(__exports, "exportInventory", { enumerable: true, get: function () { return exportInventory; } });
    Object.defineProperty(__exports, "exportReport", { enumerable: true, get: function () { return exportReport; } });
  });

  /* ================================================================== */
  /* src/services/images.js */
  __def("src/services/images.js", function (__exports, __m, __dyn) {
    /**
     * معالجة الصور المرفوعة.
     * الصور تُصغَّر قبل التخزين: صورة 5MB تصبح ~60KB، فلا تستهلك حصة التخزين
     * ولا تُثقل ملف النسخة الاحتياطية. تُخزَّن كـ data URL لتبقى النسخة الاحتياطية
     * JSON صالحاً بلا ترميز إضافي.
     */

    const { validateFile, IMAGE_TYPES, ATTACHMENT_TYPES, LIMITS } = __m("src/validation/validators.js");

    const MAX_EDGE = 600;
    const QUALITY = 0.82;

    /**
     * يتحقق من صورة ويصغّرها ويحوّلها إلى data URL.
     * @param {File} file
     * @returns {Promise<{dataUrl:string, width:number, height:number, bytes:number, name:string}>}
     */
    async function processImage(file) {
      const check = validateFile(file, {
        types: IMAGE_TYPES,
        maxBytes: LIMITS.imageBytes,
        label: 'الصورة',
      });
      if (!check.ok) throw new Error(check.error);

      const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error('تعذّر قراءة الصورة. تأكد أن الملف صورة صالحة.');
      });

      try {
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        // خلفية بيضاء حتى لا تصبح الشفافية سوداء بعد التحويل إلى JPEG
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);

        return {
          dataUrl,
          width,
          height,
          bytes: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75),
          name: file.name,
        };
      } finally {
        bitmap.close?.();
      }
    }

    /**
     * يعالج مرفقاً (صورة أو PDF). صور تُصغَّر، وPDF يُخزَّن كما هو ضمن حد الحجم.
     */
    async function processAttachment(file) {
      const check = validateFile(file, {
        types: ATTACHMENT_TYPES,
        maxBytes: LIMITS.attachmentBytes,
        label: 'المرفق',
      });
      if (!check.ok) throw new Error(check.error);

      if (file.type === 'application/pdf') {
        const dataUrl = await fileToDataUrl(file);
        return { dataUrl, name: file.name, type: file.type, bytes: file.size };
      }

      const image = await processImage(file);
      return { dataUrl: image.dataUrl, name: file.name, type: 'image/jpeg', bytes: image.bytes };
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
        reader.readAsDataURL(file);
      });
    }

    function fileToText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
        reader.readAsText(file, 'utf-8');
      });
    }

    /** يتحقق أن نصاً هو data URL لصورة قبل عرضه (حماية من مدخلات نسخة احتياطية معدّلة) */
    function isSafeImageDataUrl(value) {
      return typeof value === 'string'
        && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
        && value.length < 12_000_000;
    }

    function isSafeAttachmentDataUrl(value) {
      return typeof value === 'string'
        && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(value)
        && value.length < 12_000_000;
    }


    Object.defineProperty(__exports, "processImage", { enumerable: true, get: function () { return processImage; } });
    Object.defineProperty(__exports, "processAttachment", { enumerable: true, get: function () { return processAttachment; } });
    Object.defineProperty(__exports, "fileToDataUrl", { enumerable: true, get: function () { return fileToDataUrl; } });
    Object.defineProperty(__exports, "fileToText", { enumerable: true, get: function () { return fileToText; } });
    Object.defineProperty(__exports, "isSafeImageDataUrl", { enumerable: true, get: function () { return isSafeImageDataUrl; } });
    Object.defineProperty(__exports, "isSafeAttachmentDataUrl", { enumerable: true, get: function () { return isSafeAttachmentDataUrl; } });
  });

  /* ================================================================== */
  /* src/services/print.js */
  __def("src/services/print.js", function (__exports, __m, __dyn) {
    /**
     * الطباعة.
     *
     * لا نفتح نافذة جديدة (تحجبها المتصفحات وتفقد CSP). بدلاً من ذلك نبني المستند
     * داخل #print-region في نفس الصفحة، ويتكفّل print.css بإخفاء كل شيء آخر.
     * «حفظ PDF» هو نفس المسار — يختار المستخدم "حفظ كـ PDF" من مربع طباعة المتصفح.
     */

    const { h, render, clear, ltr } = __m("src/utils/dom.js");
    const { formatAmount } = __m("src/utils/format.js");
    const { formatDateTime, formatDate } = __m("src/utils/dates.js");
    const { settings } = __m("src/repositories/settings.js");
    const { SALE_STATUS_LABEL, PAYMENT_TYPE_LABEL } = __m("src/repositories/sales.js");

    const TEMPLATES = {
      A4: 'a4',
      THERMAL: 'thermal80',
      THERMAL_58: 'thermal58',
    };

    const TEMPLATE_LABEL = {
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
    function printInvoice(sale, items, template = settings().printTemplate) {
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
    function printReport({ title, subtitle, stats = [], tables = [] }) {
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


    Object.defineProperty(__exports, "TEMPLATES", { enumerable: true, get: function () { return TEMPLATES; } });
    Object.defineProperty(__exports, "TEMPLATE_LABEL", { enumerable: true, get: function () { return TEMPLATE_LABEL; } });
    Object.defineProperty(__exports, "printInvoice", { enumerable: true, get: function () { return printInvoice; } });
    Object.defineProperty(__exports, "printReport", { enumerable: true, get: function () { return printReport; } });
  });

  /* ================================================================== */
  /* src/services/pwa.js */
  __def("src/services/pwa.js", function (__exports, __m, __dyn) {
    /**
     * Service Worker والتخزين.
     *
     * حقيقة مهمة موثّقة في docs/offline-strategy.md: Service Worker **لا يعمل** من
     * بروتوكول file://. التطبيق يحتاج http://localhost أو HTTPS. نكشف ذلك للمستخدم
     * صراحةً في شاشة الإعدادات بدل الادعاء أن الأوفلاين مفعّل.
     */

    const { appState } = __m("src/state/store.js");

    const SW_URL = 'sw.js';

    /** هل السياق يسمح بتسجيل Service Worker؟ */
    function offlineCapability() {
      // ملاحظة: Chrome يعتبر file:// سياقاً آمناً (isSecureContext === true)
      // لكنه يرفض تسجيل Service Worker عليه، لذا نفحص البروتوكول صراحةً.
      if (window.location.protocol === 'file:') {
        return {
          ok: false,
          status: 'file',
          message: 'التطبيق يعمل من ملف محلي. كل الوظائف والبيانات تعمل بالكامل، لكن التخزين المؤقت للأصول والتثبيت كتطبيق يحتاجان تشغيله عبر خادم محلي أو HTTPS.',
        };
      }
      if (!('serviceWorker' in navigator)) {
        return { ok: false, status: 'unsupported', message: 'المتصفح لا يدعم Service Worker.' };
      }
      if (!window.isSecureContext) {
        return { ok: false, status: 'insecure', message: 'العمل دون اتصال يتطلب HTTPS أو localhost.' };
      }
      return { ok: true, status: 'ok', message: '' };
    }

    let registration = null;

    /** يسجّل Service Worker ويراقب التحديثات */
    async function registerServiceWorker() {
      const capability = offlineCapability();
      if (!capability.ok) {
        appState.set({ swStatus: capability.status });
        return { ...capability, registration: null };
      }

      try {
        registration = await navigator.serviceWorker.register(SW_URL, { scope: './' });

        // نسخة جديدة قيد التثبيت
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // "installed" مع وجود controller = نسخة جديدة جاهزة تنتظر التفعيل
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              appState.set({ updateAvailable: true });
            }
          });
        });

        // إذا كان هناك عامل ينتظر بالفعل عند التحميل
        if (registration.waiting && navigator.serviceWorker.controller) {
          appState.set({ updateAvailable: true });
        }

        appState.set({ swStatus: 'active' });
        await readCacheVersion();

        // تحقّق من وجود تحديث عند كل إقلاع
        registration.update().catch(() => {});

        return { ok: true, status: 'active', message: '', registration };
      } catch (error) {
        console.error('[pwa] فشل تسجيل Service Worker:', error);
        appState.set({ swStatus: 'failed' });
        return { ok: false, status: 'failed', message: 'تعذّر تفعيل العمل دون اتصال.', registration: null };
      }
    }

    /** يسأل العامل النشط عن إصدار الكاش */
    async function readCacheVersion() {
      const worker = navigator.serviceWorker.controller;
      if (!worker) return null;

      const version = await new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(null), 1500);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data?.version || null);
        };
        worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
      });

      if (version) appState.set({ cacheVersion: version });
      return version;
    }

    /**
     * يفعّل النسخة الجديدة ثم يعيد التحميل.
     * لا يُستدعى إلا بعد تأكيد المستخدم، حتى لا يفقد عملاً غير محفوظ.
     */
    async function applyUpdate() {
      if (!registration) registration = await navigator.serviceWorker.getRegistration();
      const waiting = registration?.waiting;

      if (!waiting) {
        window.location.reload();
        return;
      }

      // أعد التحميل مرة واحدة فقط عند تغيّر المتحكّم
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      waiting.postMessage({ type: 'SKIP_WAITING' });

      // احتياط لو لم يُطلق controllerchange
      setTimeout(() => {
        if (!reloaded) window.location.reload();
      }, 3000);
    }

    /* ------------------------------------------------------------------ */
    /* التخزين                                                              */
    /* ------------------------------------------------------------------ */

    /** يقرأ تقدير مساحة التخزين وحالة الدوام */
    async function readStorageEstimate() {
      if (!navigator.storage?.estimate) {
        appState.set({ storage: { usage: 0, quota: 0, persisted: false, supported: false } });
        return null;
      }

      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        const storage = { usage, quota, persisted, supported: true };
        appState.set({ storage });
        return storage;
      } catch (error) {
        console.warn('[pwa] تعذّر قراءة تقدير التخزين:', error);
        return null;
      }
    }

    /**
     * يطلب تخزيناً دائماً.
     * يجب أن يُستدعى بعد تفاعل واضح من المستخدم (نقرة زر)، لا تلقائياً عند الإقلاع.
     * @returns {Promise<{granted:boolean, message:string}>}
     */
    async function requestPersistentStorage() {
      if (!navigator.storage?.persist) {
        return { granted: false, message: 'المتصفح لا يدعم التخزين الدائم.' };
      }
      if (!window.isSecureContext) {
        return { granted: false, message: 'التخزين الدائم يتطلب HTTPS أو localhost.' };
      }

      try {
        const granted = await navigator.storage.persist();
        await readStorageEstimate();
        return {
          granted,
          message: granted
            ? 'تم تفعيل التخزين الدائم. لن يُحذف تلقائياً عند امتلاء مساحة الجهاز.'
            : 'لم يمنح المتصفح تخزيناً دائماً. قد يُحذف التخزين المحلي عند ضغط المساحة — احتفظ بنسخ احتياطية منتظمة.',
        };
      } catch (error) {
        return { granted: false, message: `تعذّر طلب التخزين الدائم: ${error.message}` };
      }
    }

    /* ------------------------------------------------------------------ */
    /* حالة الاتصال                                                         */
    /* ------------------------------------------------------------------ */

    function watchConnection() {
      const update = () => appState.set({ online: navigator.onLine });
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      update();
    }


    Object.defineProperty(__exports, "offlineCapability", { enumerable: true, get: function () { return offlineCapability; } });
    Object.defineProperty(__exports, "registerServiceWorker", { enumerable: true, get: function () { return registerServiceWorker; } });
    Object.defineProperty(__exports, "applyUpdate", { enumerable: true, get: function () { return applyUpdate; } });
    Object.defineProperty(__exports, "readStorageEstimate", { enumerable: true, get: function () { return readStorageEstimate; } });
    Object.defineProperty(__exports, "requestPersistentStorage", { enumerable: true, get: function () { return requestPersistentStorage; } });
    Object.defineProperty(__exports, "watchConnection", { enumerable: true, get: function () { return watchConnection; } });
  });

  /* ================================================================== */
  /* src/services/reports.js */
  __def("src/services/reports.js", function (__exports, __m, __dyn) {
    /**
     * تجميع بيانات لوحة التحكم والتقارير.
     *
     * كل الأرقام مشتقّة من السجلات الفعلية. لا توجد قيم ثابتة أو تقديرية.
     * الفواتير الملغاة مستبعدة من كل مقاييس الإيراد والربح.
     */

    const { salesInRange, saleItemsInRange, SALE_STATUS } = __m("src/repositories/sales.js");
    const { expensesInRange } = __m("src/repositories/expenses.js");
    const { paymentsInRange } = __m("src/repositories/customers.js");
    const { listProducts, stockStatus, STOCK_STATUS, categoryMap } = __m("src/repositories/products.js");
    const { movementsInRange } = __m("src/repositories/inventory.js");
    const { expenseCategoryMap } = __m("src/repositories/expenses.js");
    const { dayRange, dayKey, previousRange, relativeDayLabel } = __m("src/utils/dates.js");
    const { returnsInRange } = __m("src/repositories/returns.js");

    const isCounted = (sale) => sale.status !== SALE_STATUS.CANCELLED;

    /**
     * يجمع كل ما تحتاجه شاشة تقرير أو لوحة تحكم لفترة معيّنة، بقراءة واحدة.
     */
    async function periodSummary(fromKey, toKey) {
      const [sales, items, expenses, payments, returns] = await Promise.all([
        salesInRange(fromKey, toKey),
        saleItemsInRange(fromKey, toKey),
        expensesInRange(fromKey, toKey),
        paymentsInRange(fromKey, toKey),
        returnsInRange(fromKey, toKey),
      ]);

      const counted = sales.filter(isCounted);
      const countedIds = new Set(counted.map((sale) => sale.id));
      const countedItems = items.filter((item) => countedIds.has(item.saleId));

      const returnedMinor = returns.reduce((sum, item) => sum + item.refundMinor, 0);
      const revenueMinor = counted.reduce((sum, sale) => sum + sale.totalMinor, 0) - returnedMinor;
      const taxRatio = counted.reduce((sum, sale) => sum + sale.totalMinor, 0) > 0
        ? counted.reduce((sum, sale) => sum + sale.taxMinor, 0) / counted.reduce((sum, sale) => sum + sale.totalMinor, 0) : 0;
      const netRevenueMinor = counted.reduce((sum, sale) => sum + sale.totalMinor - sale.taxMinor, 0) - Math.round(returnedMinor * (1 - taxRatio));
      const costMinor = countedItems.reduce((sum, item) => sum + item.unitCostMinor * item.quantity, 0);
      const expensesMinor = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0);

      return {
        fromKey,
        toKey,
        sales: counted,
        cancelledSales: sales.filter((sale) => !isCounted(sale)),
        items: countedItems,
        expenses,
        payments,
        returns,

        invoiceCount: counted.length,
        revenueMinor,
        netRevenueMinor,
        taxMinor: counted.reduce((sum, sale) => sum + sale.taxMinor, 0),
        discountMinor: counted.reduce((sum, sale) => sum + sale.discountMinor, 0),
        returnedMinor,
        costMinor,
        expensesMinor,
        // الربح التقديري = صافي الإيراد (بلا ضريبة) − تكلفة البضاعة المباعة − المصروفات
        grossProfitMinor: netRevenueMinor - costMinor,
        estimatedProfitMinor: netRevenueMinor - costMinor - expensesMinor,
        grossMarginPercent: netRevenueMinor > 0 ? ((netRevenueMinor - costMinor) / netRevenueMinor) * 100 : 0,
        netCashFlowMinor: revenueMinor - expensesMinor,
        averageInvoiceMinor: counted.length > 0 ? Math.round(revenueMinor / counted.length) : 0,
        unitCount: countedItems.reduce((sum, item) => sum + item.quantity, 0),

        cashMinor: counted.filter((s) => s.paymentType === 'cash').reduce((sum, s) => sum + s.totalMinor, 0),
        creditMinor: counted.filter((s) => s.paymentType === 'credit').reduce((sum, s) => sum + s.totalMinor, 0),
        dueMinor: counted.reduce((sum, sale) => sum + (sale.dueMinor || 0), 0),
        collectedMinor: payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
      };
    }

    /** سلسلة يومية للمبيعات والمصروفات على مدى الفترة */
    function dailySeries(summary) {
      const keys = dayRange(summary.fromKey, summary.toKey);

      const salesByDay = new Map();
      for (const sale of summary.sales) {
        salesByDay.set(sale.dayKey, (salesByDay.get(sale.dayKey) || 0) + sale.totalMinor);
      }

      const expensesByDay = new Map();
      for (const expense of summary.expenses) {
        expensesByDay.set(expense.dayKey, (expensesByDay.get(expense.dayKey) || 0) + expense.amountMinor);
      }

      return keys.map((key) => ({
        key,
        label: key,
        relativeLabel: relativeDayLabel(key),
        salesMinor: salesByDay.get(key) || 0,
        expensesMinor: expensesByDay.get(key) || 0,
      }));
    }

    /** الأكثر مبيعاً حسب الكمية */
    function topProducts(summary, limit = 10) {
      const byProduct = new Map();

      for (const item of summary.items) {
        const entry = byProduct.get(item.productId) || {
          productId: item.productId, name: item.name, sku: item.sku,
          quantity: 0, revenueMinor: 0, costMinor: 0,
        };
        entry.quantity += item.quantity;
        entry.revenueMinor += item.lineTotalMinor;
        entry.costMinor += item.unitCostMinor * item.quantity;
        byProduct.set(item.productId, entry);
      }

      return [...byProduct.values()].map((entry) => ({ ...entry, profitMinor: entry.revenueMinor - entry.costMinor, marginPercent: entry.revenueMinor > 0 ? ((entry.revenueMinor - entry.costMinor) / entry.revenueMinor) * 100 : 0 }))
        .sort((a, b) => b.quantity - a.quantity || b.revenueMinor - a.revenueMinor)
        .slice(0, limit);
    }

    /** أصناف لم تسجل لها حركة بيع خلال المدة المحددة. */
    async function stagnantProducts(days = 60) {
      const end = dayKey(new Date());
      const start = shiftDays(end, -Math.max(1, days));
      const [products, sales] = await Promise.all([listProducts(), salesInRange('0000-01-01', end)]);
      const activeSales = new Set(sales.filter(isCounted).map((sale) => sale.id));
      const items = await saleItemsInRange('0000-01-01', end);
      const lastSale = new Map();
      for (const item of items) if (activeSales.has(item.saleId) && (!lastSale.get(item.productId) || item.dayKey > lastSale.get(item.productId))) lastSale.set(item.productId, item.dayKey);
      return products.filter((product) => product.isActive !== false && product.quantity > 0).map((product) => ({ ...product, lastSaleDay: lastSale.get(product.id) || null, inactiveDays: lastSale.get(product.id) ? Math.floor((new Date(end) - new Date(lastSale.get(product.id))) / 86400000) : null })).filter((product) => !product.lastSaleDay || product.lastSaleDay < start).sort((a, b) => (b.inactiveDays || Infinity) - (a.inactiveDays || Infinity));
    }

    /** المبيعات حسب فئة المنتج */
    async function salesByCategory(summary) {
      const [products, categories] = await Promise.all([listProducts(), categoryMap()]);
      const productCategory = new Map(products.map((product) => [product.id, product.categoryId]));

      const totals = new Map();
      for (const item of summary.items) {
        const categoryId = productCategory.get(item.productId);
        const category = categories.get(categoryId);
        const name = category?.name || 'غير مصنّف';
        const entry = totals.get(name) || { label: name, value: 0, color: category?.color };
        entry.value += item.lineTotalMinor;
        totals.set(name, entry);
      }

      return [...totals.values()].sort((a, b) => b.value - a.value);
    }

    /** المصروفات حسب الفئة */
    async function expensesByCategory(summary) {
      const categories = await expenseCategoryMap();

      const totals = new Map();
      for (const expense of summary.expenses) {
        const category = categories.get(expense.categoryId);
        const name = category?.name || 'أخرى';
        const entry = totals.get(name) || { label: name, value: 0, color: category?.color };
        entry.value += expense.amountMinor;
        totals.set(name, entry);
      }

      return [...totals.values()].sort((a, b) => b.value - a.value);
    }

    /** توزيع طرق الدفع */
    function paymentMethods(summary) {
      return [
        { label: 'نقدي', value: summary.cashMinor, color: '#12855A' },
        { label: 'آجل', value: summary.creditMinor, color: '#1B63E3' },
      ].filter((slice) => slice.value > 0);
    }

    /** تقرير المخزون المنخفض والمنعدم */
    async function stockReport() {
      const [products, categories] = await Promise.all([listProducts(), categoryMap()]);
      const active = products.filter((product) => product.isActive !== false);

      const withStatus = active.map((product) => ({
        ...product,
        status: stockStatus(product),
        categoryName: categories.get(product.categoryId)?.name || '—',
        stockValueMinor: product.quantity * product.costMinor,
      }));

      return {
        all: withStatus,
        low: withStatus.filter((product) => product.status === STOCK_STATUS.LOW),
        out: withStatus.filter((product) => product.status === STOCK_STATUS.OUT),
        totalProducts: withStatus.length,
        totalUnits: withStatus.reduce((sum, product) => sum + product.quantity, 0),
        stockValueMinor: withStatus.reduce((sum, product) => sum + product.stockValueMinor, 0),
        retailValueMinor: withStatus.reduce((sum, product) => sum + product.quantity * product.priceMinor, 0),
      };
    }

    /** تقرير حركات المخزون مجمّعاً بالسبب (نمط Zoho) */
    async function movementReport(fromKey, toKey) {
      const movements = await movementsInRange(fromKey, toKey);

      const byReason = new Map();
      for (const movement of movements) {
        const key = movement.reason || 'غير محدّد';
        const entry = byReason.get(key) || { reason: key, increases: 0, decreases: 0, count: 0 };
        if (movement.quantity >= 0) entry.increases += movement.quantity;
        else entry.decreases += Math.abs(movement.quantity);
        entry.count += 1;
        byReason.set(key, entry);
      }

      return { movements, byReason: [...byReason.values()].sort((a, b) => b.count - a.count) };
    }

    /**
     * ملخص لوحة التحكم: اليوم مقارنةً بأمس، مع سلسلة 7 أيام.
     */
    async function dashboardData() {
      const today = dayKey(new Date());
      const yesterday = shiftDays(today, -1);

      const [todaySummary, yesterdaySummary, weekSummary] = await Promise.all([
        periodSummary(today, today),
        periodSummary(yesterday, yesterday),
        periodSummary(shiftDays(today, -6), today),
      ]);

      const [expenseSlices, lowStock] = await Promise.all([
        expensesByCategory(weekSummary),
        stockReport(),
      ]);

      return {
        today: todaySummary,
        yesterday: yesterdaySummary,
        week: weekSummary,
        series: dailySeries(weekSummary),
        expenseSlices,
        lowStockProducts: [...lowStock.out, ...lowStock.low].slice(0, 5),
        lowStockCount: lowStock.low.length + lowStock.out.length,
        recentSales: weekSummary.sales
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 5),
      };
    }

    function shiftDays(key, days) {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d + days);
      return dayKey(date);
    }

    /** مقارنة فترة بالفترة السابقة المماثلة */
    async function compareWithPrevious(fromKey, toKey) {
      const previous = previousRange(fromKey, toKey);
      const [current, prior] = await Promise.all([
        periodSummary(fromKey, toKey),
        periodSummary(previous.from, previous.to),
      ]);
      return { current, prior, previousRange: previous };
    }


    Object.defineProperty(__exports, "periodSummary", { enumerable: true, get: function () { return periodSummary; } });
    Object.defineProperty(__exports, "dailySeries", { enumerable: true, get: function () { return dailySeries; } });
    Object.defineProperty(__exports, "topProducts", { enumerable: true, get: function () { return topProducts; } });
    Object.defineProperty(__exports, "stagnantProducts", { enumerable: true, get: function () { return stagnantProducts; } });
    Object.defineProperty(__exports, "salesByCategory", { enumerable: true, get: function () { return salesByCategory; } });
    Object.defineProperty(__exports, "expensesByCategory", { enumerable: true, get: function () { return expensesByCategory; } });
    Object.defineProperty(__exports, "paymentMethods", { enumerable: true, get: function () { return paymentMethods; } });
    Object.defineProperty(__exports, "stockReport", { enumerable: true, get: function () { return stockReport; } });
    Object.defineProperty(__exports, "movementReport", { enumerable: true, get: function () { return movementReport; } });
    Object.defineProperty(__exports, "dashboardData", { enumerable: true, get: function () { return dashboardData; } });
    Object.defineProperty(__exports, "compareWithPrevious", { enumerable: true, get: function () { return compareWithPrevious; } });
  });

  /* ================================================================== */
  /* src/state/store.js */
  __def("src/state/store.js", function (__exports, __m, __dyn) {
    /**
     * مخزن حالة صغير مع اشتراكات وتنظيف.
     * لا يُستخدم لتخزين بيانات العمل (تلك في IndexedDB) بل لحالة الواجهة المشتركة:
     * العربة، حالة الاتصال، الإعدادات المحمّلة، وحالة Service Worker.
     */

    function createStore(initialState = {}) {
      let state = { ...initialState };
      const listeners = new Set();

      function get() {
        return state;
      }

      function set(patch) {
        const next = typeof patch === 'function' ? patch(state) : patch;
        const changed = Object.keys(next).some((key) => state[key] !== next[key]);
        if (!changed) return state;

        state = { ...state, ...next };
        for (const listener of [...listeners]) {
          try {
            listener(state);
          } catch (error) {
            console.error('[store] فشل مستمع:', error);
          }
        }
        return state;
      }

      /** يشترك في التغييرات ويرجع دالة إلغاء الاشتراك */
      function subscribe(listener, { immediate = false } = {}) {
        listeners.add(listener);
        if (immediate) listener(state);
        return () => listeners.delete(listener);
      }

      return { get, set, subscribe, get size() { return listeners.size; } };
    }

    /* ------------------------------------------------------------------ */
    /* الحالة العامة للتطبيق                                                */
    /* ------------------------------------------------------------------ */

    const appState = createStore({
      online: navigator.onLine,
      settings: null,
      updateAvailable: false,
      swStatus: 'unknown',      // 'unknown' | 'active' | 'unsupported' | 'insecure' | 'failed'
      cacheVersion: null,
      storage: null,            // { usage, quota, persisted }
      suspendedCount: 0,
      sidebarOpen: false,
      dataVersion: 0,           // يزداد بعد أي تغيير بيانات ليعيد رسم الشاشات المفتوحة
    });

    /** يعلن أن البيانات تغيّرت، فتُحدّث الشاشات المشتركة نفسها */
    function notifyDataChanged() {
      appState.set((state) => ({ dataVersion: state.dataVersion + 1 }));
    }

    /* ------------------------------------------------------------------ */
    /* عربة نقطة البيع                                                      */
    /* ------------------------------------------------------------------ */

    const cartState = createStore({
      lines: [],                                  // {productId, name, sku, unit, unitPriceMinor, quantity, stock}
      customer: { id: null, name: 'عميل نقدي' },
      discount: { type: 'amount', value: 0 },
      paymentType: 'cash',
      note: '',
    });

    const cartActions = {
      add(product, quantity = 1) {
        cartState.set((state) => {
          const lines = [...state.lines];
          const index = lines.findIndex((line) => line.productId === product.id);

          if (index >= 0) {
            const next = lines[index].quantity + quantity;
            lines[index] = { ...lines[index], quantity: next };
          } else {
            lines.push({
              productId: product.id,
              name: product.name,
              sku: product.sku,
              unit: product.unit,
              unitPriceMinor: product.priceMinor,
              quantity,
              stock: product.quantity,
            });
          }
          return { lines };
        });
      },

      setQuantity(productId, quantity) {
        cartState.set((state) => ({
          lines: quantity <= 0
            ? state.lines.filter((line) => line.productId !== productId)
            : state.lines.map((line) => (line.productId === productId ? { ...line, quantity } : line)),
        }));
      },

      remove(productId) {
        cartState.set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) }));
      },

      setCustomer(customer) {
        cartState.set({ customer: customer || { id: null, name: 'عميل نقدي' } });
        // العميل النقدي لا يمكن أن يشتري آجلاً
        if (!customer?.id && cartState.get().paymentType === 'credit') {
          cartState.set({ paymentType: 'cash' });
        }
      },

      setDiscount(discount) {
        cartState.set({ discount: discount || { type: 'amount', value: 0 } });
      },

      setPaymentType(paymentType) {
        cartState.set({ paymentType });
      },

      load(saved) {
        cartState.set({
          lines: saved.lines || [],
          customer: saved.customerId
            ? { id: saved.customerId, name: saved.customerName }
            : { id: null, name: 'عميل نقدي' },
          discount: saved.discount || { type: 'amount', value: 0 },
          paymentType: 'cash',
          note: saved.note || '',
        });
      },

      clear() {
        cartState.set({
          lines: [],
          customer: { id: null, name: 'عميل نقدي' },
          discount: { type: 'amount', value: 0 },
          paymentType: 'cash',
          note: '',
        });
      },
    };


    Object.defineProperty(__exports, "createStore", { enumerable: true, get: function () { return createStore; } });
    Object.defineProperty(__exports, "appState", { enumerable: true, get: function () { return appState; } });
    Object.defineProperty(__exports, "notifyDataChanged", { enumerable: true, get: function () { return notifyDataChanged; } });
    Object.defineProperty(__exports, "cartState", { enumerable: true, get: function () { return cartState; } });
    Object.defineProperty(__exports, "cartActions", { enumerable: true, get: function () { return cartActions; } });
  });

  /* ================================================================== */
  /* src/utils/dates.js */
  __def("src/utils/dates.js", function (__exports, __m, __dyn) {
    /**
     * التعامل مع التواريخ.
     * التخزين دائماً بصيغة ISO (UTC) في الحقل `createdAt`، ومعه `dayKey` محلي
     * بصيغة YYYY-MM-DD لأن التقارير اليومية يجب أن تتبع اليوم المحلي للمتجر
     * لا يوم UTC (وإلا انقسمت مبيعات المساء على يومين).
     */

    const PAD = (n) => String(n).padStart(2, '0');

    function now() {
      return new Date();
    }

    function toISO(date = new Date()) {
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
    function monotonicISO(date = new Date()) {
      const now = Math.max(date.getTime(), lastStamp + 1);
      lastStamp = now;
      return new Date(now).toISOString();
    }

    /** مفتاح اليوم المحلي YYYY-MM-DD */
    function dayKey(date = new Date()) {
      const d = date instanceof Date ? date : new Date(date);
      return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
    }

    /** مفتاح الشهر المحلي YYYY-MM */
    function monthKey(date = new Date()) {
      return dayKey(date).slice(0, 7);
    }

    function fromDayKey(key) {
      const [y, m, d] = String(key).split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    }

    function addDays(date, days) {
      const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
      d.setDate(d.getDate() + days);
      return d;
    }

    function startOfDay(date = new Date()) {
      const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
      d.setHours(0, 0, 0, 0);
      return d;
    }

    function endOfDay(date = new Date()) {
      const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
      d.setHours(23, 59, 59, 999);
      return d;
    }

    /** قائمة مفاتيح الأيام بين تاريخين (شاملة الطرفين) */
    function dayRange(fromKey, toKey) {
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
    function presetRange(preset) {
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
    function previousRange(fromKey, toKey) {
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

    const DATE_FORMATS = Object.keys(DATE_PATTERNS);

    /** تنسيق تاريخ حسب إعداد المتجر */
    function formatDate(value, pattern = 'YYYY-MM-DD') {
      if (!value) return '—';
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return '—';
      return (DATE_PATTERNS[pattern] || DATE_PATTERNS['YYYY-MM-DD'])(d);
    }

    /** وقت 12 ساعة بالعربية: "10:30 ص" */
    function formatTime(value) {
      if (!value) return '';
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      const hours = d.getHours();
      const period = hours < 12 ? 'ص' : 'م';
      const h12 = hours % 12 === 0 ? 12 : hours % 12;
      return `${h12}:${PAD(d.getMinutes())} ${period}`;
    }

    function formatDateTime(value, pattern = 'YYYY-MM-DD') {
      if (!value) return '—';
      const time = formatTime(value);
      return time ? `${formatDate(value, pattern)} ${time}` : formatDate(value, pattern);
    }

    /** وصف نسبي مختصر: اليوم / أمس / منذ 3 أيام */
    function relativeDayLabel(key) {
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
    function fileStamp(date = new Date()) {
      return `${dayKey(date)}-${PAD(date.getHours())}${PAD(date.getMinutes())}`;
    }

    /** يتحقق أن النص مفتاح يوم صالح */
    function isDayKey(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
      const d = fromDayKey(value);
      return !Number.isNaN(d.getTime()) && dayKey(d) === value;
    }


    Object.defineProperty(__exports, "now", { enumerable: true, get: function () { return now; } });
    Object.defineProperty(__exports, "toISO", { enumerable: true, get: function () { return toISO; } });
    Object.defineProperty(__exports, "monotonicISO", { enumerable: true, get: function () { return monotonicISO; } });
    Object.defineProperty(__exports, "dayKey", { enumerable: true, get: function () { return dayKey; } });
    Object.defineProperty(__exports, "monthKey", { enumerable: true, get: function () { return monthKey; } });
    Object.defineProperty(__exports, "fromDayKey", { enumerable: true, get: function () { return fromDayKey; } });
    Object.defineProperty(__exports, "addDays", { enumerable: true, get: function () { return addDays; } });
    Object.defineProperty(__exports, "startOfDay", { enumerable: true, get: function () { return startOfDay; } });
    Object.defineProperty(__exports, "endOfDay", { enumerable: true, get: function () { return endOfDay; } });
    Object.defineProperty(__exports, "dayRange", { enumerable: true, get: function () { return dayRange; } });
    Object.defineProperty(__exports, "presetRange", { enumerable: true, get: function () { return presetRange; } });
    Object.defineProperty(__exports, "previousRange", { enumerable: true, get: function () { return previousRange; } });
    Object.defineProperty(__exports, "DATE_FORMATS", { enumerable: true, get: function () { return DATE_FORMATS; } });
    Object.defineProperty(__exports, "formatDate", { enumerable: true, get: function () { return formatDate; } });
    Object.defineProperty(__exports, "formatTime", { enumerable: true, get: function () { return formatTime; } });
    Object.defineProperty(__exports, "formatDateTime", { enumerable: true, get: function () { return formatDateTime; } });
    Object.defineProperty(__exports, "relativeDayLabel", { enumerable: true, get: function () { return relativeDayLabel; } });
    Object.defineProperty(__exports, "fileStamp", { enumerable: true, get: function () { return fileStamp; } });
    Object.defineProperty(__exports, "isDayKey", { enumerable: true, get: function () { return isDayKey; } });
  });

  /* ================================================================== */
  /* src/utils/dom.js */
  __def("src/utils/dom.js", function (__exports, __m, __dyn) {
    /**
     * بناء DOM آمن.
     * لا يوجد في هذا الملف — ولا في التطبيق كله — أي استخدام لـ innerHTML مع مدخلات المستخدم.
     * كل النصوص تُكتب عبر textContent أو createTextNode.
     */

    const SVG_NS = 'http://www.w3.org/2000/svg';

    /**
     * ينشئ عنصراً.
     * @param {string} tag اسم الوسم، ويمكن أن يكون "svg:path" لعناصر SVG
     * @param {object} [props] الخصائص. مفاتيح خاصة: class, text, style, dataset, attrs, on, ref
     * @param {...(Node|string|number|null|undefined|Array)} children
     */
    function h(tag, props, ...children) {
      let el;
      if (tag.startsWith('svg:')) {
        el = document.createElementNS(SVG_NS, tag.slice(4));
      } else {
        el = document.createElement(tag);
      }

      if (props) {
        for (const [key, value] of Object.entries(props)) {
          if (value == null || value === false) continue;

          switch (key) {
            case 'class':
              el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
              break;
            case 'text':
              el.textContent = String(value);
              break;
            case 'style':
              // CSSOM مسموح تحت CSP الصارمة، بعكس سمة style في الترميز
              for (const [prop, v] of Object.entries(value)) {
                if (v != null) el.style.setProperty(prop, String(v));
              }
              break;
            case 'dataset':
              for (const [k, v] of Object.entries(value)) {
                if (v != null) el.dataset[k] = String(v);
              }
              break;
            case 'attrs':
              for (const [k, v] of Object.entries(value)) {
                if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
              }
              break;
            case 'on':
              for (const [type, handler] of Object.entries(value)) {
                if (handler) el.addEventListener(type, handler);
              }
              break;
            case 'ref':
              if (typeof value === 'function') value(el);
              break;
            case 'html':
              throw new Error('h(): استخدام html ممنوع. استخدم text أو عناصر فرعية.');
            default:
              if (value === true) el.setAttribute(key, '');
              else el.setAttribute(key, String(value));
          }
        }
      }

      append(el, children);
      return el;
    }

    /** يضيف أبناءً (مع تسطيح المصفوفات وتجاهل null) */
    function append(parent, children) {
      for (const child of children.flat(Infinity)) {
        if (child == null || child === false || child === true) continue;
        parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
      }
      return parent;
    }

    /** يفرّغ عنصراً من كل أبنائه */
    function clear(el) {
      while (el.firstChild) el.removeChild(el.firstChild);
      return el;
    }

    /** يستبدل محتوى عنصر بمحتوى جديد */
    function render(el, ...children) {
      clear(el);
      append(el, children);
      return el;
    }

    /** نص محايد الاتجاه للقيم اللاتينية (SKU، أرقام الفواتير، التواريخ) */
    function ltr(value) {
      return h('bdi', { dir: 'ltr', text: value ?? '' });
    }

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    /** يؤخر تنفيذ دالة (للبحث الحي) */
    function debounce(fn, ms = 250) {
      let timer;
      const wrapped = (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
      };
      wrapped.cancel = () => clearTimeout(timer);
      return wrapped;
    }

    /**
     * يحصر التنقل بلوحة المفاتيح داخل عنصر (للنوافذ واللوحات الجانبية).
     * يرجع دالة تنظيف.
     */
    function trapFocus(container, onEscape) {
      const previouslyFocused = document.activeElement;
      const SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

      const focusables = () => Array.from(container.querySelectorAll(SELECTOR)).filter(el => el.offsetParent !== null);

      const first = focusables()[0];
      (first || container).focus();

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onEscape?.();
          return;
        }
        if (event.key !== 'Tab') return;

        const items = focusables();
        if (items.length === 0) return;

        const firstItem = items[0];
        const lastItem = items[items.length - 1];

        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem.focus();
        }
      };

      container.addEventListener('keydown', onKeyDown);

      return () => {
        container.removeEventListener('keydown', onKeyDown);
        if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
          previouslyFocused.focus();
        }
      };
    }

    /** يغلق عنصراً عند النقر خارجه. يرجع دالة تنظيف. */
    function onClickOutside(el, handler) {
      const listener = (event) => {
        if (!el.contains(event.target)) handler(event);
      };
      // تأجيل بإطار واحد حتى لا تُلتقط النقرة التي فتحت العنصر
      requestAnimationFrame(() => document.addEventListener('pointerdown', listener));
      return () => document.removeEventListener('pointerdown', listener);
    }


    Object.defineProperty(__exports, "h", { enumerable: true, get: function () { return h; } });
    Object.defineProperty(__exports, "append", { enumerable: true, get: function () { return append; } });
    Object.defineProperty(__exports, "clear", { enumerable: true, get: function () { return clear; } });
    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
    Object.defineProperty(__exports, "ltr", { enumerable: true, get: function () { return ltr; } });
    Object.defineProperty(__exports, "$", { enumerable: true, get: function () { return $; } });
    Object.defineProperty(__exports, "$$", { enumerable: true, get: function () { return $$; } });
    Object.defineProperty(__exports, "debounce", { enumerable: true, get: function () { return debounce; } });
    Object.defineProperty(__exports, "trapFocus", { enumerable: true, get: function () { return trapFocus; } });
    Object.defineProperty(__exports, "onClickOutside", { enumerable: true, get: function () { return onClickOutside; } });
  });

  /* ================================================================== */
  /* src/utils/format.js */
  __def("src/utils/format.js", function (__exports, __m, __dyn) {
    /** تنسيق الأرقام والتواريخ والنصوص للعرض. */

    const { toMajor } = __m("src/utils/money.js");

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
    function formatAmount(minor, digits = 2) {
      const value = toMajor(minor ?? 0);
      if (digits === 2) return numberFormatter.format(value);
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    }

    /** مبلغ بوحدة صغرى → نص "1,250.00 ر.س" */
    function formatMoney(minor, currencySymbol = '', { decimals = 2, symbolPosition = 'after' } = {}) {
      const amount = formatAmount(minor, decimals);
      if (!currencySymbol) return amount;
      return symbolPosition === 'before' ? `${currencySymbol} ${amount}` : `${amount} ${currencySymbol}`;
    }

    function formatInt(value) {
      return intFormatter.format(value ?? 0);
    }

    function formatCompact(value) {
      return compactFormatter.format(value ?? 0);
    }

    function formatPercent(value, digits = 1) {
      const num = Number(value);
      if (!Number.isFinite(num)) return '0%';
      return `${num.toFixed(digits).replace(/\.0+$/, '')}%`;
    }

    /** حجم بالبايت → نص عربي مقروء */
    function formatBytes(bytes) {
      if (!bytes || bytes < 0) return '0 بايت';
      const units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت', 'تيرابايت'];
      const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      const value = bytes / 1024 ** exponent;
      return `${value.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
    }

    /** تنسيق كمية: يحذف الأصفار العشرية غير المفيدة */
    function formatQty(value) {
      const num = Number(value ?? 0);
      return Number.isInteger(num) ? intFormatter.format(num) : num.toFixed(3).replace(/\.?0+$/, '');
    }

    /** الحرف/الحرفان الأولان من الاسم للأفاتار */
    function initials(name) {
      const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return '؟';
      if (parts.length === 1) return parts[0].slice(0, 2);
      return parts[0][0] + parts[1][0];
    }

    /** يقصّ نصاً طويلاً */
    function truncate(text, max = 60) {
      const str = String(text ?? '');
      return str.length > max ? `${str.slice(0, max - 1)}…` : str;
    }

    function pluralAr(count, one, two, few, many) {
      if (count === 1) return one;
      if (count === 2) return two;
      if (count >= 3 && count <= 10) return few;
      return many;
    }

    /** "3 أصناف" / "صنف واحد" */
    function itemsLabel(count) {
      if (count === 0) return 'لا أصناف';
      if (count === 1) return 'صنف واحد';
      if (count === 2) return 'صنفان';
      if (count <= 10) return `${count} أصناف`;
      return `${count} صنف`;
    }

    function invoicesLabel(count) {
      if (count === 0) return 'لا فواتير';
      if (count === 1) return 'فاتورة واحدة';
      if (count === 2) return 'فاتورتان';
      if (count <= 10) return `${count} فواتير`;
      return `${count} فاتورة`;
    }


    Object.defineProperty(__exports, "formatAmount", { enumerable: true, get: function () { return formatAmount; } });
    Object.defineProperty(__exports, "formatMoney", { enumerable: true, get: function () { return formatMoney; } });
    Object.defineProperty(__exports, "formatInt", { enumerable: true, get: function () { return formatInt; } });
    Object.defineProperty(__exports, "formatCompact", { enumerable: true, get: function () { return formatCompact; } });
    Object.defineProperty(__exports, "formatPercent", { enumerable: true, get: function () { return formatPercent; } });
    Object.defineProperty(__exports, "formatBytes", { enumerable: true, get: function () { return formatBytes; } });
    Object.defineProperty(__exports, "formatQty", { enumerable: true, get: function () { return formatQty; } });
    Object.defineProperty(__exports, "initials", { enumerable: true, get: function () { return initials; } });
    Object.defineProperty(__exports, "truncate", { enumerable: true, get: function () { return truncate; } });
    Object.defineProperty(__exports, "pluralAr", { enumerable: true, get: function () { return pluralAr; } });
    Object.defineProperty(__exports, "itemsLabel", { enumerable: true, get: function () { return itemsLabel; } });
    Object.defineProperty(__exports, "invoicesLabel", { enumerable: true, get: function () { return invoicesLabel; } });
  });

  /* ================================================================== */
  /* src/utils/id.js */
  __def("src/utils/id.js", function (__exports, __m, __dyn) {
    /** معرفات مستقرة وفريدة. */

    /**
     * معرّف عشوائي. crypto.randomUUID متاح في السياقات الآمنة فقط،
     * ونستخدم getRandomValues كبديل حتى يعمل الاختبار على http://localhost في كل الحالات.
     */
    function uid(prefix = '') {
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
    function formatInvoiceNumber(prefix, sequence, year, padding = 5) {
      const seq = String(sequence).padStart(padding, '0');
      return year ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`;
    }


    Object.defineProperty(__exports, "uid", { enumerable: true, get: function () { return uid; } });
    Object.defineProperty(__exports, "formatInvoiceNumber", { enumerable: true, get: function () { return formatInvoiceNumber; } });
  });

  /* ================================================================== */
  /* src/utils/money.js */
  __def("src/utils/money.js", function (__exports, __m, __dyn) {
    /**
     * حساب مالي بوحدات صغرى صحيحة (Integer minor units).
     * كل القيم المالية في قاعدة البيانات مخزّنة كأعداد صحيحة (قروش/هللات)،
     * ولا تُستخدم أعداد عشرية في أي عملية حسابية لتفادي أخطاء Floating Point.
     */

    const MINOR_PER_MAJOR = 100;

    /** يحوّل مدخل المستخدم (نص أو رقم بوحدة كبرى) إلى وحدة صغرى صحيحة. */
    function toMinor(input) {
      if (input == null || input === '') return 0;

      const normalized = String(input)
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))   // أرقام عربية-هندية
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))   // أرقام فارسية
        .replace(/[,\s٬ ]/g, '')                            // فواصل آلاف
        .replace(/٫/g, '.')                                      // الفاصلة العشرية العربية
        .trim();

      if (!/^-?\d*\.?\d*$/.test(normalized) || normalized === '' || normalized === '-') return NaN;

      const negative = normalized.startsWith('-');
      const [whole = '0', fraction = ''] = normalized.replace('-', '').split('.');
      const cents = (fraction + '00').slice(0, 2);

      // التقريب على الرقم العشري الثالث (half-up) حتى لا يُهمل إدخال مثل 1.005
      const third = Number(fraction[2] || 0);
      let value = Number(whole) * MINOR_PER_MAJOR + Number(cents);
      if (third >= 5) value += 1;

      if (!Number.isFinite(value)) return NaN;
      return negative ? -value : value;
    }

    /** يحوّل وحدة صغرى إلى رقم بوحدة كبرى (للعرض أو التصدير فقط، لا للحساب). */
    function toMajor(minor) {
      return (minor ?? 0) / MINOR_PER_MAJOR;
    }

    /** تقريب half-away-from-zero — الأنسب للضريبة والخصم في الفوترة. */
    function roundHalfUp(value) {
      return value < 0 ? -Math.round(-value) : Math.round(value);
    }

    /** نسبة مئوية من مبلغ بوحدة صغرى. rateBp = نقاط أساس (1% = 100). */
    function percentOf(minor, rateBp) {
      return roundHalfUp((minor * rateBp) / 10000);
    }

    /** يحوّل نسبة مئوية (مثل 15 أو 14.5) إلى نقاط أساس صحيحة. */
    function percentToBp(percent) {
      const value = Number(percent);
      if (!Number.isFinite(value)) return 0;
      return roundHalfUp(value * 100);
    }

    function bpToPercent(bp) {
      return (bp ?? 0) / 100;
    }

    /**
     * يحسب مجاميع سلة البيع بالكامل بوحدات صغرى.
     *
     * @param {{unitPriceMinor:number, quantity:number}[]} lines
     * @param {{type:'percent'|'amount', value:number}} discount  value = نقاط أساس أو وحدة صغرى
     * @param {number} taxRateBp نسبة الضريبة بنقاط الأساس
     * @param {boolean} taxInclusive هل السعر شامل الضريبة
     * @returns {{subtotalMinor:number, discountMinor:number, taxableMinor:number, taxMinor:number, totalMinor:number}}
     */
    function computeTotals(lines, discount = { type: 'amount', value: 0 }, taxRateBp = 0, taxInclusive = false) {
      const subtotalMinor = lines.reduce(
        (sum, line) => sum + roundHalfUp(line.unitPriceMinor * line.quantity),
        0
      );

      let discountMinor = discount?.type === 'percent'
        ? percentOf(subtotalMinor, discount.value || 0)
        : roundHalfUp(discount?.value || 0);

      // الخصم لا يتجاوز المجموع الفرعي ولا يكون سالباً
      discountMinor = Math.min(Math.max(discountMinor, 0), subtotalMinor);

      const netMinor = subtotalMinor - discountMinor;

      let taxMinor;
      let taxableMinor;
      if (taxInclusive) {
        // السعر شامل: الضريبة مستخرجة من الصافي
        taxMinor = roundHalfUp((netMinor * taxRateBp) / (10000 + taxRateBp));
        taxableMinor = netMinor - taxMinor;
      } else {
        taxableMinor = netMinor;
        taxMinor = percentOf(netMinor, taxRateBp);
      }

      const totalMinor = taxInclusive ? netMinor : netMinor + taxMinor;

      return { subtotalMinor, discountMinor, taxableMinor, taxMinor, totalMinor };
    }

    /**
     * يوزّع الخصم على السطور بالتناسب، ويسند فروق التقريب إلى آخر سطر
     * حتى يبقى مجموع الأنصبة مساوياً تماماً لإجمالي الخصم.
     */
    function allocateProportionally(totalMinor, weights) {
      const weightSum = weights.reduce((sum, w) => sum + w, 0);
      if (weightSum <= 0 || totalMinor === 0) return weights.map(() => 0);

      const shares = weights.map((w) => roundHalfUp((totalMinor * w) / weightSum));
      const drift = totalMinor - shares.reduce((sum, s) => sum + s, 0);

      // آخر سطر بوزن غير صفري يمتص فرق التقريب
      for (let i = shares.length - 1; i >= 0; i -= 1) {
        if (weights[i] > 0) { shares[i] += drift; break; }
      }
      return shares;
    }


    Object.defineProperty(__exports, "MINOR_PER_MAJOR", { enumerable: true, get: function () { return MINOR_PER_MAJOR; } });
    Object.defineProperty(__exports, "toMinor", { enumerable: true, get: function () { return toMinor; } });
    Object.defineProperty(__exports, "toMajor", { enumerable: true, get: function () { return toMajor; } });
    Object.defineProperty(__exports, "roundHalfUp", { enumerable: true, get: function () { return roundHalfUp; } });
    Object.defineProperty(__exports, "percentOf", { enumerable: true, get: function () { return percentOf; } });
    Object.defineProperty(__exports, "percentToBp", { enumerable: true, get: function () { return percentToBp; } });
    Object.defineProperty(__exports, "bpToPercent", { enumerable: true, get: function () { return bpToPercent; } });
    Object.defineProperty(__exports, "computeTotals", { enumerable: true, get: function () { return computeTotals; } });
    Object.defineProperty(__exports, "allocateProportionally", { enumerable: true, get: function () { return allocateProportionally; } });
  });

  /* ================================================================== */
  /* src/utils/xlsx.js */
  __def("src/utils/xlsx.js", function (__exports, __m, __dyn) {
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
    function columnLetter(index) {
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
    async function writeXlsx(rows, { sheetName = 'البيانات', columnWidths } = {}) {
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
    async function readXlsx(source, { maxRows = 20000 } = {}) {
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
    function downloadBlob(blob, fileName) {
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

    const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';


    Object.defineProperty(__exports, "columnLetter", { enumerable: true, get: function () { return columnLetter; } });
    Object.defineProperty(__exports, "writeXlsx", { enumerable: true, get: function () { return writeXlsx; } });
    Object.defineProperty(__exports, "readXlsx", { enumerable: true, get: function () { return readXlsx; } });
    Object.defineProperty(__exports, "downloadBlob", { enumerable: true, get: function () { return downloadBlob; } });
    Object.defineProperty(__exports, "XLSX_MIME", { enumerable: true, get: function () { return XLSX_MIME; } });
  });

  /* ================================================================== */
  /* src/validation/validators.js */
  __def("src/validation/validators.js", function (__exports, __m, __dyn) {
    /**
     * تحقق وتطبيع لكل المدخلات.
     * كل مسار يدخل بيانات إلى قاعدة البيانات (نموذج، استيراد Excel، استعادة نسخة)
     * يمر من هنا. الدوال تُرجع { ok, value, errors } ولا ترمي استثناءات.
     */

    const { toMinor, percentToBp } = __m("src/utils/money.js");
    const { isDayKey } = __m("src/utils/dates.js");

    const LIMITS = {
      name: 120,
      sku: 40,
      barcode: 40,
      description: 500,
      note: 200,
      phone: 24,
      reference: 40,
      imageBytes: 5 * 1024 * 1024,
      attachmentBytes: 5 * 1024 * 1024,
      backupBytes: 100 * 1024 * 1024,
      maxQuantity: 1_000_000,
      maxAmountMinor: 99_999_999_999,
    };

    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
    const ATTACHMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];

    /** يزيل الفراغات الزائدة والمحارف غير المرئية */
    function normalizeText(value, max = 255) {
      return String(value ?? '')
        .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '') // محارف اتجاه/صفرية العرض
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
    }

    /** نص متعدد الأسطر: يحافظ على الأسطر ويزيل المحارف الخفية */
    function normalizeMultiline(value, max = 500) {
      return String(value ?? '')
        .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, max);
    }

    /** SKU: أحرف لاتينية وأرقام وشرطات فقط، بحالة كبيرة موحّدة */
    function normalizeSku(value) {
      return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9\-_.]/g, '')
        .slice(0, LIMITS.sku);
    }

    /** باركود: أرقام وأحرف فقط */
    function normalizeBarcode(value) {
      const clean = String(value ?? '').trim().replace(/[^A-Za-z0-9]/g, '').slice(0, LIMITS.barcode);
      return clean || undefined; // undefined حتى لا يدخل الفهرس الفريد
    }

    /** هاتف: أرقام و + فقط، مع تحويل الأرقام العربية */
    function normalizePhone(value) {
      return String(value ?? '')
        .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[^\d+]/g, '')
        .slice(0, LIMITS.phone);
    }

    /** كمية: عدد صحيح موجب (أو سالب إذا سُمح) */
    function parseQuantity(value, { allowNegative = false, allowZero = true } = {}) {
      const num = Number(String(value ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, ''));
      if (!Number.isFinite(num)) return NaN;
      if (!Number.isInteger(num)) return NaN;
      if (!allowNegative && num < 0) return NaN;
      if (!allowZero && num === 0) return NaN;
      if (Math.abs(num) > LIMITS.maxQuantity) return NaN;
      return num;
    }

    /* ------------------------------------------------------------------ */

    function collect() {
      const errors = {};
      return {
        errors,
        add(field, message) { if (!errors[field]) errors[field] = message; },
        get ok() { return Object.keys(errors).length === 0; },
      };
    }

    /** يتحقق من منتج ويعيد كائناً مطبّعاً جاهزاً للتخزين */
    function validateProduct(input) {
      const v = collect();

      const name = normalizeText(input.name, LIMITS.name);
      if (!name) v.add('name', 'اسم المنتج مطلوب');

      const sku = normalizeSku(input.sku);
      if (!sku) v.add('sku', 'رمز SKU مطلوب');
      else if (sku.length < 2) v.add('sku', 'رمز SKU قصير جداً');

      const barcode = normalizeBarcode(input.barcode);

      const categoryId = normalizeText(input.categoryId, 60);
      if (!categoryId) v.add('categoryId', 'الفئة مطلوبة');

      const unit = normalizeText(input.unit, 20);
      if (!unit) v.add('unit', 'الوحدة مطلوبة');

      const costMinor = toMinor(input.costMinor ?? input.cost);
      if (!Number.isFinite(costMinor) || costMinor < 0) v.add('cost', 'سعر الشراء غير صالح');
      else if (costMinor > LIMITS.maxAmountMinor) v.add('cost', 'سعر الشراء كبير جداً');

      const priceMinor = toMinor(input.priceMinor ?? input.price);
      if (!Number.isFinite(priceMinor) || priceMinor < 0) v.add('price', 'سعر البيع غير صالح');
      else if (priceMinor > LIMITS.maxAmountMinor) v.add('price', 'سعر البيع كبير جداً');

      const taxRateBp = input.taxRateBp != null ? Math.trunc(Number(input.taxRateBp)) : percentToBp(input.taxRate ?? 0);
      if (!Number.isFinite(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) {
        v.add('taxRate', 'نسبة الضريبة يجب أن تكون بين 0 و100');
      }

      const quantity = parseQuantity(input.quantity ?? 0);
      if (Number.isNaN(quantity)) v.add('quantity', 'الكمية يجب أن تكون عدداً صحيحاً غير سالب');

      const lowStockThreshold = parseQuantity(input.lowStockThreshold ?? 0);
      if (Number.isNaN(lowStockThreshold)) v.add('lowStockThreshold', 'حد المخزون المنخفض غير صالح');

      const minimumStock = parseQuantity(input.minimumStock ?? input.lowStockThreshold ?? 0);
      const maximumStock = parseQuantity(input.maximumStock ?? 0);
      const reorderPoint = parseQuantity(input.reorderPoint ?? input.lowStockThreshold ?? 0);
      if (Number.isNaN(minimumStock)) v.add('minimumStock', 'الحد الأدنى للمخزون غير صالح');
      if (Number.isNaN(maximumStock)) v.add('maximumStock', 'الحد الأقصى للمخزون غير صالح');
      if (Number.isNaN(reorderPoint)) v.add('reorderPoint', 'نقطة إعادة الطلب غير صالحة');
      if (!Number.isNaN(maximumStock) && !Number.isNaN(minimumStock) && maximumStock > 0 && maximumStock < minimumStock) v.add('maximumStock', 'الحد الأقصى يجب أن يساوي الحد الأدنى أو يزيد عليه');

      const description = normalizeMultiline(input.description, LIMITS.description);

      if (!v.ok) return { ok: false, errors: v.errors, value: null };

      return {
        ok: true,
        errors: {},
        value: {
          name,
          nameLower: name.toLowerCase(),
          sku,
          barcode,
          categoryId,
          unit,
          costMinor,
          priceMinor,
          taxRateBp,
          quantity,
          lowStockThreshold,
          minimumStock,
          maximumStock,
          reorderPoint,
          description,
          image: input.image ?? null,
          isActive: input.isActive !== false,
        },
      };
    }

    function validateCustomer(input) {
      const v = collect();

      const name = normalizeText(input.name, LIMITS.name);
      if (!name) v.add('name', 'اسم العميل مطلوب');

      const phone = normalizePhone(input.phone);
      if (phone && phone.replace(/\D/g, '').length < 7) v.add('phone', 'رقم الهاتف غير صالح');

      const note = normalizeMultiline(input.note, LIMITS.note);

      if (!v.ok) return { ok: false, errors: v.errors, value: null };

      return {
        ok: true,
        errors: {},
        value: { name, phone, note, isActive: input.isActive !== false },
      };
    }

    function validateExpense(input) {
      const v = collect();

      const amountMinor = toMinor(input.amountMinor ?? input.amount);
      if (!Number.isFinite(amountMinor)) v.add('amount', 'المبلغ مطلوب');
      else if (amountMinor <= 0) v.add('amount', 'المبلغ يجب أن يكون أكبر من صفر');
      else if (amountMinor > LIMITS.maxAmountMinor) v.add('amount', 'المبلغ كبير جداً');

      const categoryId = normalizeText(input.categoryId, 60);
      if (!categoryId) v.add('categoryId', 'الفئة مطلوبة');

      const dayKey = String(input.dayKey || '').trim();
      if (!isDayKey(dayKey)) v.add('dayKey', 'التاريخ غير صالح');

      const method = normalizeText(input.method, 30) || 'cash';
      const title = normalizeText(input.title, LIMITS.name);
      const reference = normalizeText(input.reference, LIMITS.reference);
      const note = normalizeMultiline(input.note, LIMITS.note);

      if (!v.ok) return { ok: false, errors: v.errors, value: null };

      return {
        ok: true,
        errors: {},
        value: {
          amountMinor, categoryId, dayKey, method, title, reference, note,
          attachment: input.attachment ?? null,
        },
      };
    }

    function validateAdjustment(input) {
      const v = collect();

      const productId = normalizeText(input.productId, 60);
      if (!productId) v.add('productId', 'اختر منتجاً');

      const quantity = parseQuantity(input.quantity, { allowNegative: true, allowZero: false });
      if (Number.isNaN(quantity)) v.add('quantity', 'الكمية يجب أن تكون عدداً صحيحاً غير صفري');

      const reason = normalizeText(input.reason, 60);
      if (!reason) v.add('reason', 'السبب مطلوب');

      const note = normalizeMultiline(input.note, LIMITS.note);

      if (!v.ok) return { ok: false, errors: v.errors, value: null };
      return { ok: true, errors: {}, value: { productId, quantity, reason, note } };
    }

    function validatePayment(input) {
      const v = collect();

      const customerId = normalizeText(input.customerId, 60);
      if (!customerId) v.add('customerId', 'العميل مطلوب');

      const amountMinor = toMinor(input.amountMinor ?? input.amount);
      if (!Number.isFinite(amountMinor)) v.add('amount', 'المبلغ مطلوب');
      else if (amountMinor <= 0) v.add('amount', 'المبلغ يجب أن يكون أكبر من صفر');
      else if (amountMinor > LIMITS.maxAmountMinor) v.add('amount', 'المبلغ كبير جداً');

      if (!v.ok) return { ok: false, errors: v.errors, value: null };

      return {
        ok: true,
        errors: {},
        value: {
          customerId,
          amountMinor,
          method: normalizeText(input.method, 30) || 'cash',
          reference: normalizeText(input.reference, LIMITS.reference),
          note: normalizeMultiline(input.note, LIMITS.note),
        },
      };
    }

    /** يتحقق من ملف مرفوع قبل قراءته */
    function validateFile(file, { types, maxBytes, label = 'الملف' }) {
      if (!file) return { ok: false, error: `${label} مطلوب` };
      if (file.size === 0) return { ok: false, error: `${label} فارغ` };
      if (file.size > maxBytes) {
        return { ok: false, error: `حجم ${label} يتجاوز الحد المسموح (${Math.round(maxBytes / 1024 / 1024)} ميجابايت)` };
      }
      if (types && types.length > 0 && !types.includes(file.type)) {
        return { ok: false, error: `نوع ${label} غير مدعوم` };
      }
      return { ok: true, error: null };
    }


    Object.defineProperty(__exports, "LIMITS", { enumerable: true, get: function () { return LIMITS; } });
    Object.defineProperty(__exports, "IMAGE_TYPES", { enumerable: true, get: function () { return IMAGE_TYPES; } });
    Object.defineProperty(__exports, "ATTACHMENT_TYPES", { enumerable: true, get: function () { return ATTACHMENT_TYPES; } });
    Object.defineProperty(__exports, "normalizeText", { enumerable: true, get: function () { return normalizeText; } });
    Object.defineProperty(__exports, "normalizeMultiline", { enumerable: true, get: function () { return normalizeMultiline; } });
    Object.defineProperty(__exports, "normalizeSku", { enumerable: true, get: function () { return normalizeSku; } });
    Object.defineProperty(__exports, "normalizeBarcode", { enumerable: true, get: function () { return normalizeBarcode; } });
    Object.defineProperty(__exports, "normalizePhone", { enumerable: true, get: function () { return normalizePhone; } });
    Object.defineProperty(__exports, "parseQuantity", { enumerable: true, get: function () { return parseQuantity; } });
    Object.defineProperty(__exports, "validateProduct", { enumerable: true, get: function () { return validateProduct; } });
    Object.defineProperty(__exports, "validateCustomer", { enumerable: true, get: function () { return validateCustomer; } });
    Object.defineProperty(__exports, "validateExpense", { enumerable: true, get: function () { return validateExpense; } });
    Object.defineProperty(__exports, "validateAdjustment", { enumerable: true, get: function () { return validateAdjustment; } });
    Object.defineProperty(__exports, "validatePayment", { enumerable: true, get: function () { return validatePayment; } });
    Object.defineProperty(__exports, "validateFile", { enumerable: true, get: function () { return validateFile; } });
  });

  /* ================================================================== */
  /* src/views/backup.js */
  __def("src/views/backup.js", function (__exports, __m, __dyn) {
    /** النسخ الاحتياطي والاستعادة — مرجع: UI/11-backup-restore.png */

    const { h, render: renderInto, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, alertBox, progressBar, checkboxField, emptyState, pagination } = __m("src/components/ui.js");
    const { dataTable } = __m("src/components/table.js");
    const { toastOk, toastError, confirmDialog, openModal } = __m("src/components/feedback.js");
    const { createBackup, listBackups, downloadBackup, deleteBackup, inspectBackupFile, restoreBackup, clearAllData, BACKUP_KIND } = __m("src/services/backup.js");
    const { readStorageEstimate, requestPersistentStorage } = __m("src/services/pwa.js");
    const { settings, loadSettings, saveSettings } = __m("src/repositories/settings.js");
    const { appState, notifyDataChanged } = __m("src/state/store.js");
    const { APP_VERSION, SCHEMA_VERSION } = __m("src/db/schema.js");
    const { formatBytes, formatInt } = __m("src/utils/format.js");
    const { formatDateTime, formatDate } = __m("src/utils/dates.js");
    const { refresh } = __m("src/router.js");

    async function render(context) {
      const s = settings();
      const backups = await listBackups();
      const storage = appState.get().storage || await readStorageEstimate();

      const state = { page: 1, pageSize: 5 };
      const logHost = h('div');

      /* --------------------------------- KPIs --------------------------------- */

      const lastBackup = backups[0];
      const usageRatio = storage?.quota > 0 ? storage.usage / storage.quota : 0;

      const kpis = kpiGrid(
        kpi({
          variant: 'stacked',
          label: 'آخر نسخة',
          value: h('span', { style: { 'font-size': '19px' } },
            lastBackup ? formatDateTime(lastBackup.createdAt, s.dateFormat) : 'لا توجد'),
          iconName: 'calendar',
          tone: lastBackup ? 'blue' : 'amber',
          subtext: lastBackup ? formatDate(lastBackup.createdAt, s.dateFormat) : 'أنشئ نسختك الأولى',
        }),
        kpi({
          variant: 'stacked',
          label: 'التخزين المحلي',
          value: formatBytes(storage?.usage || 0),
          iconName: 'database',
          tone: 'teal',
          subtext: storage?.quota
            ? `${Math.round(usageRatio * 100)}% مستخدم من ${formatBytes(storage.quota)}`
            : 'غير متاح',
        }),
        kpi({
          variant: 'stacked',
          label: 'إصدار البيانات',
          value: `v${APP_VERSION}`,
          iconName: 'layers',
          tone: 'violet',
          subtext: `مخطط قاعدة البيانات ${SCHEMA_VERSION}`,
        }),
        kpi({
          variant: 'stacked',
          label: 'تذكير النسخ',
          value: { off: 'معطّل', daily: 'يومي', weekly: 'أسبوعي' }[s.backupReminder] || 'أسبوعي',
          iconName: 'bell',
          tone: s.backupReminder === 'off' ? 'amber' : 'green',
          subtext: s.backupReminder === 'off' ? 'التذكير معطّل' : 'التذكير مفعّل',
        })
      );

      /* ---------------------------- إنشاء نسخة ---------------------------- */

      const createCard = card({
        title: 'إنشاء نسخة احتياطية',
        titleIcon: 'cloudUp',
        body: h('div', { class: 'stack' },
          h('div', null,
            h('h3', { style: { 'font-size': '15px', 'font-weight': '700', 'margin-bottom': '4px' }, text: 'تصدير كامل' }),
            h('p', { class: 'field__hint', text: 'يشمل المنتجات والعملاء والمبيعات والمصروفات وحركات المخزون والإعدادات.' })
          ),
          h('button', {
            class: 'btn btn--navy btn--lg btn--block',
            attrs: { type: 'button' },
            on: {
              click: async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                  const result = await createBackup({ kind: BACKUP_KIND.MANUAL, download: true });
                  toastOk(`تم إنشاء النسخة: ${result.fileName} (${formatBytes(result.blob.size)})`);
                  refresh();
                } catch (error) {
                  toastError(`تعذّر إنشاء النسخة: ${error.message}`);
                } finally {
                  button.disabled = false;
                }
              },
            },
          }, h('span', { text: 'تنزيل ملف JSON' }), icon('download')),
          alertBox('يُحفظ الملف على جهازك فقط ولا يُرسل إلى أي خادم. انسخه إلى وسيط خارجي أو تخزين سحابي بنفسك.', 'info')
        ),
      });

      /* ---------------------------- استعادة نسخة ---------------------------- */

      let inspected = null;
      let selectedFile = null;

      const autoBackupCheck = checkboxField({
        label: 'أنشئ نسخة تلقائية من البيانات الحالية قبل الاستعادة',
        name: 'autoBackup',
        checked: true,
      });

      const inspectionHost = h('div');

      const restoreButton = h('button', {
        class: 'btn btn--danger btn--block',
        attrs: { type: 'button' },
        disabled: true,
        on: { click: doRestore },
      }, h('span', { text: 'استعادة البيانات' }), icon('upload'));

      const fileInput = h('input', {
        type: 'file',
        accept: '.json,application/json',
        attrs: { 'aria-label': 'اختر ملف النسخة الاحتياطية' },
        on: { change: (event) => handleFile(event.target.files[0]) },
      });

      const dropZone = h('label', { class: 'file-drop' },
        icon('cloudUp', { class: 'file-drop__icon' }),
        h('span', { class: 'file-drop__title', text: 'اختر ملف JSON أو اسحبه هنا' }),
        h('span', { class: 'file-drop__hint', text: 'الحد الأقصى للحجم: 100 ميجابايت' }),
        fileInput
      );

      dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-over'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-over'));
      dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        dropZone.classList.remove('is-over');
        handleFile(event.dataTransfer.files[0]);
      });

      async function handleFile(file) {
        if (!file) return;
        selectedFile = file;
        inspected = null;
        restoreButton.disabled = true;
        renderInto(inspectionHost, h('p', { class: 'field__hint', text: 'جارٍ فحص الملف…' }));

        try {
          inspected = await inspectBackupFile(file);
          showInspection();
        } catch (error) {
          renderInto(inspectionHost, alertBox(`تعذّر فحص الملف: ${error.message}`, 'error'));
        }
      }

      function showInspection() {
        const { ok, errors, warnings, summary } = inspected;
        restoreButton.disabled = !ok;

        renderInto(inspectionHost,
          h('div', { class: 'stack', style: { gap: '12px' } },
            h('div', { class: 'file-preview' },
              h('div', { class: 'table__thumb table__thumb--ph', style: { width: '54px', height: '54px', color: ok ? 'var(--green)' : 'var(--red)' } },
                icon(ok ? 'checkCircle' : 'xCircle')),
              h('div', { style: { flex: '1', 'min-width': '0' } },
                h('div', { class: 'file-preview__name', text: summary.fileName || selectedFile.name }),
                h('div', { class: 'file-preview__meta' },
                  formatBytes(summary.fileSize || selectedFile.size),
                  summary.exportedAt ? ` · أُنشئت ${formatDateTime(summary.exportedAt, s.dateFormat)}` : '')
              )
            ),

            ok
              ? alertBox(`الملف صالح. يحتوي على ${formatInt(summary.totalRecords)} سجلاً وسيستبدل كل البيانات الحالية.`, 'ok')
              : h('div', { class: 'stack', style: { gap: '6px' } },
                  ...errors.map((error) => alertBox(error, 'error'))
                ),

            ...warnings.map((warning) => alertBox(warning, 'warn')),

            ok
              ? h('div', { class: 'table-wrap' },
                  h('table', { class: 'table' },
                    h('thead', null, h('tr', null, h('th', { text: 'البيانات' }), h('th', { text: 'عدد السجلات' }))),
                    h('tbody', null,
                      ...STORE_LABELS.filter(([key]) => summary[key] != null).map(([key, label]) =>
                        h('tr', null, h('td', { text: label }), h('td', null, ltr(formatInt(summary[key]))))
                      )
                    )
                  )
                )
              : null
          )
        );
      }

      async function doRestore() {
        if (!inspected?.ok) return;

        const confirmed = await confirmDialog({
          title: 'تأكيد الاستعادة',
          message: 'سيتم استبدال جميع البيانات الحالية ببيانات الملف. هذا الإجراء لا يمكن التراجع عنه إلا باستعادة نسخة أخرى.',
          confirmLabel: 'استبدال البيانات',
          tone: 'danger',
          extra: autoBackupCheck.checked
            ? alertBox('سيتم إنشاء نسخة تلقائية من بياناتك الحالية قبل الاستبدال.', 'info')
            : alertBox('لن تُنشأ نسخة تلقائية. بياناتك الحالية ستُفقد نهائياً.', 'warn'),
        });
        if (!confirmed) return;

        restoreButton.disabled = true;
        restoreButton.textContent = 'جارٍ الاستعادة…';

        try {
          const result = await restoreBackup(inspected.payload, { autoBackup: autoBackupCheck.checked });
          const total = Object.values(result.restored).reduce((sum, count) => sum + count, 0);

          notifyDataChanged();
          toastOk(`تمت الاستعادة بنجاح: ${formatInt(total)} سجلاً.`);
          // إعادة تحميل كاملة حتى تعكس كل الشاشات البيانات الجديدة
          setTimeout(() => window.location.reload(), 900);
        } catch (error) {
          // المعاملة أُجهضت — البيانات الحالية سليمة
          toastError(`فشلت الاستعادة ولم تتغيّر بياناتك الحالية: ${error.message}`);
          restoreButton.disabled = false;
          restoreButton.textContent = 'استعادة البيانات';
        }
      }

      const restoreCard = card({
        title: 'استعادة نسخة',
        titleIcon: 'download',
        body: h('div', { class: 'stack' },
          dropZone,
          inspectionHost,
          alertBox('لن تُستبدل البيانات قبل نجاح التحقق من الملف بالكامل.', 'warn'),
          autoBackupCheck.element,
          restoreButton
        ),
      });

      /* ---------------------------- إجراءات التعافي ---------------------------- */

      const recoveryCard = card({
        title: 'إجراءات التعافي',
        titleIcon: 'shield',
        body: h('div', { class: 'stack' },
          alertBox('في حال حدوث مشكلة بعد الاستعادة، يمكنك استخدام أحدث نسخة احتياطية من السجل أدناه لاسترجاع بياناتك.', 'info'),

          h('button', {
            class: 'btn btn--ghost btn--block',
            attrs: { type: 'button' },
            disabled: !lastBackup,
            on: {
              click: async () => {
                try {
                  const name = await downloadBackup(lastBackup.id);
                  toastOk(`تم تنزيل ${name}`);
                } catch (error) {
                  toastError(error.message);
                }
              },
            },
          }, icon('download'), h('span', { text: 'تنزيل أحدث نسخة محفوظة' })),

          h('button', {
            class: 'btn btn--ghost btn--block',
            attrs: { type: 'button' },
            on: {
              click: async () => {
                const result = await requestPersistentStorage();
                if (result.granted) toastOk(result.message);
                else toastError(result.message);
                refresh();
              },
            },
          }, icon('shield'), h('span', { text: 'طلب تخزين دائم للمتصفح' })),

          h('button', {
            class: 'btn btn--outline-danger btn--block',
            attrs: { type: 'button' },
            on: { click: doClearAll },
          }, icon('trash'), h('span', { text: 'مسح جميع البيانات المحلية' }))
        ),
      });

      async function doClearAll() {
        const first = await confirmDialog({
          title: 'مسح جميع البيانات',
          message: 'سيتم حذف كل المنتجات والعملاء والفواتير والمصروفات وحركات المخزون نهائياً من هذا المتصفح.',
          confirmLabel: 'متابعة',
          tone: 'danger',
        });
        if (!first) return;

        const second = await confirmDialog({
          title: 'تأكيد نهائي',
          message: 'هل أنشأت نسخة احتياطية؟ بعد المسح لا يمكن استرجاع البيانات إلا من ملف نسخة احتياطية.',
          confirmLabel: 'نعم، امسح كل شيء',
          tone: 'danger',
          extra: alertBox('سيبقى سجل النسخ الاحتياطية المحفوظة محلياً كي تتمكّن من الاستعادة.', 'info'),
        });
        if (!second) return;

        try {
          await clearAllData({ keepBackups: true });
          toastOk('تم مسح جميع البيانات');
          setTimeout(() => window.location.reload(), 800);
        } catch (error) {
          toastError(`تعذّر المسح: ${error.message}`);
        }
      }

      /* ------------------------------ سجل النسخ ------------------------------ */

      function drawLog() {
        const total = backups.length;
        const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
        if (state.page > maxPage) state.page = maxPage;
        const pageRows = backups.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

        renderInto(logHost, card({
          title: 'سجل النسخ',
          titleIcon: 'history',
          flush: true,
          body: h('div', null,
            dataTable({
              caption: 'سجل النسخ الاحتياطية',
              columns: [
                {
                  key: 'fileName',
                  label: 'اسم الملف',
                  render: (row) => h('span', { class: 'row', style: { gap: '8px', 'flex-wrap': 'nowrap' } },
                    icon('file'), ltr(row.fileName)),
                },
                { key: 'createdAt', label: 'التاريخ', render: (row) => ltr(formatDateTime(row.createdAt, s.dateFormat)) },
                { key: 'sizeBytes', label: 'الحجم', render: (row) => formatBytes(row.sizeBytes) },
                {
                  key: 'kind',
                  label: 'النوع',
                  render: (row) => badge(row.kind === BACKUP_KIND.AUTO ? 'تلقائية' : 'يدوية',
                    row.kind === BACKUP_KIND.AUTO ? 'blue' : 'gray'),
                },
                {
                  key: 'status',
                  label: 'الحالة',
                  render: (row) => badge(row.hasPayload ? 'محفوظة' : 'سجل فقط',
                    row.hasPayload ? 'green' : 'gray', { iconName: row.hasPayload ? 'checkCircle' : null }),
                },
                {
                  key: 'actions',
                  label: 'الإجراءات',
                  className: 'is-actions',
                  render: (row) => h('div', { class: 'table__actions' },
                    h('button', {
                      class: 'icon-btn',
                      attrs: { type: 'button', 'aria-label': `تنزيل ${row.fileName}` },
                      disabled: !row.hasPayload || undefined,
                      on: {
                        click: async () => {
                          try {
                            await downloadBackup(row.id);
                            toastOk('تم التنزيل');
                          } catch (error) {
                            toastError(error.message);
                          }
                        },
                      },
                    }, icon('download')),
                    h('button', {
                      class: 'icon-btn icon-btn--danger',
                      attrs: { type: 'button', 'aria-label': `حذف ${row.fileName}` },
                      on: {
                        click: async () => {
                          const ok = await confirmDialog({
                            title: 'حذف النسخة',
                            message: `سيتم حذف "${row.fileName}" من السجل المحلي. الملف الذي نزّلته سابقاً لن يتأثر.`,
                            confirmLabel: 'حذف',
                            tone: 'danger',
                          });
                          if (!ok) return;
                          await deleteBackup(row.id);
                          toastOk('تم حذف النسخة من السجل');
                          refresh();
                        },
                      },
                    }, icon('trash'))
                  ),
                },
              ],
              rows: pageRows,
              empty: {
                iconName: 'cloudUp',
                title: 'لا نسخ محفوظة',
                text: 'أنشئ نسختك الأولى — يُحتفظ بآخر 5 نسخ داخل المتصفح.',
              },
            }),
            total > 0
              ? pagination({
                  page: state.page, pageSize: state.pageSize, total, unit: 'نسخة',
                  sizes: [5, 10],
                  onPage: (page) => { state.page = page; drawLog(); },
                })
              : null
          ),
        }));
      }

      drawLog();

      /* -------------------------------- التركيب -------------------------------- */

      return h('div', { class: 'stack' },
        kpis,
        storage?.quota
          ? card({
              body: h('div', { class: 'stack', style: { gap: '10px' } },
                h('div', { class: 'row', style: { 'justify-content': 'space-between' } },
                  h('span', { style: { 'font-weight': '600' }, text: 'استهلاك التخزين المحلي' }),
                  h('span', { class: 'field__hint' },
                    `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`)
                ),
                progressBar(usageRatio),
                storage.persisted
                  ? alertBox('التخزين الدائم مفعّل — لن يحذف المتصفح بياناتك تلقائياً عند ضغط المساحة.', 'ok')
                  : alertBox('التخزين الدائم غير مفعّل. قد يحذف المتصفح البيانات عند امتلاء مساحة الجهاز. فعّله من «إجراءات التعافي».', 'warn')
              ),
            })
          : null,
        h('div', { class: 'backup-grid' }, restoreCard, createCard),
        h('div', { class: 'backup-grid' }, recoveryCard, logHost)
      );
    }

    const STORE_LABELS = [
      ['products', 'المنتجات'],
      ['categories', 'الفئات'],
      ['customers', 'العملاء'],
      ['sales', 'الفواتير'],
      ['saleItems', 'سطور الفواتير'],
      ['payments', 'المدفوعات'],
      ['expenses', 'المصروفات'],
      ['expenseCategories', 'فئات المصروفات'],
      ['inventoryMovements', 'حركات المخزون'],
      ['suspendedSales', 'البيوع المعلّقة'],
      ['adjustmentReasons', 'أسباب التسوية'],
      ['settings', 'الإعدادات'],
    ];


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/customers.js */
  __def("src/views/customers.js", function (__exports, __m, __dyn) {
    /** العملاء والذمم — مرجع: UI/08-customers.png */

    const { h, render: renderInto, ltr, debounce } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, searchField, field, pagination, emptyState, rowMenu, detailRow, avatar, alertBox } = __m("src/components/ui.js");
    const { dataTable } = __m("src/components/table.js");
    const { openModal, openPanel, toastOk, toastError, confirmDialog } = __m("src/components/feedback.js");
    const { listCustomers, createCustomer, updateCustomer, deleteCustomer, customerLedgers, recordPayment, customerStatement, getCustomer } = __m("src/repositories/customers.js");
    const { salesForCustomer } = __m("src/repositories/sales.js");
    const { validateCustomer, validatePayment, LIMITS } = __m("src/validation/validators.js");
    const { PAYMENT_METHODS, methodLabel } = __m("src/repositories/expenses.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, formatInt, initials } = __m("src/utils/format.js");
    const { formatDate, formatDateTime } = __m("src/utils/dates.js");
    const { toMajor } = __m("src/utils/money.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { navigate, refresh } = __m("src/router.js");
    const { exportCustomers } = __m("src/services/excel.js");

    async function render(context) {
      const s = settings();
      const symbol = s.currencySymbol;

      const [customers, ledgers] = await Promise.all([listCustomers(), customerLedgers()]);

      const state = {
        query: context.query.q || '',
        status: 'all',
        balance: 'all',
        page: 1,
        pageSize: 10,
        selectedId: customers[0]?.id || null,
      };

      const tableHost = h('div');
      const detailHost = h('div', { class: 'detail-panel' });

      const ledgerOf = (id) => ledgers.get(id) || {
        balanceMinor: 0, purchasesMinor: 0, invoiceCount: 0, monthPurchasesMinor: 0, lastPurchaseAt: null,
      };

      function filtered() {
        const term = state.query.trim().toLowerCase();
        return customers.filter((customer) => {
          if (state.status === 'active' && customer.isActive === false) return false;
          if (state.status === 'inactive' && customer.isActive !== false) return false;

          const balance = ledgerOf(customer.id).balanceMinor;
          if (state.balance === 'due' && balance <= 0) return false;
          if (state.balance === 'clear' && balance > 0) return false;

          if (!term) return true;
          return `${customer.name} ${customer.phone || ''}`.toLowerCase().includes(term);
        });
      }

      /* --------------------------------- KPIs --------------------------------- */

      const activeCount = customers.filter((customer) => customer.isActive !== false).length;
      const totalDue = [...ledgers.values()].reduce((sum, ledger) => sum + Math.max(0, ledger.balanceMinor), 0);

      const kpis = h('div', { class: 'grid-3' },
        kpi({ label: 'إجمالي العملاء', value: formatInt(customers.length), unit: 'عميل', iconName: 'customers', tone: 'violet' }),
        kpi({ label: 'عملاء نشطون', value: formatInt(activeCount), unit: 'عميل', iconName: 'user', tone: 'blue' }),
        kpi({
          label: 'إجمالي الذمم',
          value: formatAmount(totalDue),
          unit: symbol,
          iconName: 'wallet',
          tone: totalDue > 0 ? 'amber' : 'green',
        })
      );

      /* -------------------------------- الجدول -------------------------------- */

      function drawTable() {
        const rows = filtered();
        const total = rows.length;
        const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
        if (state.page > maxPage) state.page = maxPage;
        const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

        renderInto(tableHost, card({
          flush: true,
          body: h('div', null,
            dataTable({
              caption: 'قائمة العملاء',
              rowKey: (customer) => customer.id,
              isSelected: (customer) => customer.id === state.selectedId,
              onRowClick: (customer) => {
                state.selectedId = customer.id;
                drawTable();
                drawDetail();
              },
              columns: [
                {
                  key: 'name',
                  label: 'الاسم',
                  render: (customer) => h('div', { class: 'row', style: { gap: '10px', 'flex-wrap': 'nowrap' } },
                    avatar(customer.name, { small: true }),
                    h('div', null,
                      h('div', { class: 'table__main', text: customer.name }),
                      customer.isActive === false ? h('div', { class: 'table__sub', text: 'غير نشط' }) : null
                    )
                  ),
                },
                { key: 'phone', label: 'الهاتف', render: (customer) => (customer.phone ? ltr(customer.phone) : '—') },
                { key: 'invoiceCount', label: 'عدد الفواتير', render: (customer) => ltr(ledgerOf(customer.id).invoiceCount) },
                {
                  key: 'purchases',
                  label: 'إجمالي المشتريات',
                  render: (customer) => h('span', null, ltr(formatAmount(ledgerOf(customer.id).purchasesMinor)), ` ${symbol}`),
                },
                {
                  key: 'balance',
                  label: 'الرصيد',
                  render: (customer) => {
                    const balance = ledgerOf(customer.id).balanceMinor;
                    return h('span', {
                      style: { color: balance > 0 ? 'var(--red)' : 'var(--green)', 'font-weight': '600' },
                    }, ltr(formatAmount(balance)), ` ${symbol}`);
                  },
                },
                {
                  key: 'lastPurchase',
                  label: 'آخر شراء',
                  render: (customer) => {
                    const last = ledgerOf(customer.id).lastPurchaseAt;
                    return last ? ltr(formatDate(last, s.dateFormat)) : '—';
                  },
                },
                {
                  key: 'status',
                  label: 'الحالة',
                  render: (customer) => badge(customer.isActive === false ? 'غير نشط' : 'نشط',
                    customer.isActive === false ? 'gray' : 'green'),
                },
                {
                  key: 'actions',
                  label: 'الإجراءات',
                  className: 'is-actions',
                  render: (customer) => rowMenu([
                    { label: 'كشف الحساب', icon: 'chart', onSelect: () => navigate(`/customers/${customer.id}`) },
                    { label: 'تسجيل دفعة', icon: 'banknote', onSelect: () => openPaymentDialog(customer) },
                    { label: 'تعديل', icon: 'pencil', onSelect: () => openCustomerForm(customer) },
                    { label: 'حذف', icon: 'trash', danger: true, onSelect: () => removeCustomer(customer) },
                  ], { label: `إجراءات ${customer.name}` }),
                },
              ],
              rows: pageRows,
              empty: customers.length === 0
                ? {
                    iconName: 'customers',
                    title: 'لا عملاء بعد',
                    text: 'أضف عميلاً لتتمكّن من البيع الآجل ومتابعة الذمم.',
                  }
                : { iconName: 'search', title: 'لا نتائج مطابقة', text: 'جرّب تعديل البحث أو الفلاتر.' },
            }),
            total > 0
              ? pagination({
                  page: state.page, pageSize: state.pageSize, total, unit: 'عميل',
                  onPage: (page) => { state.page = page; drawTable(); },
                  onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
                })
              : null
          ),
        }));
      }

      /* ------------------------------ لوحة التفاصيل ------------------------------ */

      async function drawDetail() {
        const customer = customers.find((item) => item.id === state.selectedId);

        if (!customer) {
          renderInto(detailHost, card({
            body: emptyState({
              iconName: 'user',
              title: 'اختر عميلاً',
              text: 'انقر على صف في الجدول لعرض تفاصيله.',
            }),
          }));
          return;
        }

        const ledger = ledgerOf(customer.id);
        const recentSales = await salesForCustomer(customer.id, 3);

        renderInto(detailHost, card({
          title: 'تفاصيل العميل',
          titleIcon: 'user',
          body: h('div', { class: 'stack' },
            h('div', { class: 'row', style: { gap: '12px' } },
              avatar(customer.name),
              h('div', null,
                h('h3', { style: { 'font-size': '16px', 'font-weight': '700' }, text: customer.name }),
                customer.isActive === false ? badge('غير نشط', 'gray') : null
              )
            ),

            h('div', { class: 'stack', style: { gap: '2px' } },
              detailRow('رقم الهاتف', customer.phone ? ltr(customer.phone) : '—', { iconName: 'phone' }),
              detailRow('الرصيد الحالي', h('span', {
                style: { color: ledger.balanceMinor > 0 ? 'var(--red)' : 'var(--green)', 'font-weight': '700' },
              }, ltr(formatAmount(ledger.balanceMinor)), ` ${symbol}`)),
              detailRow('مشتريات هذا الشهر', h('span', null,
                ltr(formatAmount(ledger.monthPurchasesMinor)), ` ${symbol}`)),
              detailRow('إجمالي المشتريات', h('span', null,
                ltr(formatAmount(ledger.purchasesMinor)), ` ${symbol}`))
            ),

            customer.note ? alertBox(customer.note, 'info', 'info') : null,

            h('div', { class: 'card', style: { padding: '14px' } },
              h('div', { class: 'invoice-parties__title' }, icon('invoices'), h('span', { text: 'آخر الفواتير' })),
              recentSales.length === 0
                ? h('p', { class: 'field__hint', text: 'لا فواتير لهذا العميل.' })
                : h('div', { class: 'mini-list' },
                    ...recentSales.map((sale) =>
                      h('a', {
                        class: 'mini-list__item',
                        href: `#/invoices/${sale.id}`,
                        style: { color: 'inherit', 'text-decoration': 'none' },
                      },
                        h('span', { style: { color: 'var(--blue)' } }, ltr(sale.number)),
                        h('span', { class: 'table__sub' }, ltr(formatDate(sale.createdAt, s.dateFormat))),
                        h('span', { style: { 'font-weight': '600' } }, ltr(formatAmount(sale.totalMinor)), ` ${symbol}`)
                      )
                    )
                  )
            )
          ),
          footer: h('div', { class: 'stack', style: { gap: '8px' } },
            h('a', { class: 'btn btn--ghost btn--block', href: `#/customers/${customer.id}` },
              icon('chart'), h('span', { text: 'عرض الحساب' })),
            h('button', {
              class: 'btn btn--success btn--block',
              attrs: { type: 'button' },
              on: { click: () => openPaymentDialog(customer) },
            }, icon('banknote'), h('span', { text: 'تسجيل دفعة' })),
            h('button', {
              class: 'btn btn--ghost btn--block',
              attrs: { type: 'button' },
              on: { click: () => openCustomerForm(customer) },
            }, icon('pencil'), h('span', { text: 'تعديل' })),
            h('button', {
              class: 'btn btn--outline-danger btn--block',
              attrs: { type: 'button' },
              on: { click: () => removeCustomer(customer) },
            }, icon('trash'), h('span', { text: 'حذف' }))
          ),
        }));
      }

      /* -------------------------------- النماذج -------------------------------- */

      function openCustomerForm(existing = null) {
        const nameField = field({
          label: 'اسم العميل', name: 'name', required: true,
          value: existing?.name || '', placeholder: 'الاسم الكامل', maxLength: LIMITS.name,
        });
        const phoneField = field({
          label: 'رقم الهاتف', name: 'phone', type: 'tel',
          value: existing?.phone || '', placeholder: '05xxxxxxxx', maxLength: LIMITS.phone,
        });
        const noteField = field({
          label: 'ملاحظة', name: 'note', rows: 3,
          value: existing?.note || '', maxLength: LIMITS.note, counter: true,
          placeholder: 'ملاحظة اختيارية عن العميل',
        });

        async function submit() {
          nameField.setError(null);
          phoneField.setError(null);

          const result = validateCustomer({
            name: nameField.value,
            phone: phoneField.value,
            note: noteField.value,
            isActive: existing?.isActive !== false,
          });

          if (!result.ok) {
            for (const [key, message] of Object.entries(result.errors)) {
              ({ name: nameField, phone: phoneField }[key])?.setError(message);
            }
            return;
          }

          try {
            if (existing) await updateCustomer(existing.id, result.value);
            else await createCustomer(result.value);

            notifyDataChanged();
            modal.close();
            toastOk(existing ? 'تم حفظ بيانات العميل' : `تمت إضافة "${result.value.name}"`);
            refresh();
          } catch (error) {
            toastError(error.message);
          }
        }

        const form = h('form', {
          on: { submit: (event) => { event.preventDefault(); submit(); } },
        }, h('div', { class: 'stack' }, nameField.element, phoneField.element, noteField.element));

        const modal = openModal({
          title: existing ? 'تعديل عميل' : 'إضافة عميل جديد',
          body: form,
          footer: [
            h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'حفظ', on: { click: submit } }),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });

        requestAnimationFrame(() => nameField.focus());
      }

      function openPaymentDialog(customer) {
        const ledger = ledgerOf(customer.id);

        const amountField = field({
          label: 'المبلغ', name: 'amount', required: true, suffix: symbol,
          value: ledger.balanceMinor > 0 ? String(toMajor(ledger.balanceMinor)) : '',
          hint: ledger.balanceMinor > 0
            ? `الرصيد المستحق ${formatAmount(ledger.balanceMinor)} ${symbol}`
            : 'لا يوجد رصيد مستحق على هذا العميل',
        });

        const methodField = field({
          label: 'طريقة الدفع', name: 'method', value: 'cash',
          options: PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })),
        });

        const referenceField = field({
          label: 'رقم المرجع', name: 'reference',
          placeholder: 'رقم الإيصال أو الحوالة (اختياري)', maxLength: LIMITS.reference,
        });

        const noteField = field({
          label: 'ملاحظة', name: 'note', rows: 2, maxLength: LIMITS.note,
          placeholder: 'ملاحظة اختيارية',
        });

        async function submit() {
          amountField.setError(null);

          const result = validatePayment({
            customerId: customer.id,
            amount: amountField.value,
            method: methodField.value,
            reference: referenceField.value,
            note: noteField.value,
          });

          if (!result.ok) {
            amountField.setError(result.errors.amount || null);
            return;
          }

          try {
            await recordPayment(result.value);
            notifyDataChanged();
            modal.close();
            toastOk(`تم تسجيل دفعة ${formatAmount(result.value.amountMinor)} ${symbol} من ${customer.name}`);
            refresh();
          } catch (error) {
            toastError(error.message);
          }
        }

        const modal = openModal({
          title: `تسجيل دفعة — ${customer.name}`,
          body: h('div', { class: 'stack' },
            amountField.element, methodField.element, referenceField.element, noteField.element),
          footer: [
            h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'تسجيل الدفعة', on: { click: submit } }),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });

        requestAnimationFrame(() => amountField.focus());
      }

      async function removeCustomer(customer) {
        const ok = await confirmDialog({
          title: 'حذف العميل',
          message: `سيتم حذف "${customer.name}" نهائياً. لا يمكن حذف عميل له فواتير أو مدفوعات مسجّلة.`,
          confirmLabel: 'حذف',
          tone: 'danger',
        });
        if (!ok) return;

        try {
          await deleteCustomer(customer.id);
          notifyDataChanged();
          toastOk('تم حذف العميل');
          refresh();
        } catch (error) {
          toastError(error.message);
        }
      }

      /* ------------------------------- الفلاتر ------------------------------- */

      const search = searchField({
        placeholder: 'بحث بالاسم أو الهاتف',
        value: state.query,
        label: 'بحث في العملاء',
        onInput: debounce((value) => { state.query = value; state.page = 1; drawTable(); }, 200),
      });

      const statusFilter = field({
        label: 'الحالة', name: 'status', value: 'all',
        options: [
          { value: 'all', label: 'جميع الحالات' },
          { value: 'active', label: 'نشط' },
          { value: 'inactive', label: 'غير نشط' },
        ],
        onChange: (event) => { state.status = event.target.value; state.page = 1; drawTable(); },
      });

      const balanceFilter = field({
        label: 'الرصيد', name: 'balance', value: 'all',
        options: [
          { value: 'all', label: 'جميع الأرصدة' },
          { value: 'due', label: 'عليه مديونية' },
          { value: 'clear', label: 'رصيد مسدّد' },
        ],
        onChange: (event) => { state.balance = event.target.value; state.page = 1; drawTable(); },
      });

      const filterBar = h('div', { class: 'filter-bar' },
        h('div', { class: 'filter-bar__row' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: 'بحث' }), search.element),
          statusFilter.element,
          balanceFilter.element,
          h('div', { class: 'filter-bar__actions' },
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: {
                click: async () => {
                  try {
                    await exportCustomers(filtered(), ledgers);
                    toastOk('تم تصدير العملاء إلى ملف Excel');
                  } catch (error) {
                    toastError(`تعذّر التصدير: ${error.message}`);
                  }
                },
              },
            }, h('span', { text: 'تصدير Excel' }), icon('download'))
          )
        )
      );

      drawTable();
      drawDetail();

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' },
          h('span'),
          h('div', { class: 'page__actions' },
            h('button', {
              class: 'btn btn--teal',
              attrs: { type: 'button' },
              on: { click: () => openCustomerForm() },
            }, h('span', { text: 'إضافة عميل' }), icon('plus'))
          )
        ),
        kpis,
        filterBar,
        h('div', { class: 'split-layout' }, tableHost, detailHost)
      );
    }

    /* ------------------------------------------------------------------ */
    /* كشف الحساب                                                          */
    /* ------------------------------------------------------------------ */

    async function renderStatement(context) {
      const customer = await getCustomer(context.params.id);

      if (!customer) {
        return card({
          body: emptyState({
            iconName: 'search',
            title: 'العميل غير موجود',
            action: h('a', { class: 'btn btn--primary', href: '#/customers' }, h('span', { text: 'العودة إلى العملاء' })),
          }),
        });
      }

      const s = settings();
      const symbol = s.currencySymbol;
      const { entries, balanceMinor } = await customerStatement(customer.id);

      return h('div', { class: 'stack' },
        h('nav', { class: 'breadcrumb' },
          h('a', { href: '#/customers', text: 'العملاء' }),
          icon('chevronLeft'),
          h('span', { text: customer.name })
        ),

        h('div', { class: 'page__head' },
          h('div', { class: 'row', style: { gap: '12px' } },
            avatar(customer.name),
            h('div', null,
              h('h2', { class: 'page__title', text: customer.name }),
              customer.phone ? h('p', { class: 'field__hint' }, ltr(customer.phone)) : null
            )
          ),
          h('div', { class: 'page__actions' },
            h('span', {
              class: 'badge',
              style: {
                background: balanceMinor > 0 ? 'var(--red-soft)' : 'var(--green-soft)',
                color: balanceMinor > 0 ? 'var(--red)' : 'var(--green)',
                'font-size': '15px',
                padding: '8px 16px',
              },
            }, 'الرصيد: ', ltr(formatAmount(balanceMinor)), ` ${symbol}`)
          )
        ),

        card({
          title: 'كشف الحساب',
          titleIcon: 'history',
          flush: true,
          body: dataTable({
            caption: `كشف حساب ${customer.name}`,
            columns: [
              { key: 'at', label: 'التاريخ', render: (entry) => ltr(formatDateTime(entry.at, s.dateFormat)) },
              {
                key: 'kind',
                label: 'النوع',
                render: (entry) => badge(entry.kind === 'invoice' ? 'فاتورة' : 'دفعة',
                  entry.kind === 'invoice' ? 'blue' : 'green'),
              },
              {
                key: 'label',
                label: 'المرجع',
                render: (entry) => (entry.kind === 'invoice'
                  ? h('a', { href: `#/invoices/${entry.ref}` }, ltr(entry.label))
                  : h('span', { text: entry.label })),
              },
              {
                key: 'debit',
                label: 'مدين (عليه)',
                render: (entry) => (entry.debitMinor > 0
                  ? h('span', { style: { color: 'var(--red)' } }, ltr(formatAmount(entry.debitMinor)), ` ${symbol}`)
                  : '—'),
              },
              {
                key: 'credit',
                label: 'دائن (له)',
                render: (entry) => (entry.creditMinor > 0
                  ? h('span', { style: { color: 'var(--green)' } }, ltr(formatAmount(entry.creditMinor)), ` ${symbol}`)
                  : '—'),
              },
              {
                key: 'balance',
                label: 'الرصيد التراكمي',
                render: (entry) => h('span', { style: { 'font-weight': '600' } },
                  ltr(formatAmount(entry.balanceMinor)), ` ${symbol}`),
              },
            ],
            rows: entries,
            empty: {
              iconName: 'history',
              title: 'لا حركات على الحساب',
              text: 'لم تُسجَّل فواتير آجلة أو مدفوعات لهذا العميل.',
            },
          }),
        })
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
    Object.defineProperty(__exports, "renderStatement", { enumerable: true, get: function () { return renderStatement; } });
  });

  /* ================================================================== */
  /* src/views/dashboard.js */
  __def("src/views/dashboard.js", function (__exports, __m, __dyn) {
    /** لوحة التحكم — مرجع: UI/01-dashboard.png */

    const { h, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, emptyState, deltaPercent, pagination } = __m("src/components/ui.js");
    const { dataTable, twoLineCell, thumbCell } = __m("src/components/table.js");
    const { lineChart, donutChart, chartLegend, chartWithLegend, CHART_COLORS } = __m("src/components/charts.js");
    const { dashboardData } = __m("src/services/reports.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, formatInt, formatCompact } = __m("src/utils/format.js");
    const { formatDateTime } = __m("src/utils/dates.js");
    const { SALE_STATUS_LABEL, SALE_STATUS_TONE, PAYMENT_TYPE_LABEL } = __m("src/repositories/sales.js");
    const { stockStatus, STOCK_LABEL, STOCK_TONE } = __m("src/repositories/products.js");
    const { isEmptyDatabase, seedDemoData } = __m("src/db/seed.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { toastOk, toastError, confirmDialog } = __m("src/components/feedback.js");
    const { navigate, refresh } = __m("src/router.js");

    async function render() {
      const symbol = settings().currencySymbol;
      const dateFormat = settings().dateFormat;

      const [data, empty] = await Promise.all([dashboardData(), isEmptyDatabase()]);

      if (empty) return firstRunScreen();

      const { today, yesterday, week, series, expenseSlices, lowStockProducts, lowStockCount, recentSales } = data;

      /* ------------------------------ بطاقات KPI ------------------------------ */

      const kpis = kpiGrid(
        kpi({
          label: 'مبيعات اليوم',
          value: formatAmount(today.revenueMinor),
          unit: symbol,
          iconName: 'banknote',
          tone: 'teal',
          delta: { percent: deltaPercent(today.revenueMinor, yesterday.revenueMinor), label: 'عن أمس' },
        }),
        kpi({
          label: 'عدد الفواتير',
          value: formatInt(today.invoiceCount),
          unit: 'فاتورة',
          iconName: 'clipboard',
          tone: 'violet',
          delta: { percent: deltaPercent(today.invoiceCount, yesterday.invoiceCount), label: 'عن أمس' },
        }),
        kpi({
          label: 'متوسط الفاتورة',
          value: formatAmount(today.averageInvoiceMinor),
          unit: symbol,
          iconName: 'file',
          tone: 'blue',
          delta: { percent: deltaPercent(today.averageInvoiceMinor, yesterday.averageInvoiceMinor), label: 'عن أمس' },
        }),
        kpi({
          label: 'صافي الحركة',
          value: formatAmount(today.netCashFlowMinor),
          unit: symbol,
          iconName: 'arrowUpDown',
          tone: 'green',
          delta: { percent: deltaPercent(today.netCashFlowMinor, yesterday.netCashFlowMinor), label: 'عن أمس' },
        })
      );

      /* -------------------------- المصروفات حسب الفئة -------------------------- */

      const expenseSlicesColored = expenseSlices.map((slice, index) => ({
        ...slice,
        color: slice.color || CHART_COLORS[index % CHART_COLORS.length],
      }));

      const expensesCard = card({
        title: 'المصروفات حسب الفئة',
        body: expenseSlicesColored.length === 0
          ? emptyState({
              iconName: 'expenses',
              title: 'لا مصروفات في آخر 7 أيام',
              text: 'سجّل مصروفاتك لتظهر هنا موزّعة حسب الفئة.',
            })
          : chartWithLegend(
              donutChart({ slices: expenseSlicesColored, title: 'المصروفات حسب الفئة', size: 200 }),
              chartLegend(expenseSlicesColored.map((slice) => ({
                label: slice.label,
                value: formatAmount(slice.value),
                color: slice.color,
              })))
            ),
        footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/expenses' }, h('span', { text: 'عرض الكل' })),
      });

      /* --------------------------- المبيعات خلال 7 أيام -------------------------- */

      const salesCard = card({
        title: 'المبيعات خلال 7 أيام',
        body: week.revenueMinor === 0
          ? emptyState({
              iconName: 'chart',
              title: 'لا مبيعات في آخر 7 أيام',
              text: 'ستظهر حركة المبيعات هنا بمجرد إتمام أول فاتورة.',
              action: h('a', { class: 'btn btn--sm btn--teal', href: '#/pos' },
                icon('pos'), h('span', { text: 'ابدأ البيع' })),
            })
          : lineChart({
              points: series.map((point) => ({
                label: point.relativeLabel,
                value: point.salesMinor / 100,
              })),
              title: 'المبيعات خلال 7 أيام',
              formatValue: (value) => formatCompact(value),
              height: 250,
            }),
        footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/reports' }, h('span', { text: 'عرض الكل' })),
      });

      /* -------------------------- الأصناف منخفضة المخزون ------------------------- */

      const lowStockCard = card({
        title: 'الأصناف منخفضة المخزون',
        titleIcon: lowStockCount > 0 ? 'warning' : null,
        body: lowStockProducts.length === 0
          ? emptyState({
              iconName: 'checkCircle',
              title: 'المخزون بحالة جيدة',
              text: 'لا توجد أصناف تحت الحد الأدنى حالياً.',
            })
          : h('ul', { class: 'stack', style: { gap: '14px' } },
              ...lowStockProducts.map((product) =>
                h('li', { class: 'row', style: { gap: '12px', 'flex-wrap': 'nowrap' } },
                  thumbCell(product.image, product.name),
                  h('div', { style: { flex: '1', 'min-width': '0' } },
                    h('div', { class: 'table__main', text: product.name }),
                    h('div', { class: 'table__sub' }, ltr(product.sku))
                  ),
                  h('div', { style: { 'text-align': 'center', flex: 'none' } },
                    h('div', {
                      style: { 'font-weight': '700', color: product.quantity === 0 ? 'var(--red)' : 'var(--amber-strong)' },
                    }, ltr(product.quantity)),
                    h('div', { class: 'table__sub', text: 'وحدة' })
                  )
                )
              )
            ),
        footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/inventory?stock=low' },
          h('span', { text: 'عرض الكل' })),
      });

      /* ------------------------------ آخر الفواتير ------------------------------ */

      const invoicesCard = card({
        title: 'آخر الفواتير',
        flush: true,
        body: dataTable({
          caption: 'آخر خمس فواتير',
          columns: [
            {
              key: 'number',
              label: 'رقم الفاتورة',
              render: (sale) => h('a', { href: `#/invoices/${sale.id}` }, ltr(sale.number)),
            },
            { key: 'customerName', label: 'العميل' },
            {
              key: 'totalMinor',
              label: 'الإجمالي',
              render: (sale) => h('span', null, ltr(formatAmount(sale.totalMinor)), ` ${symbol}`),
            },
            {
              key: 'status',
              label: 'الحالة',
              render: (sale) => badge(SALE_STATUS_LABEL[sale.status], SALE_STATUS_TONE[sale.status]),
            },
            {
              key: 'createdAt',
              label: 'التاريخ',
              render: (sale) => h('span', { class: 'row', style: { gap: '6px', 'flex-wrap': 'nowrap' } },
                icon('calendar', { class: 'icon' }),
                ltr(formatDateTime(sale.createdAt, dateFormat))
              ),
            },
            {
              key: 'paymentType',
              label: 'نوع الدفع',
              render: (sale) => h('span', { class: 'row', style: { gap: '6px', 'flex-wrap': 'nowrap' } },
                icon(sale.paymentType === 'credit' ? 'credit' : 'cash'),
                h('span', { text: PAYMENT_TYPE_LABEL[sale.paymentType] })
              ),
            },
          ],
          rows: recentSales,
          empty: {
            iconName: 'invoices',
            title: 'لا فواتير بعد',
            text: 'أول فاتورة تتمّها ستظهر هنا مباشرة.',
          },
        }),
        footer: h('a', { class: 'btn btn--sm btn--outline', href: '#/invoices' }, h('span', { text: 'عرض الكل' })),
      });

      return h('div', { class: 'stack' },
        kpis,
        h('div', { class: 'grid-3' }, expensesCard, salesCard, lowStockCard),
        invoicesCard
      );
    }

    /* ------------------------------------------------------------------ */
    /* شاشة أول تشغيل                                                       */
    /* ------------------------------------------------------------------ */

    function firstRunScreen() {
      let seeding = false;

      const seedButton = h('button', {
        class: 'btn btn--primary',
        attrs: { type: 'button' },
        on: {
          click: async (event) => {
            if (seeding) return;
            // احفظ المرجع قبل أي await — المتصفح يصفّر currentTarget بعد انتهاء الإرسال
            const button = event.currentTarget;
            const confirmed = await confirmDialog({
              title: 'إضافة بيانات تجريبية',
              message: 'سيتم إنشاء منتجات وعملاء ومبيعات ومصروفات للتجربة. يمكنك حذفها لاحقاً من شاشة النسخ الاحتياطي.',
              confirmLabel: 'إضافة البيانات',
            });
            if (!confirmed) return;

            seeding = true;
            button.disabled = true;
            button.textContent = 'جارٍ الإنشاء…';

            try {
              const result = await seedDemoData();
              notifyDataChanged();
              toastOk(`تمت إضافة ${result.products} منتجاً و${result.sales} فاتورة و${result.customers} عميلاً.`);
              refresh();
            } catch (error) {
              toastError(`تعذّر إنشاء البيانات التجريبية: ${error.message}`);
              button.disabled = false;
              seeding = false;
            }
          },
        },
      }, icon('zap'), h('span', { text: 'إضافة بيانات تجريبية' }));

      return h('div', { class: 'stack' },
        card({
          body: h('div', { class: 'empty', style: { padding: '48px 20px' } },
            h('div', { class: 'empty__icon', style: { width: '72px', height: '72px', background: 'var(--teal-soft)', color: 'var(--teal)' } },
              icon('store', { size: 34 })),
            h('h2', { style: { 'font-size': '20px', 'font-weight': '700' }, text: 'مرحباً بك في نظام المبيعات' }),
            h('p', { class: 'empty__text', style: { 'max-width': '520px' } },
              'قاعدة البيانات فارغة. ابدأ بإضافة منتجاتك، أو جرّب النظام ببيانات جاهزة. كل شيء يُحفظ على هذا الجهاز ولا يُرسل إلى أي خادم.'),
            h('div', { class: 'row', style: { 'margin-top': '8px', 'justify-content': 'center' } },
              h('a', { class: 'btn btn--teal', href: '#/products/new' },
                icon('plus'), h('span', { text: 'إضافة أول منتج' })),
              seedButton,
              h('a', { class: 'btn btn--ghost', href: '#/backup' },
                icon('upload'), h('span', { text: 'استعادة نسخة احتياطية' }))
            )
          ),
        }),

        h('div', { class: 'grid-3' },
          infoCard('database', 'بياناتك محلية', 'كل السجلات مخزّنة في متصفح هذا الجهاز فقط. لا يوجد خادم ولا حساب ولا مزامنة.'),
          infoCard('cloudUp', 'النسخ الاحتياطي مسؤوليتك', 'احفظ نسخة JSON خارج الجهاز بانتظام. مسح بيانات المتصفح يمسح كل شيء.'),
          infoCard('zap', 'يعمل دون اتصال', 'بعد أول زيارة عبر HTTPS أو localhost، يعمل التطبيق كاملاً بلا إنترنت.')
        )
      );
    }

    function infoCard(iconName, title, text) {
      return card({
        body: h('div', { class: 'stack', style: { gap: '10px' } },
          h('div', { class: 'kpi__icon kpi__icon--blue', style: { width: '40px', height: '40px' } }, icon(iconName)),
          h('h3', { style: { 'font-size': '15px', 'font-weight': '700' }, text: title }),
          h('p', { style: { 'font-size': '13.5px', color: 'var(--text-2)', 'line-height': '1.7' }, text })
        ),
      });
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/expenses.js */
  __def("src/views/expenses.js", function (__exports, __m, __dyn) {
    /** المصروفات — مرجع: UI/09-expenses.png */

    const { h, render: renderInto, ltr, debounce } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, searchField, field, pagination, rowMenu, alertBox } = __m("src/components/ui.js");
    const { dataTable } = __m("src/components/table.js");
    const { openPanel, openModal, toastOk, toastError, confirmDialog } = __m("src/components/feedback.js");
    const { listExpenses, createExpense, updateExpense, deleteExpense, listExpenseCategories, PAYMENT_METHODS, methodLabel } = __m("src/repositories/expenses.js");
    const { validateExpense, LIMITS } = __m("src/validation/validators.js");
    const { processAttachment } = __m("src/services/images.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, formatInt, formatBytes } = __m("src/utils/format.js");
    const { formatDateTime, dayKey, monthKey } = __m("src/utils/dates.js");
    const { toMajor } = __m("src/utils/money.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { refresh } = __m("src/router.js");
    const { exportExpenses } = __m("src/services/excel.js");

    async function render(context) {
      const s = settings();
      const symbol = s.currencySymbol;

      const [expenses, categories] = await Promise.all([listExpenses(), listExpenseCategories()]);
      const categoryById = new Map(categories.map((category) => [category.id, category]));

      const today = dayKey(new Date());
      const thisMonth = monthKey(new Date());

      const state = {
        query: '',
        category: 'all',
        from: `${thisMonth}-01`,
        to: today,
        page: 1,
        pageSize: 10,
      };

      const tableHost = h('div');
      const kpiHost = h('div');

      function filtered() {
        const term = state.query.trim().toLowerCase();
        return expenses.filter((expense) => {
          if (state.category !== 'all' && expense.categoryId !== state.category) return false;
          if (state.from && expense.dayKey < state.from) return false;
          if (state.to && expense.dayKey > state.to) return false;
          if (!term) return true;
          const category = categoryById.get(expense.categoryId)?.name || '';
          return `${expense.title || ''} ${expense.reference || ''} ${expense.note || ''} ${category}`
            .toLowerCase().includes(term);
        });
      }

      /* --------------------------------- KPIs --------------------------------- */

      function drawKpis() {
        const rows = filtered();
        const todayTotal = expenses.filter((e) => e.dayKey === today);
        const monthTotal = expenses.filter((e) => e.dayKey.startsWith(thisMonth));

        const sum = (list) => list.reduce((total, expense) => total + expense.amountMinor, 0);
        const average = rows.length > 0 ? Math.round(sum(rows) / rows.length) : 0;

        // أعلى فئة في النطاق المحدد
        const byCategory = new Map();
        for (const expense of rows) {
          byCategory.set(expense.categoryId, (byCategory.get(expense.categoryId) || 0) + expense.amountMinor);
        }
        const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];

        renderInto(kpiHost, kpiGrid(
          kpi({
            label: 'متوسط المصروف', value: formatAmount(average), unit: symbol,
            iconName: 'trendUp', tone: 'amber', subtext: 'للمصروف الواحد',
          }),
          kpi({
            label: 'أعلى فئة',
            value: h('span', { style: { 'font-size': '20px' }, text: top ? (categoryById.get(top[0])?.name || 'أخرى') : '—' }),
            iconName: 'tag', tone: 'violet',
            subtext: top ? `${formatAmount(top[1])} ${symbol}` : 'لا مصروفات',
          }),
          kpi({
            label: 'مصروفات الشهر', value: formatAmount(sum(monthTotal)), unit: symbol,
            iconName: 'calendar', tone: 'green', subtext: `عدد ${formatInt(monthTotal.length)}`,
          }),
          kpi({
            label: 'مصروفات اليوم', value: formatAmount(sum(todayTotal)), unit: symbol,
            iconName: 'calendar', tone: 'blue', subtext: `عدد ${formatInt(todayTotal.length)}`,
          })
        ));
      }

      /* -------------------------------- الجدول -------------------------------- */

      function drawTable() {
        const rows = filtered();
        const total = rows.length;
        const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
        if (state.page > maxPage) state.page = maxPage;
        const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

        renderInto(tableHost, card({
          flush: true,
          body: h('div', null,
            dataTable({
              caption: 'قائمة المصروفات',
              columns: [
                {
                  key: 'createdAt',
                  label: 'التاريخ',
                  render: (expense) => ltr(formatDateTime(expense.createdAt, s.dateFormat)),
                },
                {
                  key: 'categoryId',
                  label: 'الفئة',
                  render: (expense) => {
                    const category = categoryById.get(expense.categoryId);
                    return h('span', { class: 'row', style: { gap: '8px', 'flex-wrap': 'nowrap' } },
                      h('span', {
                        style: {
                          width: '9px', height: '9px', 'border-radius': '50%', flex: 'none',
                          background: category?.color || 'var(--text-3)',
                        },
                      }),
                      h('span', { style: { 'font-weight': '600' }, text: category?.name || 'أخرى' })
                    );
                  },
                },
                { key: 'title', label: 'البيان', render: (expense) => expense.title || '—' },
                { key: 'method', label: 'طريقة الدفع', render: (expense) => methodLabel(expense.method) },
                {
                  key: 'amountMinor',
                  label: 'المبلغ',
                  render: (expense) => h('span', { style: { 'font-weight': '600' } },
                    ltr(formatAmount(expense.amountMinor)), ` ${symbol}`),
                },
                {
                  key: 'attachment',
                  label: 'المرفق',
                  render: (expense) => {
                    if (!expense.attachment?.dataUrl) return h('span', { class: 'table__sub', text: '—' });
                    const isPdf = expense.attachment.type === 'application/pdf';
                    return h('button', {
                      class: 'icon-btn',
                      attrs: { type: 'button', 'aria-label': `عرض مرفق ${expense.title || 'المصروف'}` },
                      style: { color: isPdf ? 'var(--red)' : 'var(--green)' },
                      on: { click: () => openAttachment(expense) },
                    }, icon(isPdf ? 'file' : 'image'));
                  },
                },
                {
                  key: 'actions',
                  label: 'الإجراءات',
                  className: 'is-actions',
                  render: (expense) => rowMenu([
                    { label: 'تعديل', icon: 'pencil', onSelect: () => openExpensePanel(expense) },
                    { label: 'حذف', icon: 'trash', danger: true, onSelect: () => removeExpense(expense) },
                  ], { label: 'إجراءات المصروف' }),
                },
              ],
              rows: pageRows,
              empty: expenses.length === 0
                ? {
                    iconName: 'expenses',
                    title: 'لا مصروفات مسجّلة',
                    text: 'سجّل مصروفاتك لتظهر في التقارير وحساب صافي الحركة.',
                  }
                : { iconName: 'search', title: 'لا نتائج في هذه الفترة', text: 'جرّب توسيع نطاق التاريخ أو تغيير الفئة.' },
            }),
            total > 0
              ? pagination({
                  page: state.page, pageSize: state.pageSize, total, unit: 'مصروف',
                  onPage: (page) => { state.page = page; drawTable(); },
                  onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
                })
              : null
          ),
        }));
      }

      function openAttachment(expense) {
        const { attachment } = expense;
        const isPdf = attachment.type === 'application/pdf';

        const modal = openModal({
          title: attachment.name || 'المرفق',
          size: 'lg',
          body: isPdf
            ? alertBox('ملف PDF مرفق. استخدم زر التنزيل لفتحه في قارئ PDF.', 'info')
            : h('img', {
                src: attachment.dataUrl,
                alt: `مرفق ${expense.title || 'المصروف'}`,
                style: { width: '100%', 'max-height': '65vh', 'object-fit': 'contain' },
              }),
          footer: [
            h('a', {
              class: 'btn btn--primary',
              href: attachment.dataUrl,
              download: attachment.name || 'attachment',
            }, icon('download'), h('span', { text: 'تنزيل' })),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إغلاق', on: { click: () => modal.close() } }),
          ],
        });
      }

      async function removeExpense(expense) {
        const ok = await confirmDialog({
          title: 'حذف المصروف',
          message: `سيتم حذف مصروف "${expense.title || formatAmount(expense.amountMinor)}" نهائياً.`,
          confirmLabel: 'حذف',
          tone: 'danger',
        });
        if (!ok) return;

        try {
          await deleteExpense(expense.id);
          notifyDataChanged();
          toastOk('تم حذف المصروف');
          refresh();
        } catch (error) {
          toastError(error.message);
        }
      }

      /* ---------------------------- لوحة إضافة/تعديل ---------------------------- */

      function openExpensePanel(existing = null) {
        let attachment = existing?.attachment || null;

        const dateField = field({
          label: 'التاريخ', name: 'date', type: 'date', required: true,
          value: existing?.dayKey || today,
        });

        const categoryField = field({
          label: 'الفئة', name: 'categoryId', required: true,
          value: existing?.categoryId || categories[0]?.id || '',
          options: categories.map((category) => ({ value: category.id, label: category.name })),
        });

        const amountField = field({
          label: 'المبلغ', name: 'amount', required: true, suffix: symbol,
          placeholder: 'المبلغ',
          value: existing ? String(toMajor(existing.amountMinor)) : '',
        });

        const titleField = field({
          label: 'البيان', name: 'title',
          placeholder: 'وصف مختصر للمصروف', value: existing?.title || '', maxLength: LIMITS.name,
        });

        const methodField = field({
          label: 'طريقة الدفع', name: 'method',
          value: existing?.method || 'cash',
          options: PAYMENT_METHODS.map((method) => ({ value: method.value, label: method.label })),
        });

        const referenceField = field({
          label: 'رقم المرجع', name: 'reference',
          placeholder: 'أدخل رقم المرجع (اختياري)',
          value: existing?.reference || '', maxLength: LIMITS.reference,
        });

        const noteField = field({
          label: 'ملاحظة', name: 'note', rows: 3,
          placeholder: 'أدخل ملاحظة (اختياري)',
          value: existing?.note || '', maxLength: LIMITS.note, counter: true,
        });

        /* ------------------------------ الإيصال ------------------------------ */

        const attachmentHost = h('div');

        function drawAttachment() {
          if (attachment) {
            renderInto(attachmentHost,
              h('div', { class: 'file-preview' },
                attachment.type === 'application/pdf'
                  ? h('div', { class: 'table__thumb table__thumb--ph', style: { width: '54px', height: '54px', color: 'var(--red)' } }, icon('file'))
                  : h('img', { src: attachment.dataUrl, alt: '' }),
                h('div', { style: { flex: '1', 'min-width': '0' } },
                  h('div', { class: 'file-preview__name', text: attachment.name }),
                  h('div', { class: 'file-preview__meta', text: formatBytes(attachment.bytes) })
                ),
                h('button', {
                  class: 'icon-btn icon-btn--danger',
                  attrs: { type: 'button', 'aria-label': 'إزالة المرفق' },
                  on: { click: () => { attachment = null; drawAttachment(); } },
                }, icon('trash'))
              )
            );
            return;
          }

          const input = h('input', {
            type: 'file',
            accept: 'image/png,image/jpeg,image/webp,application/pdf',
            attrs: { 'aria-label': 'اختر ملف الإيصال' },
            on: { change: (event) => handleAttachment(event.target.files[0]) },
          });

          const drop = h('label', { class: 'file-drop' },
            icon('cloudUp', { class: 'file-drop__icon' }),
            h('span', { class: 'file-drop__title', text: 'اختر ملفاً' }),
            h('span', { class: 'file-drop__hint', text: 'PNG، JPG، PDF — الحد الأقصى 5MB' }),
            input
          );

          drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
          drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
          drop.addEventListener('drop', (event) => {
            event.preventDefault();
            drop.classList.remove('is-over');
            handleAttachment(event.dataTransfer.files[0]);
          });

          renderInto(attachmentHost, drop);
        }

        async function handleAttachment(file) {
          if (!file) return;
          try {
            attachment = await processAttachment(file);
            drawAttachment();
            toastOk('تم إرفاق الإيصال');
          } catch (error) {
            toastError(error.message);
          }
        }

        drawAttachment();

        /* ------------------------------- الحفظ ------------------------------- */

        async function submit() {
          amountField.setError(null);
          categoryField.setError(null);
          dateField.setError(null);

          const result = validateExpense({
            amount: amountField.value,
            categoryId: categoryField.value,
            dayKey: dateField.value,
            method: methodField.value,
            title: titleField.value,
            reference: referenceField.value,
            note: noteField.value,
            attachment,
          });

          if (!result.ok) {
            for (const [key, message] of Object.entries(result.errors)) {
              ({ amount: amountField, categoryId: categoryField, dayKey: dateField }[key])?.setError(message);
            }
            const first = Object.keys(result.errors)[0];
            ({ amount: amountField, categoryId: categoryField, dayKey: dateField }[first])?.focus();
            return;
          }

          try {
            if (existing) await updateExpense(existing.id, result.value);
            else await createExpense(result.value);

            notifyDataChanged();
            panel.close();
            toastOk(existing ? 'تم حفظ التعديلات' : 'تم تسجيل المصروف');
            refresh();
          } catch (error) {
            toastError(error.message);
          }
        }

        const panel = openPanel({
          title: existing ? 'تعديل مصروف' : 'إضافة مصروف جديد',
          body: [
            dateField.element,
            categoryField.element,
            amountField.element,
            titleField.element,
            methodField.element,
            referenceField.element,
            noteField.element,
            h('div', { class: 'field' },
              h('span', { class: 'field__label', text: 'إيصال' }),
              attachmentHost
            ),
          ],
          footer: [
            h('button', { class: 'btn btn--success btn--block', attrs: { type: 'button' }, text: 'حفظ المصروف', on: { click: submit } }),
            h('button', { class: 'btn btn--ghost btn--block', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => panel.close() } }),
          ],
        });

        requestAnimationFrame(() => amountField.focus());
      }

      /* ------------------------------- الفلاتر ------------------------------- */

      const applyFilters = () => { state.page = 1; drawKpis(); drawTable(); };

      const search = searchField({
        placeholder: 'بحث',
        label: 'بحث في المصروفات',
        onInput: debounce((value) => { state.query = value; applyFilters(); }, 200),
      });

      const fromField = field({
        label: 'من تاريخ', name: 'from', type: 'date', value: state.from,
        onChange: (event) => { state.from = event.target.value; applyFilters(); },
      });

      const toField = field({
        label: 'إلى تاريخ', name: 'to', type: 'date', value: state.to,
        onChange: (event) => { state.to = event.target.value; applyFilters(); },
      });

      const categoryFilter = field({
        label: 'الفئة', name: 'category', value: 'all',
        options: [{ value: 'all', label: 'الكل' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
        onChange: (event) => { state.category = event.target.value; applyFilters(); },
      });

      const filterBar = h('div', { class: 'filter-bar' },
        h('div', { class: 'filter-bar__row' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: 'بحث' }), search.element),
          fromField.element,
          toField.element,
          categoryFilter.element,
          h('div', { class: 'filter-bar__actions' },
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: {
                click: async () => {
                  try {
                    await exportExpenses(filtered(), categoryById);
                    toastOk('تم تصدير المصروفات إلى ملف Excel');
                  } catch (error) {
                    toastError(`تعذّر التصدير: ${error.message}`);
                  }
                },
              },
            }, h('span', { text: 'تصدير Excel' }), icon('download'))
          )
        )
      );

      drawKpis();
      drawTable();

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' },
          h('span'),
          h('div', { class: 'page__actions' },
            h('button', {
              class: 'btn btn--success',
              attrs: { type: 'button' },
              on: { click: () => openExpensePanel() },
            }, h('span', { text: 'إضافة مصروف' }), icon('plus'))
          )
        ),
        kpiHost,
        filterBar,
        tableHost
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/inventory.js */
  __def("src/views/inventory.js", function (__exports, __m, __dyn) {
    /** المخزون — مرجع: UI/05-inventory.png */

    const { h, render: renderInto, ltr, debounce } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, searchField, field, pagination, emptyState, rowMenu, alertBox } = __m("src/components/ui.js");
    const { dataTable, thumbCell } = __m("src/components/table.js");
    const { openPanel, openModal, toastOk, toastError } = __m("src/components/feedback.js");
    const { listProducts, listCategories, stockStatus, STOCK_LABEL, STOCK_TONE, STOCK_STATUS } = __m("src/repositories/products.js");
    const { recordAdjustment, recordStocktake, listReasons, lastMovementByProduct, movementsForProduct, MOVEMENT_LABEL } = __m("src/repositories/inventory.js");
    const { validateAdjustment, parseQuantity, LIMITS } = __m("src/validation/validators.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, formatInt } = __m("src/utils/format.js");
    const { formatDate, formatDateTime } = __m("src/utils/dates.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { refresh } = __m("src/router.js");
    const { exportInventory } = __m("src/services/excel.js");

    async function render(context) {
      const s = settings();
      const symbol = s.currencySymbol;

      const [products, categories, reasons, lastMovements] = await Promise.all([
        listProducts(), listCategories(), listReasons(), lastMovementByProduct(),
      ]);

      const categoryById = new Map(categories.map((category) => [category.id, category]));
      const active = products.filter((product) => product.isActive !== false);

      const state = {
        query: '',
        category: 'all',
        stock: context.query.stock || 'all',
        page: 1,
        pageSize: 10,
      };

      const tableHost = h('div');

      function filtered() {
        const term = state.query.trim().toLowerCase();
        return active.filter((product) => {
          if (state.category !== 'all' && product.categoryId !== state.category) return false;
          if (state.stock !== 'all' && stockStatus(product) !== state.stock) return false;
          if (!term) return true;
          return `${product.nameLower || product.name.toLowerCase()} ${product.sku}`.includes(term);
        });
      }

      /* --------------------------------- KPIs --------------------------------- */

      const totalUnits = active.reduce((sum, product) => sum + product.quantity, 0);
      const stockValue = active.reduce((sum, product) => sum + product.quantity * product.costMinor, 0);
      const lowCount = active.filter((product) => stockStatus(product) === STOCK_STATUS.LOW).length;
      const outCount = active.filter((product) => stockStatus(product) === STOCK_STATUS.OUT).length;

      const kpis = kpiGrid(
        kpi({
          variant: 'stacked', label: 'إجمالي الوحدات', value: formatInt(totalUnits), unit: 'وحدة',
          iconName: 'products', tone: 'teal',
          link: { label: 'عرض التفاصيل', href: '#/inventory' },
        }),
        kpi({
          variant: 'stacked', label: 'قيمة المخزون', value: formatAmount(stockValue), unit: symbol,
          iconName: 'layers', tone: 'violet',
          link: { label: 'عرض التفاصيل', href: '#/reports?type=stock' },
        }),
        kpi({
          variant: 'stacked', label: 'مخزون منخفض', value: formatInt(lowCount), unit: 'منتجات',
          iconName: 'arrowDown', tone: 'amber',
          link: { label: 'عرض التفاصيل', href: '#/inventory?stock=low' },
        }),
        kpi({
          variant: 'stacked', label: 'نفد المخزون', value: formatInt(outCount), unit: 'منتجات',
          iconName: 'packageX', tone: 'red',
          link: { label: 'عرض التفاصيل', href: '#/inventory?stock=out' },
        })
      );

      /* -------------------------------- الجدول -------------------------------- */

      function drawTable() {
        const rows = filtered();
        const total = rows.length;
        const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
        if (state.page > maxPage) state.page = maxPage;
        const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

        renderInto(tableHost, card({
          flush: true,
          body: h('div', null,
            dataTable({
              caption: 'قائمة المخزون',
              columns: [
                { key: 'image', label: 'صورة', render: (product) => thumbCell(product.image, product.name) },
                {
                  key: 'name',
                  label: 'اسم المنتج',
                  render: (product) => h('div', null,
                    h('div', { class: 'table__main', text: product.name }),
                    h('div', { class: 'table__sub', text: categoryById.get(product.categoryId)?.name || '' })
                  ),
                },
                { key: 'sku', label: 'SKU', render: (product) => ltr(product.sku) },
                {
                  key: 'quantity',
                  label: 'الكمية الحالية',
                  render: (product) => h('span', { style: { 'font-weight': '600' } }, ltr(product.quantity)),
                },
                { key: 'minimumStock', label: 'الحد الأدنى', render: (product) => ltr(product.minimumStock ?? product.lowStockThreshold ?? 0) },
                { key: 'maximumStock', label: 'الحد الأقصى', render: (product) => ltr(product.maximumStock ?? 0) },
                { key: 'reorderPoint', label: 'نقطة إعادة الطلب', render: (product) => ltr(product.reorderPoint ?? product.lowStockThreshold ?? 0) },
                {
                  key: 'status',
                  label: 'الحالة',
                  render: (product) => {
                    const status = stockStatus(product);
                    return badge(STOCK_LABEL[status], STOCK_TONE[status]);
                  },
                },
                {
                  key: 'lastMovement',
                  label: 'آخر حركة',
                  render: (product) => {
                    const movement = lastMovements.get(product.id);
                    if (!movement) return h('span', { class: 'table__sub', text: 'لا حركات' });
                    const sign = movement.quantity >= 0 ? 'إضافة' : 'سحب';
                    return h('div', null,
                      h('div', null, ltr(formatDate(movement.createdAt, s.dateFormat))),
                      h('div', { class: 'table__sub', text: `${sign} ${Math.abs(movement.quantity)} وحدة` })
                    );
                  },
                },
                {
                  key: 'actions',
                  label: 'الإجراءات',
                  className: 'is-actions',
                  render: (product) => rowMenu([
                    { label: 'تسوية مخزون', icon: 'sliders', onSelect: () => openAdjustPanel(product) },
                    { label: 'جرد هذا الصنف', icon: 'clipboard', onSelect: () => openStocktake(product) },
                    { label: 'سجل الحركات', icon: 'history', onSelect: () => openHistory(product) },
                    { label: 'تعديل المنتج', icon: 'pencil', onSelect: () => { window.location.hash = `#/products/${product.id}/edit`; } },
                  ], { label: `إجراءات ${product.name}` }),
                },
              ],
              rows: pageRows,
              empty: {
                iconName: 'layers',
                title: active.length === 0 ? 'لا توجد منتجات' : 'لا نتائج مطابقة',
                text: active.length === 0
                  ? 'أضف منتجات لتتمكّن من إدارة المخزون.'
                  : 'جرّب تعديل البحث أو مسح الفلاتر.',
              },
            }),
            total > 0
              ? pagination({
                  page: state.page, pageSize: state.pageSize, total, unit: 'منتج',
                  onPage: (page) => { state.page = page; drawTable(); },
                  onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
                })
              : null
          ),
        }));
      }

      /* ------------------------------- الفلاتر ------------------------------- */

      const search = searchField({
        placeholder: 'بحث باسم المنتج أو SKU',
        label: 'بحث في المخزون',
        onInput: debounce((value) => { state.query = value; state.page = 1; drawTable(); }, 200),
      });

      const categoryFilter = field({
        label: 'الفئة', name: 'category', value: state.category,
        options: [{ value: 'all', label: 'الكل' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
        onChange: (event) => { state.category = event.target.value; state.page = 1; drawTable(); },
      });

      const stockFilter = field({
        label: 'حالة المخزون', name: 'stock', value: state.stock,
        options: [
          { value: 'all', label: 'الكل' },
          { value: STOCK_STATUS.OK, label: 'متوفر' },
          { value: STOCK_STATUS.LOW, label: 'منخفض' },
          { value: STOCK_STATUS.OUT, label: 'نفد المخزون' },
        ],
        onChange: (event) => { state.stock = event.target.value; state.page = 1; drawTable(); },
      });

      const filterBar = h('div', { class: 'filter-bar' },
        h('div', { class: 'filter-bar__row' },
          h('div', { class: 'field' },
            h('label', { class: 'field__label', text: 'بحث' }),
            search.element
          ),
          categoryFilter.element,
          stockFilter.element,
          h('div', { class: 'filter-bar__actions' },
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  state.query = ''; state.category = 'all'; state.stock = 'all'; state.page = 1;
                  search.input.value = '';
                  categoryFilter.value = 'all';
                  stockFilter.value = 'all';
                  drawTable();
                },
              },
            }, h('span', { text: 'مسح الفلاتر' }), icon('close'))
          )
        )
      );

      /* --------------------------- لوحة تسوية المخزون --------------------------- */

      function openAdjustPanel(initialProduct) {
        let product = initialProduct;
        let direction = 1; // 1 إضافة، -1 سحب

        const currentField = field({
          label: 'المخزون الحالي', name: 'current',
          value: `${product.quantity} ${product.unit}`, disabled: true,
        });

        // اختيار المنتج من داخل اللوحة (كما في الصورة المرجعية)
        const productField = field({
          label: 'المنتج', name: 'productId', required: true,
          value: product.id,
          options: active.map((item) => ({ value: item.id, label: `${item.name} — ${item.sku}` })),
          onChange: (event) => {
            product = active.find((item) => item.id === event.target.value) || product;
            currentField.value = `${product.quantity} ${product.unit}`;
            drawProductPreview();
            updatePreview();
          },
        });

        const productPreview = h('div');
        function drawProductPreview() {
          renderInto(productPreview,
            h('div', { class: 'file-preview' },
              product.image
                ? h('img', { src: product.image, alt: '' })
                : h('div', { class: 'table__thumb table__thumb--ph', style: { width: '54px', height: '54px' } }, icon('package')),
              h('div', null,
                h('div', { class: 'file-preview__name', text: product.name }),
                h('div', { class: 'file-preview__meta' }, 'SKU: ', ltr(product.sku))
              )
            )
          );
        }
        drawProductPreview();

        const quantityField = field({
          label: 'الكمية', name: 'quantity', type: 'number', min: '0', required: true,
          value: '0',
          hint: 'أدخل كمية موجبة، ثم اختر نوع الحركة أعلاه',
        });

        const reasonField = field({
          label: 'السبب', name: 'reason', required: true,
          value: reasons[0]?.name || '',
          options: reasons.map((reason) => ({ value: reason.name, label: reason.name })),
        });

        const noteField = field({
          label: 'ملاحظة', name: 'note', rows: 3,
          placeholder: 'أدخل ملاحظة (اختياري)', maxLength: LIMITS.note, counter: true,
        });

        const previewLine = h('p', { class: 'field__hint' });
        const updatePreview = () => {
          const raw = parseQuantity(quantityField.value, { allowZero: true });
          const delta = Number.isNaN(raw) ? 0 : raw * direction;
          const after = product.quantity + delta;
          previewLine.textContent = `الرصيد بعد التسوية: ${after} ${product.unit}`;
          previewLine.style.color = after < 0 ? 'var(--red)' : 'var(--text-3)';
        };
        quantityField.input.addEventListener('input', updatePreview);
        updatePreview();

        const typeButtons = h('div', { class: 'segmented' },
          h('button', {
            class: 'segmented__btn',
            attrs: { type: 'button', 'aria-pressed': 'true' },
            on: { click: (event) => setDirection(1, event.currentTarget) },
          }, icon('plus'), h('span', { text: 'إضافة' })),
          h('button', {
            class: 'segmented__btn',
            attrs: { type: 'button', 'aria-pressed': 'false' },
            on: { click: (event) => setDirection(-1, event.currentTarget) },
          }, icon('minus'), h('span', { text: 'سحب' }))
        );

        function setDirection(value, button) {
          direction = value;
          for (const child of typeButtons.children) {
            child.setAttribute('aria-pressed', String(child === button));
          }
          updatePreview();
        }

        async function submit() {
          quantityField.setError(null);
          reasonField.setError(null);

          const magnitude = parseQuantity(quantityField.value, { allowZero: false });
          if (Number.isNaN(magnitude) || magnitude <= 0) {
            quantityField.setError('أدخل كمية أكبر من صفر');
            quantityField.focus();
            return;
          }

          const result = validateAdjustment({
            productId: product.id,
            quantity: magnitude * direction,
            reason: reasonField.value,
            note: noteField.value,
          });

          if (!result.ok) {
            for (const [key, message] of Object.entries(result.errors)) {
              ({ quantity: quantityField, reason: reasonField }[key])?.setError(message);
            }
            return;
          }

          try {
            await recordAdjustment({ ...result.value, allowNegative: s.allowNegativeStock });
            notifyDataChanged();
            panel.close();
            toastOk(`تمت تسوية مخزون "${product.name}"`);
            refresh();
          } catch (error) {
            toastError(error.message);
          }
        }

        const panel = openPanel({
          title: 'تعديل المخزون',
          body: [
            productField.element,
            productPreview,
            currentField.element,
            h('div', { class: 'field' },
              h('span', { class: 'field__label', text: 'نوع الحركة' }),
              typeButtons
            ),
            h('div', null, quantityField.element, previewLine),
            reasonField.element,
            noteField.element,
          ],
          footer: [
            h('button', { class: 'btn btn--primary btn--block', attrs: { type: 'button' }, text: 'حفظ التسوية', on: { click: submit } }),
            h('button', { class: 'btn btn--ghost btn--block', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => panel.close() } }),
          ],
        });

        requestAnimationFrame(() => quantityField.focus());
      }

      /* --------------------------------- الجرد --------------------------------- */

      function openStocktake(product) {
        const countedField = field({
          label: 'الكمية المعدودة فعلياً', name: 'counted', type: 'number', min: '0', required: true,
          value: String(product.quantity),
          hint: `الكمية المسجّلة في النظام: ${product.quantity} ${product.unit}`,
        });

        const noteField = field({
          label: 'ملاحظة', name: 'note', rows: 2, maxLength: LIMITS.note,
          placeholder: 'ملاحظة اختيارية عن الجرد',
        });

        const diffLine = h('p', { class: 'field__hint' });
        const updateDiff = () => {
          const counted = parseQuantity(countedField.value);
          if (Number.isNaN(counted)) { diffLine.textContent = 'أدخل عدداً صحيحاً غير سالب'; return; }
          const delta = counted - product.quantity;
          diffLine.textContent = delta === 0
            ? 'لا فرق — لن تُسجَّل حركة'
            : `الفرق: ${delta > 0 ? '+' : ''}${delta} ${product.unit}`;
          diffLine.style.color = delta === 0 ? 'var(--text-3)' : delta > 0 ? 'var(--green)' : 'var(--red)';
        };
        countedField.input.addEventListener('input', updateDiff);
        updateDiff();

        async function submit() {
          const counted = parseQuantity(countedField.value);
          if (Number.isNaN(counted)) {
            countedField.setError('أدخل عدداً صحيحاً غير سالب');
            return;
          }

          try {
            const result = await recordStocktake({
              productId: product.id,
              countedQuantity: counted,
              note: noteField.value,
            });
            modal.close();
            if (result.delta === 0) {
              toastOk('الجرد مطابق — لم تُسجَّل أي حركة');
            } else {
              notifyDataChanged();
              toastOk(`تم تسجيل الجرد. الفرق ${result.delta > 0 ? '+' : ''}${result.delta}`);
              refresh();
            }
          } catch (error) {
            toastError(error.message);
          }
        }

        const modal = openModal({
          title: `جرد: ${product.name}`,
          body: [
            alertBox('الجرد يضبط الكمية على ما عددته فعلياً ويسجّل الفرق كحركة بسبب «جرد».', 'info'),
            countedField.element,
            diffLine,
            noteField.element,
          ],
          footer: [
            h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'حفظ الجرد', on: { click: submit } }),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });
      }

      /* ------------------------------ سجل الحركات ------------------------------ */

      async function openHistory(product) {
        const movements = await movementsForProduct(product.id, 100);

        const modal = openModal({
          title: `سجل حركات: ${product.name}`,
          size: 'lg',
          body: dataTable({
            caption: 'سجل الحركات',
            columns: [
              { key: 'createdAt', label: 'التاريخ', render: (m) => ltr(formatDateTime(m.createdAt, s.dateFormat)) },
              { key: 'type', label: 'النوع', render: (m) => badge(MOVEMENT_LABEL[m.type] || m.type, m.quantity >= 0 ? 'green' : 'amber') },
              {
                key: 'quantity',
                label: 'الكمية',
                render: (m) => h('span', {
                  style: { color: m.quantity >= 0 ? 'var(--green)' : 'var(--red)', 'font-weight': '600' },
                }, ltr(`${m.quantity >= 0 ? '+' : ''}${m.quantity}`)),
              },
              { key: 'balanceAfter', label: 'الرصيد', render: (m) => ltr(m.balanceAfter) },
              { key: 'reason', label: 'السبب' },
              { key: 'note', label: 'ملاحظة' },
            ],
            rows: movements,
            empty: { iconName: 'history', title: 'لا حركات', text: 'لم تُسجَّل أي حركة لهذا المنتج بعد.' },
          }),
          footer: [h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إغلاق', on: { click: () => modal.close() } })],
        });
      }

      /* ------------------------------ جرد شامل ------------------------------ */

      function openBulkStocktake() {
        const rows = filtered();
        if (rows.length === 0) {
          toastError('لا توجد منتجات مطابقة للفلاتر الحالية');
          return;
        }

        const inputs = new Map();
        const list = h('div', { class: 'table-wrap', style: { 'max-height': '52vh' } },
          h('table', { class: 'table' },
            h('thead', null, h('tr', null,
              h('th', { text: 'المنتج' }),
              h('th', { text: 'المسجّل' }),
              h('th', { text: 'المعدود فعلياً' })
            )),
            h('tbody', null, ...rows.map((product) => {
              const input = h('input', {
                class: 'input',
                type: 'number',
                min: '0',
                value: String(product.quantity),
                style: { width: '110px' },
                attrs: { 'aria-label': `الكمية المعدودة لـ ${product.name}` },
              });
              inputs.set(product.id, input);

              return h('tr', null,
                h('td', null,
                  h('div', { class: 'table__main', text: product.name }),
                  h('div', { class: 'table__sub' }, ltr(product.sku))
                ),
                h('td', null, ltr(product.quantity)),
                h('td', null, input)
              );
            }))
          )
        );

        async function submit() {
          const changes = [];
          for (const product of rows) {
            const counted = parseQuantity(inputs.get(product.id).value);
            if (Number.isNaN(counted) || counted === product.quantity) continue;
            changes.push({ product, counted });
          }

          if (changes.length === 0) {
            modal.close();
            toastOk('الجرد مطابق لكل الأصناف — لا حركات مسجّلة');
            return;
          }

          let applied = 0;
          const failures = [];
          for (const { product, counted } of changes) {
            try {
              await recordStocktake({ productId: product.id, countedQuantity: counted, note: 'جرد شامل' });
              applied += 1;
            } catch (error) {
              failures.push(`${product.name}: ${error.message}`);
            }
          }

          notifyDataChanged();
          modal.close();
          if (failures.length > 0) toastError(`سُجّل ${applied} صنفاً، وفشل ${failures.length}. أول خطأ: ${failures[0]}`);
          else toastOk(`تم تسجيل الجرد لـ ${applied} صنفاً`);
          refresh();
        }

        const modal = openModal({
          title: 'جرد المخزون',
          size: 'lg',
          body: [
            alertBox(`سيتم جرد ${rows.length} صنفاً حسب الفلاتر الحالية. غيّر الكميات المعدودة ثم احفظ — تُسجَّل حركة لكل فرق فقط.`, 'info'),
            list,
          ],
          footer: [
            h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'حفظ الجرد', on: { click: submit } }),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });
      }

      /* -------------------------------- التركيب -------------------------------- */

      drawTable();

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' },
          h('span'),
          h('div', { class: 'page__actions' },
            h('button', {
              class: 'btn btn--primary',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  if (active.length === 0) { toastError('لا توجد منتجات'); return; }
                  openAdjustPanel(active[0]);
                },
              },
            }, h('span', { text: 'تسوية مخزون' }), icon('sliders')),
            h('button', {
              class: 'btn btn--outline',
              attrs: { type: 'button' },
              on: { click: openBulkStocktake },
            }, h('span', { text: 'جرد المخزون' }), icon('clipboard')),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: {
                click: async () => {
                  try {
                    const rows = filtered().map((product) => ({
                      ...product,
                      status: stockStatus(product),
                      categoryName: categoryById.get(product.categoryId)?.name || '',
                      stockValueMinor: product.quantity * product.costMinor,
                    }));
                    await exportInventory(rows);
                    toastOk('تم تصدير المخزون إلى ملف Excel');
                  } catch (error) {
                    toastError(`تعذّر التصدير: ${error.message}`);
                  }
                },
              },
            }, h('span', { text: 'تصدير Excel' }), icon('download'))
          )
        ),
        kpis,
        filterBar,
        tableHost
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/invoice-detail.js */
  __def("src/views/invoice-detail.js", function (__exports, __m, __dyn) {
    /** تفاصيل الفاتورة — مرجع: UI/07-invoice-detail.png */

    const { h, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, badge, emptyState, detailRow, alertBox } = __m("src/components/ui.js");
    const { toastOk, toastError, confirmDialog, openModal } = __m("src/components/feedback.js");
    const { field } = __m("src/components/ui.js");
    const { getSaleWithItems, cancelSale, SALE_STATUS, SALE_STATUS_LABEL, SALE_STATUS_TONE, PAYMENT_TYPE_LABEL } = __m("src/repositories/sales.js");
    const { getCustomer } = __m("src/repositories/customers.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount } = __m("src/utils/format.js");
    const { formatDateTime } = __m("src/utils/dates.js");
    const { bpToPercent } = __m("src/utils/money.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { navigate, refresh } = __m("src/router.js");
    const { printInvoice, TEMPLATES, TEMPLATE_LABEL } = __m("src/services/print.js");
    const { exportReport, exportFileName } = __m("src/services/excel.js");
    const { toMajor } = __m("src/utils/money.js");
    const { returnAvailability, createReturn, returnsForSale, REFUND_METHOD_LABEL } = __m("src/repositories/returns.js");

    async function render(context) {
      const data = await getSaleWithItems(context.params.id);

      if (!data) {
        return card({
          body: emptyState({
            iconName: 'search',
            title: 'الفاتورة غير موجودة',
            text: 'الرابط الذي فتحته لا يطابق أي فاتورة.',
            action: h('a', { class: 'btn btn--primary', href: '#/invoices' }, h('span', { text: 'العودة إلى الفواتير' })),
          }),
        });
      }

      const { sale, items } = data;
      const returns = await returnsForSale(sale.id);
      const s = settings();
      const symbol = s.currencySymbol;
      const customer = sale.customerId ? await getCustomer(sale.customerId) : null;
      const isCancelled = sale.status === SALE_STATUS.CANCELLED;

      const money = (minor) => h('span', null, ltr(formatAmount(minor)), ` ${symbol}`);

      /* ------------------------------- الإجراءات ------------------------------- */

      function openPrintDialog() {
        let template = s.printTemplate;

        const templateField = field({
          label: 'قالب الطباعة',
          name: 'template',
          value: template,
          options: [
            { value: TEMPLATES.A4, label: TEMPLATE_LABEL[TEMPLATES.A4] },
            { value: TEMPLATES.THERMAL, label: TEMPLATE_LABEL[TEMPLATES.THERMAL] },
          ],
          onChange: (event) => { template = event.target.value; },
        });

        const modal = openModal({
          title: 'طباعة الفاتورة',
          body: [
            templateField.element,
            alertBox('لحفظ الفاتورة كملف PDF، اختر «حفظ كـ PDF» من قائمة الطابعات في مربع الطباعة.', 'info'),
          ],
          footer: [
            h('button', {
              class: 'btn btn--primary',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  modal.close();
                  printInvoice(sale, items, template);
                },
              },
            }, icon('printer'), h('span', { text: 'طباعة' })),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });
      }

      async function doCancel() {
        const ok = await confirmDialog({
          title: 'إلغاء الفاتورة',
          message: `سيتم إرجاع ${items.length} صنفاً إلى المخزون وتسجيل حركة لكل صنف. الفاتورة تبقى في السجل بحالة «ملغاة» ولا تُحذف نهائياً.`,
          confirmLabel: 'إلغاء الفاتورة',
          tone: 'danger',
        });
        if (!ok) return;

        try {
          const result = await cancelSale(sale.id, 'إلغاء من شاشة الفاتورة');
          notifyDataChanged();
          toastOk(`تم إلغاء الفاتورة وإرجاع ${result.restoredLines} صنفاً إلى المخزون`);
          refresh();
        } catch (error) {
          toastError(error.message);
        }
      }

      async function openReturnDialog() {
        const available = await returnAvailability(sale.id);
        if (!available.some((item) => item.availableQuantity > 0)) {
          toastError('تم إرجاع كامل كميات هذه الفاتورة بالفعل');
          return;
        }
        const quantities = new Map();
        const reasonField = field({ label: 'سبب المرتجع', name: 'reason', placeholder: 'مثال: عيب في المنتج أو تغيير رأي العميل', maxLength: 200 });
        const methodField = field({ label: 'طريقة إعادة المبلغ', name: 'refundMethod', value: 'cash', options: Object.entries(REFUND_METHOD_LABEL).map(([value, label]) => ({ value, label })) });
        const noteField = field({ label: 'ملاحظة', name: 'note', rows: 2, maxLength: 300 });
        const rows = available.filter((item) => item.availableQuantity > 0).map((item) => {
          const qty = field({ label: `${item.name} — المتاح ${item.availableQuantity}`, name: `return-${item.id}`, type: 'number', min: '0', max: String(item.availableQuantity), value: '0', suffix: item.unit || 'وحدة' });
          quantities.set(item.id, qty);
          return qty.element;
        });
        const modal = openModal({
          title: `إرجاع من الفاتورة ${sale.number}`,
          body: [alertBox('سيُعاد المخزون فوراً، ويُحفظ المرتجع كحركة مستقلة دون إلغاء الفاتورة.', 'info'), ...rows, reasonField.element, methodField.element, noteField.element],
          footer: [
            h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'تأكيد الإرجاع', on: { click: async () => {
              const lines = available.map((item) => ({ saleItemId: item.id, quantity: Number(quantities.get(item.id)?.value || 0) })).filter((line) => line.quantity > 0);
              try {
                const result = await createReturn({ saleId: sale.id, lines, reason: reasonField.value, refundMethod: methodField.value, note: noteField.value });
                modal.close(); notifyDataChanged(); toastOk(`تم تسجيل المرتجع بقيمة ${formatAmount(result.return.refundMinor)} ${symbol}`); refresh();
              } catch (error) { toastError(error.message); }
            } } }),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });
      }

      async function doExport() {
        try {
          await exportReport({
            title: `فاتورة ${sale.number}`,
            fileName: exportFileName(`فاتورة-${sale.number}`),
            header: ['الصنف', 'SKU', 'الكمية', `سعر الوحدة (${symbol})`, `الخصم (${symbol})`, `الإجمالي (${symbol})`],
            rows: items.map((item) => [
              item.name, item.sku, item.quantity,
              toMajor(item.unitPriceMinor), toMajor(item.lineDiscountMinor), toMajor(item.lineTotalMinor),
            ]),
          });
          toastOk('تم تصدير الفاتورة إلى ملف Excel');
        } catch (error) {
          toastError(`تعذّر التصدير: ${error.message}`);
        }
      }

      /* ------------------------------- المستند ------------------------------- */

      const document_ = card({
        className: 'invoice-doc-card',
        body: h('article', { class: 'invoice-doc' },
          h('header', { class: 'invoice-doc__head' }, icon('receipt'), h('span', { text: 'فاتورة مبيعات' })),

          h('div', { class: 'invoice-parties' },
            h('div', { class: 'invoice-parties__col' },
              h('div', { class: 'invoice-parties__title' }, icon('store'), h('span', { text: 'بيانات المتجر' })),
              h('div', { class: 'invoice-parties__name', text: s.storeName }),
              s.storeAddress ? h('div', { class: 'invoice-parties__line', text: s.storeAddress }) : null,
              s.storePhone ? h('div', { class: 'invoice-parties__line' }, 'هاتف: ', ltr(s.storePhone)) : null,
              s.storeCrNumber ? h('div', { class: 'invoice-parties__line' }, 'السجل التجاري: ', ltr(s.storeCrNumber)) : null,
              s.storeTaxNumber ? h('div', { class: 'invoice-parties__line' }, 'الرقم الضريبي: ', ltr(s.storeTaxNumber)) : null
            ),
            h('div', { class: 'invoice-parties__col' },
              h('div', { class: 'invoice-parties__title' }, icon('user'), h('span', { text: 'بيانات العميل' })),
              h('div', { class: 'invoice-parties__name', text: sale.customerName }),
              customer?.phone
                ? h('div', { class: 'invoice-parties__line' }, 'هاتف: ', ltr(customer.phone))
                : h('div', { class: 'invoice-parties__line', text: 'عميل نقدي - مبيعات فورية' }),
              customer
                ? h('a', { class: 'invoice-parties__line', href: `#/customers/${customer.id}`, text: 'عرض كشف الحساب' })
                : null
            )
          ),

          h('div', { class: 'table-wrap' },
            h('table', { class: 'table' },
              h('thead', null, h('tr', null,
                h('th', { text: 'الصنف' }),
                h('th', { text: 'الكمية' }),
                h('th', { text: 'سعر الوحدة' }),
                h('th', { text: 'الإجمالي' })
              )),
              h('tbody', null, ...items.map((item) =>
                h('tr', null,
                  h('td', null,
                    h('div', { class: 'table__main', text: item.name }),
                    h('div', { class: 'table__sub' }, ltr(item.sku))
                  ),
                  h('td', null, ltr(item.quantity)),
                  h('td', null, money(item.unitPriceMinor)),
                  h('td', null, money(item.lineTotalMinor))
                )
              ))
            )
          ),

          h('div', { class: 'invoice-totals' },
            h('div', { class: 'invoice-totals__row' },
              h('span', { text: 'المجموع الفرعي' }), money(sale.subtotalMinor)),
            sale.discountMinor > 0
              ? h('div', { class: 'invoice-totals__row' },
                  h('span', { text: 'الخصم' }),
                  h('span', null, '−', ltr(formatAmount(sale.discountMinor)), ` ${symbol}`))
              : null,
            h('div', { class: 'invoice-totals__row' },
              h('span', { text: `الضريبة (${bpToPercent(sale.taxRateBp)}%)` }), money(sale.taxMinor)),
            h('div', { class: 'invoice-totals__row invoice-totals__row--final' },
              h('span', { text: 'الإجمالي النهائي' }), money(sale.totalMinor))
          ),

          sale.note
            ? h('div', { class: 'invoice-note' },
                h('div', { class: 'invoice-note__label', text: 'ملاحظة' }),
                h('div', { class: 'invoice-note__text', text: sale.note }))
            : s.invoiceFooter
              ? h('div', { class: 'invoice-note' },
                  h('div', { class: 'invoice-note__label', text: 'ملاحظة' }),
                  h('div', { class: 'invoice-note__text', text: s.invoiceFooter }))
              : null
        ),
      });

      /* -------------------------------- الجانب -------------------------------- */

      const timeline = [
        {
          title: 'تم إنشاء الفاتورة',
          at: sale.createdAt,
          actor: 'المستخدم',
        },
        {
          title: 'تم تخفيض المخزون',
          at: sale.createdAt,
          actor: 'النظام',
        },
        ...(isCancelled
          ? [{
              title: 'تم إلغاء الفاتورة وإرجاع المخزون',
              at: sale.cancelledAt,
              actor: 'المستخدم',
              tone: 'red',
            }]
          : []),
      ];

      const sidebar = h('div', { class: 'stack' },
        card({
          title: 'ملخص الدفع',
          titleIcon: 'wallet',
          body: h('div', { class: 'stack', style: { gap: '2px' } },
            detailRow('نوع الدفع', PAYMENT_TYPE_LABEL[sale.paymentType] || '—'),
            detailRow('المبلغ المدفوع', h('span', { style: { color: 'var(--green)', 'font-weight': '700' } },
              ltr(formatAmount(sale.paidMinor)), ` ${symbol}`)),
            detailRow('المتبقي', h('span', {
              style: { color: sale.dueMinor > 0 ? 'var(--red)' : 'var(--text)', 'font-weight': sale.dueMinor > 0 ? '700' : '600' },
            }, ltr(formatAmount(sale.dueMinor)), ` ${symbol}`))
          ),
          footer: sale.dueMinor > 0 && customer
            ? h('a', { class: 'btn btn--sm btn--success btn--block', href: `#/customers/${customer.id}` },
                icon('banknote'), h('span', { text: 'تسجيل دفعة من العميل' }))
            : null,
        }),

        card({
          title: 'معلومات الفاتورة',
          titleIcon: 'info',
          body: h('div', { class: 'stack', style: { gap: '2px' } },
            detailRow('رقم الفاتورة', ltr(sale.number)),
            detailRow('تاريخ الإنشاء', ltr(formatDateTime(sale.createdAt, s.dateFormat))),
            detailRow('آخر تحديث', ltr(formatDateTime(sale.updatedAt, s.dateFormat))),
            detailRow('عدد الأصناف', ltr(sale.itemCount)),
            detailRow('عدد الوحدات', ltr(sale.unitCount ?? items.reduce((sum, item) => sum + item.quantity, 0)))
          ),
        }),

        card({
          title: 'سجل الفاتورة',
          titleIcon: 'history',
          body: h('div', { class: 'timeline' },
            ...timeline.map((entry) =>
              h('div', { class: 'timeline__item' },
                h('div', {
                  class: 'timeline__dot',
                  style: entry.tone === 'red'
                    ? { background: 'var(--red)', 'box-shadow': '0 0 0 3px var(--red-soft)' }
                    : null,
                }),
                h('div', null,
                  h('div', { class: 'timeline__title', text: entry.title }),
                  h('div', { class: 'timeline__meta' }, ltr(formatDateTime(entry.at, s.dateFormat))),
                  h('div', { class: 'timeline__meta', text: entry.actor })
                )
              )
            )
          ),
        })
      );

      /* -------------------------------- التركيب -------------------------------- */

      return h('div', { class: 'stack' },
        h('nav', { class: 'breadcrumb' },
          h('a', { href: '#/invoices', text: 'الفواتير' }),
          icon('chevronLeft'),
          h('span', null, ltr(sale.number))
        ),

        h('div', { class: 'page__head' },
          h('div', { class: 'invoice-hero' },
            h('div', null,
              h('p', { style: { color: 'var(--text-2)', 'font-size': '14px' }, text: 'تفاصيل الفاتورة' }),
              h('h2', { class: 'invoice-hero__num' }, ltr(sale.number))
            ),
            badge(SALE_STATUS_LABEL[sale.status], SALE_STATUS_TONE[sale.status], {
              iconName: isCancelled ? 'xCircle' : 'checkCircle',
            })
          ),
          h('div', { class: 'page__actions' },
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: openPrintDialog } },
              h('span', { text: 'طباعة' }), icon('printer')),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: { click: openPrintDialog },
            }, h('span', { text: 'حفظ PDF' }), icon('file')),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: doExport } },
              h('span', { text: 'تصدير Excel' }), icon('download')),
            !isCancelled
              ? [
                  h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: openReturnDialog } }, h('span', { text: 'إرجاع' }), icon('undo')),
                  h('button', { class: 'btn btn--outline-danger', attrs: { type: 'button' }, on: { click: doCancel } }, h('span', { text: 'إلغاء الفاتورة' }), icon('trash')),
                ]
              : null
          )
        ),

        isCancelled
          ? alertBox(
              `أُلغيت هذه الفاتورة في ${formatDateTime(sale.cancelledAt, s.dateFormat)}${sale.cancelReason ? ` — ${sale.cancelReason}` : ''}. أُعيدت كل الأصناف إلى المخزون.`,
              'warn'
            )
          : null,

        returns.length > 0
          ? alertBox(`سُجلت ${returns.length} عملية مرتجع لهذه الفاتورة بقيمة إجمالية ${formatAmount(returns.reduce((sum, item) => sum + item.refundMinor, 0))} ${symbol}.`, 'info')
          : null,

        h('div', { class: 'split-layout' }, document_, h('div', { class: 'detail-panel' }, sidebar))
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/invoices.js */
  __def("src/views/invoices.js", function (__exports, __m, __dyn) {
    /** الفواتير — مرجع: UI/06-invoices-list.png */

    const { h, render: renderInto, ltr, debounce } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, searchField, field, pagination, rowMenu } = __m("src/components/ui.js");
    const { dataTable } = __m("src/components/table.js");
    const { toastOk, toastError, confirmDialog } = __m("src/components/feedback.js");
    const { listSales, cancelSale, getSaleWithItems, SALE_STATUS, SALE_STATUS_LABEL, SALE_STATUS_TONE, PAYMENT_TYPE_LABEL } = __m("src/repositories/sales.js");
    const { listCustomers } = __m("src/repositories/customers.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, itemsLabel } = __m("src/utils/format.js");
    const { formatDate, isDayKey } = __m("src/utils/dates.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { navigate, refresh } = __m("src/router.js");
    const { printInvoice } = __m("src/services/print.js");
    const { exportInvoices } = __m("src/services/excel.js");

    async function render(context) {
      const s = settings();
      const symbol = s.currencySymbol;

      const [sales, customers] = await Promise.all([listSales(2000), listCustomers()]);

      const state = {
        query: context.query.q || '',
        from: '',
        to: '',
        customer: context.query.customer || 'all',
        payment: 'all',
        status: 'all',
        page: 1,
        pageSize: 8,
      };

      const tableHost = h('div');
      const kpiHost = h('div');

      function filtered() {
        const term = state.query.trim().toLowerCase();

        return sales.filter((sale) => {
          if (state.customer !== 'all') {
            if (state.customer === 'walkin' ? sale.customerId : sale.customerId !== state.customer) return false;
          }
          if (state.payment !== 'all' && sale.paymentType !== state.payment) return false;
          if (state.status !== 'all' && sale.status !== state.status) return false;
          if (state.from && sale.dayKey < state.from) return false;
          if (state.to && sale.dayKey > state.to) return false;
          if (!term) return true;
          return `${sale.number} ${sale.customerName}`.toLowerCase().includes(term);
        });
      }

      function drawKpis() {
        const rows = filtered().filter((sale) => sale.status !== SALE_STATUS.CANCELLED);
        const total = rows.reduce((sum, sale) => sum + sale.totalMinor, 0);
        const paid = rows.reduce((sum, sale) => sum + sale.paidMinor, 0);
        const due = rows.reduce((sum, sale) => sum + sale.dueMinor, 0);

        renderInto(kpiHost, h('div', { class: 'grid-3' },
          kpi({ variant: 'tinted', tone: 'blue', label: 'إجمالي المبيعات', value: `${formatAmount(total)} ${symbol}`, iconName: 'trendUp' }),
          kpi({ variant: 'tinted', tone: 'green', label: 'مدفوع', value: `${formatAmount(paid)} ${symbol}`, iconName: 'checkCircle' }),
          kpi({ variant: 'tinted', tone: 'amber', label: 'آجل', value: `${formatAmount(due)} ${symbol}`, iconName: 'clock' })
        ));
      }

      function drawTable() {
        const rows = filtered();
        const total = rows.length;
        const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
        if (state.page > maxPage) state.page = maxPage;
        const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

        renderInto(tableHost, card({
          flush: true,
          body: h('div', null,
            dataTable({
              caption: 'قائمة الفواتير',
              columns: [
                {
                  key: 'number',
                  label: 'رقم الفاتورة',
                  render: (sale) => h('a', { href: `#/invoices/${sale.id}` }, ltr(sale.number)),
                },
                { key: 'dayKey', label: 'التاريخ', render: (sale) => ltr(formatDate(sale.createdAt, s.dateFormat)) },
                { key: 'customerName', label: 'العميل' },
                { key: 'itemCount', label: 'الأصناف', render: (sale) => itemsLabel(sale.itemCount) },
                {
                  key: 'paymentType',
                  label: 'نوع الدفع',
                  render: (sale) => h('span', { class: 'row', style: { gap: '6px', 'flex-wrap': 'nowrap' } },
                    icon(sale.paymentType === 'credit' ? 'credit' : 'cash'),
                    h('span', { text: PAYMENT_TYPE_LABEL[sale.paymentType] })
                  ),
                },
                {
                  key: 'totalMinor',
                  label: 'الإجمالي',
                  render: (sale) => h('span', { style: { 'font-weight': '600' } },
                    ltr(formatAmount(sale.totalMinor)), ` ${symbol}`),
                },
                {
                  key: 'status',
                  label: 'الحالة',
                  render: (sale) => badge(SALE_STATUS_LABEL[sale.status], SALE_STATUS_TONE[sale.status]),
                },
                {
                  key: 'actions',
                  label: 'الإجراءات',
                  className: 'is-actions',
                  render: (sale) => rowMenu([
                    { label: 'عرض التفاصيل', icon: 'eye', onSelect: () => navigate(`/invoices/${sale.id}`) },
                    { label: 'طباعة', icon: 'printer', onSelect: () => doPrint(sale) },
                    sale.status !== SALE_STATUS.CANCELLED
                      ? { label: 'إلغاء الفاتورة', icon: 'xCircle', danger: true, onSelect: () => doCancel(sale) }
                      : null,
                  ], { label: `إجراءات الفاتورة ${sale.number}` }),
                },
              ],
              rows: pageRows,
              empty: sales.length === 0
                ? {
                    iconName: 'invoices',
                    title: 'لا فواتير بعد',
                    text: 'أتمم أول عملية بيع من نقطة البيع لتظهر الفاتورة هنا.',
                  }
                : { iconName: 'search', title: 'لا نتائج مطابقة', text: 'جرّب تغيير الفلاتر أو نطاق التاريخ.' },
            }),
            total > 0
              ? pagination({
                  page: state.page, pageSize: state.pageSize, total, unit: 'فاتورة',
                  sizes: [8, 20, 50, 100],
                  onPage: (page) => { state.page = page; drawTable(); },
                  onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
                })
              : null
          ),
        }));
      }

      async function doPrint(sale) {
        try {
          const data = await getSaleWithItems(sale.id);
          if (!data) throw new Error('الفاتورة غير موجودة');
          printInvoice(data.sale, data.items);
        } catch (error) {
          toastError(error.message);
        }
      }

      async function doCancel(sale) {
        const ok = await confirmDialog({
          title: 'إلغاء الفاتورة',
          message: `سيتم إرجاع كل أصناف الفاتورة ${sale.number} إلى المخزون وتسجيل حركة لكل صنف. الفاتورة تبقى في السجل بحالة «ملغاة» ولا تُحذف.`,
          confirmLabel: 'إلغاء الفاتورة',
          tone: 'danger',
        });
        if (!ok) return;

        try {
          const result = await cancelSale(sale.id, 'إلغاء من قائمة الفواتير');
          notifyDataChanged();
          toastOk(`تم إلغاء الفاتورة وإرجاع ${result.restoredLines} صنفاً إلى المخزون`);
          refresh();
        } catch (error) {
          toastError(error.message);
        }
      }

      /* ------------------------------- الفلاتر ------------------------------- */

      const applyFilters = () => { state.page = 1; drawKpis(); drawTable(); };

      const search = searchField({
        placeholder: 'بحث برقم الفاتورة أو العميل',
        value: state.query,
        label: 'بحث في الفواتير',
        onInput: debounce((value) => { state.query = value; applyFilters(); }, 200),
      });

      const fromField = field({
        label: 'من تاريخ', name: 'from', type: 'date',
        onChange: (event) => {
          state.from = isDayKey(event.target.value) ? event.target.value : '';
          applyFilters();
        },
      });

      const toField = field({
        label: 'إلى تاريخ', name: 'to', type: 'date',
        onChange: (event) => {
          state.to = isDayKey(event.target.value) ? event.target.value : '';
          applyFilters();
        },
      });

      const customerField = field({
        label: 'العميل', name: 'customer', value: state.customer,
        options: [
          { value: 'all', label: 'الكل' },
          { value: 'walkin', label: 'عميل نقدي' },
          ...customers.map((customer) => ({ value: customer.id, label: customer.name })),
        ],
        onChange: (event) => { state.customer = event.target.value; applyFilters(); },
      });

      const paymentField = field({
        label: 'نوع الدفع', name: 'payment', value: 'all',
        options: [
          { value: 'all', label: 'الكل' },
          { value: 'cash', label: 'نقدي' },
          { value: 'credit', label: 'آجل' },
        ],
        onChange: (event) => { state.payment = event.target.value; applyFilters(); },
      });

      const statusField = field({
        label: 'الحالة', name: 'status', value: 'all',
        options: [
          { value: 'all', label: 'الكل' },
          { value: SALE_STATUS.COMPLETED, label: 'مكتملة' },
          { value: SALE_STATUS.CANCELLED, label: 'ملغاة' },
        ],
        onChange: (event) => { state.status = event.target.value; applyFilters(); },
      });

      const filterBar = h('div', { class: 'filter-bar' },
        h('div', { class: 'filter-bar__row' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', text: 'بحث' }), search.element),
          fromField.element,
          toField.element,
          customerField.element
        ),
        h('div', { class: 'filter-bar__row' },
          paymentField.element,
          statusField.element,
          h('div'),
          h('div', { class: 'filter-bar__actions' },
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: {
                click: async () => {
                  try {
                    await exportInvoices(filtered());
                    toastOk('تم تصدير الفواتير إلى ملف Excel');
                  } catch (error) {
                    toastError(`تعذّر التصدير: ${error.message}`);
                  }
                },
              },
            }, h('span', { text: 'تصدير Excel' }), icon('download'))
          )
        )
      );

      drawKpis();
      drawTable();

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' },
          h('span'),
          h('div', { class: 'page__actions' },
            h('a', { class: 'btn btn--primary', href: '#/pos' },
              h('span', { text: 'فاتورة جديدة' }), icon('plus'))
          )
        ),
        kpiHost,
        filterBar,
        tableHost
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/notifications.js */
  __def("src/views/notifications.js", function (__exports, __m, __dyn) {
    const { h, ltr } = __m("src/utils/dom.js");
    const { card, emptyState, badge } = __m("src/components/ui.js");
    const { stockReport, stagnantProducts } = __m("src/services/reports.js");
    const { customerLedgers } = __m("src/repositories/customers.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount } = __m("src/utils/format.js");
    const { dayKey } = __m("src/utils/dates.js");

    async function render() {
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


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/pos.js */
  __def("src/views/pos.js", function (__exports, __m, __dyn) {
    /** نقطة البيع — مرجع: UI/02-pos.png و UI/13-mobile-pos-draft.png */

    const { h, render: renderInto, ltr, debounce } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, badge, emptyState, searchField, chipGroup, field } = __m("src/components/ui.js");
    const { openModal, openPanel, toastOk, toastError, toastWarn, confirmDialog } = __m("src/components/feedback.js");
    const { listProducts, listCategories, stockStatus, STOCK_LABEL, STOCK_TONE, STOCK_STATUS } = __m("src/repositories/products.js");
    const { listCustomers, WALK_IN } = __m("src/repositories/customers.js");
    const { completeSale, suspendSale, listSuspended, resumeSuspended, deleteSuspended, PAYMENT_TYPE } = __m("src/repositories/sales.js");
    const { settings } = __m("src/repositories/settings.js");
    const { cartState, cartActions, notifyDataChanged, appState } = __m("src/state/store.js");
    const { computeTotals, toMinor, percentToBp, bpToPercent } = __m("src/utils/money.js");
    const { formatAmount, itemsLabel, initials } = __m("src/utils/format.js");
    const { formatDateTime } = __m("src/utils/dates.js");
    const { printInvoice } = __m("src/services/print.js");
    const { navigate } = __m("src/router.js");

    async function render(context) {
      const [products, categories, customers, suspended] = await Promise.all([
        listProducts(), listCategories(), listCustomers(), listSuspended(),
      ]);

      const active = products.filter((product) => product.isActive !== false);

      if (active.length === 0) {
        return card({
          body: emptyState({
            iconName: 'products',
            title: 'لا توجد منتجات للبيع',
            text: 'أضف منتجاً واحداً على الأقل لتبدأ استخدام نقطة البيع.',
            action: h('a', { class: 'btn btn--primary', href: '#/products/new' },
              icon('plus'), h('span', { text: 'إضافة منتج' })),
          }),
        });
      }

      const s = settings();
      const symbol = s.currencySymbol;

      let query = '';
      let categoryFilter = 'all';
      let suspendedList = suspended;
      let selectedProductId = null;

      const productGrid = h('div', { class: 'product-grid' });
      const cartRoot = h('section', { class: 'cart' });
      const cartBar = h('div', { class: 'cart-bar', hidden: true });

      /* ------------------------------ شبكة المنتجات ------------------------------ */

      function visibleProducts() {
        const term = query.trim().toLowerCase();
        return active.filter((product) => {
          if (categoryFilter !== 'all' && product.categoryId !== categoryFilter) return false;
          if (!term) return true;
          return `${product.nameLower || product.name.toLowerCase()} ${product.sku} ${product.barcode || ''}`
            .toLowerCase().includes(term);
        });
      }

      function drawProducts() {
        const items = visibleProducts();

        if (items.length === 0) {
          renderInto(productGrid, h('div', { style: { 'grid-column': '1 / -1' } },
            emptyState({
              iconName: 'search',
              title: 'لا نتائج',
              text: 'جرّب اسماً آخر أو امسح الفلاتر.',
            })
          ));
          return;
        }

        renderInto(productGrid, ...items.map((product) => {
          const status = stockStatus(product);
          const isOut = status === STOCK_STATUS.OUT && !s.allowNegativeStock;

          return h('button', {
            class: 'product-card',
            attrs: {
              type: 'button',
              disabled: isOut || undefined,
              'aria-label': `${product.name}، ${formatAmount(product.priceMinor)} ${symbol}، ${STOCK_LABEL[status]}`,
            },
            on: { click: () => addToCart(product) },
          },
            h('span', { class: 'product-card__badge' }, badge(STOCK_LABEL[status], STOCK_TONE[status])),
            product.image
              ? h('img', { class: 'product-card__img', src: product.image, alt: '', loading: 'lazy', decoding: 'async' })
              : h('div', { class: 'product-card__img product-card__img--ph' }, icon('package')),
            h('span', { class: 'product-card__name', text: product.name }),
            h('span', { class: 'product-card__price' }, ltr(formatAmount(product.priceMinor)), ` ${symbol}`),
            h('span', { class: 'product-card__sku' }, ltr(product.sku)),
            h('span', { class: 'product-card__stock' }, 'المخزون: ', ltr(product.quantity))
          );
        }));
      }

      function addToCart(product) {
        const line = cartState.get().lines.find((l) => l.productId === product.id);
        const nextQty = (line?.quantity || 0) + 1;

        if (!s.allowNegativeStock && nextQty > product.quantity) {
          toastWarn(`الكمية المتاحة من "${product.name}" هي ${product.quantity} فقط`);
          return;
        }
        cartActions.add(product, 1);
        selectedProductId = product.id;
      }

      function incrementSelectedProduct() {
        const cart = cartState.get();
        const selectedLine = cart.lines.find((line) => line.productId === selectedProductId);
        const line = selectedLine || cart.lines.at(-1);
        if (!line) return;
        const product = active.find((item) => item.id === line.productId);
        if (!product) return;
        const nextQty = line.quantity + 1;
        if (!s.allowNegativeStock && nextQty > product.quantity) {
          toastWarn(`الكمية المتاحة من "${product.name}" هي ${product.quantity} فقط`);
          return;
        }
        cartActions.setQuantity(line.productId, nextQty);
        selectedProductId = line.productId;
      }

      /* -------------------------------- البحث -------------------------------- */

      const search = searchField({
        placeholder: 'بحث باسم المنتج أو SKU أو Barcode',
        label: 'بحث عن منتج',
        onInput: debounce((value) => {
          query = value;
          // مطابقة باركود دقيقة: أضف للعربة مباشرة (سلوك ماسح الباركود)
          const exact = active.find((product) => product.barcode && String(product.barcode).trim().toLowerCase() === value.trim().toLowerCase());
          if (exact) {
            addToCart(exact);
            search.input.value = '';
            query = '';
          }
          drawProducts();
        }, 180),
      });

      let stopCameraScanner = null;

      async function openCameraScanner() {
        const Detector = globalThis.BarcodeDetector;
        if (!navigator.mediaDevices?.getUserMedia || !Detector) {
          search.input.focus();
          toastWarn(!navigator.mediaDevices?.getUserMedia
            ? 'مسح الكاميرا يحتاج إلى اتصال آمن HTTPS أو localhost. يمكنك استخدام قارئ باركود خارجي أو الإدخال اليدوي.'
            : 'هذا المتصفح لا يدعم قراءة الباركود بالكاميرا. استخدم قارئ باركود خارجي أو الإدخال اليدوي.');
          return;
        }

        const video = h('video', {
          attrs: { autoplay: true, playsinline: true, muted: true, 'aria-label': 'معاينة الكاميرا' },
          style: { display: 'block', width: '100%', 'max-height': '58vh', 'object-fit': 'contain', 'border-radius': '12px', background: '#111' },
        });
        const status = h('p', { class: 'field__hint', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'وجّه الكاميرا نحو باركود المنتج.' });
        let stream = null;
        let frame = 0;
        let stopped = false;
        let detecting = false;
        let lastScanAt = 0;
        let detector;
        const stop = () => {
          stopped = true;
          if (frame) cancelAnimationFrame(frame);
          stream?.getTracks().forEach((track) => track.stop());
          video.srcObject = null;
          if (stopCameraScanner === stop) stopCameraScanner = null;
        };
        stopCameraScanner?.();
        stopCameraScanner = stop;

        const modal = openModal({
          title: 'مسح الباركود بالكاميرا',
          size: 'lg',
          body: h('div', { class: 'stack' }, video, status),
          footer: [h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إغلاق الكاميرا', on: { click: () => modal.close() } })],
          onClose: stop,
        });

        try {
          const supported = typeof Detector.getSupportedFormats === 'function'
            ? await Detector.getSupportedFormats()
            : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
          const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf']
            .filter((format) => supported.includes(format));
          if (formats.length === 0) throw new Error('لا توجد صيغ باركود مدعومة في هذا المتصفح.');
          detector = new Detector({ formats });
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          });
          if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
          video.srcObject = stream;
          await video.play();

          const scanFrame = async () => {
            if (stopped) return;
            if (!detecting && video.readyState >= 2 && performance.now() - lastScanAt >= 120) {
              detecting = true;
              lastScanAt = performance.now();
              try {
                const results = await detector.detect(video);
                const value = results.find((item) => item.rawValue)?.rawValue?.trim();
                if (value && !stopped) {
                  search.input.value = value;
                  search.input.dispatchEvent(new Event('input', { bubbles: true }));
                  status.textContent = 'تمت قراءة الباركود. جارٍ البحث عن المنتج…';
                  modal.close();
                  return;
                }
              } catch (error) {
                status.textContent = 'تعذرت قراءة الصورة. ثبّت الكاميرا واجعل الباركود واضحاً.';
              } finally {
                detecting = false;
              }
            }
            if (!stopped) frame = requestAnimationFrame(scanFrame);
          };
          frame = requestAnimationFrame(scanFrame);
        } catch (error) {
          stop();
          status.textContent = error.name === 'NotAllowedError'
            ? 'لم يُسمح باستخدام الكاميرا. امنح المتصفح الإذن ثم حاول مجدداً.'
            : error.message || 'تعذر تشغيل الكاميرا.';
          toastError(status.textContent);
        }
      }

      const scanButton = h('button', {
        class: 'pos__scan btn btn--outline',
        attrs: { type: 'button', 'aria-label': 'مسح الباركود بالكاميرا' },
        on: { click: openCameraScanner },
      }, icon('barcode'), h('span', { text: 'مسح بالكاميرا' }));

      const categoryChips = h('div');
      function drawChips() {
        renderInto(categoryChips, chipGroup({
          label: 'تصفية حسب الفئة',
          active: categoryFilter,
          onSelect: (value) => {
            categoryFilter = value;
            drawChips();
            drawProducts();
          },
          items: [
            { value: 'all', label: 'الكل', icon: 'grid' },
            ...categories
              .filter((category) => active.some((product) => product.categoryId === category.id))
              .map((category) => ({ value: category.id, label: category.name, icon: category.icon || 'tag' })),
          ],
        }));
      }

      /* -------------------------------- العربة -------------------------------- */

      function totals() {
        const cart = cartState.get();
        return computeTotals(
          cart.lines.map((line) => ({ unitPriceMinor: line.unitPriceMinor, quantity: line.quantity })),
          cart.discount,
          s.defaultTaxRateBp,
          s.taxInclusive
        );
      }

      function drawCart() {
        const cart = cartState.get();
        const sums = totals();
        const isEmpty = cart.lines.length === 0;

        renderInto(cartRoot, card({
          title: 'العربة',
          titleIcon: 'pos',
          flush: true,
          actions: suspendedList.length > 0
            ? h('button', {
                class: 'btn btn--sm btn--ghost',
                attrs: { type: 'button' },
                on: { click: openSuspendedList },
              }, icon('pause'), h('span', { text: `معلّقة (${suspendedList.length})` }))
            : null,
          body: h('div', null,
            h('div', { style: { padding: '16px 20px 0' } },
              h('button', {
                class: 'cart__customer',
                attrs: { type: 'button' },
                on: { click: openCustomerPicker },
              },
                cart.customer.id
                  ? h('div', { class: 'avatar avatar--sm', text: initials(cart.customer.name) })
                  : h('span', { class: 'user-chip__avatar' }, icon('user')),
                h('span', { style: { flex: '1', 'min-width': '0' } },
                  h('span', { class: 'cart__customer-label', style: { display: 'block' }, text: 'اختيار العميل' }),
                  h('span', { class: 'cart__customer-name', text: cart.customer.name })
                ),
                icon('chevronDown', { class: 'icon-chev' })
              )
            ),

            isEmpty
              ? emptyState({
                  iconName: 'pos',
                  title: 'العربة فارغة',
                  text: 'اختر منتجاً من القائمة لبدء الفاتورة.',
                })
              : h('div', { class: 'cart__items' },
                  h('table', { class: 'table' },
                    h('thead', null, h('tr', null,
                      h('th', { text: 'المنتج' }),
                      h('th', { text: 'الكمية' }),
                      h('th', { text: 'السعر' }),
                      h('th', { text: 'الإجمالي' }),
                      h('th', { class: 'is-actions', attrs: { scope: 'col' } }, h('span', { class: 'sr-only', text: 'حذف' }))
                    )),
                    h('tbody', null, ...cart.lines.map((line) => cartRow(line)))
                  )
                ),

            h('div', { class: 'cart__totals' },
              h('div', { class: 'cart__row' },
                h('span', { class: 'cart__label', text: 'المجموع الفرعي' }),
                h('span', { class: 'cart__amount' }, ltr(formatAmount(sums.subtotalMinor)), ` ${symbol}`)
              ),
              s.allowDiscount
                ? h('div', { class: 'cart__row' },
                    h('span', { class: 'cart__label' },
                      icon('info'),
                      h('span', { text: 'الخصم' })
                    ),
                    h('span', { class: 'row', style: { gap: '8px' } },
                      h('button', {
                        class: 'cart__discount-btn',
                        attrs: { type: 'button', 'aria-label': 'تعديل الخصم' },
                        on: { click: openDiscountDialog },
                      }, icon('pencil')),
                      h('span', { class: 'cart__amount' }, ltr(formatAmount(sums.discountMinor)), ` ${symbol}`)
                    )
                  )
                : null,
              h('div', { class: 'cart__row' },
                h('span', { class: 'cart__label', text: `الضريبة (${bpToPercent(s.defaultTaxRateBp)}%)` }),
                h('span', { class: 'cart__amount' }, ltr(formatAmount(sums.taxMinor)), ` ${symbol}`)
              ),
              h('div', { class: 'cart__row cart__row--total' },
                h('span', { text: 'الإجمالي النهائي' }),
                h('span', { class: 'cart__amount' }, ltr(formatAmount(sums.totalMinor)), ` ${symbol}`)
              )
            ),

            h('div', { class: 'cart__pay', attrs: { role: 'group', 'aria-label': 'طريقة الدفع' } },
              payButton(PAYMENT_TYPE.CASH, 'نقدي', 'cash'),
              payButton(PAYMENT_TYPE.BANK, 'تحويل', 'wallet'),
              payButton(PAYMENT_TYPE.CARD, 'بطاقة', 'credit'),
              payButton(PAYMENT_TYPE.CHEQUE, 'شيك', 'file'),
              payButton(PAYMENT_TYPE.WALLET, 'محفظة', 'wallet'),
              payButton(PAYMENT_TYPE.CREDIT, 'آجل', 'calendar')
            ),

            h('div', { class: 'cart__actions' },
              h('button', {
                class: 'btn btn--success btn--lg btn--block',
                attrs: { type: 'button' },
                disabled: isEmpty || undefined,
                on: { click: doCheckout },
              }, h('span', { text: 'إتمام البيع' }), icon('checkCircle')),
              h('div', { class: 'cart__actions-row' },
                h('button', {
                  class: 'btn btn--outline',
                  attrs: { type: 'button' },
                  disabled: isEmpty || undefined,
                  on: { click: doSuspend },
                }, h('span', { text: 'تعليق البيع' }), icon('pause')),
                h('button', {
                  class: 'btn btn--outline',
                  attrs: { type: 'button' },
                  disabled: isEmpty || undefined,
                  on: { click: openInvoicePreview },
                }, h('span', { text: 'معاينة' }), icon('eye')),
                h('button', {
                  class: 'btn btn--outline-danger',
                  attrs: { type: 'button' },
                  disabled: isEmpty || undefined,
                  on: { click: doClear },
                }, h('span', { text: 'تفريغ العربة' }), icon('trash'))
              )
            )
          ),
        }));

        drawCartBar(cart, sums);
      }

      function payButton(type, label, iconName) {
        const isActive = cartState.get().paymentType === type;
        const disabled = type === PAYMENT_TYPE.CREDIT && !cartState.get().customer.id;

        return h('button', {
          class: ['segmented__btn', isActive && 'is-green'],
          attrs: {
            type: 'button',
            'aria-pressed': String(isActive),
            title: disabled ? 'البيع الآجل يتطلب اختيار عميل مسجّل' : label,
          },
          disabled: disabled || undefined,
          on: { click: () => cartActions.setPaymentType(type) },
        }, icon(iconName), h('span', { text: label }));
      }

      function cartRow(line) {
        const product = active.find((p) => p.id === line.productId);
        const max = s.allowNegativeStock ? Infinity : (product?.quantity ?? 0);

        const setQty = (value) => {
          const quantity = Math.max(0, Math.min(Math.trunc(value) || 0, max === Infinity ? 999999 : max));
          if (value > max && max !== Infinity) toastWarn(`الحد الأقصى ${max} وحدة`);
          cartActions.setQuantity(line.productId, quantity);
        };

        return h('tr', null,
          h('td', null,
            h('div', { class: 'table__main', text: line.name }),
            h('div', { class: 'table__sub' }, ltr(line.sku))
          ),
          h('td', null,
            h('div', { class: 'qty-stepper' },
              h('button', {
                class: 'qty-stepper__btn',
                attrs: { type: 'button', 'aria-label': `زيادة كمية ${line.name}` },
                disabled: line.quantity >= max || undefined,
                on: { click: () => setQty(line.quantity + 1) },
              }, '+'),
              h('input', {
                class: 'qty-stepper__input',
                type: 'number',
                value: line.quantity,
                min: '0',
                attrs: { 'aria-label': `كمية ${line.name}` },
                on: { change: (event) => setQty(Number(event.target.value)) },
              }),
              h('button', {
                class: 'qty-stepper__btn',
                attrs: { type: 'button', 'aria-label': `إنقاص كمية ${line.name}` },
                on: { click: () => setQty(line.quantity - 1) },
              }, '−')
            )
          ),
          h('td', null, ltr(formatAmount(line.unitPriceMinor)), ` ${symbol}`),
          h('td', null, ltr(formatAmount(line.unitPriceMinor * line.quantity)), ` ${symbol}`),
          h('td', { class: 'is-actions' },
            h('button', {
              class: 'icon-btn icon-btn--danger',
              attrs: { type: 'button', 'aria-label': `حذف ${line.name} من العربة` },
              on: { click: () => cartActions.remove(line.productId) },
            }, icon('trash'))
          )
        );
      }

      /** شريط العربة العائم على الهاتف */
      function drawCartBar(cart, sums) {
        cartBar.hidden = cart.lines.length === 0;
        if (cart.lines.length === 0) return;

        renderInto(cartBar,
          h('button', {
            class: 'cart-bar__icon',
            attrs: { type: 'button', 'aria-label': 'عرض العربة' },
            on: { click: () => cartRoot.classList.toggle('is-open') },
          },
            icon('pos'),
            h('span', { class: 'cart-bar__count', text: String(cart.lines.length) })
          ),
          h('div', { class: 'cart-bar__block' },
            h('span', { class: 'cart-bar__label', text: 'العربة' }),
            h('span', { class: 'cart-bar__value', text: itemsLabel(cart.lines.length) })
          ),
          h('div', { class: 'cart-bar__sep' }),
          h('div', { class: 'cart-bar__block' },
            h('span', { class: 'cart-bar__label', text: 'الإجمالي' }),
            h('span', { class: 'cart-bar__value' }, ltr(formatAmount(sums.totalMinor)), ` ${symbol}`)
          ),
          h('button', {
            class: 'btn btn--teal',
            attrs: { type: 'button' },
            text: 'إتمام البيع',
            on: { click: doCheckout },
          })
        );
      }

      /* ------------------------------- الحوارات ------------------------------- */

      function openCustomerPicker() {
        let filtered = customers;
        const list = h('div', { class: 'stack', style: { gap: '4px', 'max-height': '46vh', 'overflow-y': 'auto' } });

        const pick = (customer) => {
          cartActions.setCustomer(customer);
          modal.close();
        };

        const drawList = () => {
          renderInto(list,
            customerOption(WALK_IN, () => pick(WALK_IN)),
            ...filtered.map((customer) => customerOption(customer, () => pick(customer))),
            filtered.length === 0
              ? h('p', { class: 'field__hint', style: { padding: '12px' }, text: 'لا نتائج مطابقة.' })
              : null
          );
        };

        const search = searchField({
          placeholder: 'بحث بالاسم أو الهاتف',
          label: 'بحث عن عميل',
          onInput: (value) => {
            const term = value.trim().toLowerCase();
            filtered = term
              ? customers.filter((c) => `${c.name} ${c.phone || ''}`.toLowerCase().includes(term))
              : customers;
            drawList();
          },
        });

        drawList();

        const modal = openModal({
          title: 'اختيار العميل',
          body: [search.element, list],
          footer: [
            h('a', { class: 'btn btn--outline', href: '#/customers', on: { click: () => modal.close() } },
              icon('plus'), h('span', { text: 'عميل جديد' })),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              text: 'إلغاء',
              on: { click: () => modal.close() },
            }),
          ],
        });
      }

      function customerOption(customer, onSelect) {
        const selected = cartState.get().customer.id === customer.id;
        return h('button', {
          class: 'cart__customer',
          attrs: { type: 'button', 'aria-pressed': String(selected) },
          style: selected ? { 'border-color': 'var(--green)', background: 'var(--green-soft)' } : null,
          on: { click: onSelect },
        },
          customer.isWalkIn
            ? h('span', { class: 'user-chip__avatar' }, icon('user'))
            : h('div', { class: 'avatar avatar--sm', text: initials(customer.name) }),
          h('span', { style: { flex: '1', 'min-width': '0', 'text-align': 'start' } },
            h('span', { class: 'cart__customer-name', style: { display: 'block' }, text: customer.name }),
            customer.phone ? h('span', { class: 'cart__customer-label' }, ltr(customer.phone)) : null
          ),
          selected ? icon('check') : null
        );
      }

      function openDiscountDialog() {
        const cart = cartState.get();
        const sums = totals();
        let type = cart.discount.type;

        const amountField = field({
          label: 'قيمة الخصم',
          name: 'discount',
          type: 'text',
          value: type === 'percent' ? String(bpToPercent(cart.discount.value)) : String(cart.discount.value / 100 || ''),
          suffix: type === 'percent' ? '%' : symbol,
          hint: `المجموع الفرعي ${formatAmount(sums.subtotalMinor)} ${symbol}`,
        });

        const typeRow = h('div', { class: 'segmented' },
          ...[['amount', `مبلغ (${symbol})`], ['percent', 'نسبة (%)']].map(([value, label]) =>
            h('button', {
              class: 'segmented__btn',
              attrs: { type: 'button', 'aria-pressed': String(type === value) },
              on: {
                click: (event) => {
                  type = value;
                  for (const button of typeRow.children) {
                    button.setAttribute('aria-pressed', String(button === event.currentTarget));
                  }
                  const suffix = amountField.element.querySelector('.input-affix__suffix');
                  if (suffix) suffix.textContent = type === 'percent' ? '%' : symbol;
                },
              },
            }, h('span', { text: label }))
          )
        );

        const apply = () => {
          const raw = amountField.value.trim();
          if (!raw) {
            cartActions.setDiscount({ type: 'amount', value: 0 });
            modal.close();
            return;
          }

          if (type === 'percent') {
            const percent = Number(raw);
            if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
              amountField.setError('النسبة يجب أن تكون بين 0 و100');
              return;
            }
            if (percent > s.maxDiscountPercent) {
              amountField.setError(`الحد الأقصى للخصم ${s.maxDiscountPercent}%`);
              return;
            }
            cartActions.setDiscount({ type: 'percent', value: percentToBp(percent) });
          } else {
            const minor = toMinor(raw);
            if (!Number.isFinite(minor) || minor < 0) {
              amountField.setError('المبلغ غير صالح');
              return;
            }
            if (minor > sums.subtotalMinor) {
              amountField.setError('الخصم لا يمكن أن يتجاوز المجموع الفرعي');
              return;
            }
            cartActions.setDiscount({ type: 'amount', value: minor });
          }
          modal.close();
        };

        const modal = openModal({
          title: 'خصم على الفاتورة',
          body: [typeRow, amountField.element],
          footer: [
            h('button', { class: 'btn btn--primary', attrs: { type: 'button' }, text: 'تطبيق', on: { click: apply } }),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              text: 'إزالة الخصم',
              on: {
                click: () => {
                  cartActions.setDiscount({ type: 'amount', value: 0 });
                  modal.close();
                },
              },
            }),
          ],
        });

        requestAnimationFrame(() => amountField.focus());
      }

      async function openSuspendedList() {
        suspendedList = await listSuspended();

        const rows = h('div', { class: 'stack', style: { gap: '8px' } });
        const draw = () => {
          renderInto(rows, ...(suspendedList.length === 0
            ? [emptyState({ iconName: 'pause', title: 'لا بيوع معلّقة', text: 'البيوع التي تعلّقها ستظهر هنا.' })]
            : suspendedList.map((item) =>
                h('div', { class: 'cart__customer', style: { cursor: 'default' } },
                  h('div', { style: { flex: '1', 'min-width': '0', 'text-align': 'start' } },
                    h('div', { class: 'cart__customer-name', text: item.customerName }),
                    h('div', { class: 'cart__customer-label' },
                      `${itemsLabel(item.itemCount)} · `,
                      ltr(formatAmount(item.totalMinor)),
                      ` ${symbol} · `,
                      ltr(formatDateTime(item.createdAt, s.dateFormat))
                    )
                  ),
                  h('button', {
                    class: 'btn btn--sm btn--outline',
                    attrs: { type: 'button' },
                    text: 'استعادة',
                    on: { click: () => doResume(item.id) },
                  }),
                  h('button', {
                    class: 'icon-btn icon-btn--danger',
                    attrs: { type: 'button', 'aria-label': 'حذف البيع المعلّق' },
                    on: {
                      click: async () => {
                        await deleteSuspended(item.id);
                        suspendedList = await listSuspended();
                        appState.set({ suspendedCount: suspendedList.length });
                        draw();
                        drawCart();
                      },
                    },
                  }, icon('trash'))
                )
              )));
        };
        draw();

        const modal = openModal({
          title: 'البيوع المعلّقة',
          body: rows,
          footer: [h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إغلاق', on: { click: () => modal.close() } })],
        });

        async function doResume(id) {
          if (cartState.get().lines.length > 0) {
            const ok = await confirmDialog({
              title: 'استبدال العربة الحالية',
              message: 'العربة الحالية تحتوي أصنافاً وستُستبدل بالبيع المعلّق. هل تريد المتابعة؟',
              confirmLabel: 'استبدال',
            });
            if (!ok) return;
          }
          const record = await resumeSuspended(id);
          cartActions.load(record);
          suspendedList = await listSuspended();
          appState.set({ suspendedCount: suspendedList.length });
          modal.close();
          toastOk('تمت استعادة البيع المعلّق');
        }
      }

      /* ------------------------------- الإجراءات ------------------------------- */

      async function doSuspend() {
        const cart = cartState.get();
        if (cart.lines.length === 0) return;

        const sums = totals();
        await suspendSale({
          lines: cart.lines,
          customer: cart.customer,
          discount: cart.discount,
          totalMinor: sums.totalMinor,
        });

        cartActions.clear();
        suspendedList = await listSuspended();
        appState.set({ suspendedCount: suspendedList.length });
        notifyDataChanged();
        toastOk('تم تعليق البيع. يمكنك استعادته لاحقاً.');
        drawCart();
      }

      async function doClear() {
        const ok = await confirmDialog({
          title: 'تفريغ العربة',
          message: 'سيتم حذف كل الأصناف من العربة الحالية.',
          confirmLabel: 'تفريغ',
          tone: 'danger',
        });
        if (ok) cartActions.clear();
      }

      function openInvoicePreview() {
        const cart = cartState.get();
        if (cart.lines.length === 0) return;
        const sums = totals();
        const summaryRow = (label, value, strong = false) =>
          h('div', { class: ['cart__row', strong && 'cart__row--total'] },
            h('span', { class: 'cart__label', text: label }),
            h('span', { class: 'cart__amount' }, ltr(formatAmount(value)), ` ${symbol}`)
          );

        const modal = openModal({
          title: 'معاينة الفاتورة',
          size: 'lg',
          body: h('div', { class: 'stack', style: { gap: '16px' } },
            h('div', { class: 'cart__row' },
              h('span', { class: 'cart__label', text: 'العميل' }),
              h('span', { class: 'cart__amount', text: cart.customer.name })
            ),
            h('div', { class: 'cart__items' },
              h('table', { class: 'table' },
                h('thead', null, h('tr', null,
                  h('th', { text: 'المنتج' }),
                  h('th', { text: 'الكمية' }),
                  h('th', { text: 'سعر الوحدة' }),
                  h('th', { text: 'الإجمالي' })
                )),
                h('tbody', null, ...cart.lines.map((line) =>
                  h('tr', null,
                    h('td', { text: line.name }),
                    h('td', { class: 'num' }, ltr(line.quantity)),
                    h('td', { class: 'num' }, ltr(formatAmount(line.unitPriceMinor)), ` ${symbol}`),
                    h('td', { class: 'num' }, ltr(formatAmount(line.unitPriceMinor * line.quantity)), ` ${symbol}`)
                  )
                ))
              )
            ),
            h('div', { class: 'cart__totals', style: { padding: '0' } },
              summaryRow('المجموع الفرعي', sums.subtotalMinor),
              sums.discountMinor > 0 ? summaryRow('الخصم', sums.discountMinor) : null,
              summaryRow('الضريبة', sums.taxMinor),
              summaryRow('الإجمالي النهائي', sums.totalMinor, true)
            )
          ),
          footer: [h('button', {
            class: 'btn btn--primary',
            attrs: { type: 'button' },
            text: 'العودة إلى العربة',
            on: { click: () => modal.close() },
          })],
        });
      }

      async function doCheckout() {
        const cart = cartState.get();
        if (cart.lines.length === 0) return;

        if (cart.paymentType === PAYMENT_TYPE.CREDIT && !cart.customer.id) {
          toastError('البيع الآجل يتطلب اختيار عميل مسجّل');
          return;
        }

        const sums = totals();
        const confirmed = await confirmCheckout(sums, cart);
        if (!confirmed) return;

        try {
          const { sale, items } = await completeSale({
            lines: cart.lines.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
            })),
            customer: cart.customer,
            discount: cart.discount,
            taxRateBp: s.defaultTaxRateBp,
            taxInclusive: s.taxInclusive,
            paymentType: cart.paymentType,
            paidMinor: confirmed.paidMinor,
            allowNegativeStock: s.allowNegativeStock,
          });

          cartActions.clear();
          notifyDataChanged();

          // حدّث الكميات المحلية حتى تعكس البطاقات المخزون الجديد فوراً
          for (const item of items) {
            const product = active.find((p) => p.id === item.productId);
            if (product) product.quantity -= item.quantity;
          }
          drawProducts();

          showReceiptDialog(sale, items);
        } catch (error) {
          // فشل البيع = لا تغيير على المخزون إطلاقاً (المعاملة أُجهضت بالكامل)
          toastError(error.message || 'تعذّر إتمام البيع');
        }
      }

      function confirmCheckout(sums, cart) {
        return new Promise((resolve) => {
          let settled = false;
          const finish = (value) => {
            if (settled) return;
            settled = true;
            modal.close();
            resolve(value);
          };

          const isCredit = cart.paymentType === PAYMENT_TYPE.CREDIT;
          const paidField = isCredit
            ? field({
                label: 'المبلغ المدفوع الآن',
                name: 'paid',
                value: '0',
                suffix: symbol,
                hint: `الإجمالي ${formatAmount(sums.totalMinor)} ${symbol} — الباقي يُسجّل على ذمة العميل`,
              })
            : null;

          const summaryRow = (label, value, strong = false) =>
            h('div', { class: ['cart__row', strong && 'cart__row--total'] },
              h('span', { class: 'cart__label', text: label }),
              h('span', { class: 'cart__amount' }, ltr(formatAmount(value)), ` ${symbol}`)
            );

          const modal = openModal({
            title: 'تأكيد البيع',
            body: [
              h('div', { class: 'stack', style: { gap: '10px' } },
                h('div', { class: 'cart__row' },
                  h('span', { class: 'cart__label', text: 'العميل' }),
                  h('span', { class: 'cart__amount', text: cart.customer.name })
                ),
                h('div', { class: 'cart__row' },
                  h('span', { class: 'cart__label', text: 'طريقة الدفع' }),
                  h('span', { class: 'cart__amount', text: isCredit ? 'آجل' : 'نقدي' })
                ),
                summaryRow('المجموع الفرعي', sums.subtotalMinor),
                sums.discountMinor > 0 ? summaryRow('الخصم', sums.discountMinor) : null,
                summaryRow('الضريبة', sums.taxMinor),
                summaryRow('الإجمالي', sums.totalMinor, true)
              ),
              paidField?.element,
            ],
            footer: [
              h('button', {
                class: 'btn btn--success',
                attrs: { type: 'button' },
                text: 'تأكيد وإتمام البيع',
                on: {
                  click: () => {
                    let paidMinor = sums.totalMinor;
                    if (isCredit) {
                      paidMinor = toMinor(paidField.value || '0');
                      if (!Number.isFinite(paidMinor) || paidMinor < 0) {
                        paidField.setError('المبلغ غير صالح');
                        return;
                      }
                      if (paidMinor > sums.totalMinor) {
                        paidField.setError('المدفوع لا يمكن أن يتجاوز الإجمالي');
                        return;
                      }
                    }
                    finish({ paidMinor });
                  },
                },
              }),
              h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'رجوع', on: { click: () => finish(null) } }),
            ],
            onClose: () => finish(null),
          });
        });
      }

      function showReceiptDialog(sale, items) {
        const modal = openModal({
          title: 'تم إتمام البيع',
          body: h('div', { class: 'stack', style: { 'text-align': 'center', gap: '12px' } },
            h('div', { class: 'empty__icon', style: { background: 'var(--green-soft)', color: 'var(--green)', margin: '0 auto' } },
              icon('checkCircle', { size: 30 })),
            h('p', { style: { 'font-size': '15px' } }, 'رقم الفاتورة: ', ltr(sale.number)),
            h('p', { style: { 'font-size': '22px', 'font-weight': '700', color: 'var(--green)' } },
              ltr(formatAmount(sale.totalMinor)), ` ${symbol}`),
            sale.dueMinor > 0
              ? h('p', { style: { color: 'var(--amber)' } }, 'المتبقي على العميل: ', ltr(formatAmount(sale.dueMinor)), ` ${symbol}`)
              : null
          ),
          footer: [
            h('button', {
              class: 'btn btn--primary',
              attrs: { type: 'button' },
              on: { click: () => printInvoice(sale, items) },
            }, icon('printer'), h('span', { text: 'طباعة' })),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: { click: () => { modal.close(); navigate(`/invoices/${sale.id}`); } },
            }, icon('eye'), h('span', { text: 'عرض الفاتورة' })),
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              text: 'بيع جديد',
              on: { click: () => modal.close() },
            }),
          ],
        });
      }

      /* -------------------------------- التركيب -------------------------------- */

      drawChips();
      drawProducts();
      drawCart();

      const onKeyDown = (event) => {
        if (event.key !== '+' && event.code !== 'NumpadAdd') return;
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        const target = event.target;
        if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        if (document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        incrementSelectedProduct();
      };
      document.addEventListener('keydown', onKeyDown);

      const unsubscribe = cartState.subscribe(drawCart);
      context?.onCleanup?.(() => {
        unsubscribe();
        document.removeEventListener('keydown', onKeyDown);
        stopCameraScanner?.();
        cartBar.remove();
      });

      document.body.appendChild(cartBar);

      // إعادة تركيز حقل البحث تلقائياً (سلوك ماسح الباركود)
      requestAnimationFrame(() => search.input.focus());

      return h('div', { class: 'pos' },
        h('div', null,
          h('div', { class: 'pos__search-row' }, search.element, scanButton),
          categoryChips,
          productGrid
        ),
        cartRoot
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/product-form.js */
  __def("src/views/product-form.js", function (__exports, __m, __dyn) {
    /** نموذج المنتج وعرض تفاصيله — مرجع: UI/04-product-form.png */

    const { h, render: renderInto, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, field, toggleField, badge, alertBox, emptyState, detailRow } = __m("src/components/ui.js");
    const { dataTable } = __m("src/components/table.js");
    const { toastOk, toastError, confirmDialog, promptDialog } = __m("src/components/feedback.js");
    const { getProduct, createProduct, updateProduct, listCategories, createCategory, stockStatus, STOCK_LABEL, STOCK_TONE } = __m("src/repositories/products.js");
    const { applyMovement, MOVEMENT, MOVEMENT_LABEL, movementsForProduct } = __m("src/repositories/inventory.js");
    const { tx, add } = __m("src/db/db.js");
    const { STORES } = __m("src/db/schema.js");
    const { validateProduct, LIMITS } = __m("src/validation/validators.js");
    const { processImage } = __m("src/services/images.js");
    const { settings } = __m("src/repositories/settings.js");
    const { bpToPercent, percentToBp, toMajor } = __m("src/utils/money.js");
    const { formatAmount, formatBytes } = __m("src/utils/format.js");
    const { formatDateTime } = __m("src/utils/dates.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { navigate, refresh } = __m("src/router.js");

    const UNITS = ['قطعة', 'عبوة', 'كيس', 'علبة', 'كرتون', 'حزمة', 'كجم', 'جرام', 'لتر', 'متر'];

    const TAX_OPTIONS = [
      { value: '0', label: 'معفى (0%)' },
      { value: '5', label: '5%' },
      { value: '10', label: '10%' },
      { value: '14', label: '14%' },
      { value: '15', label: '15% - ضريبة القيمة المضافة' },
    ];

    async function render(context) {
      const productId = context.params.id || null;
      const isEdit = Boolean(productId);
      const s = settings();
      const symbol = s.currencySymbol;

      const [categories, existing] = await Promise.all([
        listCategories(),
        productId ? getProduct(productId) : Promise.resolve(null),
      ]);

      if (isEdit && !existing) {
        return card({
          body: emptyState({
            iconName: 'search',
            title: 'المنتج غير موجود',
            text: 'ربما حُذف هذا المنتج.',
            action: h('a', { class: 'btn btn--primary', href: '#/products' }, h('span', { text: 'العودة إلى المنتجات' })),
          }),
        });
      }

      /* -------------------------------- الحقول -------------------------------- */

      let imageData = existing?.image || null;

      const nameField = field({
        label: 'اسم المنتج', name: 'name', required: true,
        placeholder: 'أدخل اسم المنتج', value: existing?.name || '', maxLength: LIMITS.name,
      });

      const skuField = field({
        label: 'SKU', name: 'sku', required: true,
        placeholder: 'أدخل SKU', value: existing?.sku || '', maxLength: LIMITS.sku,
        hint: 'رمز فريد لا يتكرر بين المنتجات',
      });

      const barcodeField = field({
        label: 'Barcode', name: 'barcode',
        placeholder: 'أدخل الباركود', value: existing?.barcode || '', maxLength: LIMITS.barcode,
      });

      const categoryField = field({
        label: 'الفئة', name: 'categoryId', required: true,
        value: existing?.categoryId || '',
        options: [
          { value: '', label: 'اختر الفئة' },
          ...categories.map((category) => ({ value: category.id, label: category.name })),
          { value: '__new', label: '+ فئة جديدة…' },
        ],
        onChange: async (event) => {
          if (event.target.value !== '__new') return;
          event.target.value = existing?.categoryId || '';

          const name = await promptDialog({
            title: 'فئة جديدة',
            label: 'اسم الفئة',
            hint: 'ستُضاف إلى قائمة الفئات وتصبح متاحة لكل المنتجات.',
            confirmLabel: 'إضافة',
          });
          if (!name?.trim()) return;

          try {
            const created = await createCategory({ name: name.trim(), sortOrder: categories.length + 1 });
            categories.push(created);
            const option = h('option', { value: created.id, text: created.name });
            event.target.insertBefore(option, event.target.lastElementChild);
            event.target.value = created.id;
            toastOk(`تمت إضافة الفئة "${created.name}"`);
          } catch (error) {
            toastError(error.message);
          }
        },
      });

      const unitField = field({
        label: 'الوحدة', name: 'unit', required: true,
        value: existing?.unit || '',
        options: [{ value: '', label: 'اختر الوحدة' }, ...UNITS.map((unit) => ({ value: unit, label: unit }))],
      });

      const descriptionField = field({
        label: 'الوصف', name: 'description', rows: 3,
        placeholder: 'أدخل وصف المنتج (اختياري)',
        value: existing?.description || '', maxLength: LIMITS.description, counter: true,
      });

      const costField = field({
        label: 'سعر الشراء', name: 'cost', required: true,
        placeholder: 'أدخل سعر الشراء', suffix: symbol,
        value: existing ? String(toMajor(existing.costMinor)) : '',
      });

      const priceField = field({
        label: 'سعر البيع', name: 'price', required: true,
        placeholder: 'أدخل سعر البيع', suffix: symbol,
        value: existing ? String(toMajor(existing.priceMinor)) : '',
      });

      const taxField = field({
        label: 'الضريبة', name: 'tax', required: true,
        value: String(bpToPercent(existing?.taxRateBp ?? s.defaultTaxRateBp)),
        options: TAX_OPTIONS,
      });

      const quantityField = field({
        label: 'الكمية الحالية', name: 'quantity', required: true, type: 'number', min: '0',
        value: String(existing?.quantity ?? 0),
        hint: isEdit ? 'التعديل هنا يُسجَّل كحركة مخزون بسبب «خطأ إدخال»' : 'الرصيد الافتتاحي',
      });

      const lowStockField = field({
        label: 'حد المخزون المنخفض', name: 'lowStockThreshold', type: 'number', min: '0',
        placeholder: 'أدخل حد المخزون المنخفض',
        value: String(existing?.lowStockThreshold ?? s.lowStockDefault),
      });

      const minimumStockField = field({
        label: 'الحد الأدنى للمخزون', name: 'minimumStock', type: 'number', min: '0',
        value: String(existing?.minimumStock ?? existing?.lowStockThreshold ?? s.lowStockDefault),
      });
      const maximumStockField = field({
        label: 'الحد الأقصى للمخزون', name: 'maximumStock', type: 'number', min: '0',
        value: String(existing?.maximumStock ?? 0), hint: '0 يعني غير محدد',
      });
      const reorderPointField = field({
        label: 'نقطة إعادة الطلب', name: 'reorderPoint', type: 'number', min: '0',
        value: String(existing?.reorderPoint ?? existing?.lowStockThreshold ?? s.lowStockDefault),
        hint: 'يظهر تنبيه إعادة الطلب عند وصول المخزون إلى هذه الكمية أو أقل.',
      });

      const activeToggle = toggleField({ label: 'نشط', name: 'isActive', checked: existing?.isActive !== false });

      /* ------------------------------ رفع الصورة ------------------------------ */

      const imageHost = h('div');

      function drawImage() {
        if (imageData) {
          renderInto(imageHost,
            h('div', { class: 'stack', style: { gap: '10px' } },
              h('img', {
                src: imageData,
                alt: 'معاينة صورة المنتج',
                style: { width: '100%', 'max-height': '200px', 'object-fit': 'contain', 'border-radius': '8px', background: 'var(--surface-2)' },
              }),
              h('button', {
                class: 'btn btn--sm btn--outline-danger btn--block',
                attrs: { type: 'button' },
                on: {
                  click: () => {
                    imageData = null;
                    drawImage();
                  },
                },
              }, icon('trash'), h('span', { text: 'إزالة الصورة' }))
            )
          );
          return;
        }

        const input = h('input', {
          type: 'file',
          accept: 'image/png,image/jpeg,image/webp',
          attrs: { 'aria-label': 'اختر صورة المنتج' },
          on: { change: (event) => handleImage(event.target.files[0]) },
        });

        const drop = h('label', { class: 'file-drop' },
          icon('cloudUp', { class: 'file-drop__icon' }),
          h('span', { class: 'file-drop__title', text: 'اختر صورة' }),
          h('span', { class: 'file-drop__hint', text: 'PNG, JPG, WEBP حتى 5MB' }),
          input
        );

        drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', (event) => {
          event.preventDefault();
          drop.classList.remove('is-over');
          handleImage(event.dataTransfer.files[0]);
        });

        renderInto(imageHost, drop);
      }

      async function handleImage(file) {
        if (!file) return;
        try {
          const processed = await processImage(file);
          imageData = processed.dataUrl;
          drawImage();
          toastOk(`تم رفع الصورة (${formatBytes(processed.bytes)} بعد الضغط)`);
        } catch (error) {
          toastError(error.message);
        }
      }

      drawImage();

      /* -------------------------------- الحفظ -------------------------------- */

      const allFields = {
        name: nameField, sku: skuField, categoryId: categoryField, unit: unitField,
        cost: costField, price: priceField, taxRate: taxField,
        quantity: quantityField, lowStockThreshold: lowStockField,
        minimumStock: minimumStockField, maximumStock: maximumStockField, reorderPoint: reorderPointField,
      };

      function clearErrors() {
        for (const item of Object.values(allFields)) item.setError(null);
      }

      function collect() {
        return {
          name: nameField.value,
          sku: skuField.value,
          barcode: barcodeField.value,
          categoryId: categoryField.value,
          unit: unitField.value,
          description: descriptionField.value,
          cost: costField.value,
          price: priceField.value,
          taxRate: taxField.value,
          quantity: quantityField.value,
          lowStockThreshold: lowStockField.value,
          minimumStock: minimumStockField.value,
          maximumStock: maximumStockField.value,
          reorderPoint: reorderPointField.value,
          isActive: activeToggle.checked,
          image: imageData,
        };
      }

      async function save({ andAnother = false } = {}) {
        clearErrors();

        const result = validateProduct(collect());
        if (!result.ok) {
          for (const [key, message] of Object.entries(result.errors)) {
            allFields[key]?.setError(message);
          }
          const firstKey = Object.keys(result.errors)[0];
          allFields[firstKey]?.focus();
          toastError('راجع الحقول المميزة بالأحمر');
          return;
        }

        // تحذير تجاري: البيع بأقل من التكلفة
        if (result.value.priceMinor < result.value.costMinor) {
          const ok = await confirmDialog({
            title: 'سعر البيع أقل من سعر الشراء',
            message: 'سيؤدي هذا إلى خسارة في كل عملية بيع لهذا المنتج. هل تريد المتابعة؟',
            confirmLabel: 'متابعة على أي حال',
          });
          if (!ok) return;
        }

        try {
          if (isEdit) {
            await updateProduct(productId, result.value);

            // تغيير الكمية يدوياً يمر عبر حركة مخزون مسجّلة، لا كتابة مباشرة
            const delta = result.value.quantity - existing.quantity;
            if (delta !== 0) {
              await tx([STORES.products, STORES.inventoryMovements], 'readwrite', (stores) =>
                applyMovement(stores, {
                  productId,
                  delta,
                  type: delta > 0 ? MOVEMENT.IN : MOVEMENT.OUT,
                  reason: 'خطأ إدخال',
                  note: 'تعديل الكمية من نموذج المنتج',
                  refType: 'product-form',
                  refId: productId,
                  allowNegative: true,
                })
              );
            }
            notifyDataChanged();
            toastOk('تم حفظ التعديلات');
            navigate('/products');
          } else {
            const created = await createProduct(result.value);

            if (created.quantity > 0) {
              await tx(STORES.inventoryMovements, 'readwrite', async (stores) => {
                // الكمية كُتبت مع المنتج؛ نسجّل الحركة فقط بدون تغيير الرصيد مرة أخرى
                await add(stores[STORES.inventoryMovements], {
                  id: `mov_${created.id}`,
                  productId: created.id,
                  sku: created.sku,
                  productName: created.name,
                  type: MOVEMENT.INITIAL,
                  quantity: created.quantity,
                  balanceAfter: created.quantity,
                  reason: 'رصيد افتتاحي',
                  note: '',
                  refType: 'product-create',
                  refId: created.id,
                  actor: 'المستخدم',
                  createdAt: created.createdAt,
                  dayKey: created.createdAt.slice(0, 10),
                });
              });
            }

            notifyDataChanged();
            toastOk(`تمت إضافة "${created.name}"`);

            if (andAnother) refresh();
            else navigate('/products');
          }
        } catch (error) {
          if (error.name === 'ConstraintError') {
            skuField.setError(error.message);
            skuField.focus();
          }
          toastError(error.message || 'تعذّر حفظ المنتج');
        }
      }

      /* -------------------------------- التخطيط -------------------------------- */

      const form = h('form', {
        attrs: { novalidate: '' },
        on: { submit: (event) => { event.preventDefault(); save(); } },
      },
        h('div', { class: 'form-layout' },
          card({
            body: h('div', { class: 'stack', style: { gap: '24px' } },
              h('div', { class: 'form-section' },
                h('h2', { class: 'form-section__title', text: 'البيانات الأساسية' }),
                h('div', { class: 'form-grid' }, nameField.element, skuField.element, barcodeField.element),
                h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                  categoryField.element, unitField.element),
                descriptionField.element
              ),
              h('div', { class: 'form-section' },
                h('h2', { class: 'form-section__title', text: 'التسعير' }),
                h('div', { class: 'form-grid' }, costField.element, priceField.element, taxField.element)
              )
            ),
          }),

          h('div', { class: 'stack' },
            card({ title: 'صورة المنتج', body: imageHost }),
            card({
              title: 'المخزون',
              body: h('div', { class: 'stack' }, quantityField.element, minimumStockField.element, maximumStockField.element, reorderPointField.element),
            }),
            card({
              body: h('div', { class: 'row', style: { 'justify-content': 'space-between' } },
                h('span', { style: { 'font-weight': '700' }, text: 'الحالة' }),
                activeToggle.element
              ),
            })
          )
        ),

        h('div', { class: 'form-actions' },
          h('button', { class: 'btn btn--primary', attrs: { type: 'submit' } },
            icon('save'), h('span', { text: isEdit ? 'حفظ التعديلات' : 'حفظ المنتج' })),
          !isEdit
            ? h('button', {
                class: 'btn btn--outline',
                attrs: { type: 'button' },
                text: 'حفظ وإضافة آخر',
                on: { click: () => save({ andAnother: true }) },
              })
            : null,
          h('a', { class: 'btn btn--ghost', href: '#/products', text: 'إلغاء' })
        )
      );

      return h('div', null,
        h('nav', { class: 'breadcrumb', attrs: { 'aria-label': 'مسار التنقل' } },
          h('a', { href: '#/products', text: 'المنتجات' }),
          icon('chevronLeft'),
          h('span', { text: isEdit ? 'تعديل المنتج' : 'إضافة منتج جديد' })
        ),
        h('div', { class: 'title-row' },
          h('div', { class: 'title-row__icon' }, icon('products')),
          h('h2', { class: 'page__title', text: isEdit ? `تعديل: ${existing.name}` : 'إضافة منتج جديد' })
        ),
        form
      );
    }

    /* ------------------------------------------------------------------ */
    /* عرض تفاصيل المنتج                                                    */
    /* ------------------------------------------------------------------ */

    async function renderView(context) {
      const product = await getProduct(context.params.id);
      if (!product) {
        return card({
          body: emptyState({ iconName: 'search', title: 'المنتج غير موجود', text: 'ربما حُذف هذا المنتج.' }),
        });
      }

      const s = settings();
      const symbol = s.currencySymbol;
      const [categories, movements] = await Promise.all([
        listCategories(),
        movementsForProduct(product.id, 50),
      ]);

      const category = categories.find((c) => c.id === product.categoryId);
      const status = stockStatus(product);
      const marginMinor = product.priceMinor - product.costMinor;
      const marginPercent = product.costMinor > 0 ? (marginMinor / product.costMinor) * 100 : 0;

      return h('div', null,
        h('nav', { class: 'breadcrumb' },
          h('a', { href: '#/products', text: 'المنتجات' }),
          icon('chevronLeft'),
          h('span', { text: product.name })
        ),

        h('div', { class: 'page__head' },
          h('div', { class: 'row' },
            h('h2', { class: 'page__title', text: product.name }),
            badge(STOCK_LABEL[status], STOCK_TONE[status]),
            product.isActive === false ? badge('غير نشط', 'gray') : null
          ),
          h('div', { class: 'page__actions' },
            h('a', { class: 'btn btn--primary', href: `#/products/${product.id}/edit` },
              icon('pencil'), h('span', { text: 'تعديل' })),
            h('a', { class: 'btn btn--ghost', href: '#/inventory', text: 'تسوية المخزون' })
          )
        ),

        h('div', { class: 'split-layout' },
          h('div', { class: 'stack' },
            card({
              title: 'سجل حركات المخزون',
              titleIcon: 'history',
              flush: true,
              body: dataTable({
                caption: `حركات مخزون ${product.name}`,
                columns: [
                  {
                    key: 'createdAt',
                    label: 'التاريخ',
                    render: (movement) => ltr(formatDateTime(movement.createdAt, s.dateFormat)),
                  },
                  {
                    key: 'type',
                    label: 'النوع',
                    render: (movement) => badge(
                      MOVEMENT_LABEL[movement.type] || movement.type,
                      movement.quantity >= 0 ? 'green' : 'amber'
                    ),
                  },
                  {
                    key: 'quantity',
                    label: 'الكمية',
                    render: (movement) => h('span', {
                      style: { color: movement.quantity >= 0 ? 'var(--green)' : 'var(--red)', 'font-weight': '600' },
                    }, ltr(`${movement.quantity >= 0 ? '+' : ''}${movement.quantity}`)),
                  },
                  { key: 'balanceAfter', label: 'الرصيد بعدها', render: (movement) => ltr(movement.balanceAfter) },
                  { key: 'reason', label: 'السبب' },
                  { key: 'note', label: 'ملاحظة' },
                ],
                rows: movements,
                empty: { iconName: 'history', title: 'لا حركات مسجّلة', text: 'ستظهر هنا كل إضافة وسحب وبيع لهذا المنتج.' },
              }),
            })
          ),

          h('div', { class: 'detail-panel stack' },
            card({
              body: h('div', { class: 'stack', style: { gap: '4px' } },
                product.image
                  ? h('img', {
                      src: product.image, alt: '',
                      style: { width: '100%', 'max-height': '180px', 'object-fit': 'contain', 'margin-bottom': '12px' },
                    })
                  : null,
                detailRow('SKU', ltr(product.sku), { iconName: 'barcode' }),
                product.barcode ? detailRow('الباركود', ltr(product.barcode), { iconName: 'barcode' }) : null,
                detailRow('الفئة', category?.name || '—', { iconName: 'tag' }),
                detailRow('الوحدة', product.unit),
                detailRow('الكمية الحالية', ltr(product.quantity)),
                detailRow('حد المخزون المنخفض', ltr(product.lowStockThreshold))
              ),
            }),
            card({
              title: 'التسعير',
              body: h('div', { class: 'stack', style: { gap: '4px' } },
                detailRow('سعر الشراء', h('span', null, ltr(formatAmount(product.costMinor)), ` ${symbol}`)),
                detailRow('سعر البيع', h('span', null, ltr(formatAmount(product.priceMinor)), ` ${symbol}`)),
                detailRow('هامش الربح', h('span', {
                  style: { color: marginMinor >= 0 ? 'var(--green)' : 'var(--red)' },
                }, ltr(formatAmount(marginMinor)), ` ${symbol} (${marginPercent.toFixed(1)}%)`)),
                detailRow('الضريبة', `${bpToPercent(product.taxRateBp)}%`),
                detailRow('قيمة المخزون', h('span', null,
                  ltr(formatAmount(product.quantity * product.costMinor)), ` ${symbol}`))
              ),
            })
          )
        )
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
    Object.defineProperty(__exports, "renderView", { enumerable: true, get: function () { return renderView; } });
  });

  /* ================================================================== */
  /* src/views/products.js */
  __def("src/views/products.js", function (__exports, __m, __dyn) {
    /** المنتجات — مرجع: UI/03-products-list.png */

    const { h, render: renderInto, ltr, debounce } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, badge, searchField, field, pagination, emptyState, alertBox } = __m("src/components/ui.js");
    const { dataTable, thumbCell, actionButtons, actionButton } = __m("src/components/table.js");
    const { openModal, toastOk, toastError, confirmDialog } = __m("src/components/feedback.js");
    const { listProducts, listCategories, deleteProduct, stockStatus, STOCK_LABEL, STOCK_TONE, STOCK_STATUS } = __m("src/repositories/products.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, formatInt } = __m("src/utils/format.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { navigate, refresh, href } = __m("src/router.js");
    const { exportProducts, parseProductsFile, commitProductsImport, downloadProductTemplate } = __m("src/services/excel.js");

    async function render(context) {
      const symbol = settings().currencySymbol;

      const [products, categories] = await Promise.all([listProducts(), listCategories()]);
      const categoryById = new Map(categories.map((category) => [category.id, category]));

      const state = {
        query: context.query.q || '',
        category: context.query.category || 'all',
        stock: context.query.stock || 'all',
        sort: { key: 'name', dir: 'asc' },
        page: 1,
        pageSize: 20,
      };

      const tableHost = h('div');
      const kpiHost = h('div');

      /* -------------------------------- الفلترة -------------------------------- */

      function filtered() {
        const term = state.query.trim().toLowerCase();

        let rows = products.filter((product) => {
          if (state.category !== 'all' && product.categoryId !== state.category) return false;
          if (state.stock !== 'all' && stockStatus(product) !== state.stock) return false;
          if (!term) return true;
          return `${product.nameLower || product.name.toLowerCase()} ${product.sku} ${product.barcode || ''}`
            .toLowerCase().includes(term);
        });

        const { key, dir } = state.sort;
        const factor = dir === 'asc' ? 1 : -1;
        rows = rows.slice().sort((a, b) => {
          let left = a[key];
          let right = b[key];
          if (key === 'categoryId') {
            left = categoryById.get(a.categoryId)?.name || '';
            right = categoryById.get(b.categoryId)?.name || '';
          }
          if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
          return String(left ?? '').localeCompare(String(right ?? ''), 'ar') * factor;
        });

        return rows;
      }

      /* --------------------------------- KPIs --------------------------------- */

      function drawKpis() {
        const active = products.filter((product) => product.isActive !== false);
        const low = active.filter((product) => stockStatus(product) === STOCK_STATUS.LOW).length;
        const out = active.filter((product) => stockStatus(product) === STOCK_STATUS.OUT).length;
        const stockValue = active.reduce((sum, product) => sum + product.quantity * product.costMinor, 0);

        renderInto(kpiHost, kpiGrid(
          kpi({ label: 'إجمالي المنتجات', value: formatInt(active.length), unit: 'منتج', iconName: 'products', tone: 'teal' }),
          kpi({ label: 'قيمة المخزون', value: formatAmount(stockValue), unit: symbol, iconName: 'database', tone: 'blue' }),
          kpi({ label: 'مخزون منخفض', value: formatInt(low), unit: 'منتج', iconName: 'boxOpen', tone: 'amber' }),
          kpi({ label: 'غير متوفر', value: formatInt(out), unit: 'منتج', iconName: 'packageX', tone: 'red' })
        ));
      }

      /* -------------------------------- الجدول -------------------------------- */

      function drawTable() {
        const rows = filtered();
        const total = rows.length;
        const maxPage = Math.max(1, Math.ceil(total / state.pageSize));
        if (state.page > maxPage) state.page = maxPage;

        const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

        renderInto(tableHost, card({
          flush: true,
          body: h('div', null,
            dataTable({
              caption: 'قائمة المنتجات',
              sort: state.sort,
              onSort: (key) => {
                state.sort = state.sort.key === key
                  ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
                  : { key, dir: 'asc' };
                drawTable();
              },
              columns: [
                {
                  key: 'image',
                  label: 'صورة',
                  render: (product) => thumbCell(product.image, product.name),
                },
                { key: 'sku', label: 'SKU', sortable: true, render: (product) => ltr(product.sku) },
                {
                  key: 'name',
                  label: 'اسم المنتج',
                  sortable: true,
                  render: (product) => h('div', null,
                    h('div', { class: 'table__main', text: product.name }),
                    product.isActive === false ? h('div', { class: 'table__sub', text: 'غير نشط' }) : null
                  ),
                },
                {
                  key: 'categoryId',
                  label: 'الفئة',
                  sortable: true,
                  render: (product) => categoryById.get(product.categoryId)?.name || '—',
                },
                {
                  key: 'priceMinor',
                  label: 'سعر البيع',
                  sortable: true,
                  render: (product) => h('span', null, ltr(formatAmount(product.priceMinor)), ` ${symbol}`),
                },
                {
                  key: 'quantity',
                  label: 'المخزون',
                  sortable: true,
                  render: (product) => ltr(product.quantity),
                },
                {
                  key: 'status',
                  label: 'الحالة',
                  render: (product) => {
                    const status = stockStatus(product);
                    return badge(STOCK_LABEL[status], STOCK_TONE[status]);
                  },
                },
                {
                  key: 'actions',
                  label: 'الإجراءات',
                  className: 'is-actions',
                  render: (product) => actionButtons(
                    actionButton({
                      label: 'تعديل',
                      iconName: 'pencil',
                      tone: 'primary',
                      onClick: () => navigate(`/products/${product.id}/edit`),
                    }),
                    actionButton({
                      label: 'حذف',
                      iconName: 'trash',
                      tone: 'danger',
                      onClick: () => removeProduct(product),
                    }),
                    actionButton({
                      label: 'عرض',
                      iconName: 'eye',
                      onClick: () => navigate(`/products/${product.id}`),
                    })
                  ),
                },
              ],
              rows: pageRows,
              empty: products.length === 0
                ? {
                    iconName: 'products',
                    title: 'لا توجد منتجات',
                    text: 'ابدأ بإضافة أول منتج، أو استورد قائمتك من ملف Excel.',
                  }
                : {
                    iconName: 'search',
                    title: 'لا نتائج مطابقة',
                    text: 'جرّب تعديل البحث أو الفلاتر.',
                  },
            }),
            total > 0
              ? pagination({
                  page: state.page,
                  pageSize: state.pageSize,
                  total,
                  unit: 'منتج',
                  onPage: (page) => { state.page = page; drawTable(); },
                  onPageSize: (size) => { state.pageSize = size; state.page = 1; drawTable(); },
                })
              : null
          ),
        }));
      }

      async function removeProduct(product) {
        const ok = await confirmDialog({
          title: 'حذف المنتج',
          message: `سيتم حذف "${product.name}" نهائياً. لا يمكن التراجع عن هذا الإجراء.`,
          confirmLabel: 'حذف',
          tone: 'danger',
        });
        if (!ok) return;

        try {
          await deleteProduct(product.id);
          notifyDataChanged();
          toastOk('تم حذف المنتج');
          refresh();
        } catch (error) {
          toastError(error.message);
        }
      }

      /* ------------------------------ شريط الفلاتر ------------------------------ */

      const search = searchField({
        placeholder: 'بحث باسم المنتج أو SKU',
        value: state.query,
        label: 'بحث في المنتجات',
        onInput: debounce((value) => {
          state.query = value;
          state.page = 1;
          drawTable();
        }, 200),
      });

      const categoryFilter = field({
        label: 'الفئة',
        name: 'category',
        value: state.category,
        options: [{ value: 'all', label: 'الكل' }, ...categories.map((c) => ({ value: c.id, label: c.name }))],
        onChange: (event) => { state.category = event.target.value; state.page = 1; drawTable(); },
      });

      const stockFilter = field({
        label: 'حالة المخزون',
        name: 'stock',
        value: state.stock,
        options: [
          { value: 'all', label: 'الكل' },
          { value: STOCK_STATUS.OK, label: 'متوفر' },
          { value: STOCK_STATUS.LOW, label: 'منخفض' },
          { value: STOCK_STATUS.OUT, label: 'نفد المخزون' },
        ],
        onChange: (event) => { state.stock = event.target.value; state.page = 1; drawTable(); },
      });

      const filterBar = h('div', { class: 'filter-bar' },
        h('div', { class: 'filter-bar__row' },
          h('div', { class: 'field' },
            h('label', { class: 'field__label', for: search.input.id || undefined, text: 'بحث' }),
            search.element
          ),
          categoryFilter.element,
          stockFilter.element,
          h('div', { class: 'filter-bar__actions' },
            h('button', {
              class: 'btn btn--outline',
              attrs: { type: 'button' },
              on: { click: openImportDialog },
            }, h('span', { text: 'استيراد Excel' }), icon('upload')),
            h('button', {
              class: 'btn btn--outline',
              attrs: { type: 'button' },
              on: {
                click: async (event) => {
                  const button = event.currentTarget;
                  button.disabled = true;
                  try {
                    await exportProducts();
                    toastOk('تم تصدير المنتجات إلى ملف Excel');
                  } catch (error) {
                    toastError(`تعذّر التصدير: ${error.message}`);
                  } finally {
                    button.disabled = false;
                  }
                },
              },
            }, h('span', { text: 'تصدير Excel' }), icon('download'))
          )
        )
      );

      /* ------------------------------- الاستيراد ------------------------------- */

      function openImportDialog() {
        let parsed = null;
        let selectedFile = null;

        const resultHost = h('div');
        const fileInput = h('input', {
          type: 'file',
          accept: '.xlsx',
          attrs: { 'aria-label': 'اختر ملف Excel' },
          on: { change: (event) => handleFile(event.target.files[0]) },
        });

        const dropZone = h('label', { class: 'file-drop' },
          icon('excel', { class: 'file-drop__icon' }),
          h('span', { class: 'file-drop__title', text: 'اختر ملف Excel أو اسحبه هنا' }),
          h('span', { class: 'file-drop__hint', text: 'صيغة .xlsx فقط — الحد الأقصى 15 ميجابايت' }),
          fileInput
        );

        dropZone.addEventListener('dragover', (event) => {
          event.preventDefault();
          dropZone.classList.add('is-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-over'));
        dropZone.addEventListener('drop', (event) => {
          event.preventDefault();
          dropZone.classList.remove('is-over');
          handleFile(event.dataTransfer.files[0]);
        });

        const modeField = field({
          label: 'المنتجات الموجودة مسبقاً (نفس SKU)',
          name: 'mode',
          value: 'skip',
          options: [
            { value: 'skip', label: 'تخطّيها وعدم تغييرها' },
            { value: 'update', label: 'تحديث بياناتها من الملف' },
          ],
        });

        const importButton = h('button', {
          class: 'btn btn--primary',
          attrs: { type: 'button' },
          disabled: true,
          text: 'استيراد',
          on: { click: doImport },
        });

        async function handleFile(file) {
          if (!file) return;
          selectedFile = file;
          renderInto(resultHost, h('p', { class: 'field__hint', text: 'جارٍ قراءة الملف…' }));
          importButton.disabled = true;

          try {
            parsed = await parseProductsFile(file);
            showPreview();
          } catch (error) {
            parsed = null;
            renderInto(resultHost, alertBox(error.message, 'error'));
          }
        }

        function showPreview() {
          const { valid, invalid, newCategories } = parsed;
          importButton.disabled = valid.length === 0;

          renderInto(resultHost,
            h('div', { class: 'stack', style: { gap: '12px' } },
              h('div', { class: 'row', style: { gap: '10px' } },
                badge(`${valid.length} صف صالح`, valid.length > 0 ? 'green' : 'gray'),
                invalid.length > 0 ? badge(`${invalid.length} صف مرفوض`, 'red') : null,
                newCategories.length > 0 ? badge(`${newCategories.length} فئة جديدة`, 'blue') : null
              ),
              newCategories.length > 0
                ? alertBox(`سيتم إنشاء الفئات التالية: ${newCategories.join('، ')}`, 'info')
                : null,
              invalid.length > 0
                ? h('div', { class: 'stack', style: { gap: '6px' } },
                    h('p', { class: 'field__label', text: 'صفوف لن تُستورد:' }),
                    h('div', { style: { 'max-height': '180px', 'overflow-y': 'auto' } },
                      ...invalid.slice(0, 40).map((row) =>
                        h('p', { class: 'field__error' }, `الصف ${row.row}: ${row.errors.join('، ')}`)
                      ),
                      invalid.length > 40
                        ? h('p', { class: 'field__hint', text: `و${invalid.length - 40} صفاً آخر…` })
                        : null
                    )
                  )
                : null,
              valid.length > 0 ? modeField.element : null
            )
          );
        }

        async function doImport() {
          if (!parsed || parsed.valid.length === 0) return;
          importButton.disabled = true;
          importButton.textContent = 'جارٍ الاستيراد…';

          try {
            const result = await commitProductsImport(parsed.valid, {
              mode: modeField.value,
              createCategories: true,
            });

            notifyDataChanged();
            modal.close();

            const parts = [];
            if (result.created) parts.push(`${result.created} منتجاً جديداً`);
            if (result.updated) parts.push(`${result.updated} منتجاً محدّثاً`);
            if (result.skipped) parts.push(`${result.skipped} متخطّى`);
            if (result.failed.length) parts.push(`${result.failed.length} فشل`);

            if (result.failed.length > 0) {
              toastError(`اكتمل الاستيراد مع أخطاء: ${parts.join('، ')}. أول خطأ: ${result.failed[0].error}`);
            } else {
              toastOk(`تم الاستيراد: ${parts.join('، ') || 'لا تغييرات'}`);
            }
            refresh();
          } catch (error) {
            toastError(`فشل الاستيراد: ${error.message}`);
            importButton.disabled = false;
            importButton.textContent = 'استيراد';
          }
        }

        const modal = openModal({
          title: 'استيراد منتجات من Excel',
          size: 'lg',
          body: [
            alertBox('يجب أن يحتوي الملف على الأعمدة: SKU، اسم المنتج، الفئة، الوحدة، سعر الشراء، سعر البيع. نزّل القالب لضمان التنسيق الصحيح.', 'info'),
            dropZone,
            resultHost,
          ],
          footer: [
            importButton,
            h('button', {
              class: 'btn btn--ghost',
              attrs: { type: 'button' },
              on: {
                click: async () => {
                  await downloadProductTemplate();
                  toastOk('تم تنزيل القالب');
                },
              },
            }, icon('download'), h('span', { text: 'تنزيل القالب' })),
            h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
          ],
        });
      }

      /* -------------------------------- التركيب -------------------------------- */

      drawKpis();
      drawTable();

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' },
          h('span'),
          h('div', { class: 'page__actions' },
            h('a', { class: 'btn btn--primary', href: '#/products/new' },
              h('span', { text: 'إضافة منتج' }), icon('plus'))
          )
        ),
        kpiHost,
        filterBar,
        tableHost
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/purchases.js */
  __def("src/views/purchases.js", function (__exports, __m, __dyn) {
    /** الموردون والمشتريات وأوامر الشراء. */
    const { h } = __m("src/utils/dom.js");
    const { formatAmount } = __m("src/utils/format.js");
    const { toMinor } = __m("src/utils/money.js");
    const { formatDate } = __m("src/utils/dates.js");
    const { listProducts } = __m("src/repositories/products.js");
    const { listSuppliers, supplierLedger, listOrders, saveSupplier, createOrder, receiveOrder, paySupplier } = __m("src/repositories/purchasing.js");
    const { toastOk, toastError } = __m("src/components/feedback.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { refresh } = __m("src/router.js");
    const { settings } = __m("src/repositories/settings.js");
    const inp=(label,name,type='text',attrs={})=>h('label',{class:'field'},h('span',{class:'field__label',text:label}),h('input',{class:'input',name,type,attrs:{required:true,...attrs}}));
    const money=n=>formatAmount(n||0);
    async function render(context={}){let [suppliers,ledger,orders,products]=await Promise.all([listSuppliers(),supplierLedger(),listOrders(),listProducts()]);const prefs=settings();const symbol=prefs.currencySymbol||'₪';const host=h('div',{class:'page stack'});function draw(){const rows=suppliers.map(s=>{let l=ledger.get(s.id)||{balanceMinor:0,purchasesMinor:0};return h('tr',null,h('td',{text:s.name}),h('td',{text:s.phone||'—'}),h('td',{text:s.email||'—'}),h('td',{text:money(l.balanceMinor)+' '+symbol}),h('td',{text:money(l.purchasesMinor)+' '+symbol}),h('td',{text:l.lastPurchaseAt?formatDate(l.lastPurchaseAt,prefs.dateFormat):'—'}),h('td',null,h('button',{class:'btn btn--sm btn--ghost',attrs:{type:'button'},text:'تسجيل دفعة',on:{click:()=>payment(s)}}))) });const orderRows=orders.map(o=>{const sup=suppliers.find(x=>x.id===o.supplierId);return h('tr',null,h('td',{text:o.number}),h('td',{text:sup?.name||'—'}),h('td',{text:o.invoiceNumber||'—'}),h('td',{text:o.status==='received'?'تم الاستلام':'بانتظار الاستلام'}),h('td',null,o.status==='ordered'?h('button',{class:'btn btn--sm btn--primary',attrs:{type:'button'},text:'استلام وتحديث المخزون',on:{click:()=>receive(o)} }):h('span',{text:o.purchaseId||'—'}))) });host.replaceChildren(h('div',{class:'page-header'},h('div',null,h('h2',{text:'الموردون والمشتريات'}),h('p',{class:'muted',text:'إدارة الموردين وأوامر الشراء والاستلام وحساب المورد.'}))),h('div',{class:'grid-2'},h('section',{class:'card card__body'},h('h3',{text:'إضافة مورد'}),h('form',{class:'stack',on:{submit:addSupplier}},inp('اسم المورد','name'),inp('الهاتف','phone','tel',{required:false}),inp('البريد الإلكتروني','email','email',{required:false}),inp('العنوان','address','text',{required:false}),h('label',{class:'field'},h('span',{class:'field__label',text:'ملاحظات'}),h('textarea',{class:'input',name:'note',attrs:{rows:2}})),h('button',{class:'btn btn--primary',attrs:{type:'submit'},text:'حفظ المورد'}))),h('section',{class:'card card__body'},h('h3',{text:'إنشاء أمر شراء'}),h('form',{class:'stack',on:{submit:addOrder}},h('label',{class:'field'},h('span',{class:'field__label',text:'المورد'}),h('select',{class:'input',name:'supplierId',attrs:{required:true}},...suppliers.map(s=>h('option',{attrs:{value:s.id},text:s.name})))),inp('رقم فاتورة المورد','invoiceNumber','text',{required:false}),h('div',{class:'grid-3'},h('label',{class:'field'},h('span',{class:'field__label',text:'المنتج'}),h('select',{class:'input',name:'productId',attrs:{required:true}},...products.filter(p=>p.isActive!==false).map(p=>h('option',{attrs:{value:p.id,...(context.query?.productId===p.id?{selected:true}:{})},text:p.name})))),inp('الكمية','quantity','number',{min:1,step:1,value:context.query?.quantity||1}),inp('سعر الشراء للوحدة','cost','number',{min:0,step:'0.01'})),h('label',{class:'field'},h('span',{class:'field__label',text:'ملاحظات'}),h('textarea',{class:'input',name:'note',attrs:{rows:2}})),h('button',{class:'btn btn--primary',attrs:{type:'submit'},text:'حفظ أمر الشراء'})))),h('section',{class:'card card__body'},h('h3',{text:'قائمة الموردين'}),h('div',{class:'table-wrap'},h('table',{class:'table'},h('thead',null,h('tr',null,...['المورد','الهاتف','البريد','الرصيد المستحق','إجمالي المشتريات','آخر شراء','إجراء'].map(x=>h('th',{text:x})))),h('tbody',null,...rows)))),h('section',{class:'card card__body'},h('h3',{text:'أوامر الشراء والاستلام'}),h('div',{class:'table-wrap'},h('table',{class:'table'},h('thead',null,h('tr',null,...['رقم الأمر','المورد','فاتورة المورد','الحالة','الإجراء'].map(x=>h('th',{text:x})))),h('tbody',null,...orderRows)))))}
    async function addSupplier(e){e.preventDefault();let d=Object.fromEntries(new FormData(e.currentTarget));try{await saveSupplier(d);notifyDataChanged();toastOk('تم حفظ المورد');refresh()}catch(x){toastError(x.message)}}
    async function addOrder(e){e.preventDefault();let d=Object.fromEntries(new FormData(e.currentTarget));try{await createOrder({supplierId:d.supplierId,invoiceNumber:d.invoiceNumber,lines:[{productId:d.productId,quantity:Number(d.quantity),unitCostMinor:toMinor(d.cost)}],note:d.note});notifyDataChanged();toastOk('تم حفظ أمر الشراء؛ استلمه لتحديث المخزون');refresh()}catch(x){toastError(x.message)}}
    async function receive(o){let paid=prompt('المبلغ المدفوع الآن (اتركه 0 للشراء الآجل):','0');if(paid===null)return;let discount=prompt('الخصم على الفاتورة:','0');if(discount===null)return;let tax=prompt('نسبة الضريبة %:','0');if(tax===null)return;try{await receiveOrder(o.id,{paidMinor:toMinor(paid),discountMinor:toMinor(discount),taxRateBp:Math.round(Number(tax)*100)});notifyDataChanged();toastOk('تم الاستلام وتحديث المخزون وحساب المورد');refresh()}catch(x){toastError(x.message)}}
    async function payment(s){let amount=prompt('مبلغ الدفعة:');if(amount===null)return;try{await paySupplier({supplierId:s.id,amountMinor:toMinor(amount),reference:'دفعة مورد'});notifyDataChanged();toastOk('تم تسجيل الدفعة');refresh()}catch(x){toastError(x.message)}}
    draw();return host;}


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/reorder.js */
  __def("src/views/reorder.js", function (__exports, __m, __dyn) {
    /** تقرير المنتجات التي وصلت إلى نقطة إعادة الطلب. */
    const { h } = __m("src/utils/dom.js");
    const { dataTable } = __m("src/components/table.js");
    const { card, badge } = __m("src/components/ui.js");
    const { productsToReorder, stockStatus, STOCK_TONE } = __m("src/repositories/products.js");
    const { formatInt } = __m("src/utils/format.js");
    const { navigate } = __m("src/router.js");

    async function render() {
      const products = await productsToReorder();
      const table = dataTable({
        caption: 'المنتجات المطلوب شراؤها',
        columns: [
          { key: 'name', label: 'المنتج', render: (product) => h('div', null,
            h('strong', { text: product.name }),
            h('div', { class: 'table__sub', text: product.sku })
          ) },
          { key: 'quantity', label: 'المخزون الحالي', render: (product) => formatInt(product.quantity) },
          { key: 'minimumStock', label: 'الحد الأدنى', render: (product) => formatInt(product.minimumStock) },
          { key: 'maximumStock', label: 'الحد الأقصى', render: (product) => product.maximumStock ? formatInt(product.maximumStock) : '—' },
          { key: 'reorderPoint', label: 'نقطة إعادة الطلب', render: (product) => formatInt(product.reorderPoint) },
          { key: 'status', label: 'الحالة', render: (product) => badge('يحتاج إلى إعادة طلب', STOCK_TONE[stockStatus(product)] || 'amber') },
          { key: 'suggestedPurchase', label: 'المقترح شراء', render: (product) => h('strong', { text: formatInt(product.suggestedPurchase) }) },
          {
            key: 'action', label: 'الإجراء', className: 'is-actions',
            render: (product) => h('button', {
              class: 'btn btn--sm btn--primary',
              attrs: { type: 'button' },
              text: 'إنشاء أمر شراء',
              on: { click: () => navigate('/purchases?productId=' + encodeURIComponent(product.id) + '&quantity=' + product.suggestedPurchase) },
            }),
          },
        ],
        rows: products,
        empty: {
          iconName: 'checkCircle',
          title: 'لا توجد منتجات لإعادة الطلب',
          text: 'كل المنتجات أعلى من نقاط إعادة الطلب المحددة.',
        },
      });

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' },
          h('div', null,
            h('h2', { class: 'page__title', text: 'المنتجات المطلوب شراؤها' }),
            h('p', { class: 'muted', text: 'منتجات وصلت إلى نقطة إعادة الطلب، مع كمية مقترحة للوصول إلى الحد المستهدف.' })
          )
        ),
        card({ flush: true, body: table })
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/reports.js */
  __def("src/views/reports.js", function (__exports, __m, __dyn) {
    /** التقارير — مرجع: UI/10-reports.png */

    const { h, render: renderInto, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, kpi, kpiGrid, field, emptyState, deltaPercent, badge } = __m("src/components/ui.js");
    const { dataTable } = __m("src/components/table.js");
    const { lineChart, barChart, donutChart, chartLegend, chartWithLegend, inlineLegend, CHART_COLORS } = __m("src/components/charts.js");
    const { toastOk, toastError } = __m("src/components/feedback.js");
    const { compareWithPrevious, dailySeries, topProducts, salesByCategory, expensesByCategory, paymentMethods, stockReport, movementReport, stagnantProducts } = __m("src/services/reports.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount, formatInt, formatCompact, formatPercent } = __m("src/utils/format.js");
    const { presetRange, isDayKey, formatDate } = __m("src/utils/dates.js");
    const { toMajor } = __m("src/utils/money.js");
    const { printReport } = __m("src/services/print.js");
    const { exportReport, exportFileName } = __m("src/services/excel.js");

    const REPORT_TYPES = [
      { value: 'sales', label: 'ملخص المبيعات' },
      { value: 'salesExpenses', label: 'المبيعات والمصروفات' },
      { value: 'profit', label: 'الربح التقديري' },
      { value: 'topProducts', label: 'الأكثر مبيعاً' },
      { value: 'mostProfitable', label: 'الأكثر ربحية' },
      { value: 'stagnant', label: 'المنتجات الراكدة' },
      { value: 'category', label: 'المبيعات حسب الفئة' },
      { value: 'payments', label: 'طرق الدفع' },
      { value: 'stock', label: 'المخزون المنخفض والمنعدم' },
      { value: 'movements', label: 'حركات المخزون' },
    ];

    const PRESETS = [
      { value: 'today', label: 'اليوم' },
      { value: 'last7', label: 'آخر 7 أيام' },
      { value: 'last30', label: 'آخر 30 يوماً' },
      { value: 'month', label: 'هذا الشهر' },
      { value: 'prevMonth', label: 'الشهر الماضي' },
      { value: 'year', label: 'هذه السنة' },
    ];

    async function render(context) {
      const s = settings();
      const symbol = s.currencySymbol;

      const initial = presetRange('last7');
      const state = {
        type: context.query.type || 'sales',
        from: context.query.from && isDayKey(context.query.from) ? context.query.from : initial.from,
        to: context.query.to && isDayKey(context.query.to) ? context.query.to : initial.to,
        data: null,
      };

      const contentHost = h('div', { class: 'stack' });

      /* ------------------------------ شريط الأدوات ------------------------------ */

      const typeField = field({
        label: 'نوع التقرير', name: 'type', value: state.type,
        options: REPORT_TYPES,
        onChange: (event) => { state.type = event.target.value; load(); },
      });

      const fromField = field({ label: 'من تاريخ', name: 'from', type: 'date', value: state.from });
      const toField = field({ label: 'إلى تاريخ', name: 'to', type: 'date', value: state.to });

      const presetField = field({
        label: 'فترة سريعة', name: 'preset', value: 'last7',
        options: [{ value: 'custom', label: 'مخصّص' }, ...PRESETS],
        onChange: (event) => {
          if (event.target.value === 'custom') return;
          const range = presetRange(event.target.value);
          state.from = range.from;
          state.to = range.to;
          fromField.value = range.from;
          toField.value = range.to;
          load();
        },
      });

      function applyDates() {
        const from = fromField.value;
        const to = toField.value;

        if (!isDayKey(from) || !isDayKey(to)) {
          toastError('التاريخ غير صالح');
          return;
        }
        if (from > to) {
          toastError('«من تاريخ» يجب أن يسبق «إلى تاريخ»');
          return;
        }

        state.from = from;
        state.to = to;
        presetField.value = 'custom';
        load();
      }

      const toolbar = h('div', { class: 'report-toolbar' },
        typeField.element,
        fromField.element,
        toField.element,
        presetField.element,
        h('div', { class: 'filter-bar__actions' },
          h('button', {
            class: 'btn btn--success',
            attrs: { type: 'button' },
            on: { click: applyDates },
          }, h('span', { text: 'تطبيق' }), icon('filter')),
          h('button', {
            class: 'btn btn--ghost',
            attrs: { type: 'button' },
            on: {
              click: () => {
                const range = presetRange('last7');
                state.from = range.from;
                state.to = range.to;
                state.type = 'sales';
                typeField.value = 'sales';
                fromField.value = range.from;
                toField.value = range.to;
                presetField.value = 'last7';
                load();
              },
            },
          }, h('span', { text: 'إعادة تعيين' }), icon('refresh'))
        )
      );

      const actionRow = h('div', { class: 'page__actions' },
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: { click: () => doPrint() },
        }, h('span', { text: 'طباعة التقرير' }), icon('printer')),
        h('button', {
          class: 'btn btn--ghost',
          attrs: { type: 'button' },
          on: { click: () => doExport() },
        }, h('span', { text: 'تصدير Excel' }), icon('download'))
      );

      /* -------------------------------- التحميل -------------------------------- */

      async function load() {
        renderInto(contentHost, h('div', { class: 'card' }, h('div', { class: 'card__body' },
          h('p', { class: 'field__hint', text: 'جارٍ حساب التقرير…' }))));

        try {
          const { current, prior } = await compareWithPrevious(state.from, state.to);
          const [categorySlices, expenseSlices, stock, movements, stagnant] = await Promise.all([
            salesByCategory(current),
            expensesByCategory(current),
            stockReport(),
            movementReport(state.from, state.to),
            stagnantProducts(60),
          ]);

          state.data = { current, prior, categorySlices, expenseSlices, stock, movements, stagnant };
          draw();
        } catch (error) {
          renderInto(contentHost, card({
            body: emptyState({
              iconName: 'error',
              title: 'تعذّر حساب التقرير',
              text: error.message,
            }),
          }));
        }
      }

      /* --------------------------------- الرسم --------------------------------- */

      function draw() {
        const { current, prior } = state.data;
        const rangeLabel = `${formatDate(state.from, s.dateFormat)} — ${formatDate(state.to, s.dateFormat)}`;

        const kpis = kpiGrid(
          kpi({
            label: 'إجمالي المبيعات', value: formatAmount(current.revenueMinor), unit: symbol,
            iconName: 'basket', tone: 'green',
            delta: { percent: deltaPercent(current.revenueMinor, prior.revenueMinor), label: 'مقارنة بالفترة السابقة' },
          }),
          kpi({
            label: 'إجمالي المصروفات', value: formatAmount(current.expensesMinor), unit: symbol,
            iconName: 'wallet', tone: 'amber',
            delta: { percent: deltaPercent(current.expensesMinor, prior.expensesMinor), label: 'مقارنة بالفترة السابقة' },
          }),
          kpi({
            label: 'الربح التقديري', value: formatAmount(current.estimatedProfitMinor), unit: symbol,
            iconName: 'pieChart', tone: current.estimatedProfitMinor >= 0 ? 'teal' : 'red',
            delta: { percent: deltaPercent(current.estimatedProfitMinor, prior.estimatedProfitMinor), label: 'مقارنة بالفترة السابقة' },
          }),
          kpi({
            label: 'عدد الفواتير', value: formatInt(current.invoiceCount), unit: 'فاتورة',
            iconName: 'receipt', tone: 'blue',
            delta: { percent: deltaPercent(current.invoiceCount, prior.invoiceCount), label: 'مقارنة بالفترة السابقة' },
          })
        );

        const body = current.invoiceCount === 0 && current.expenses.length === 0 && state.type !== 'stock'
          ? card({
              body: emptyState({
                iconName: 'chart',
                title: 'لا بيانات في هذه الفترة',
                text: 'لم تُسجَّل مبيعات أو مصروفات بين هذين التاريخين. جرّب توسيع النطاق.',
              }),
            })
          : reportBody();

        renderInto(contentHost,
          h('p', { class: 'field__hint' }, 'الفترة: ', ltr(rangeLabel)),
          kpis,
          body
        );
      }

      function reportBody() {
        const { current, categorySlices, expenseSlices, stock, movements } = state.data;
        const series = dailySeries(current);

        switch (state.type) {
          case 'salesExpenses':
            return h('div', { class: 'stack' },
              card({
                title: 'المبيعات والمصروفات',
                body: h('div', null,
                  inlineLegend([
                    { label: `المبيعات (${symbol})`, color: '#12855A' },
                    { label: `المصروفات (${symbol})`, color: '#DC2626' },
                  ]),
                  barChart({
                    labels: series.map((point) => point.key),
                    series: [
                      { name: 'المبيعات', color: '#12855A', values: series.map((p) => p.salesMinor / 100) },
                      { name: 'المصروفات', color: '#DC2626', values: series.map((p) => p.expensesMinor / 100) },
                    ],
                    title: 'المبيعات والمصروفات اليومية',
                  })
                ),
              }),
              expenseSlices.length > 0
                ? card({
                    title: 'المصروفات حسب الفئة',
                    body: chartWithLegend(
                      donutChart({ slices: colorize(expenseSlices), title: 'المصروفات حسب الفئة' }),
                      chartLegend(colorize(expenseSlices).map((slice) => ({
                        label: slice.label, value: `${formatAmount(slice.value)} ${symbol}`, color: slice.color,
                      })))
                    ),
                  })
                : null
            );

          case 'profit':
            return h('div', { class: 'stack' },
              card({
                title: 'مكوّنات الربح التقديري',
                body: h('div', { class: 'stack', style: { gap: '2px' } },
                  profitRow('إجمالي المبيعات (شامل الضريبة)', current.revenueMinor),
                  profitRow('الضريبة المحصّلة', -current.taxMinor),
                  profitRow('صافي الإيراد', current.netRevenueMinor, true),
                  profitRow('تكلفة البضاعة المباعة', -current.costMinor),
                  profitRow('مجمل الربح', current.grossProfitMinor, true),
                  profitRow('المصروفات التشغيلية', -current.expensesMinor),
                  profitRow('الربح التقديري', current.estimatedProfitMinor, true, true)
                ),
                footer: h('p', { class: 'field__hint' },
                  'التكلفة محسوبة من سعر شراء المنتج المحفوظ داخل كل سطر فاتورة وقت البيع، فتغيير الأسعار لاحقاً لا يؤثر على أرباح الفواتير السابقة.'),
              }),
              card({
                title: 'اتجاه المبيعات',
                body: lineChart({
                  points: series.map((p) => ({ label: p.key, value: p.salesMinor / 100 })),
                  title: 'اتجاه المبيعات',
                  showValues: series.length <= 10,
                  color: '#12855A',
                }),
              })
            );

          case 'topProducts':
          case 'mostProfitable': {
            const top = topProducts(current, 20).sort(state.type === 'mostProfitable' ? (a, b) => b.profitMinor - a.profitMinor : (a, b) => b.quantity - a.quantity);
            const totalQty = top.reduce((sum, item) => sum + item.quantity, 0);
            const totalRevenue = top.reduce((sum, item) => sum + item.revenueMinor, 0);

            return card({
              title: state.type === 'mostProfitable' ? 'المنتجات الأكثر ربحية' : 'الأكثر مبيعاً',
              flush: true,
              body: dataTable({
                caption: 'المنتجات الأكثر مبيعاً',
                columns: [
                  { key: 'name', label: 'المنتج', render: (row) => h('div', null,
                    h('div', { class: 'table__main', text: row.name }),
                    h('div', { class: 'table__sub' }, ltr(row.sku))
                  ) },
                  { key: 'quantity', label: 'الكمية المباعة', render: (row) => ltr(row.quantity) },
                  { key: 'revenueMinor', label: 'الإيراد', render: (row) => h('span', null, ltr(formatAmount(row.revenueMinor)), ` ${symbol}`) },
                  {
                    key: 'profit',
                    label: 'الربح',
                    render: (row) => {
                      const profit = row.revenueMinor - row.costMinor;
                      return h('span', { style: { color: profit >= 0 ? 'var(--green)' : 'var(--red)' } },
                        ltr(formatAmount(profit)), ` ${symbol}`);
                    },
                  },
                ],
                rows: top.length > 0
                  ? [...top, {
                      productId: '__total', name: 'الإجمالي', sku: '',
                      quantity: totalQty, revenueMinor: totalRevenue,
                      costMinor: top.reduce((sum, item) => sum + item.costMinor, 0),
                    }]
                  : [],
                empty: { iconName: 'products', title: 'لا مبيعات في هذه الفترة', text: 'لم يُبَع أي منتج بين هذين التاريخين.' },
              }),
            });
          }

          case 'stagnant':
            return card({ title: 'المنتجات الراكدة — لم تُبع خلال 60 يوماً', flush: true, body: dataTable({ caption: 'المنتجات الراكدة', columns: [
              { key: 'name', label: 'المنتج', render: (row) => h('div', null, h('div', { class: 'table__main', text: row.name }), h('div', { class: 'table__sub' }, ltr(row.sku))) },
              { key: 'lastSaleDay', label: 'آخر بيع', render: (row) => ltr(row.lastSaleDay || 'لم يُبع') },
              { key: 'quantity', label: 'الكمية', render: (row) => ltr(row.quantity) },
              { key: 'value', label: 'قيمة المخزون', render: (row) => h('span', null, ltr(formatAmount(row.quantity * row.costMinor)), ` ${symbol}`) },
            ], rows: state.data.stagnant, empty: { iconName: 'products', title: 'لا توجد منتجات راكدة', text: 'كل المنتجات النشطة لها مبيعات حديثة.' } }) });

          case 'category':
            return card({
              title: 'المبيعات حسب الفئة',
              body: categorySlices.length === 0
                ? emptyState({ iconName: 'tag', title: 'لا مبيعات', text: 'لا توجد مبيعات في هذه الفترة.' })
                : chartWithLegend(
                    donutChart({ slices: colorize(categorySlices), title: 'المبيعات حسب الفئة' }),
                    chartLegend(colorize(categorySlices).map((slice) => ({
                      label: slice.label,
                      value: formatPercent((slice.value / categorySlices.reduce((sum, x) => sum + x.value, 0)) * 100),
                      color: slice.color,
                    })))
                  ),
            });

          case 'payments': {
            const slices = paymentMethods(current);
            const total = slices.reduce((sum, slice) => sum + slice.value, 0);
            return card({
              title: 'طرق الدفع',
              body: slices.length === 0
                ? emptyState({ iconName: 'wallet', title: 'لا مبيعات', text: 'لا توجد مبيعات في هذه الفترة.' })
                : chartWithLegend(
                    donutChart({ slices, title: 'طرق الدفع' }),
                    chartLegend(slices.map((slice) => ({
                      label: slice.label,
                      value: formatPercent((slice.value / total) * 100),
                      color: slice.color,
                    })))
                  ),
            });
          }

          case 'stock':
            return h('div', { class: 'stack' },
              h('div', { class: 'grid-3' },
                kpi({ label: 'إجمالي الأصناف', value: formatInt(stock.totalProducts), unit: 'صنف', iconName: 'products', tone: 'blue' }),
                kpi({ label: 'مخزون منخفض', value: formatInt(stock.low.length), unit: 'صنف', iconName: 'arrowDown', tone: 'amber' }),
                kpi({ label: 'نفد المخزون', value: formatInt(stock.out.length), unit: 'صنف', iconName: 'packageX', tone: 'red' })
              ),
              card({
                title: 'الأصناف التي تحتاج إعادة طلب',
                flush: true,
                body: dataTable({
                  caption: 'المخزون المنخفض والمنعدم',
                  columns: [
                    { key: 'name', label: 'المنتج', render: (row) => h('div', null,
                      h('div', { class: 'table__main', text: row.name }),
                      h('div', { class: 'table__sub' }, ltr(row.sku))
                    ) },
                    { key: 'categoryName', label: 'الفئة' },
                    { key: 'quantity', label: 'الكمية', render: (row) => h('span', {
                      style: { color: row.quantity === 0 ? 'var(--red)' : 'var(--amber)', 'font-weight': '700' },
                    }, ltr(row.quantity)) },
                    { key: 'lowStockThreshold', label: 'الحد الأدنى', render: (row) => ltr(row.lowStockThreshold) },
                    { key: 'status', label: 'الحالة', render: (row) => badge(
                      row.status === 'out' ? 'نفد المخزون' : 'منخفض', row.status === 'out' ? 'red' : 'amber') },
                    { key: 'value', label: 'قيمة المخزون', render: (row) => h('span', null,
                      ltr(formatAmount(row.stockValueMinor)), ` ${symbol}`) },
                  ],
                  rows: [...stock.out, ...stock.low],
                  empty: { iconName: 'checkCircle', title: 'المخزون بحالة جيدة', text: 'لا توجد أصناف تحت الحد الأدنى.' },
                }),
              })
            );

          case 'movements':
            return h('div', { class: 'stack' },
              card({
                title: 'حركات المخزون مجمّعة حسب السبب',
                flush: true,
                body: dataTable({
                  caption: 'ملخص حركات المخزون',
                  columns: [
                    { key: 'reason', label: 'السبب' },
                    { key: 'count', label: 'عدد الحركات', render: (row) => ltr(row.count) },
                    { key: 'increases', label: 'إجمالي الإضافة', render: (row) => h('span', { style: { color: 'var(--green)' } }, ltr(`+${row.increases}`)) },
                    { key: 'decreases', label: 'إجمالي السحب', render: (row) => h('span', { style: { color: 'var(--red)' } }, ltr(`−${row.decreases}`)) },
                  ],
                  rows: movements.byReason,
                  empty: { iconName: 'history', title: 'لا حركات', text: 'لم تُسجَّل حركات مخزون في هذه الفترة.' },
                }),
              })
            );

          case 'sales':
          default:
            return h('div', { class: 'stack' },
              h('div', { class: 'grid-2' },
                card({
                  title: 'المبيعات والمصروفات',
                  body: h('div', null,
                    inlineLegend([
                      { label: `المبيعات (${symbol})`, color: '#12855A' },
                      { label: `المصروفات (${symbol})`, color: '#DC2626' },
                    ]),
                    barChart({
                      labels: series.map((p) => p.key),
                      series: [
                        { name: 'المبيعات', color: '#12855A', values: series.map((p) => p.salesMinor / 100) },
                        { name: 'المصروفات', color: '#DC2626', values: series.map((p) => p.expensesMinor / 100) },
                      ],
                      title: 'المبيعات والمصروفات',
                    })
                  ),
                }),
                card({
                  title: 'اتجاه المبيعات',
                  body: lineChart({
                    points: series.map((p) => ({ label: p.key, value: p.salesMinor / 100 })),
                    title: 'اتجاه المبيعات',
                    showValues: series.length <= 10,
                    color: '#12855A',
                  }),
                })
              ),
              h('div', { class: 'grid-3' },
                card({
                  title: 'طرق الدفع',
                  body: (() => {
                    const slices = paymentMethods(current);
                    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
                    return slices.length === 0
                      ? emptyState({ iconName: 'wallet', title: 'لا مبيعات', text: '' })
                      : chartWithLegend(
                          donutChart({ slices, title: 'طرق الدفع', size: 180 }),
                          chartLegend(slices.map((slice) => ({
                            label: slice.label, value: formatPercent((slice.value / total) * 100), color: slice.color,
                          })))
                        );
                  })(),
                }),
                card({
                  title: 'المبيعات حسب الفئة',
                  body: categorySlices.length === 0
                    ? emptyState({ iconName: 'tag', title: 'لا مبيعات', text: '' })
                    : chartWithLegend(
                        donutChart({ slices: colorize(categorySlices), title: 'المبيعات حسب الفئة', size: 180 }),
                        chartLegend(colorize(categorySlices).map((slice) => ({
                          label: slice.label,
                          value: formatPercent((slice.value / categorySlices.reduce((sum, x) => sum + x.value, 0)) * 100),
                          color: slice.color,
                        })))
                      ),
                }),
                card({
                  title: 'الأكثر مبيعاً',
                  flush: true,
                  body: (() => {
                    const top = topProducts(current, 5);
                    return dataTable({
                      caption: 'أكثر خمسة منتجات مبيعاً',
                      columns: [
                        { key: 'name', label: 'المنتج' },
                        { key: 'quantity', label: 'الكمية المباعة', render: (row) => ltr(row.quantity) },
                        { key: 'revenueMinor', label: 'الإيراد', render: (row) => h('span', null, ltr(formatAmount(row.revenueMinor)), ` ${symbol}`) },
                      ],
                      rows: top.length > 0
                        ? [...top, {
                            name: 'الإجمالي',
                            quantity: top.reduce((sum, item) => sum + item.quantity, 0),
                            revenueMinor: top.reduce((sum, item) => sum + item.revenueMinor, 0),
                          }]
                        : [],
                      empty: { iconName: 'products', title: 'لا مبيعات', text: '' },
                    });
                  })(),
                })
              )
            );
        }
      }

      function profitRow(label, minor, strong = false, highlight = false) {
        return h('div', {
          class: 'invoice-totals__row',
          style: highlight
            ? { background: minor >= 0 ? 'var(--green-soft)' : 'var(--red-soft)', 'font-size': '16px' }
            : null,
        },
          h('span', { style: strong ? { 'font-weight': '700' } : null, text: label }),
          h('span', {
            style: {
              'font-weight': strong ? '700' : '600',
              color: minor < 0 ? 'var(--red)' : highlight || strong ? 'var(--green)' : 'inherit',
            },
          }, ltr(formatAmount(minor)), ` ${symbol}`)
        );
      }

      const colorize = (slices) => slices.map((slice, index) => ({
        ...slice,
        color: slice.color || CHART_COLORS[index % CHART_COLORS.length],
      }));

      /* ----------------------------- طباعة وتصدير ----------------------------- */

      function reportTable() {
        const { current, categorySlices, expenseSlices, stock, movements } = state.data;
        const series = dailySeries(current);
        const typeLabel = REPORT_TYPES.find((type) => type.value === state.type)?.label || 'تقرير';

        switch (state.type) {
          case 'topProducts':
          case 'mostProfitable':
            return {
              title: typeLabel,
              header: ['المنتج', 'SKU', 'الكمية المباعة', `الإيراد (${symbol})`, `الربح (${symbol})`],
              rows: topProducts(current, 100).map((row) => [
                row.name, row.sku, row.quantity,
                toMajor(row.revenueMinor), toMajor(row.revenueMinor - row.costMinor),
              ]),
            };
          case 'stagnant':
            return { title: typeLabel, header: ['المنتج', 'SKU', 'آخر بيع', 'الكمية', `القيمة (${symbol})`], rows: state.data.stagnant.map((row) => [row.name, row.sku, row.lastSaleDay || 'لم يُبع', row.quantity, toMajor(row.quantity * row.costMinor)]) };
          case 'category':
            return {
              title: typeLabel,
              header: ['الفئة', `المبيعات (${symbol})`],
              rows: categorySlices.map((slice) => [slice.label, toMajor(slice.value)]),
            };
          case 'payments':
            return {
              title: typeLabel,
              header: ['طريقة الدفع', `المبلغ (${symbol})`],
              rows: paymentMethods(current).map((slice) => [slice.label, toMajor(slice.value)]),
            };
          case 'stock':
            return {
              title: typeLabel,
              header: ['المنتج', 'SKU', 'الفئة', 'الكمية', 'الحد الأدنى', 'الحالة', `قيمة المخزون (${symbol})`],
              rows: [...stock.out, ...stock.low].map((row) => [
                row.name, row.sku, row.categoryName, row.quantity, row.lowStockThreshold,
                row.status === 'out' ? 'نفد المخزون' : 'منخفض', toMajor(row.stockValueMinor),
              ]),
            };
          case 'movements':
            return {
              title: typeLabel,
              header: ['السبب', 'عدد الحركات', 'إجمالي الإضافة', 'إجمالي السحب'],
              rows: movements.byReason.map((row) => [row.reason, row.count, row.increases, row.decreases]),
            };
          case 'profit':
            return {
              title: typeLabel,
              header: ['البند', `المبلغ (${symbol})`],
              rows: [
                ['إجمالي المبيعات', toMajor(current.revenueMinor)],
                ['الضريبة المحصّلة', toMajor(-current.taxMinor)],
                ['صافي الإيراد', toMajor(current.netRevenueMinor)],
                ['تكلفة البضاعة المباعة', toMajor(-current.costMinor)],
                ['مجمل الربح', toMajor(current.grossProfitMinor)],
                ['المصروفات التشغيلية', toMajor(-current.expensesMinor)],
                ['الربح التقديري', toMajor(current.estimatedProfitMinor)],
              ],
            };
          default:
            return {
              title: typeLabel,
              header: ['اليوم', `المبيعات (${symbol})`, `المصروفات (${symbol})`, `الصافي (${symbol})`],
              rows: series.map((point) => [
                point.key, toMajor(point.salesMinor), toMajor(point.expensesMinor),
                toMajor(point.salesMinor - point.expensesMinor),
              ]),
            };
        }
      }

      function statCards() {
        const { current } = state.data;
        return [
          { label: 'إجمالي المبيعات', value: `${formatAmount(current.revenueMinor)} ${symbol}` },
          { label: 'إجمالي المصروفات', value: `${formatAmount(current.expensesMinor)} ${symbol}` },
          { label: 'الربح التقديري', value: `${formatAmount(current.estimatedProfitMinor)} ${symbol}` },
          { label: 'عدد الفواتير', value: formatInt(current.invoiceCount) },
        ];
      }

      function doPrint() {
        if (!state.data) return;
        const table = reportTable();
        printReport({
          title: table.title,
          subtitle: `الفترة من ${formatDate(state.from, s.dateFormat)} إلى ${formatDate(state.to, s.dateFormat)}`,
          stats: statCards(),
          tables: [table],
        });
      }

      async function doExport() {
        if (!state.data) return;
        try {
          const table = reportTable();
          await exportReport({
            title: table.title,
            fileName: exportFileName(`${table.title}-${state.from}-${state.to}`),
            header: table.header,
            rows: table.rows,
          });
          toastOk('تم تصدير التقرير إلى ملف Excel');
        } catch (error) {
          toastError(`تعذّر التصدير: ${error.message}`);
        }
      }

      /* -------------------------------- التركيب -------------------------------- */

      await load();

      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' }, h('span'), actionRow),
        toolbar,
        contentHost
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/settings.js */
  __def("src/views/settings.js", function (__exports, __m, __dyn) {
    /** الإعدادات — مرجع: UI/12-settings.png */

    const { h, render: renderInto, ltr } = __m("src/utils/dom.js");
    const { icon } = __m("src/components/icons.js");
    const { card, field, toggleField, badge, alertBox, progressBar, emptyState } = __m("src/components/ui.js");
    const { toastOk, toastError, confirmDialog, openModal } = __m("src/components/feedback.js");
    const { settings, saveSettings, loadSettings, DEFAULT_SETTINGS } = __m("src/repositories/settings.js");
    const { listCategories, createCategory, deleteCategory } = __m("src/repositories/products.js");
    const { listExpenseCategories, createExpenseCategory, deleteExpenseCategory } = __m("src/repositories/expenses.js");
    const { listReasons, createReason, deactivateReason } = __m("src/repositories/inventory.js");
    const { appState } = __m("src/state/store.js");
    const { applyUpdate, offlineCapability, readStorageEstimate, requestPersistentStorage } = __m("src/services/pwa.js");
    const { seedDemoData, isEmptyDatabase } = __m("src/db/seed.js");
    const { APP_VERSION, SCHEMA_VERSION } = __m("src/db/schema.js");
    const { DATE_FORMATS } = __m("src/utils/dates.js");
    const { bpToPercent, percentToBp } = __m("src/utils/money.js");
    const { formatBytes } = __m("src/utils/format.js");
    const { TEMPLATES, TEMPLATE_LABEL } = __m("src/services/print.js");
    const { refresh } = __m("src/router.js");
    const { notifyDataChanged } = __m("src/state/store.js");

    const SECTIONS = [
      { id: 'general', label: 'عام', icon: 'gear' },
      { id: 'store', label: 'بيانات المتجر', icon: 'store' },
      { id: 'invoices', label: 'الفواتير', icon: 'invoices' },
      { id: 'taxes', label: 'الضرائب', icon: 'percent' },
      { id: 'catalog', label: 'الفئات والأسباب', icon: 'tag' },
      { id: 'data', label: 'البيانات والأوفلاين', icon: 'database' },
    ];

    const CURRENCIES = [
      { code: 'SAR', symbol: 'ر.س', label: 'ريال سعودي (SAR)' },
      { code: 'EGP', symbol: 'ج.م', label: 'جنيه مصري (EGP)' },
      { code: 'AED', symbol: 'د.إ', label: 'درهم إماراتي (AED)' },
      { code: 'KWD', symbol: 'د.ك', label: 'دينار كويتي (KWD)' },
      { code: 'QAR', symbol: 'ر.ق', label: 'ريال قطري (QAR)' },
      { code: 'JOD', symbol: 'د.أ', label: 'دينار أردني (JOD)' },
      { code: 'IQD', symbol: 'د.ع', label: 'دينار عراقي (IQD)' },
      { code: 'USD', symbol: '$', label: 'دولار أمريكي (USD)' },
      { code: 'ILS', symbol: '₪', label: 'شيكل إسرائيلي (ILS)' },
    ];

    async function render(context) {
      const s = await loadSettings({ force: true });
      const capability = offlineCapability();
      const storage = appState.get().storage || await readStorageEstimate();

      let activeSection = context.query.section || 'general';
      const formHost = h('div');
      const navHost = h('div', { class: 'settings-nav' });

      /* -------------------------------- الحقول -------------------------------- */

      const fields = {
        storeName: field({ label: 'اسم المتجر', name: 'storeName', value: s.storeName, required: true, placeholder: 'اسم المتجر' }),
        storePhone: field({ label: 'رقم الهاتف', name: 'storePhone', type: 'tel', value: s.storePhone, placeholder: '+966 50 123 4567' }),
        storeEmail: field({ label: 'البريد الإلكتروني', name: 'storeEmail', type: 'email', value: s.storeEmail, placeholder: 'info@store.com' }),
        storeAddress: field({ label: 'العنوان', name: 'storeAddress', value: s.storeAddress, placeholder: 'المدينة، الحي، الشارع' }),
        storeCrNumber: field({ label: 'السجل التجاري', name: 'storeCrNumber', value: s.storeCrNumber, placeholder: 'رقم السجل التجاري' }),
        storeTaxNumber: field({ label: 'الرقم الضريبي', name: 'storeTaxNumber', value: s.storeTaxNumber, placeholder: 'الرقم الضريبي' }),

        currencyCode: field({
          label: 'العملة', name: 'currencyCode', value: s.currencyCode,
          options: CURRENCIES.map((currency) => ({ value: currency.code, label: currency.label })),
          onChange: (event) => {
            const currency = CURRENCIES.find((item) => item.code === event.target.value);
            if (currency) fields.currencySymbol.value = currency.symbol;
          },
        }),
        currencySymbol: field({ label: 'رمز العملة', name: 'currencySymbol', value: s.currencySymbol, required: true }),
        currencyDecimalDigits: field({ label: 'المنازل العشرية', name: 'currencyDecimalDigits', type: 'number', min: '0', max: '3', value: String(s.currencyDecimalDigits ?? 2) }),
        currencySymbolPosition: field({ label: 'موضع الرمز', name: 'currencySymbolPosition', value: s.currencySymbolPosition || 'after', options: [{ value: 'after', label: 'بعد المبلغ' }, { value: 'before', label: 'قبل المبلغ' }] }),
        dateFormat: field({
          label: 'تنسيق التاريخ', name: 'dateFormat', value: s.dateFormat,
          options: DATE_FORMATS.map((format) => ({ value: format, label: format })),
        }),

        invoicePrefix: field({ label: 'بادئة الفاتورة', name: 'invoicePrefix', value: s.invoicePrefix, required: true }),
        invoiceNextNumber: field({
          label: 'الرقم التالي', name: 'invoiceNextNumber', type: 'number', min: '1',
          value: String(s.invoiceNextNumber),
          hint: 'تغيير هذا الرقم قد ينتج أرقام فواتير مكررة إن كان أقل من رقم مستخدم.',
        }),
        invoiceFooter: field({
          label: 'نص تذييل الفاتورة', name: 'invoiceFooter', value: s.invoiceFooter,
          placeholder: 'شكراً لتعاملكم معنا', maxLength: 200,
        }),
        printTemplate: field({
          label: 'قالب الطباعة الافتراضي', name: 'printTemplate', value: s.printTemplate,
          options: [
            { value: TEMPLATES.A4, label: TEMPLATE_LABEL[TEMPLATES.A4] },
            { value: TEMPLATES.THERMAL, label: TEMPLATE_LABEL[TEMPLATES.THERMAL] },
            { value: TEMPLATES.THERMAL_58, label: TEMPLATE_LABEL[TEMPLATES.THERMAL_58] },
          ],
        }),

        defaultTaxRate: field({
          label: 'الضريبة الافتراضية', name: 'defaultTaxRate',
          value: String(bpToPercent(s.defaultTaxRateBp)),
          options: [
            { value: '0', label: 'معفى (0%)' },
            { value: '5', label: '5%' },
            { value: '10', label: '10%' },
            { value: '14', label: '14% - ضريبة القيمة المضافة' },
            { value: '15', label: '15% - ضريبة القيمة المضافة' },
          ],
        }),
        maxDiscountPercent: field({
          label: 'الحد الأقصى للخصم', name: 'maxDiscountPercent', type: 'number', min: '0', max: '100',
          value: String(s.maxDiscountPercent), suffix: '%',
        }),
        lowStockDefault: field({
          label: 'حد المخزون المنخفض الافتراضي', name: 'lowStockDefault', type: 'number', min: '0',
          value: String(s.lowStockDefault),
          hint: 'يُستخدم كقيمة مبدئية عند إضافة منتج جديد.',
        }),
        backupReminder: field({
          label: 'تذكير النسخ الاحتياطي', name: 'backupReminder', value: s.backupReminder,
          options: [
            { value: 'off', label: 'معطّل' },
            { value: 'daily', label: 'يومي' },
            { value: 'weekly', label: 'أسبوعي' },
          ],
        }),
      };

      const toggles = {
        taxInclusive: toggleField({ label: 'الأسعار المدخلة شاملة الضريبة', name: 'taxInclusive', checked: s.taxInclusive }),
        allowDiscount: toggleField({ label: 'السماح بالخصم في نقطة البيع', name: 'allowDiscount', checked: s.allowDiscount }),
        allowNegativeStock: toggleField({ label: 'السماح بالبيع عند نفاد المخزون', name: 'allowNegativeStock', checked: s.allowNegativeStock }),
      };

      /* -------------------------------- الأقسام -------------------------------- */

      function sectionContent() {
        switch (activeSection) {
          case 'store':
            return card({
              title: 'بيانات المتجر',
              titleIcon: 'store',
              body: h('div', { class: 'stack' },
                h('div', { class: 'form-grid' },
                  fields.storeName.element, fields.storePhone.element, fields.storeEmail.element),
                fields.storeAddress.element,
                h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                  fields.storeCrNumber.element, fields.storeTaxNumber.element),
                alertBox('هذه البيانات تظهر في رأس الفواتير المطبوعة.', 'info')
              ),
            });

          case 'invoices':
            return card({
              title: 'الفواتير',
              titleIcon: 'invoices',
              body: h('div', { class: 'stack' },
                h('div', { class: 'form-grid' },
                  fields.dateFormat.element, fields.invoicePrefix.element, fields.invoiceNextNumber.element),
                fields.invoiceFooter.element,
                h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                  fields.printTemplate.element,
                  h('div', { class: 'field' },
                    h('span', { class: 'field__label', text: 'السماح بالخصم' }),
                    toggles.allowDiscount.element)
                ),
                alertBox(
                  `شكل رقم الفاتورة القادم: ${s.invoicePrefix}-${new Date().getFullYear()}-${String(s.invoiceNextNumber).padStart(5, '0')}`,
                  'info'
                )
              ),
            });

          case 'taxes':
            return card({
              title: 'الضرائب والخصم',
              titleIcon: 'percent',
              body: h('div', { class: 'stack' },
                h('div', { class: 'form-grid' },
                  fields.defaultTaxRate.element, fields.maxDiscountPercent.element, fields.lowStockDefault.element),
                h('div', { class: 'stack', style: { gap: '14px' } },
                  toggles.taxInclusive.element,
                  toggles.allowNegativeStock.element),
                alertBox('تغيير نسبة الضريبة يؤثر على الفواتير الجديدة فقط. الفواتير السابقة تحتفظ بالنسبة المستخدمة وقت إصدارها.', 'warn')
              ),
            });

          case 'catalog':
            return catalogSection();

          case 'data':
            return dataSection();

          case 'general':
          default:
            return h('div', { class: 'stack' },
              card({
                title: 'بيانات المتجر',
                titleIcon: 'store',
                body: h('div', { class: 'stack' },
                  h('div', { class: 'form-grid' },
                    fields.storeName.element, fields.storePhone.element, fields.storeEmail.element),
                  fields.storeAddress.element,
                  h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                    fields.currencyCode.element, fields.currencySymbol.element),
                  h('div', { class: 'form-grid--2', style: { display: 'grid', 'grid-template-columns': '1fr 1fr', gap: '16px' } },
                    fields.currencyDecimalDigits.element, fields.currencySymbolPosition.element)
                ),
              }),
              card({
                title: 'الفواتير',
                titleIcon: 'invoices',
                body: h('div', { class: 'stack' },
                  h('div', { class: 'form-grid' },
                    fields.dateFormat.element, fields.invoicePrefix.element, fields.invoiceNextNumber.element),
                  fields.invoiceFooter.element,
                  h('div', { class: 'form-grid' },
                    fields.defaultTaxRate.element,
                    h('div', { class: 'field' },
                      h('span', { class: 'field__label', text: 'السماح بالخصم' }),
                      toggles.allowDiscount.element),
                    fields.printTemplate.element)
                ),
              })
            );
        }
      }

      /* --------------------------- الفئات والأسباب --------------------------- */

      function catalogSection() {
        const host = h('div', { class: 'stack' });

        async function draw() {
          const [productCategories, expenseCategories, reasons] = await Promise.all([
            listCategories(), listExpenseCategories(), listReasons(),
          ]);

          renderInto(host,
            listCard('فئات المنتجات', 'tag', productCategories, {
              onAdd: async (name) => { await createCategory({ name, sortOrder: productCategories.length + 1 }); },
              onDelete: async (item) => { await deleteCategory(item.id); },
              deleteLabel: 'حذف',
            }),
            listCard('فئات المصروفات', 'expenses', expenseCategories, {
              onAdd: async (name) => { await createExpenseCategory({ name }); },
              onDelete: async (item) => { await deleteExpenseCategory(item.id); },
              deleteLabel: 'حذف',
            }),
            listCard('أسباب تسوية المخزون', 'sliders', reasons, {
              onAdd: async (name) => { await createReason(name); },
              onDelete: async (item) => { await deactivateReason(item.id); },
              deleteLabel: 'تعطيل',
              note: 'الأسباب المستخدمة في حركات مسجّلة تُعطَّل ولا تُحذف، حفاظاً على قابلية قراءة السجل التاريخي.',
            })
          );
        }

        function listCard(title, iconName, items, { onAdd, onDelete, deleteLabel, note }) {
          let input;

          return card({
            title,
            titleIcon: iconName,
            body: h('div', { class: 'stack' },
              note ? alertBox(note, 'info') : null,
              h('div', { class: 'chips' },
                ...items.map((item) =>
                  h('span', { class: 'chip', style: { cursor: 'default' } },
                    item.color
                      ? h('span', { class: 'badge__dot', style: { background: item.color, width: '9px', height: '9px' } })
                      : null,
                    h('span', { text: item.name }),
                    h('button', {
                      class: 'icon-btn',
                      style: { width: '24px', height: '24px' },
                      attrs: { type: 'button', 'aria-label': `${deleteLabel} ${item.name}` },
                      on: {
                        click: async () => {
                          const ok = await confirmDialog({
                            title: `${deleteLabel} "${item.name}"`,
                            message: `هل تريد ${deleteLabel} هذا العنصر؟`,
                            confirmLabel: deleteLabel,
                            tone: 'danger',
                          });
                          if (!ok) return;
                          try {
                            await onDelete(item);
                            toastOk('تم التنفيذ');
                            draw();
                          } catch (error) {
                            toastError(error.message);
                          }
                        },
                      },
                    }, icon('close'))
                  )
                ),
                items.length === 0 ? h('p', { class: 'field__hint', text: 'لا عناصر.' }) : null
              ),
              h('form', {
                class: 'row',
                on: {
                  submit: async (event) => {
                    event.preventDefault();
                    const name = input.value.trim();
                    if (!name) return;
                    try {
                      await onAdd(name);
                      input.value = '';
                      toastOk(`تمت إضافة "${name}"`);
                      draw();
                    } catch (error) {
                      toastError(error.message);
                    }
                  },
                },
              },
                h('input', {
                  class: 'input',
                  placeholder: 'اسم جديد',
                  style: { flex: '1' },
                  attrs: { 'aria-label': `إضافة إلى ${title}` },
                  ref: (el) => { input = el; },
                }),
                h('button', { class: 'btn btn--outline', attrs: { type: 'submit' } },
                  icon('plus'), h('span', { text: 'إضافة' }))
              )
            ),
          });
        }

        draw();
        return host;
      }

      /* --------------------------- البيانات والأوفلاين --------------------------- */

      function dataSection() {
        const usageRatio = storage?.quota > 0 ? storage.usage / storage.quota : 0;

        return h('div', { class: 'stack' },
          card({
            title: 'العمل دون اتصال',
            titleIcon: 'cloudUp',
            body: h('div', { class: 'stack' },
              capability.ok
                ? alertBox('التطبيق مؤهّل للعمل دون اتصال. بعد أول زيارة تُخزَّن ملفاته محلياً ويعمل بلا إنترنت.', 'ok')
                : alertBox(capability.message, 'warn'),
              h('div', { class: 'stack', style: { gap: '2px' } },
                settingRow('حالة Service Worker', swBadge()),
                settingRow('إصدار Cache', ltr(appState.get().cacheVersion || 'غير متاح')),
                settingRow('إصدار التطبيق', ltr(`v${APP_VERSION}`)),
                settingRow('إصدار مخطط البيانات', ltr(String(SCHEMA_VERSION))),
                settingRow('السياق آمن (HTTPS/localhost)', badge(window.isSecureContext ? 'نعم' : 'لا',
                  window.isSecureContext ? 'green' : 'red'))
              ),
              appState.get().updateAvailable
                ? h('div', { class: 'stack' },
                    alertBox('تحديث متاح — نسخة جديدة من التطبيق جاهزة للتفعيل.', 'info'),
                    h('button', {
                      class: 'btn btn--success',
                      attrs: { type: 'button' },
                      on: { click: () => applyUpdate() },
                    }, icon('refresh'), h('span', { text: 'تحديث الآن' }))
                  )
                : null
            ),
          }),

          card({
            title: 'مساحة التخزين المحلي',
            titleIcon: 'database',
            body: h('div', { class: 'stack' },
              storage?.quota
                ? h('div', { class: 'stack', style: { gap: '10px' } },
                    h('div', { class: 'row', style: { 'justify-content': 'space-between' } },
                      h('span', { class: 'field__hint' },
                        `${formatBytes(storage.usage)} من ${formatBytes(storage.quota)}`),
                      h('span', { style: { 'font-weight': '700' }, text: `${Math.round(usageRatio * 100)}%` })
                    ),
                    progressBar(usageRatio)
                  )
                : alertBox('تقدير مساحة التخزين غير متاح في هذا المتصفح.', 'warn'),

              settingRow('التخزين الدائم', badge(storage?.persisted ? 'مفعّل' : 'غير مفعّل',
                storage?.persisted ? 'green' : 'amber')),

              !storage?.persisted
                ? h('div', { class: 'stack' },
                    alertBox('بدون التخزين الدائم قد يحذف المتصفح البيانات عند ضغط مساحة الجهاز. التفعيل يتطلب نقرة منك.', 'warn'),
                    h('button', {
                      class: 'btn btn--outline',
                      attrs: { type: 'button' },
                      on: {
                        click: async () => {
                          const result = await requestPersistentStorage();
                          if (result.granted) toastOk(result.message);
                          else toastError(result.message);
                          refresh();
                        },
                      },
                    }, icon('shield'), h('span', { text: 'طلب تخزين دائم' }))
                  )
                : null
            ),
          }),

          card({
            title: 'النسخ الاحتياطي',
            titleIcon: 'shield',
            body: h('div', { class: 'stack' },
              fields.backupReminder.element,
              alertBox('بياناتك محفوظة في متصفح هذا الجهاز على هذا النطاق (Origin) فقط. مسح بيانات المتصفح أو استخدام متصفح آخر يعني عدم وجود البيانات. النسخ الاحتياطي مسؤولية تشغيلية أساسية.', 'warn'),
              h('a', { class: 'btn btn--navy', href: '#/backup' },
                icon('cloudUp'), h('span', { text: 'إدارة النسخ الاحتياطي' }))
            ),
          }),

          card({
            title: 'بيانات تجريبية',
            titleIcon: 'zap',
            body: h('div', { class: 'stack' },
              h('p', { class: 'field__hint', text: 'أضف منتجات وعملاء ومبيعات للتجربة. لا تفعل هذا على قاعدة بيانات حقيقية.' }),
              h('button', {
                class: 'btn btn--outline',
                attrs: { type: 'button' },
                on: {
                  click: async (event) => {
                    // احفظ المرجع قبل أي await — المتصفح يصفّر currentTarget بعد انتهاء الإرسال
                    const button = event.currentTarget;
                    if (!(await isEmptyDatabase())) {
                      const ok = await confirmDialog({
                        title: 'قاعدة البيانات غير فارغة',
                        message: 'ستُضاف بيانات تجريبية فوق بياناتك الحالية. يُنصح بإنشاء نسخة احتياطية أولاً.',
                        confirmLabel: 'إضافة على أي حال',
                        tone: 'danger',
                      });
                      if (!ok) return;
                    }
                    button.disabled = true;
                    try {
                      const result = await seedDemoData();
                      notifyDataChanged();
                      toastOk(`تمت إضافة ${result.products} منتجاً و${result.sales} فاتورة.`);
                      refresh();
                    } catch (error) {
                      toastError(error.message);
                      button.disabled = false;
                    }
                  },
                },
              }, icon('zap'), h('span', { text: 'إضافة بيانات تجريبية' }))
            ),
          })
        );
      }

      function settingRow(label, value) {
        return h('div', { class: 'detail-row' },
          h('span', { class: 'detail-row__label', text: label }),
          h('span', { class: 'detail-row__value' }, value)
        );
      }

      function swBadge() {
        const status = appState.get().swStatus;
        const map = {
          active: ['نشط', 'green'],
          unsupported: ['غير مدعوم', 'red'],
          insecure: ['يتطلب HTTPS', 'amber'],
          file: ['وضع الملف المحلي', 'amber'],
          failed: ['فشل التسجيل', 'red'],
          unknown: ['جارٍ الفحص', 'gray'],
        };
        const [label, tone] = map[status] || map.unknown;
        return badge(label, tone);
      }

      /* -------------------------------- الحفظ -------------------------------- */

      async function save() {
        for (const item of Object.values(fields)) item.setError(null);

        const storeName = fields.storeName.value.trim();
        if (!storeName) {
          fields.storeName.setError('اسم المتجر مطلوب');
          activeSection = 'general';
          drawAll();
          fields.storeName.focus();
          return;
        }

        const symbol = fields.currencySymbol.value.trim();
        if (!symbol) {
          fields.currencySymbol.setError('رمز العملة مطلوب');
          return;
        }

        const nextNumber = Number(fields.invoiceNextNumber.value);
        if (!Number.isInteger(nextNumber) || nextNumber < 1) {
          fields.invoiceNextNumber.setError('الرقم التالي يجب أن يكون عدداً صحيحاً أكبر من صفر');
          return;
        }

        const maxDiscount = Number(fields.maxDiscountPercent.value);
        if (!Number.isFinite(maxDiscount) || maxDiscount < 0 || maxDiscount > 100) {
          fields.maxDiscountPercent.setError('يجب أن يكون بين 0 و100');
          return;
        }

        const patch = {
          storeName,
          storePhone: fields.storePhone.value.trim(),
          storeEmail: fields.storeEmail.value.trim(),
          storeAddress: fields.storeAddress.value.trim(),
          storeCrNumber: fields.storeCrNumber.value.trim(),
          storeTaxNumber: fields.storeTaxNumber.value.trim(),
          currencyCode: fields.currencyCode.value,
          currencySymbol: symbol,
          currencyDecimalDigits: Math.max(0, Math.min(3, Number(fields.currencyDecimalDigits.value) || 0)),
          currencySymbolPosition: fields.currencySymbolPosition.value === 'before' ? 'before' : 'after',
          dateFormat: fields.dateFormat.value,
          invoicePrefix: fields.invoicePrefix.value.trim().toUpperCase() || 'INV',
          invoiceNextNumber: nextNumber,
          invoiceFooter: fields.invoiceFooter.value.trim(),
          printTemplate: fields.printTemplate.value,
          defaultTaxRateBp: percentToBp(fields.defaultTaxRate.value),
          maxDiscountPercent: maxDiscount,
          lowStockDefault: Number(fields.lowStockDefault.value) || 0,
          backupReminder: fields.backupReminder.value,
          taxInclusive: toggles.taxInclusive.checked,
          allowDiscount: toggles.allowDiscount.checked,
          allowNegativeStock: toggles.allowNegativeStock.checked,
        };

        try {
          await saveSettings(patch);
          appState.set({ settings: settings() });
          toastOk('تم حفظ الإعدادات');
          refresh();
        } catch (error) {
          toastError(`تعذّر الحفظ: ${error.message}`);
        }
      }

      /* -------------------------------- التركيب -------------------------------- */

      function drawNav() {
        renderInto(navHost, ...SECTIONS.map((section) =>
          h('button', {
            class: 'settings-nav__item',
            attrs: { type: 'button', 'aria-current': String(section.id === activeSection) },
            on: {
              click: () => {
                activeSection = section.id;
                drawAll();
              },
            },
          }, icon(section.icon), h('span', { text: section.label }))
        ));
      }

      function drawAll() {
        drawNav();
        renderInto(formHost, sectionContent());
      }

      drawAll();

      const statusPanel = h('div', { class: 'settings-layout__side stack' },
        card({
          title: 'حالة التطبيق',
          body: h('div', { class: 'stack', style: { gap: '2px' } },
            settingRow('Service Worker', swBadge()),
            settingRow('إصدار Cache', ltr(appState.get().cacheVersion || '—'))
          ),
        }),
        capability.ok
          ? card({
              body: h('div', { class: 'alert alert--ok', style: { border: 'none' } },
                icon('checkCircle'),
                h('div', null,
                  h('div', { style: { 'font-weight': '700', 'margin-bottom': '3px' }, text: 'جاهز دون اتصال' }),
                  h('div', { text: 'يمكنك متابعة العمل بلا إنترنت. كل البيانات محلية.' })
                )
              ),
            })
          : card({ body: alertBox(capability.message, 'warn') }),
        appState.get().updateAvailable
          ? card({
              title: 'تحديث متاح',
              titleIcon: 'arrowUp',
              body: h('div', { class: 'stack' },
                h('p', { class: 'field__hint' }, 'الإصدار الحالي: ', ltr(`v${APP_VERSION}`)),
                h('button', {
                  class: 'btn btn--success btn--block',
                  attrs: { type: 'button' },
                  on: { click: () => applyUpdate() },
                }, h('span', { text: 'تحديث الآن' }))
              ),
            })
          : null,
        storage?.quota
          ? card({
              title: 'مساحة التخزين المحلي',
              body: h('div', { class: 'stack', style: { gap: '10px' } },
                progressBar(storage.usage / storage.quota),
                h('p', { class: 'field__hint' },
                  `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)} (${Math.round((storage.usage / storage.quota) * 100)}%)`)
              ),
            })
          : null
      );

      return h('div', null,
        h('div', { class: 'settings-layout' },
          navHost,
          formHost,
          statusPanel
        ),
        h('div', { class: 'form-actions' },
          h('button', { class: 'btn btn--success', attrs: { type: 'button' }, on: { click: save } },
            icon('save'), h('span', { text: 'حفظ التغييرات' })),
          h('button', {
            class: 'btn btn--ghost',
            attrs: { type: 'button' },
            text: 'إلغاء',
            on: { click: () => refresh() },
          })
        )
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* ================================================================== */
  /* src/views/shifts.js */
  __def("src/views/shifts.js", function (__exports, __m, __dyn) {
    const { h, ltr } = __m("src/utils/dom.js");
    const { card, kpi, kpiGrid, detailRow, field, alertBox } = __m("src/components/ui.js");
    const { openModal, toastOk, toastError } = __m("src/components/feedback.js");
    const { currentShift, listShifts, openShift, closeShift, shiftSummary } = __m("src/repositories/shifts.js");
    const { settings } = __m("src/repositories/settings.js");
    const { formatAmount } = __m("src/utils/format.js");
    const { toMinor, toMajor } = __m("src/utils/money.js");
    const { formatDateTime } = __m("src/utils/dates.js");
    const { notifyDataChanged } = __m("src/state/store.js");
    const { refresh } = __m("src/router.js");

    async function render() {
      const s = settings(); const symbol = s.currencySymbol;
      const [shift, history] = await Promise.all([currentShift(), listShifts()]);
      const summary = await shiftSummary(shift);
      const money = (minor) => h('span', null, ltr(formatAmount(minor)), ` ${symbol}`);
      function openStart() {
        const amount = field({ label: 'الرصيد الافتتاحي', name: 'opening', value: '0', suffix: symbol });
        const cashier = field({ label: 'اسم الكاشير', name: 'cashier', placeholder: 'اختياري' });
        const modal = openModal({ title: 'فتح وردية', body: [amount.element, cashier.element], footer: [
          h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'فتح الوردية', on: { click: async () => { try { await openShift({ openingMinor: toMinor(amount.value || '0'), cashierName: cashier.value }); modal.close(); notifyDataChanged(); toastOk('تم فتح الوردية'); refresh(); } catch (e) { toastError(e.message); } } } }),
          h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
        ] });
      }
      function openClose() {
        const counted = field({ label: 'المبلغ النقدي الفعلي', name: 'counted', value: String(toMajor(summary.expectedMinor)), suffix: symbol });
        const note = field({ label: 'ملاحظة الإغلاق', name: 'note', rows: 2 });
        const modal = openModal({ title: 'إغلاق الوردية', body: [alertBox(`الرصيد المتوقع: ${formatAmount(summary.expectedMinor)} ${symbol}`, 'info'), counted.element, note.element], footer: [
          h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: 'إغلاق واعتماد', on: { click: async () => { try { const result = await closeShift({ shiftId: shift.id, countedMinor: toMinor(counted.value || '0'), note: note.value }); modal.close(); notifyDataChanged(); toastOk(`أغلقت الوردية، الفرق ${formatAmount(result.shift.differenceMinor)} ${symbol}`); refresh(); } catch (e) { toastError(e.message); } } } }),
          h('button', { class: 'btn btn--ghost', attrs: { type: 'button' }, text: 'إلغاء', on: { click: () => modal.close() } }),
        ] });
      }
      return h('div', { class: 'stack' },
        h('div', { class: 'page__head' }, h('div', null, h('h2', { text: 'الورديات والصندوق' }), h('p', { text: 'متابعة النقدية الفعلية ومطابقتها مع الحركات المسجلة.' })), h('button', { class: 'btn btn--success', attrs: { type: 'button' }, text: shift ? 'إغلاق الوردية' : 'فتح وردية', on: { click: shift ? openClose : openStart } })),
        shift ? kpiGrid(kpi({ label: 'الرصيد المتوقع', value: formatAmount(summary.expectedMinor), unit: symbol, tone: 'green', iconName: 'cash' }), kpi({ label: 'مبيعات نقدية', value: formatAmount(summary.cashSalesMinor), unit: symbol, tone: 'blue', iconName: 'invoices' }), kpi({ label: 'مصروفات نقدية', value: formatAmount(summary.cashExpensesMinor), unit: symbol, tone: 'amber', iconName: 'expenses' })) : alertBox('لا توجد وردية مفتوحة. افتح وردية قبل بدء عمل الكاشير.', 'info'),
        shift ? card({ title: 'حركة الوردية الحالية', body: h('div', { class: 'stack' }, detailRow('فُتحت في', ltr(formatDateTime(shift.openedAt, s.dateFormat))), detailRow('الرصيد الافتتاحي', money(shift.openingMinor)), detailRow('تحصيلات العملاء النقدية', money(summary.customerCashMinor)), detailRow('الرصد المتوقع', money(summary.expectedMinor))) }) : null,
        card({ title: 'سجل الورديات', body: h('div', { class: 'stack' }, ...history.map((item) => detailRow(`${item.status === 'open' ? 'وردية مفتوحة' : 'وردية مغلقة'} — ${formatDateTime(item.openedAt, s.dateFormat)}`, item.status === 'closed' ? money(item.differenceMinor) : 'قيد العمل'))) })
      );
    }


    Object.defineProperty(__exports, "render", { enumerable: true, get: function () { return render; } });
  });

  /* نقطة الدخول */
  __m("src/app.js");
}());
