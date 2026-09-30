/**
 * LRU overlay bitmap cache keyed by content_hash.
 *
 * Evicts and closes ImageBitmap entries when capacity is exceeded.
 * Does not invent placeholders for missing hashes.
 */

export type OverlayCacheBitmap = ImageBitmap | HTMLImageElement;

export interface OverlayCacheEntry {
  readonly bitmap: OverlayCacheBitmap;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_MAX_ENTRIES = 8;

function isImageBitmap(bitmap: OverlayCacheBitmap): bitmap is ImageBitmap {
  return typeof (bitmap as ImageBitmap).close === 'function';
}

function closeBitmap(bitmap: OverlayCacheBitmap): void {
  if (isImageBitmap(bitmap)) {
    try {
      bitmap.close();
    } catch {
      // Already closed or non-browser host — ignore.
    }
  }
}

export class OverlayBitmapCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, OverlayCacheEntry>();

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.#maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  get size(): number {
    return this.#entries.size;
  }

  get(contentHash: string): OverlayCacheEntry | null {
    if (!contentHash) return null;
    const entry = this.#entries.get(contentHash);
    if (!entry) return null;
    // Refresh LRU order: delete + re-insert moves to end (most recent).
    this.#entries.delete(contentHash);
    this.#entries.set(contentHash, entry);
    return entry;
  }

  set(contentHash: string, entry: OverlayCacheEntry): void {
    if (!contentHash || entry.width <= 0 || entry.height <= 0) return;
    const existing = this.#entries.get(contentHash);
    if (existing && existing.bitmap !== entry.bitmap) {
      closeBitmap(existing.bitmap);
    }
    this.#entries.delete(contentHash);
    this.#entries.set(contentHash, entry);
    this.#evictIfNeeded();
  }

  has(contentHash: string): boolean {
    return Boolean(contentHash) && this.#entries.has(contentHash);
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      closeBitmap(entry.bitmap);
    }
    this.#entries.clear();
  }

  /** Evict a single hash without closing if the caller still owns the bitmap. */
  delete(contentHash: string, options?: { readonly close?: boolean }): boolean {
    const entry = this.#entries.get(contentHash);
    if (!entry) return false;
    this.#entries.delete(contentHash);
    if (options?.close !== false) {
      closeBitmap(entry.bitmap);
    }
    return true;
  }

  #evictIfNeeded(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.#entries.get(oldest);
      this.#entries.delete(oldest);
      if (entry) closeBitmap(entry.bitmap);
    }
  }
}
