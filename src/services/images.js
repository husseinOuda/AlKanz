/**
 * معالجة الصور المرفوعة.
 * الصور تُصغَّر قبل التخزين: صورة 5MB تصبح ~60KB، فلا تستهلك حصة التخزين
 * ولا تُثقل ملف النسخة الاحتياطية. تُخزَّن كـ data URL لتبقى النسخة الاحتياطية
 * JSON صالحاً بلا ترميز إضافي.
 */

import { validateFile, IMAGE_TYPES, ATTACHMENT_TYPES, LIMITS } from '../validation/validators.js';

const MAX_EDGE = 600;
const QUALITY = 0.82;

/**
 * يتحقق من صورة ويصغّرها ويحوّلها إلى data URL.
 * @param {File} file
 * @returns {Promise<{dataUrl:string, width:number, height:number, bytes:number, name:string}>}
 */
export async function processImage(file) {
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
export async function processAttachment(file) {
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

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    reader.readAsText(file, 'utf-8');
  });
}

/** يتحقق أن نصاً هو data URL لصورة قبل عرضه (حماية من مدخلات نسخة احتياطية معدّلة) */
export function isSafeImageDataUrl(value) {
  return typeof value === 'string'
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)
    && value.length < 12_000_000;
}

export function isSafeAttachmentDataUrl(value) {
  return typeof value === 'string'
    && /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/.test(value)
    && value.length < 12_000_000;
}
