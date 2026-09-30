import { formatCatalogPrice } from './catalog-browse';

/**
 * Public product fields safe to put in a WhatsApp / share message.
 * Never include storage paths, signed URLs, device secrets, or org ids.
 */
export interface ShareableProduct {
  readonly name: string;
  readonly category: string;
  readonly colorName: string;
  readonly brand: string | null;
  readonly size: string | null;
  readonly priceMinor: number | null;
  readonly currencyCode: string | null;
  /** Public catalog garment id used as a shop floor reference — not a storage key. */
  readonly garmentId: string;
  readonly variantId: string;
  readonly isTestFixture?: boolean;
}

export type ProductShareChannel = 'whatsapp' | 'clipboard' | 'web_share' | 'none';

export interface ProductShareResult {
  readonly ok: boolean;
  readonly channel: ProductShareChannel;
  readonly url: string | null;
  readonly text: string;
  readonly error: string | null;
}

/** Strip control characters that can break deep links or paste targets. */
export function sanitizeShareField(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

/** Short public floor reference derived from the garment UUID (not a secret). */
export function publicItemRef(garmentId: string): string {
  const compact = sanitizeShareField(garmentId).replace(/-/g, '').slice(0, 8).toUpperCase();
  return compact.length > 0 ? compact : 'UNKNOWN';
}

/**
 * Plain-text payload for WhatsApp / clipboard / Web Share.
 * Deliberately omits URLs to storage, overlay assets, and tokens.
 */
export function buildProductShareText(product: ShareableProduct): string {
  const lines: string[] = [];
  if (product.isTestFixture) {
    lines.push('TEST FIXTURE — not a commercial product');
  }
  lines.push(sanitizeShareField(product.name));
  lines.push(`Category: ${sanitizeShareField(product.category)}`);
  lines.push(`Color: ${sanitizeShareField(product.colorName)}`);
  if (product.brand) lines.push(`Brand: ${sanitizeShareField(product.brand)}`);
  if (product.size) lines.push(`Size: ${sanitizeShareField(product.size)}`);
  const price = formatCatalogPrice(product.priceMinor, product.currencyCode);
  if (price) lines.push(`Price: ${sanitizeShareField(price)}`);
  lines.push(`Item ref: ${publicItemRef(product.garmentId)}`);
  lines.push('Please hold this look at the counter / MirrorFit session.');
  return lines.join('\n');
}

/**
 * Encodes the WhatsApp `text` query value. Always uses encodeURIComponent so
 * spaces, newlines, &, =, #, %, and non-ASCII characters cannot break the URL.
 */
export function encodeWhatsAppTextQuery(text: string): string {
  return encodeURIComponent(text);
}

/** WhatsApp click-to-chat deep link with prefilled public product text. */
export function buildWhatsAppShareUrl(
  product: ShareableProduct,
  phoneE164?: string | null,
): string {
  const text = buildProductShareText(product);
  const encoded = encodeWhatsAppTextQuery(text);
  const digits = typeof phoneE164 === 'string' ? phoneE164.replace(/[^\d]/g, '') : '';
  const path = digits.length >= 8 ? `https://wa.me/${digits}` : 'https://wa.me/';
  return `${path}?text=${encoded}`;
}

/**
 * Verifies a wa.me URL's text param round-trips through encodeURIComponent.
 * Used by tests and as a runtime sanity check before opening.
 */
export function whatsAppTextParamIsFullyEncoded(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'wa.me') return false;
    const rawQuery = parsed.search.startsWith('?') ? parsed.search.slice(1) : parsed.search;
    const textPart = rawQuery.split('&').find((part) => part.startsWith('text='));
    if (!textPart) return false;
    const encoded = textPart.slice('text='.length);
    // Unencoded reserved characters in the query value would be malformed.
    if (/[ \n\r#"<>\\{}|^`]/.test(encoded)) return false;
    decodeURIComponent(encoded);
    return true;
  } catch {
    return false;
  }
}

export interface ProductSharePorts {
  readonly openUrl?: (url: string) => void;
  readonly copyText?: (text: string) => Promise<boolean>;
  readonly webShare?: (data: { title: string; text: string }) => Promise<boolean>;
}

/**
 * Prefer WhatsApp deep link; fall back to Web Share API, then clipboard.
 * Never throws — restricted browsers get a soft failure with copyable text.
 */
export async function shareProductLook(
  product: ShareableProduct,
  options?: {
    readonly phoneE164?: string | null;
    readonly prefer?: 'whatsapp' | 'web_share';
    readonly ports?: ProductSharePorts;
  },
): Promise<ProductShareResult> {
  const text = buildProductShareText(product);
  const url = buildWhatsAppShareUrl(product, options?.phoneE164);
  const prefer = options?.prefer ?? 'whatsapp';
  const ports = options?.ports ?? {};

  if (!whatsAppTextParamIsFullyEncoded(url)) {
    const copy =
      ports.copyText ??
      (async (value: string) => {
        if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch {
          return false;
        }
      });
    const copied = await copy(text);
    return {
      ok: copied,
      channel: copied ? 'clipboard' : 'none',
      url,
      text,
      error: copied
        ? null
        : 'Sharing is unavailable in this browser. Copy the item details manually.',
    };
  }

  if (prefer === 'web_share' && ports.webShare) {
    try {
      const shared = await ports.webShare({ title: sanitizeShareField(product.name), text });
      if (shared) {
        return { ok: true, channel: 'web_share', url, text, error: null };
      }
    } catch {
      // fall through
    }
  }

  try {
    if (ports.openUrl) {
      ports.openUrl(url);
      return { ok: true, channel: 'whatsapp', url, text, error: null };
    }
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true, channel: 'whatsapp', url, text, error: null };
    }
  } catch {
    // fall through to clipboard
  }

  const copy =
    ports.copyText ??
    (async (value: string) => {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return false;
      }
    });

  const copied = await copy(text);
  if (copied) {
    return { ok: true, channel: 'clipboard', url, text, error: null };
  }

  return {
    ok: false,
    channel: 'none',
    url,
    text,
    error: 'Sharing is unavailable in this browser. Copy the item details manually.',
  };
}
