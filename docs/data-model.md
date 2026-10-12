# نموذج البيانات

قاعدة البيانات: **IndexedDB** باسم `sales-system`، الإصدار الحالي **5**.
التعريف في [`src/db/schema.js`](../src/db/schema.js).

## مبادئ عامة

1. **المال بوحدات صغرى صحيحة.** كل حقل ينتهي بـ `Minor` هو عدد صحيح من القروش/الهللات.
   لا يوجد أي عدد عشري في التخزين أو الحساب.
2. **النِّسب بنقاط الأساس.** كل حقل ينتهي بـ `Bp` عدد صحيح، و1% = 100 نقطة.
   15% ⇒ `taxRateBp: 1500`.
3. **المعرّفات مستقرة ونصية**: `uid()` يولّد UUID v4 ببادئة نوعية (`prd_`, `sal_`, `cus_`…).
   لا تُستخدم مفاتيح تلقائية متزايدة حتى تبقى المعرّفات صالحة بعد الاستعادة.
4. **التواريخ مزدوجة**: `createdAt` بصيغة ISO (UTC) للترتيب الدقيق، و`dayKey` بصيغة
   `YYYY-MM-DD` **باليوم المحلي** للتقارير. بدون `dayKey` المحلي تنقسم مبيعات المساء
   على يومين في التقارير.
5. **اللقطات التاريخية**: أي سجل مالي يخزّن نسخة من القيم التي أثّرت عليه وقت إنشائه.

---

## الكيانات

### `products`

تُستخدم `reorderPoint` لتحديد المنتجات في تقرير المطلوب شراؤها. كمية الاقتراح هي الفرق بين المخزون الحالي والحد الأقصى؛ وإذا لم يُحدد حد أقصى، تُستخدم نقطة إعادة الطلب كهدف.

| الحقل | النوع | ملاحظات |
|---|---|---|
| `id` | string | مفتاح رئيسي |
| `sku` | string | **فهرس فريد** — بحروف كبيرة موحّدة |
| `barcode` | string \| undefined | **فهرس فريد**؛ `undefined` لا يدخل الفهرس فيمكن تركه فارغاً لعدة منتجات |
| `name` | string | |
| `nameLower` | string | فهرس — بحث غير حسّاس لحالة الأحرف (أُضيف في الإصدار 2) |
| `categoryId` | string | فهرس → `categories.id` |
| `unit` | string | قطعة، عبوة، كجم… |
| `costMinor` | int | سعر الشراء |
| `priceMinor` | int | سعر البيع |
| `taxRateBp` | int | 0–10000 |
| `quantity` | int | **لا يُكتب إلا عبر `applyMovement`** |
| `lowStockThreshold` | int | حد قديم للتوافق مع البيانات السابقة |
| `minimumStock` / `maximumStock` | int | مستويات الحد الأدنى والأقصى؛ 0 للحد الأقصى يعني غير محدد |
| `reorderPoint` | int | عنده يظهر تنبيه إعادة الطلب |
| `description` | string | ≤ 500 |
| `image` | string \| null | data URL مصغّرة (JPEG ≤ ~60KB) |
| `isActive` | boolean | التعطيل بديل الحذف |
| `createdAt` / `updatedAt` | ISO | |

الفهارس: `sku`(فريد)، `barcode`(فريد)، `categoryId`، `name`، `nameLower`، `createdAt`.

### `categories`

`id`, `name` (**فهرس فريد**), `color`, `icon`, `sortOrder`, `createdAt`.

### `customers`

`id`, `name`, `phone`, `note`, `isActive`, `createdAt`, `updatedAt`.
الفهارس: `name`، `phone`، `createdAt`.

> **لا يوجد حقل رصيد.** الرصيد محسوب — انظر §«الذمم» أدناه.

### `sales`

| الحقل | النوع | ملاحظات |
|---|---|---|
| `id` | string | |
| `number` | string | **فهرس فريد** — `INV-2026-00126` |
| `status` | string | `completed` \| `cancelled` |
| `paymentType` | string | `cash` \| `credit` |
| `customerId` | string \| null | فهرس؛ `null` = عميل نقدي |
| `customerName` | string | **لقطة** الاسم وقت البيع |
| `subtotalMinor` | int | مجموع السطور قبل الخصم |
| `discountType` / `discountValue` | string / int | `percent` (نقاط أساس) أو `amount` (وحدة صغرى) |
| `discountMinor` | int | الخصم المحتسب فعلياً |
| `taxRateBp` | int | **لقطة** النسبة وقت البيع |
| `taxInclusive` | boolean | **لقطة** السياسة وقت البيع |
| `taxMinor` | int | |
| `totalMinor` | int | |
| `paidMinor` / `dueMinor` | int | `due = total − paid`؛ يُصفَّر عند الإلغاء |
| `itemCount` / `unitCount` | int | |
| `costMinor` | int | تكلفة البضاعة المباعة (مجمّعة من اللقطات) |
| `note` | string | |
| `createdAt` / `updatedAt` / `dayKey` | | |
| `cancelledAt` / `cancelReason` | ISO \| null / string \| null | |

