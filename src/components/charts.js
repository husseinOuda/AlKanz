/**
 * مخططات SVG مكتوبة يدوياً.
 * القرار موثّق في docs/design-decisions.md: نحتاج ثلاثة أنواع فقط
 * (خطي بمساحة، دائري مفرّغ، أعمدة مجمّعة)، وكتابتها بـ SVG أصغر بكثير من
 * تضمين مكتبة رسوم كاملة، وتعطي تحكماً كاملاً في الاتجاه والوصولية.
 *
 * المخططات تُرسم بمحاور LTR (الأقدم يساراً والأحدث يميناً) مطابقةً للصور المرجعية،
 * بينما تبقى النصوص والأساطير عربية RTL.
 */

import { h } from '../utils/dom.js';
import { formatCompact, formatAmount } from '../utils/format.js';

export const CHART_COLORS = [
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
export function lineChart({
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
export function donutChart({ slices, title = 'مخطط دائري', size = 220, showPercentInside = true }) {
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
export function barChart({
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
export function chartLegend(items) {
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
export function inlineLegend(items) {
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
export const chartWithLegend = (chart, legend) =>
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
export function chartAccessibleTable(title, rows) {
  return h('table', { class: 'sr-only' },
    h('caption', { text: title }),
    h('tbody', null,
      ...rows.map(([label, value]) =>
        h('tr', null, h('td', { text: label }), h('td', { text: String(value) }))
      )
    )
  );
}
