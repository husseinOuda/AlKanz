/** تسجيل مسارات التطبيق. الشاشات تُحمَّل ديناميكياً لتقصير أول رسم. */

import { route, setNotFound } from './router.js';
import { h } from './utils/dom.js';
import { emptyState } from './components/ui.js';
import { icon } from './components/icons.js';

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

export function registerRoutes() {
  route('/dashboard', screen(() => import('./views/dashboard.js')), { title: 'لوحة التحكم' });
  route('/pos', screen(() => import('./views/pos.js')), { title: 'نقطة البيع' });

  route('/products', screen(() => import('./views/products.js')), { title: 'المنتجات' });
  route('/products/new', screen(() => import('./views/product-form.js')), { title: 'إضافة منتج جديد' });
  route('/products/:id/edit', screen(() => import('./views/product-form.js')), { title: 'تعديل المنتج' });
  route('/products/:id', screen(() => import('./views/product-form.js'), 'renderView'), { title: 'تفاصيل المنتج' });

  route('/inventory', screen(() => import('./views/inventory.js')), { title: 'المخزون' });
  route('/reorder', screen(() => import('./views/reorder.js')), { title: 'المنتجات المطلوب شراؤها' });
  route('/purchases', screen(() => import('./views/purchases.js')), { title: 'الموردون والمشتريات' });

  route('/invoices', screen(() => import('./views/invoices.js')), { title: 'الفواتير' });
  route('/invoices/:id', screen(() => import('./views/invoice-detail.js')), { title: 'تفاصيل الفاتورة' });

  route('/customers', screen(() => import('./views/customers.js')), { title: 'العملاء' });
  route('/customers/:id', screen(() => import('./views/customers.js'), 'renderStatement'), { title: 'كشف حساب العميل' });

  route('/expenses', screen(() => import('./views/expenses.js')), { title: 'المصروفات' });
  route('/shifts', screen(() => import('./views/shifts.js')), { title: 'الورديات والصندوق' });
  route('/notifications', screen(() => import('./views/notifications.js')), { title: 'مركز الإشعارات' });
  route('/reports', screen(() => import('./views/reports.js')), { title: 'التقارير' });
  route('/backup', screen(() => import('./views/backup.js')), { title: 'النسخ الاحتياطي' });
  route('/settings', screen(() => import('./views/settings.js')), { title: 'الإعدادات' });

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
