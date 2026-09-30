import { describe, expect, it } from 'vitest';

import { resolveFitCategory } from '@mirrorfit/tryon-core';

import { TRIAL_PANTS_OVERLAY, TRIAL_SHIRT_OVERLAY } from './trial-overlay';
import {
  TRIAL_FIXTURES,
  ensureTrialGarments,
  type TrialQuery,
  type TrialResult,
  type TrialWriter,
} from './trial-garments';

function memoryDb(): TrialWriter & { tables: Record<string, Record<string, unknown>[]> } {
  const tables: Record<string, Record<string, unknown>[]> = {
    garments: [],
    garment_variants: [],
    size_charts: [],
    size_measurements: [],
    garment_assets: [],
  };
  let seq = 0;

  function from(table: string): TrialQuery {
    const filters: Record<string, string | number> = {};
    let pendingInsert: Record<string, unknown> | null = null;
    let pendingUpdate: Record<string, unknown> | null = null;
    const rows = () => tables[table] ?? [];
    const matches = (row: Record<string, unknown>) =>
      Object.entries(filters).every(([key, value]) => row[key] === value);

    const finish = (): TrialResult<unknown> => {
      if (pendingInsert) {
        const stored = { id: `id-${String(++seq)}`, ...pendingInsert };
        rows().push(stored);
        pendingInsert = null;
        return { data: stored, error: null };
      }
      if (pendingUpdate) {
        for (const row of rows()) {
          if (matches(row)) Object.assign(row, pendingUpdate);
        }
        pendingUpdate = null;
        return { data: null, error: null };
      }
      return { data: rows().filter(matches), error: null };
    };

    const query: TrialQuery = {
      select() {
        return query;
      },
      eq(column, value) {
        filters[column] = value;
        return query;
      },
      insert(row) {
        pendingInsert = row;
        return query;
      },
      update(row) {
        pendingUpdate = row;
        return query;
      },
      maybeSingle() {
        const found = rows().find(matches) ?? null;
        return Promise.resolve({ data: found, error: null });
      },
      single() {
        if (!pendingInsert) {
          return Promise.resolve({ data: {}, error: { message: 'insert failed' } });
        }
        const stored: Record<string, unknown> = {
          id: `id-${String(++seq)}`,
          ...pendingInsert,
        };
        rows().push(stored);
        pendingInsert = null;
        return Promise.resolve({ data: stored, error: null });
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(finish()).then(onfulfilled, onrejected);
      },
    };
    return query;
  }

  return { from, tables };
}

const shop = {
  organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  shop_id: '11111111-1111-4111-8111-111111111111',
};

describe('trial garments', () => {
  it('adds one shirt and one pants row, then does not duplicate them', async () => {
    const db = memoryDb();
    const first = await ensureTrialGarments(db, shop);
    const second = await ensureTrialGarments(db, shop);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(db.tables['garments']).toHaveLength(2);
    expect(db.tables['garments']?.map((row) => row['sku'])).toEqual([
      'TEST-FIXTURE-TOP',
      'TEST-FIXTURE-PANTS',
    ]);
    expect(db.tables['garments']?.map((row) => row['name'])).toEqual([
      'TEST FIXTURE Shirt',
      'TEST FIXTURE Pants',
    ]);
    expect(db.tables['garment_variants']).toHaveLength(2);
    expect(db.tables['size_measurements']).toHaveLength(6);
    expect(db.tables['garment_assets']).toHaveLength(2);
    expect(TRIAL_FIXTURES.map((fixture) => resolveFitCategory(fixture.category))).toEqual([
      'TOP',
      'LOWER_BODY',
    ]);
    expect(resolveFitCategory(TRIAL_SHIRT_OVERLAY.category)).toBe('TOP');
    expect(resolveFitCategory(TRIAL_PANTS_OVERLAY.category)).toBe('LOWER_BODY');
  });

  it('reports a lookup failure and writes nothing further', async () => {
    const broken: TrialWriter = {
      from() {
        const query: TrialQuery = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          insert() {
            return query;
          },
          update() {
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: null, error: { message: 'permission denied' } });
          },
          single() {
            return Promise.resolve({ data: {}, error: { message: 'unused' } });
          },
          then(onfulfilled, onrejected) {
            return Promise.resolve({ data: null, error: null }).then(onfulfilled, onrejected);
          },
        };
        return query;
      },
    };

    const result = await ensureTrialGarments(broken, shop);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('permission denied');
  });
});
