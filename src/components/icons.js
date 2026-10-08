/**
 * أيقونات SVG مضمّنة.
 * سبب عدم استخدام مكتبة أيقونات خارجية موثّق في docs/design-decisions.md:
 * نحتاج ~60 أيقونة فقط، ومجموعة كاملة تعني ملفاً محلياً أكبر بكثير بلا فائدة.
 * كل الأيقونات بنمط stroke على شبكة 24×24.
 */

import { h } from '../utils/dom.js';

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
export function icon(name, options = {}) {
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

export const hasIcon = (name) => Boolean(PATHS[ALIASES[name] || name]);
