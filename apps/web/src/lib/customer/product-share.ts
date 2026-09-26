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

/** Short public floor reference derived from the garment UUID (not a secret). */
export function publicItemRef(garmentId: string): string {
  const compact = garmentId.replace(/-/g, '').slice(0, 8).toUpperCase();
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
  lines.push(product.name);
  lines.push(`Category: ${product.category}`);
  lines.push(`Color: ${product.colorName}`);
  if (product.brand) lines.push(`Brand: ${product.brand}`);
  if (product.size) lines.push(`Size: ${product.size}`);
  const price = formatCatalogPrice(product.priceMinor, product.currencyCode);
  if (price) lines.push(`Price: ${price}`);
  lines.push(`Item ref: ${publicItemRef(product.garmentId)}`);
  lines.push('Please hold this look at the counter / MirrorFit session.');
  return lines.join('\n');
}

/** WhatsApp click-to-chat deep link with prefilled public product text. */
export function buildWhatsAppShareUrl(product: ShareableProduct, phoneE164?: string | null): string {
  const text = buildProductShareText(product);
  const encoded = encodeURIComponent(text);
  const digits =
    typeof phoneE164 === 'string' ? phoneE164.replace(/[^\d]/g, '') : '';
  if (digits.length >= 8) {
    return `https://wa.me/${digits}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
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

  if (prefer === 'web_share' && ports.webShare) {
    try {
      const shared = await ports.webShare({ title: product.name, text });
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
