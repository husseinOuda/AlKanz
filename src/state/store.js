/**
 * مخزن حالة صغير مع اشتراكات وتنظيف.
 * لا يُستخدم لتخزين بيانات العمل (تلك في IndexedDB) بل لحالة الواجهة المشتركة:
 * العربة، حالة الاتصال، الإعدادات المحمّلة، وحالة Service Worker.
 */

export function createStore(initialState = {}) {
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

export const appState = createStore({
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
export function notifyDataChanged() {
  appState.set((state) => ({ dataVersion: state.dataVersion + 1 }));
}

/* ------------------------------------------------------------------ */
/* عربة نقطة البيع                                                      */
/* ------------------------------------------------------------------ */

export const cartState = createStore({
  lines: [],                                  // {productId, name, sku, unit, unitPriceMinor, quantity, stock}
  customer: { id: null, name: 'عميل نقدي' },
  discount: { type: 'amount', value: 0 },
  paymentType: 'cash',
  note: '',
});

export const cartActions = {
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
