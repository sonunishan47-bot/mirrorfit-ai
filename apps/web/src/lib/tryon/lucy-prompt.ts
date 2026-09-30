/**
 * Clothing prompt for local Lucy Edit Dev.
 * Do not add face, pose, or identity instructions. The model rejects that style.
 */

export interface LucyPromptFields {
  readonly color: string;
  readonly garment: string;
  readonly fabricAndDetails: string;
  readonly fit: string;
  readonly extraPrompt?: string | null;
}

const FALLBACK_FABRIC = 'shop fabric';
const FALLBACK_FIT = 'as cut';

export function lucyOutfitPrompt(fields: LucyPromptFields): string {
  const color = clean(fields.color) || 'selected';
  const garment = clean(fields.garment) || 'garment';
  const fabric = clean(fields.fabricAndDetails) || FALLBACK_FABRIC;
  const fit = clean(fields.fit) || FALLBACK_FIT;
  const core = `Change the outfit to a ${color} ${garment}, ${fabric}, ${fit}, natural folds and drape, realistic studio lighting, full-body mid-shot.`;
  const extra = clean(fields.extraPrompt ?? '');
  return extra ? `${core} ${extra}` : core;
}

export function lucyDescription(fields: {
  readonly fabricAndDetails?: string | null;
  readonly fit?: string | null;
  readonly extraPrompt?: string | null;
}): string | null {
  const lines: string[] = [];
  const fabric = clean(fields.fabricAndDetails ?? '');
  const fit = clean(fields.fit ?? '');
  const extra = clean(fields.extraPrompt ?? '');
  if (fabric) lines.push(`fabric: ${fabric}`);
  if (fit) lines.push(`fit: ${fit}`);
  if (extra) lines.push(`extra: ${extra}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

export function parseLucyDescription(description: string | null | undefined): {
  readonly fabricAndDetails: string;
  readonly fit: string;
  readonly extraPrompt: string;
} {
  const fabric = labeled(description, 'fabric');
  const fit = labeled(description, 'fit');
  const extra = labeled(description, 'extra');
  return { fabricAndDetails: fabric, fit, extraPrompt: extra };
}

function labeled(description: string | null | undefined, key: string): string {
  if (!description) return '';
  for (const line of description.split('\n')) {
    const trimmed = line.trim();
    const prefix = `${key}:`;
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return clean(trimmed.slice(prefix.length));
    }
  }
  return '';
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}
