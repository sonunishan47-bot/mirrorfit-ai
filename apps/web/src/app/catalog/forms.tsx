'use client';

import { useActionState } from 'react';

import { STAFF_GARMENT_CATEGORIES } from '@mirrorfit/validation';

import { createGarment, setGarmentActive, type CatalogActionResult } from './actions';

const IDLE: CatalogActionResult = { ok: true };

const inputClass =
  'w-full rounded-sm border border-white/15 bg-black/30 px-3 py-2 text-sm text-primary outline-none focus:border-accent';

interface Shop {
  readonly id: string;
  readonly name: string;
}

export function CreateGarmentForm({ shops }: { shops: readonly Shop[] }) {
  const [state, action, pending] = useActionState(createGarment, IDLE);
  if (shops.length === 0) {
    return <p className="text-sm text-muted">No shop is available for this account.</p>;
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Shop</span>
        <select name="shop_id" required className={inputClass} defaultValue={shops[0]?.id}>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Category</span>
        <select name="category" required className={inputClass} defaultValue="Shirt">
          {STAFF_GARMENT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Name</span>
        <input
          name="name"
          required
          maxLength={200}
          placeholder="Black abaya"
          className={inputClass}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">SKU</span>
        <input
          name="sku"
          maxLength={64}
          placeholder="Leave blank to build one from the name"
          className={inputClass}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Colour</span>
        <input
          name="color_name"
          required
          maxLength={80}
          placeholder="Black"
          className={inputClass}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Colour hex</span>
        <input
          name="color_hex"
          required
          defaultValue="#1e3a5f"
          pattern="#[0-9a-fA-F]{6}"
          className={inputClass}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Price in halalas, optional</span>
        <input
          name="price_minor"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="25000"
          className={inputClass}
        />
      </label>
      <label className="space-y-1.5 text-sm sm:col-span-2">
        <span className="block text-secondary">Fabric and details, optional</span>
        <input
          name="fabric_and_details"
          maxLength={160}
          placeholder="cotton poplin, white buttons"
          className={inputClass}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Fit, optional</span>
        <input name="fit" maxLength={80} placeholder="relaxed" className={inputClass} />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Extra line, optional</span>
        <input
          name="extra_prompt"
          maxLength={200}
          placeholder="side slits"
          className={inputClass}
        />
      </label>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add garment'}
        </button>
      </div>
      <p className="text-xs text-muted sm:col-span-2">
        Sizes S, M, and L are added with the garment. Dress, abaya, kurta, churidar, and thobe are
        recognised on the mirror as a pose silhouette, not a photograph. Fabric, fit, and the extra
        line are used only by the local delayed clip. They are not sent to the phone.
      </p>
      {state.message ? (
        <p
          role="status"
          className={`sm:col-span-2 text-sm ${state.ok ? 'text-success' : 'text-danger'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function GarmentActiveForm({ garmentId, active }: { garmentId: string; active: boolean }) {
  const [state, action, pending] = useActionState(setGarmentActive, IDLE);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="garment_id" value={garmentId} />
      <input type="hidden" name="is_active" value={active ? 'false' : 'true'} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs uppercase tracking-widest text-muted underline-offset-2 hover:underline"
      >
        {pending ? 'Saving…' : active ? 'Hide' : 'Show'}
      </button>
      {state.message && !state.ok ? (
        <span className="text-xs text-danger">{state.message}</span>
      ) : null}
    </form>
  );
}
