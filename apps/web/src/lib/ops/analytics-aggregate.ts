/**
 * Pure shop-scoped analytics aggregation from existing session rows/events.
 *
 * Outputs contain counts and durations only — never pairing tokens, storage
 * paths, device secrets, or customer identifiers.
 */

export interface OpsSessionRow {
  readonly id: string;
  readonly shop_id: string;
  readonly status: string;
  readonly created_at: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly pairing_claimed_at: string | null;
}

export interface OpsSessionEventRow {
  readonly session_id: string;
  readonly shop_id: string;
  readonly type: string;
  readonly occurred_at: string;
  readonly payload: unknown;
}

export interface CategoryEngagement {
  readonly category: string;
  readonly selections: number;
}

export interface ShopAnalyticsSummary {
  readonly session_count: number;
  readonly claimed_sessions: number;
  readonly active_sessions: number;
  readonly ended_sessions: number;
  readonly garment_selections: number;
  readonly average_session_duration_ms: number | null;
  readonly category_engagement: readonly CategoryEngagement[];
}

function durationMs(session: OpsSessionRow): number | null {
  if (!session.started_at || !session.ended_at) return null;
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function categoryFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'unknown';
  const record = payload as Record<string, unknown>;
  const category = record['category'];
  if (typeof category === 'string' && category.trim()) return category.trim();
  return 'unknown';
}

/**
 * Aggregates sessions + GARMENT_SELECTED events for one already-resolved shop.
 * Caller must filter rows to the staff member's tenant before calling.
 */
export function aggregateShopAnalytics(
  sessions: readonly OpsSessionRow[],
  events: readonly OpsSessionEventRow[],
  shopId: string,
): ShopAnalyticsSummary {
  const shopSessions = sessions.filter((row) => row.shop_id === shopId);
  const shopEvents = events.filter((row) => row.shop_id === shopId);

  let claimed = 0;
  let active = 0;
  let ended = 0;
  const durations: number[] = [];
  for (const session of shopSessions) {
    if (session.pairing_claimed_at) claimed += 1;
    if (session.status === 'ACTIVE') active += 1;
    if (session.status === 'ENDED') ended += 1;
    const d = durationMs(session);
    if (d !== null) durations.push(d);
  }

  const categoryCounts = new Map<string, number>();
  let garmentSelections = 0;
  for (const event of shopEvents) {
    if (event.type !== 'GARMENT_SELECTED') continue;
    garmentSelections += 1;
    const category = categoryFromPayload(event.payload);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }

  const category_engagement = [...categoryCounts.entries()]
    .map(([category, selections]) => ({ category, selections }))
    .sort((a, b) => b.selections - a.selections || a.category.localeCompare(b.category));

  const average_session_duration_ms =
    durations.length === 0
      ? null
      : Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length);

  return {
    session_count: shopSessions.length,
    claimed_sessions: claimed,
    active_sessions: active,
    ended_sessions: ended,
    garment_selections: garmentSelections,
    average_session_duration_ms,
    category_engagement,
  };
}
