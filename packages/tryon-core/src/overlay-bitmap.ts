import { OVERLAY_MIME_TYPES } from './garment-asset';
import { matchesContentHash, type DigestFn } from './overlay-integrity';

export interface OverlayBitmapLoadResult {
  readonly bitmap: ImageBitmap | HTMLImageElement;
  readonly width: number;
  readonly height: number;
}

/**
 * Loads a transparent overlay image for the kiosk canvas.
 *
 * Returns null when the bytes cannot be decoded, are not PNG/WebP, or fail
 * an optional content_hash check. Does not invent a placeholder product image.
 */
export async function loadOverlayBitmap(
  url: string,
  options?: {
    readonly fetchFn?: typeof fetch;
    readonly createImageBitmapFn?: typeof createImageBitmap;
    /** When set, downloaded bytes must SHA-256 to this lowercase hex digest. */
    readonly expectedContentHash?: string;
    readonly digestFn?: DigestFn;
  },
): Promise<OverlayBitmapLoadResult | null> {
  if (!url || typeof url !== 'string') return null;
  const fetchFn = options?.fetchFn ?? fetch;
  const createBitmap = options?.createImageBitmapFn ?? defaultCreateImageBitmap();

  try {
    const response = await fetchFn(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (mime && !OVERLAY_MIME_TYPES.includes(mime as (typeof OVERLAY_MIME_TYPES)[number])) {
      return null;
    }
    const blob = await response.blob();
    if (blob.size <= 0) return null;
    const blobType = blob.type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (blobType && !OVERLAY_MIME_TYPES.includes(blobType as (typeof OVERLAY_MIME_TYPES)[number])) {
      return null;
    }

    if (options?.expectedContentHash) {
      const buffer = await blob.arrayBuffer();
      const ok = await matchesContentHash(buffer, options.expectedContentHash, options.digestFn);
      if (!ok) return null;
    }

    if (createBitmap) {
      const bitmap = await createBitmap(blob);
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        bitmap.close?.();
        return null;
      }
      return { bitmap, width: bitmap.width, height: bitmap.height };
    }

    return await decodeViaImageElement(blob);
  } catch {
    return null;
  }
}

function defaultCreateImageBitmap(): typeof createImageBitmap | null {
  if (typeof createImageBitmap === 'function') return createImageBitmap;
  return null;
}

function decodeViaImageElement(blob: Blob): Promise<OverlayBitmapLoadResult | null> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve(null);
  }
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        resolve(null);
        return;
      }
      resolve({
        bitmap: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}
