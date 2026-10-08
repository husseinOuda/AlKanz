/**
 * تجميع بيانات لوحة التحكم والتقارير.
 *
 * كل الأرقام مشتقّة من السجلات الفعلية. لا توجد قيم ثابتة أو تقديرية.
 * الفواتير الملغاة مستبعدة من كل مقاييس الإيراد والربح.
 */

import { salesInRange, saleItemsInRange, SALE_STATUS } from '../repositories/sales.js';
import { expensesInRange } from '../repositories/expenses.js';
import { paymentsInRange } from '../repositories/customers.js';
import { listProducts, stockStatus, STOCK_STATUS, categoryMap } from '../repositories/products.js';
import { movementsInRange } from '../repositories/inventory.js';
import { expenseCategoryMap } from '../repositories/expenses.js';
import { dayRange, dayKey, previousRange, relativeDayLabel } from '../utils/dates.js';
import { returnsInRange } from '../repositories/returns.js';

const isCounted = (sale) => sale.status !== SALE_STATUS.CANCELLED;

/**
 * يجمع كل ما تحتاجه شاشة تقرير أو لوحة تحكم لفترة معيّنة، بقراءة واحدة.
 */
export async function periodSummary(fromKey, toKey) {
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
export function dailySeries(summary) {
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
export function topProducts(summary, limit = 10) {
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
export async function stagnantProducts(days = 60) {
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
export async function salesByCategory(summary) {
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
export async function expensesByCategory(summary) {
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
export function paymentMethods(summary) {
  return [
    { label: 'نقدي', value: summary.cashMinor, color: '#12855A' },
    { label: 'آجل', value: summary.creditMinor, color: '#1B63E3' },
  ].filter((slice) => slice.value > 0);
}

/** تقرير المخزون المنخفض والمنعدم */
export async function stockReport() {
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
export async function movementReport(fromKey, toKey) {
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
export async function dashboardData() {
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
export async function compareWithPrevious(fromKey, toKey) {
  const previous = previousRange(fromKey, toKey);
  const [current, prior] = await Promise.all([
    periodSummary(fromKey, toKey),
    periodSummary(previous.from, previous.to),
  ]);
  return { current, prior, previousRange: previous };
}