الفهارس: `number`(فريد)، `dayKey`، `customerId`، `status`، `createdAt`.

### `saleItems`

| الحقل | ملاحظات |
|---|---|
| `id`, `saleId`(فهرس), `productId`(فهرس) | |
| `sku`, `name`, `unit` | **لقطات** — تغييرها على المنتج لا يمسّ الفاتورة |
| `quantity` | int |
| `unitPriceMinor` | **لقطة** سعر البيع |
| `unitCostMinor` | **لقطة سعر الشراء** — أساس حساب الربح التاريخي |
| `lineDiscountMinor` | نصيب السطر من خصم الفاتورة (توزيع تناسبي بلا فقد فلس) |
| `lineTotalMinor` | `gross − lineDiscount` |
| `dayKey`(فهرس), `createdAt` | |

### `payments`

`id`, `customerId`(فهرس), `saleId`(فهرس, غالباً `null`), `amountMinor`, `method`,
`reference`, `note`, `createdAt`(فهرس), `dayKey`(فهرس — أُضيف في الإصدار 2).

### `expenses`

`id`, `dayKey`(فهرس), `categoryId`(فهرس), `title`, `amountMinor`, `method`,
`reference`, `note`, `attachment`, `createdAt`(فهرس), `updatedAt`.

`attachment` = `{ dataUrl, name, type, bytes } | null` — صورة مصغّرة أو PDF ≤ 5MB.

### `expenseCategories`

`id`, `name`(**فهرس فريد**), `color`, `createdAt`.

### `inventoryMovements`

**السجل المرجعي للمخزون.** لا يُحذف منه شيء أبداً.

| الحقل | ملاحظات |
|---|---|
| `id`, `productId`(فهرس) | |
| `sku`, `productName` | لقطات لقراءة السجل بعد حذف المنتج |
| `type`(فهرس) | `initial` \| `in` \| `out` \| `sale` \| `cancel` \| `count` \| `damage` \| `return` |
| `quantity` | **موقّع**: موجب إضافة، سالب سحب |
| `balanceAfter` | الرصيد بعد الحركة — يجعل السجل قابلاً للتدقيق مباشرة |
| `reason` | إلزامي في التسويات اليدوية |
| `note` | ≤ 200 |
| `refType` / `refId`(فهرس) | `sale` / `adjustment` / `stocktake` / `product-form`… |
| `actor` | «المستخدم» أو «النظام» |
| `createdAt`(فهرس), `dayKey`(فهرس) | |

**الثابت البنيوي:** لكل منتج، `quantity = Σ(movements.quantity)`.
مضمون لأن `applyMovement` هو المسار الوحيد الذي يكتب `quantity`، ويكتب الحركة في نفس المعاملة.

### `adjustmentReasons` *(أُضيف في الإصدار 2)*

`id`, `name`(**فهرس فريد**), `isActive`, `system`, `createdAt`.
السبب المستخدم في حركة يُعطَّل ولا يُحذف.

### `suspendedSales`

`id`, `label`, `customerId`, `customerName`, `lines[]`, `discount`, `itemCount`,
`totalMinor`, `createdAt`(فهرس). **لا يحجز مخزوناً.**

### `settings`

صفوف `{ key, value }`. المفاتيح الرئيسية:

| المجموعة | المفاتيح |
|---|---|
| المتجر | `storeName`, `storePhone`, `storeEmail`, `storeAddress`, `storeCrNumber`, `storeTaxNumber` |
| العملة والتاريخ | `currencyCode`, `currencySymbol`, `dateFormat` |
| الفواتير | `invoicePrefix`, `invoiceIncludeYear`, `invoiceNextNumber`, `invoiceFooter`, `printTemplate` |
| الضريبة والخصم | `defaultTaxRateBp`, `taxInclusive`, `allowDiscount`, `maxDiscountPercent` |
| المخزون | `allowNegativeStock`, `lowStockDefault` |
| النسخ | `backupReminder`, `lastBackupAt` |
| النظام | `seeded`, `appVersion`, `schemaVersion` |

