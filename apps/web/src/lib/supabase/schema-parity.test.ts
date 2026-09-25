/**
 * Guards the seam between the database and the domain vocabulary.
 *
 * `@mirrorfit/types` declares each enum once and `@mirrorfit/validation`
 * derives its Zod schemas from those arrays, so the TypeScript side cannot
 * drift from itself. The database is the one layer that can: a migration adds
 * a value to a Postgres enum type and nothing in the type system notices.
 *
 * `database.types.ts` is regenerated from the applied migrations, so it is the
 * database's own account of itself. Comparing against it turns drift into a
 * failing test instead of a row that fails to parse in production.
 *
 * When something here fails, fix whichever side is wrong. Do not edit the
 * expected values to make it pass.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTOR_KINDS,
  CONSENT_KINDS,
  CUSTOMER_REQUEST_STATUSES,
  DEVICE_STATUSES,
  GARMENT_ASSET_KINDS,
  INSTALLATION_STATUSES,
  SESSION_END_REASONS,
  SESSION_STATUSES,
  SIZE_LABELS,
  STAFF_ROLES,
  TRYON_JOB_STATUSES,
} from '@mirrorfit/types';

import { Constants, type Database, type Tables } from './database.types';

/** True only when the two types are mutually assignable, not merely related. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const databaseEnums = Constants.public.Enums;

/**
 * Order is part of the contract, not a formatting detail. `app.role_rank()` in
 * the tenancy migration assigns privilege by role and `STAFF_ROLES` is ordered
 * most to least privileged, so a reordering is an authorisation change.
 */
const ENUM_PAIRS: Record<
  keyof Database['public']['Enums'],
  readonly [readonly string[], readonly string[]]
> = {
  staff_role: [databaseEnums.staff_role, STAFF_ROLES],
  actor_kind: [databaseEnums.actor_kind, ACTOR_KINDS],
  session_status: [databaseEnums.session_status, SESSION_STATUSES],
  session_end_reason: [databaseEnums.session_end_reason, SESSION_END_REASONS],
  device_status: [databaseEnums.device_status, DEVICE_STATUSES],
  installation_status: [databaseEnums.installation_status, INSTALLATION_STATUSES],
  customer_request_status: [databaseEnums.customer_request_status, CUSTOMER_REQUEST_STATUSES],
  tryon_job_status: [databaseEnums.tryon_job_status, TRYON_JOB_STATUSES],
  size_label: [databaseEnums.size_label, SIZE_LABELS],
  consent_kind: [databaseEnums.consent_kind, CONSENT_KINDS],
  garment_asset_kind: [databaseEnums.garment_asset_kind, GARMENT_ASSET_KINDS],
};

describe('postgres enums match the domain vocabulary', () => {
  for (const [name, [fromDatabase, fromTypes]] of Object.entries(ENUM_PAIRS)) {
    it(`${name} has the same values in the same order`, () => {
      expect([...fromDatabase]).toEqual([...fromTypes]);
    });
  }

  it('leaves no database enum unchecked', () => {
    // `ENUM_PAIRS` is keyed by the generated enum names, so a new Postgres
    // enum type breaks the build rather than slipping past this file.
    expect(Object.keys(databaseEnums).sort()).toEqual(Object.keys(ENUM_PAIRS).sort());
  });
});

const EXPECTED_TABLES = [
  'organizations',
  'shops',
  'staff_users',
  'displays',
  'device_credentials',
  'device_enrollment_codes',
  'device_heartbeats',
  'installations',
  'garments',
  'garment_variants',
  'garment_assets',
  'size_charts',
  'size_measurements',
  'sessions',
  'session_events',
  'customer_requests',
  'consents',
  'recommendation_events',
  'size_recommendation_events',
  'tryon_jobs',
  'audit_logs',
] as const;

/**
 * Compile-time, and therefore enforced by `pnpm typecheck` as well as by the
 * test run. Assigning `true` fails if `Equal` resolves to `false`, which it
 * does if the schema gains a table, loses one, or renames one.
 */
const tablesMatchTheSpecification: Equal<
  (typeof EXPECTED_TABLES)[number],
  keyof Database['public']['Tables']
> = true;

/**
 * Size advice is computed from a garment's size chart and the customer's own
 * stated preference. Persisting a measured body would turn an ephemeral
 * session into a biometric record, so these tables have no column to write one
 * into. `size_measurements` legitimately carries centimetre columns because
 * those describe the garment, not the person.
 */
type BodyMeasurementColumn =
  'chest_cm' | 'waist_cm' | 'hip_cm' | 'height_cm' | 'weight_kg' | 'shoulder_cm' | 'inseam_cm';

type HasNoBodyMeasurements<TRow> =
  Extract<keyof TRow, BodyMeasurementColumn> extends never ? true : false;

const recommendationsStoreNoBody: HasNoBodyMeasurements<Tables<'recommendation_events'>> = true;
const sizeAdviceStoresNoBody: HasNoBodyMeasurements<Tables<'size_recommendation_events'>> = true;
const sessionsStoreNoBody: HasNoBodyMeasurements<Tables<'sessions'>> = true;

/**
 * Without the size the customer actually accepted there is no ground truth,
 * and any accuracy figure published later would be an estimate dressed up as
 * a measurement.
 */
const sizeAdviceRecordsOutcome: 'accepted_size' extends keyof Tables<'size_recommendation_events'>
  ? true
  : false = true;

describe('the generated schema matches what the migrations were meant to create', () => {
  it('defines exactly the specified tables', () => {
    // Twenty from the specification, plus device_enrollment_codes, which
    // Phase 3 added because a mirror needs a way to obtain its first
    // credential without a human ever handling the secret.
    expect(EXPECTED_TABLES).toHaveLength(21);
    expect(tablesMatchTheSpecification).toBe(true);
  });

  it('keeps body measurements out of session and recommendation tables', () => {
    expect(recommendationsStoreNoBody).toBe(true);
    expect(sizeAdviceStoresNoBody).toBe(true);
    expect(sessionsStoreNoBody).toBe(true);
  });

  it('records a size recommendation outcome so accuracy can be measured', () => {
    expect(sizeAdviceRecordsOutcome).toBe(true);
  });
});
