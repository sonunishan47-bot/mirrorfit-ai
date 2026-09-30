'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { cn } from '@mirrorfit/ui';
import {
  CATALOG_CACHE_STORAGE_KEY,
  cacheIsFresh,
  sanitizeCatalogCache,
} from '@mirrorfit/experience';

import { GarmentCard } from '@/components/customer/garment-card';
import { PrimaryButton } from '@/components/customer/primary-button';
import {
  CATALOG_BROWSE_FILTERS,
  CatalogSelectionGuard,
  filterCatalogItems,
  fittingAvailabilityLabel,
  formatCatalogPrice,
  groupCatalogByGarment,
  type CatalogBrowseFilter,
  type CatalogGarmentGroup,
} from '@/lib/customer/catalog-browse';
import {
  listSessionCatalog,
  selectSessionGarment,
  type CustomerCatalogItem,
} from '@/lib/customer/catalog-client';
import { fixtureCatalogThumbnailSrc } from '@/lib/customer/fixture-catalog-thumbnail';
import { shareProductLook, type ShareableProduct } from '@/lib/customer/product-share';
import { LookDesk } from '@/components/customer/look-desk';

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';
type LoadStatus = 'loading' | 'ready' | 'empty' | 'error';
type ShareStatus = 'idle' | 'sharing' | 'shared' | 'copied' | 'error';

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * Phone catalog after Mirror Ready.
 *
 * Empty shop catalogs stay empty. No invented products. The pairing token
 * is accepted as an argument and is never rendered. Selection sync uses a
 * generation guard so rapid taps cannot race the kiosk garment state.
 */