`invoiceNextNumber` يُقرأ ويُزاد **داخل معاملة البيع** لضمان عدم تكرار الرقم.

### `backupRecords`

`id`, `fileName`, `kind` (`manual` \| `auto-pre-restore`), `createdAt`(فهرس), `dayKey`,
`sizeBytes`, `schemaVersion`, `appVersion`, `counts`, `status`, `payload`.

يُحتفظ بآخر **5** نسخ ويُقلَّم الأقدم تلقائياً. هذا المتجر **لا يُستورد** من ملف النسخة.

---

### الموردون والمشتريات (أُضيفت في الإصدار 5)

`suppliers` تحفظ بيانات الاتصال، والذمة محسوبة من فواتير الشراء ناقص الدفعات. `purchaseOrders` تحفظ المسودات/أوامر الشراء قبل الاستلام. عند الاستلام تُنشأ `purchases` و`purchaseItems` والدفعات، وتُحدَّث كمية المخزون عبر `applyMovement` وتكلفة المنتج في معاملة ذرّية واحدة.

## العلاقات

```
categories ──< products ──< saleItems >── sales >── customers
                  │                        │           │
                  └──< inventoryMovements  │           └──< payments
                                           │
expenseCategories ──< expenses             └── (refId في inventoryMovements)
```

كلها علاقات منطقية على مستوى التطبيق — IndexedDB لا يفرض مفاتيح أجنبية.
الفحص المرجعي يُطبَّق في التحقق (منع الحذف عند الارتباط) وفي فحص ملف النسخة قبل الاستعادة.

---

## الذمم — الرصيد محسوب

```
رصيد العميل = Σ(sales.dueMinor حيث customerId = X و status ≠ cancelled)
            − Σ(payments.amountMinor حيث customerId = X)
```

يُنفَّذ في `customerLedgers()` بمسح واحد على `sales` و`payments`.
لا يوجد رقم رصيد محفوظ يمكن أن ينحرف عن الحركات.

---

## الترقيات

| الإصدار | التغيير | ترحيل البيانات |
|---|---|---|
| 1 | إنشاء كل المتاجر الأساسية والفهارس | — |
| 2 | متجر `adjustmentReasons`؛ فهرس `dayKey` على `payments`؛ فهرس `nameLower` على `products` | تعبئة `nameLower` لكل المنتجات القائمة عبر مؤشر داخل معاملة `versionchange` |

قواعد كتابة الترقيات:
- كل إصدار دالة واحدة تنتقل من (الإصدار−1) إليه، وتُشغَّل بالتسلسل.
- لا يجوز داخلها انتظار أي وعد غير مرتبط بطلب IndexedDB.
- إضافة متجر أو فهرس تُفحص أولاً بـ `contains()` لتكون العملية idempotent.

اختبار `tests/backup.test.js` يفتح قاعدة على الإصدار 1، يكتب سجلاً بالشكل القديم،
ثم يفتحها على الإصدار الحالي ويتحقق أن السجل بقي وأن `nameLower` عُبِّئ والفهارس أُنشئت.

---

## بنية ملف النسخة الاحتياطية

```json
{
  "format": "sales-system-backup",
  "schemaVersion": 2,
  "appVersion": "1.0.3",
  "exportedAt": "2026-08-04T12:34:56.789Z",
  "counts": { "products": 18, "sales": 25, "...": 0 },
  "data": {
    "products": [ ... ], "categories": [ ... ], "customers": [ ... ],
    "sales": [ ... ], "saleItems": [ ... ], "payments": [ ... ],
    "expenses": [ ... ], "expenseCategories": [ ... ],
    "inventoryMovements": [ ... ], "suspendedSales": [ ... ],
    "adjustmentReasons": [ ... ], "settings": [ ... ], "backupRecords": [ ... ]
  }
}
```

قواعد التوافق:
- `schemaVersion` **أكبر** من إصدار التطبيق ⇒ **رفض** (لا نخمّن حقولاً مستقبلية).
- `schemaVersion` **أصغر** ⇒ يُقبل مع تحذير، وتتولّى ترقيات IndexedDB الباقي.
- متجر مفقود من الملف ⇒ يبدأ فارغاً (يحدث عند استعادة نسخة أقدم من إضافة المتجر).
