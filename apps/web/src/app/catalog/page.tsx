import Link from 'next/link';

import { MANAGER_ROLE_RANK } from '@mirrorfit/types';

import { signOut } from '@/app/login/actions';
import { requireStaff } from '@/lib/auth/staff';
import { createSupabaseServerClient } from '@/lib/supabase/server-client';

import { CreateGarmentForm, GarmentActiveForm } from './forms';

export const metadata = { title: 'Catalog — MirrorFit AI' };
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const staff = await requireStaff();
  const supabase = await createSupabaseServerClient();
  const [{ data: shops }, { data: garments }, { data: variants }] = await Promise.all([
    supabase.from('shops').select('id, name').order('name'),
    supabase
      .from('garments')
      .select('id, name, sku, category, shop_id, is_active, price_minor, currency_code')
      .order('name'),
    supabase.from('garment_variants').select('garment_id, color_name, is_active'),
  ]);
  const shopNames = new Map((shops ?? []).map((shop) => [shop.id, shop.name]));
  const colors = new Map<string, string[]>();
  for (const variant of variants ?? []) {
    if (!variant.is_active) continue;
    const list = colors.get(variant.garment_id) ?? [];
    list.push(variant.color_name);
    colors.set(variant.garment_id, list);
  }
  const canManage = staff.roleRank >= MANAGER_ROLE_RANK;

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.35em] text-accent">MirrorFit AI</p>
          <h1 className="text-3xl font-light tracking-tight text-primary">Catalog</h1>
          <p className="text-sm text-secondary">
            {staff.email} — add a shirt, pants, dress, abaya, kurta, churidar, or thobe for this
            shop.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/displays" className="text-sm text-muted underline-offset-2 hover:underline">
            Displays
          </Link>
          <Link href="/ops" className="text-sm text-muted underline-offset-2 hover:underline">
            Operations
          </Link>
          <form action={signOut}>
            <button type="submit" className="text-sm text-muted underline-offset-2 hover:underline">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {canManage ? (
        <section className="glass space-y-4 rounded-lg p-6">
          <h2 className="text-sm font-medium uppercase tracking-widest text-muted">
            Add a garment
          </h2>
          <CreateGarmentForm shops={shops ?? []} />
        </section>
      ) : (
        <p className="text-sm text-muted">Your role can view the catalog but not change it.</p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">Shop garments</h2>
        {(garments ?? []).length === 0 ? (
          <p className="text-sm text-muted">
            No garments yet. Trial shirt and pants appear after a customer opens the catalog.
          </p>
        ) : (
          <ul className="space-y-3">
            {(garments ?? []).map((garment) => (
              <li
                key={garment.id}
                className="glass flex flex-wrap items-center justify-between gap-3 rounded-lg p-5"
              >
                <div>
                  <h3 className="text-lg text-primary">{garment.name}</h3>
                  <p className="text-xs text-muted">
                    {shopNames.get(garment.shop_id) ?? 'Shop'} · {garment.category} · {garment.sku}
                    {(colors.get(garment.id) ?? []).length > 0
                      ? ` · ${(colors.get(garment.id) ?? []).join(', ')}`
                      : ''}
                    {garment.price_minor !== null
                      ? ` · ${String(garment.price_minor)} ${garment.currency_code ?? ''}`
                      : ''}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs uppercase tracking-widest text-secondary">
                    {garment.is_active ? 'Visible' : 'Hidden'}
                  </span>
                  {canManage ? (
                    <GarmentActiveForm garmentId={garment.id} active={garment.is_active} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
