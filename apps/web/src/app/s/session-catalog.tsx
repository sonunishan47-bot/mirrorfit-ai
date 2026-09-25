'use client';

import { useEffect, useState } from 'react';

import { GarmentCard } from '@/components/customer/garment-card';
import { PrimaryButton } from '@/components/customer/primary-button';
import {
  listSessionCatalog,
  selectSessionGarment,
  type CustomerCatalogItem,
} from '@/lib/customer/catalog-client';

/**
 * Phone catalog foundation after Mirror Ready.
 *
 * Empty shop catalogs stay empty. No invented products. The pairing token
 * is accepted as an argument and is never rendered.
 */
export function SessionCatalog({
  readToken,
}: {
  readToken: () => string | null;
}) {
  const [items, setItems] = useState<CustomerCatalogItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = readToken();
    if (!token) return;
    let cancelled = false;
    void listSessionCatalog(token).then((catalog) => {
      if (cancelled) return;
      if (catalog === null) {
        setFailed(true);
        setItems([]);
        return;
      }
      setFailed(false);
      setItems(catalog);
    });
    return () => {
      cancelled = true;
    };
  }, [readToken]);

  async function choose(item: CustomerCatalogItem | null): Promise<void> {
    const token = readToken();
    if (!token) return;
    const ok = await selectSessionGarment(
      token,
      item
        ? { garmentId: item.garmentId, variantId: item.variantId, category: item.category }
        : null,
    );
    if (ok) {
      setSelected(item ? item.variantId : null);
    }
  }

  return (
    <section className="space-y-4" data-testid="session-catalog">
      <div className="space-y-1">
        <h2 className="text-lg font-light tracking-tight text-customer-ink">Garments</h2>
        <p className="text-sm text-customer-quiet">
          Selection updates this session only. Fitting still happens on the
          mirror, and photorealistic try-on is not implemented.
        </p>
      </div>

      {items === null ? (
        <p className="text-sm text-customer-quiet">Loading this shop&apos;s catalog…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-customer-quiet">
          {failed
            ? 'The catalog could not be loaded. The mirror session is still available.'
            : 'No garments are available for this shop yet. Nothing is invented here.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.variantId}>
              <button
                type="button"
                className="w-full text-left"
                onClick={() => {
                  void choose(item);
                }}
              >
                <GarmentCard
                  title={item.name}
                  category={item.category}
                  meta={[
                    item.isTestFixture ? 'TEST FIXTURE · not a product' : null,
                    item.brand,
                    item.colorName,
                    item.sizes.length > 0 ? item.sizes.join(' / ') : null,
                    item.fittingAvailable
                      ? 'TOP fitting available'
                      : 'Fitting not available for this category',
                    selected === item.variantId ? 'selected' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <PrimaryButton
          onClick={() => {
            void choose(null);
          }}
        >
          Clear garment
        </PrimaryButton>
      ) : null}
    </section>
  );
}
