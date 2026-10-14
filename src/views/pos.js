/** نقطة البيع — مرجع: UI/02-pos.png و UI/13-mobile-pos-draft.png */

import { h, render as renderInto, ltr, debounce } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { card, badge, emptyState, searchField, chipGroup, field } from '../components/ui.js';
import { openModal, openPanel, toastOk, toastError, toastWarn, confirmDialog } from '../components/feedback.js';
import { listProducts, listCategories, stockStatus, STOCK_LABEL, STOCK_TONE, STOCK_STATUS } from '../repositories/products.js';
import { listCustomers, WALK_IN } from '../repositories/customers.js';
import { completeSale, suspendSale, listSuspended, resumeSuspended, deleteSuspended, PAYMENT_TYPE } from '../repositories/sales.js';
import { settings } from '../repositories/settings.js';
import { cartState, cartActions, notifyDataChanged, appState } from '../state/store.js';
import { computeTotals, toMinor, percentToBp, bpToPercent } from '../utils/money.js';
import { formatAmount, itemsLabel, initials } from '../utils/format.js';
import { formatDateTime } from '../utils/dates.js';
import { printInvoice } from '../services/print.js';
import { navigate } from '../router.js';

export async function render(context) {
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

  const unsubscribe = cartState.subscribe(drawCart);
  context?.onCleanup?.(() => {
    unsubscribe();
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