export function SessionCatalog({ readToken }: { readToken: () => string | null }) {
  const [items, setItems] = useState<CustomerCatalogItem[] | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
  const [loadSlow, setLoadSlow] = useState(false);
  const [filter, setFilter] = useState<CatalogBrowseFilter>('all');
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedGarmentId, setSelectedGarmentId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [reloadKey, setReloadKey] = useState(0);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const offline = !online;
  const [sawOffline, setSawOffline] = useState(false);
  if (!online && !sawOffline) {
    setSawOffline(true);
  } else if (online && sawOffline) {
    setSawOffline(false);
    setReloadKey((key) => key + 1);
  }
  const [expandedGarmentId, setExpandedGarmentId] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>('idle');
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [usingCache, setUsingCache] = useState(false);

  const guardRef = useRef(new CatalogSelectionGuard());

  useEffect(() => {
    const guard = guardRef.current;
    let cancelled = false;
    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setLoadSlow(true);
    }, 2500);

    void (async () => {
      const token = readToken();
      if (!token) {
        if (!cancelled) {
          setItems([]);
          setLoadStatus('error');
          setLoadSlow(false);
        }
        return;
      }
      setLoadStatus('loading');
      setLoadSlow(false);
      const catalog = await listSessionCatalog(token);
      if (cancelled) return;
      if (catalog === null) {
        const cached = readCachedCatalog();
        if (!cancelled && cached) {
          setItems(cached);
          setLoadStatus(cached.length === 0 ? 'empty' : 'ready');
          setUsingCache(true);
          setLoadSlow(false);
          return;
        }
        if (!cancelled) {
          setItems([]);
          setLoadStatus('error');
          setUsingCache(false);
          setLoadSlow(false);
        }
        return;
      }
      setItems(catalog);
      setUsingCache(false);
      writeCatalogCache(catalog);
      setLoadStatus(catalog.length === 0 ? 'empty' : 'ready');
      setLoadSlow(false);
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      guard.invalidate();
    };
  }, [readToken, reloadKey]);

  const filtered = useMemo(() => (items ? filterCatalogItems(items, filter) : []), [items, filter]);
  const groups = useMemo(() => groupCatalogByGarment(filtered), [filtered]);

  const syncSelection = useCallback(
    async (item: CustomerCatalogItem | null, sizeOverride?: string | null): Promise<void> => {
      const token = readToken();
      if (!token) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('error');
        return;
      }

      const generation = guardRef.current.begin();
      setSyncStatus('syncing');
      const sizeLabel = sizeOverride === undefined ? selectedSize : sizeOverride;
      const ok = await selectSessionGarment(
        token,
        item
          ? {
              garmentId: item.garmentId,
              variantId: item.variantId,
              category: item.category,
              ...(sizeLabel ? { sizeLabel } : {}),
            }
          : null,
      );
      if (!guardRef.current.isCurrent(generation)) return;
      if (!ok) {
        setSyncStatus('error');
        return;
      }
      setSelectedVariantId(item ? item.variantId : null);
      setSelectedGarmentId(item ? item.garmentId : null);
      if (!item) {
        setSelectedSize(null);
        setExpandedGarmentId(null);
      }
      setSyncStatus('synced');
    },
    [readToken, selectedSize],
  );

  async function chooseGroup(
    group: CatalogGarmentGroup,
    variant?: CustomerCatalogItem,
  ): Promise<void> {
    const next = variant ?? group.variants[0] ?? null;
    if (!next) return;
    setExpandedGarmentId(group.garmentId);
    const sizeForGroup =
      group.sizes.length > 0 && selectedGarmentId !== group.garmentId
        ? (group.sizes[0] ?? null)
        : selectedSize;
    if (sizeForGroup !== selectedSize) setSelectedSize(sizeForGroup);
    await syncSelection(next, sizeForGroup);
  }

  const selectedGroup = groups.find((g) => g.garmentId === selectedGarmentId) ?? null;

  async function shareSelected(): Promise<void> {
    if (!selectedGroup || !selectedVariantId) return;
    const variant =
      selectedGroup.variants.find((row) => row.variantId === selectedVariantId) ??
      selectedGroup.variants[0];
    if (!variant) return;

    const product: ShareableProduct = {
      name: selectedGroup.name,
      category: selectedGroup.category,
      colorName: variant.colorName,
      brand: selectedGroup.brand,
      size: selectedSize,
      priceMinor: selectedGroup.priceMinor,
      currencyCode: selectedGroup.currencyCode,
      garmentId: selectedGroup.garmentId,
      variantId: variant.variantId,
      isTestFixture: selectedGroup.isTestFixture,
    };

    setShareStatus('sharing');
    setShareMessage(null);
    const result = await shareProductLook(product);
    if (result.ok && result.channel === 'whatsapp') {
      setShareStatus('shared');
      setShareMessage('Opening WhatsApp with this look…');
    } else if (result.ok && result.channel === 'clipboard') {
      setShareStatus('copied');
      setShareMessage('WhatsApp blocked — item details copied for the counter.');
    } else if (result.ok && result.channel === 'web_share') {
      setShareStatus('shared');
      setShareMessage('Shared.');
    } else {
      setShareStatus('error');
      setShareMessage(result.error ?? 'Sharing unavailable.');
    }
  }

  return (
    <section className="space-y-5" data-testid="session-catalog">
      <div className="space-y-1">
        <h2 className="text-lg font-light tracking-tight text-customer-ink">Shop catalog</h2>
        <p className="text-sm text-customer-quiet">
          Pick a garment to update the mirror. Fitting stays on the kiosk — this phone never
          receives camera frames or product storage paths.
        </p>
      </div>

      {offline ? (
        <p
          className="rounded-2xl bg-[#f3ebe0] px-4 py-3 text-sm text-customer-ink"
          role="status"
          data-testid="catalog-offline"
        >
          You appear offline. Selections will retry when the connection returns.
        </p>
      ) : null}

      {syncStatus === 'error' ? (
        <p className="rounded-2xl bg-[#f3ebe0] px-4 py-3 text-sm text-customer-ink" role="status">
          Could not update the mirror. Tap a garment again to retry.
        </p>
      ) : syncStatus === 'syncing' ? (
        <p className="text-sm text-customer-quiet" role="status" aria-live="polite">
          Updating the mirror…
        </p>
      ) : syncStatus === 'synced' && selectedGroup ? (
        <p className="text-sm text-customer-quiet" role="status" aria-live="polite">
          Mirror updated · {selectedGroup.name}
          {selectedSize ? ` · size ${selectedSize}` : ''}
        </p>
      ) : null}

      <LookDesk
        items={items ?? []}
        selected={items?.find((item) => item.variantId === selectedVariantId) ?? null}
        size={selectedSize}
        readToken={readToken}
        usingCache={usingCache}
        onApply={(item, nextSize) => {
          setSelectedSize(nextSize);
          void syncSelection(item, nextSize);
        }}
      />

      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Catalog categories"
        data-testid="catalog-filters"
      >
        {CATALOG_BROWSE_FILTERS.map((entry) => {
          const active = filter === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                'rounded-full px-4 py-2 text-xs tracking-wide transition-colors duration-150',
                active
                  ? 'bg-forest text-forest-contrast'
                  : 'bg-customer-surface text-customer-quiet shadow-[0_8px_20px_rgb(27_48_34_/_6%)]',
              )}
              onClick={() => setFilter(entry.id)}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {loadStatus === 'loading' ? (
        <div
          className="flex flex-col gap-2 py-6 text-sm text-customer-quiet"
          role="status"
          aria-busy="true"
          data-testid="catalog-loading"
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-block size-5 animate-spin rounded-full border-2 border-forest/25 border-t-forest"
              aria-hidden
            />
            Loading this shop&apos;s catalog…
          </div>
          {loadSlow ? (
            <p className="pl-8 text-xs" data-testid="catalog-loading-slow">
              Still waiting on the shop catalog. Check Wi‑Fi if this continues — you can retry below
              if it fails.
            </p>
          ) : null}
        </div>
      ) : loadStatus === 'error' ? (
        <div className="space-y-3">
          <p className="text-sm text-customer-quiet">
            The catalog could not be loaded. The mirror session is still available.
          </p>
          <PrimaryButton busyLabel="Retrying…" onClick={() => setReloadKey((k) => k + 1)}>
            Retry catalog
          </PrimaryButton>
        </div>
      ) : loadStatus === 'empty' || groups.length === 0 ? (
        <p className="text-sm text-customer-quiet">
          {items && items.length > 0
            ? 'No garments in this category for this shop.'
            : 'No garments are available for this shop yet. Nothing is invented here.'}
        </p>
      ) : (
        <ul className="space-y-4">
          {groups.map((group) => {
            const activeVariant =
              group.variants.find((v) => v.variantId === selectedVariantId) ?? group.variants[0]!;
            const isSelected = selectedGarmentId === group.garmentId;
            const isExpanded = expandedGarmentId === group.garmentId || isSelected;
            const price = formatCatalogPrice(group.priceMinor, group.currencyCode);
            const meta = [
              group.isTestFixture ? 'TEST FIXTURE · not a product' : null,
              group.brand,
              activeVariant.colorName,
              price,
              fittingAvailabilityLabel(group),
            ]
              .filter(Boolean)
              .join(' · ');
            const thumbnailSrc = fixtureCatalogThumbnailSrc(group.name, group.isTestFixture);

            return (
              <li key={group.garmentId} className="space-y-0">
                <GarmentCard
                  title={group.name}
                  category={group.category}
                  meta={meta}
                  selected={isSelected}
                  imageSrc={thumbnailSrc}
                  {...(thumbnailSrc
                    ? {
                        imageAlt: `${group.name} sample — TEST FIXTURE, not a commercial product`,
                      }
                    : {})}
                  badge={
                    group.isTestFixture
                      ? 'Test fixture'
                      : group.fittingAvailable
                        ? 'Try on'
                        : 'Browse'
                  }
                >
                  <button
                    type="button"
                    className="w-full rounded-full bg-[#ebe6dc] px-4 py-2.5 text-left text-sm text-customer-ink transition-opacity disabled:opacity-60"
                    disabled={syncStatus === 'syncing' || offline}
                    onClick={() => {
                      void chooseGroup(group, activeVariant);
                    }}
                  >
                    {isSelected ? 'Selected on mirror' : 'Try on mirror'}
                  </button>

                  {isExpanded ? (
                    <div className="space-y-3 pt-2">
                      {group.variants.length > 1 ? (
                        <div className="space-y-2">
                          <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-customer-quiet">
                            Color
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {group.variants.map((variant) => {
                              const colorActive = variant.variantId === selectedVariantId;
                              return (
                                <button
                                  key={variant.variantId}
                                  type="button"
                                  className={cn(
                                    'rounded-full px-3 py-1.5 text-xs tracking-wide',
                                    colorActive
                                      ? 'bg-forest text-forest-contrast'
                                      : 'bg-[#ebe6dc] text-customer-ink',
                                  )}
                                  disabled={syncStatus === 'syncing' || offline}
                                  onClick={() => {
                                    void chooseGroup(group, variant);
                                  }}
                                >
                                  {variant.colorName}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {group.sizes.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-customer-quiet">
                            Size
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {group.sizes.map((size) => {
                              const sizeActive = selectedSize === size && isSelected;
                              return (
                                <button
                                  key={size}
                                  type="button"
                                  className={cn(
                                    'min-w-10 rounded-full px-3 py-1.5 text-xs tracking-wide',
                                    sizeActive
                                      ? 'bg-forest text-forest-contrast'
                                      : 'bg-[#ebe6dc] text-customer-ink',
                                  )}
                                  onClick={() => setSelectedSize(size)}
                                >
                                  {size}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </GarmentCard>
              </li>
            );
          })}
        </ul>
      )}

      {selectedVariantId ? (
        <div className="space-y-3">
          <PrimaryButton
            busy={shareStatus === 'sharing'}
            busyLabel="Preparing…"
            disabled={offline}
            onClick={() => {
              void shareSelected();
            }}
          >
            Share via WhatsApp
          </PrimaryButton>
          {shareMessage ? (
            <p className="text-sm text-customer-quiet" role="status" data-testid="share-status">
              {shareMessage}
            </p>
          ) : (
            <p className="text-xs text-customer-quiet">
              Sends public item details only — never storage paths or session secrets.
            </p>
          )}
          <PrimaryButton
            busy={syncStatus === 'syncing'}
            busyLabel="Clearing…"
            disabled={offline}
            onClick={() => {
              void syncSelection(null);
            }}
          >
            Clear garment
          </PrimaryButton>
        </div>
      ) : null}
    </section>
  );
}

function writeCatalogCache(items: readonly CustomerCatalogItem[]): void {
  try {
    localStorage.setItem(
      CATALOG_CACHE_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), items: sanitizeCatalogCache([...items]) }),
    );
  } catch {
    // A full or private browser store must not block the catalog.
  }
}

function readCachedCatalog(): CustomerCatalogItem[] | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; items?: unknown };
    if (typeof parsed.savedAt !== 'number' || !cacheIsFresh(parsed.savedAt, Date.now()))
      return null;
    if (!Array.isArray(parsed.items)) return null;
    const items: CustomerCatalogItem[] = [];
    for (const row of parsed.items) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      if (
        typeof record['garmentId'] !== 'string' ||
        typeof record['variantId'] !== 'string' ||
        typeof record['name'] !== 'string' ||
        typeof record['category'] !== 'string' ||
        typeof record['colorName'] !== 'string'
      ) {
        continue;
      }
      items.push({
        garmentId: record['garmentId'],
        variantId: record['variantId'],
        name: record['name'],
        category: record['category'],
        brand: typeof record['brand'] === 'string' ? record['brand'] : null,
        colorName: record['colorName'],
        isTestFixture: record['isTestFixture'] === true,
        sizes: Array.isArray(record['sizes'])
          ? record['sizes'].filter((value): value is string => typeof value === 'string')
          : [],
        hasThumbnail: record['hasThumbnail'] === true,
        hasOverlay: record['hasOverlay'] === true,
        fittingAvailable: record['fittingAvailable'] === true,
        priceMinor: typeof record['priceMinor'] === 'number' ? record['priceMinor'] : null,
        currencyCode: typeof record['currencyCode'] === 'string' ? record['currencyCode'] : null,
      });
    }
    return items;
  } catch {
    return null;
  }
}
