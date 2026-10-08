/** تقرير المنتجات التي وصلت إلى نقطة إعادة الطلب. */
import { h } from '../utils/dom.js';
import { dataTable } from '../components/table.js';
import { card, badge } from '../components/ui.js';
import { productsToReorder, stockStatus, STOCK_TONE } from '../repositories/products.js';
import { formatInt } from '../utils/format.js';
import { navigate } from '../router.js';

export async function render() {
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
