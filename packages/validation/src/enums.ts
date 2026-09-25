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
  SUPPORTED_LOCALES,
  TRYON_JOB_STATUSES,
} from '@mirrorfit/types';
import { z } from 'zod';

export const staffRoleSchema = z.enum(STAFF_ROLES);
export const actorKindSchema = z.enum(ACTOR_KINDS);
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export const sessionEndReasonSchema = z.enum(SESSION_END_REASONS);
export const deviceStatusSchema = z.enum(DEVICE_STATUSES);
export const installationStatusSchema = z.enum(INSTALLATION_STATUSES);
export const customerRequestStatusSchema = z.enum(CUSTOMER_REQUEST_STATUSES);
export const tryOnJobStatusSchema = z.enum(TRYON_JOB_STATUSES);
export const garmentAssetKindSchema = z.enum(GARMENT_ASSET_KINDS);
export const sizeLabelSchema = z.enum(SIZE_LABELS);
export const consentKindSchema = z.enum(CONSENT_KINDS);
export const localeSchema = z.enum(SUPPORTED_LOCALES);
