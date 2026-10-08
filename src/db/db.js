/**
 * طبقة الوصول إلى IndexedDB.
 *
 * قاعدة حرجة (موثّقة في MDN — IDBTransaction):
 * المعاملة تلتزم تلقائياً عندما تصبح خاملة. انتظار وعد مرتبط بطلب IndexedDB
 * آمن لأن الوعد يُحلّ داخل مهمة معالج success. أما انتظار أي شيء آخر
 * (fetch أو setTimeout أو FileReader) داخل معاملة فيؤدي إلى التزامها قبل
 * اكتمال العمل. لذلك: كل التحويلات غير المتزامنة تتم **قبل** فتح المعاملة.
 */

import { DB_NAME, SCHEMA_VERSION, runMigrations } from './schema.js';

let dbPromise = null;
let dbName = DB_NAME;

/** يسمح للاختبارات بالعمل على قاعدة معزولة */
export function configureDatabase(name) {
  dbName = name;
  dbPromise = null;
}

export function currentDatabaseName() {
  return dbName;
}

/** يحوّل IDBRequest إلى Promise */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDB(version = SCHEMA_VERSION, name = dbName) {
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

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export async function closeDB() {
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
export async function tx(storeNames, mode, work) {
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

export const get = (store, key) => req(store.get(key));
export const getAll = (store, query, count) => req(store.getAll(query, count));
export const put = (store, value) => req(store.put(value));
export const add = (store, value) => req(store.add(value));
export const del = (store, key) => req(store.delete(key));
export const count = (store, query) => req(store.count(query));
export const clearStore = (store) => req(store.clear());

export const getByIndex = (store, indexName, key) => req(store.index(indexName).get(key));
export const getAllByIndex = (store, indexName, query, limit) =>
  req(store.index(indexName).getAll(query, limit));
export const countByIndex = (store, indexName, query) => req(store.index(indexName).count(query));

/**
 * يمرّ على سجلات (أو فهرس) ويستدعي `visit` لكل سجل.
 * أرجع `false` من `visit` لإيقاف المرور مبكراً.
 */
export function iterate(source, query, visit, direction = 'next') {
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
export async function pageByIndex(store, indexName, {
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
export async function deleteDatabase(name = dbName) {
  await closeDB();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('تعذّر حذف قاعدة البيانات لأنها مفتوحة في نافذة أخرى.'));
  });
}
