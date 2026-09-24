/**
 * Branded identifier types.
 *
 * Every persisted entity uses a UUID. Branding prevents a `ShopId` from being
 * passed where a `DisplayId` is expected, which is the class of mistake most
 * likely to cause a cross-tenant data leak.
 */

declare const brand: unique symbol;

export type Branded<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type Uuid = string;

export type OrganizationId = Branded<Uuid, 'OrganizationId'>;
export type ShopId = Branded<Uuid, 'ShopId'>;
export type StaffUserId = Branded<Uuid, 'StaffUserId'>;
export type DisplayId = Branded<Uuid, 'DisplayId'>;
export type DeviceCredentialId = Branded<Uuid, 'DeviceCredentialId'>;
export type InstallationId = Branded<Uuid, 'InstallationId'>;
export type GarmentId = Branded<Uuid, 'GarmentId'>;
export type GarmentVariantId = Branded<Uuid, 'GarmentVariantId'>;
export type GarmentAssetId = Branded<Uuid, 'GarmentAssetId'>;
export type SizeChartId = Branded<Uuid, 'SizeChartId'>;
export type SessionId = Branded<Uuid, 'SessionId'>;
export type SessionEventId = Branded<Uuid, 'SessionEventId'>;
export type CustomerRequestId = Branded<Uuid, 'CustomerRequestId'>;
export type ConsentId = Branded<Uuid, 'ConsentId'>;
export type TryOnJobId = Branded<Uuid, 'TryOnJobId'>;
export type AuditLogId = Branded<Uuid, 'AuditLogId'>;
