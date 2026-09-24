import { describe, expect, it } from 'vitest';

import { ADMIN_ROLE_RANK, MANAGER_ROLE_RANK, STAFF_ROLES, staffRoleRank } from './enums';

/**
 * The expected values are written out rather than derived, because the point
 * is to pin them to `app.role_rank()` in the tenancy migration. Deriving them
 * the same way the implementation does would make this test agree with any
 * reordering of `STAFF_ROLES`, which is exactly the change that would break
 * authorisation silently.
 */
const SQL_ROLE_RANK = {
  ORG_OWNER: 4,
  ADMIN: 3,
  MANAGER: 2,
  STAFF: 1,
} as const;

describe('staffRoleRank', () => {
  it('matches app.role_rank() in the database for every role', () => {
    for (const role of STAFF_ROLES) {
      expect(staffRoleRank(role)).toBe(SQL_ROLE_RANK[role]);
    }
  });

  it('covers every role, so a new one cannot default to a rank', () => {
    expect(Object.keys(SQL_ROLE_RANK).sort()).toEqual([...STAFF_ROLES].sort());
  });

  it('orders roles strictly, so "at least" comparisons are meaningful', () => {
    const ranks = STAFF_ROLES.map(staffRoleRank);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i - 1]).toBeGreaterThan(ranks[i] as number);
    }
  });

  it('names the thresholds the policies actually use', () => {
    expect(ADMIN_ROLE_RANK).toBe(staffRoleRank('ADMIN'));
    expect(MANAGER_ROLE_RANK).toBe(staffRoleRank('MANAGER'));
    expect(staffRoleRank('ORG_OWNER')).toBeGreaterThan(ADMIN_ROLE_RANK);
    expect(staffRoleRank('STAFF')).toBeLessThan(MANAGER_ROLE_RANK);
  });
});
