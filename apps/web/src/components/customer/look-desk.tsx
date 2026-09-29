'use client';

import { useEffect, useState } from 'react';

import {
  UI_COPY,
  adviceForItem,
  assistantReply,
  buildMannequinSpec,
  colorHex,
  completeLook,
  isSizeLabel,
  itemMatchesQuery,
  nextView,
  parseShopCommand,
  productDescription,
  type ChartSize,
  type MannequinView,
  type ShopCommand,
} from '@mirrorfit/experience';
import type { Locale } from '@mirrorfit/types';
import { resolveFitCategory } from '@mirrorfit/tryon-core';

import type { CustomerCatalogItem } from '@/lib/customer/catalog-client';

import { MannequinStage } from '../mirror/mannequin-stage';

function asExperience(item: CustomerCatalogItem) {
  return {
    garmentId: item.garmentId,
    variantId: item.variantId,
    name: item.name,
    category: item.category,
    brand: item.brand,
    colorName: item.colorName,
    sizes: item.sizes,
    priceMinor: item.priceMinor,
    currencyCode: item.currencyCode,
  };
}

function startDictation(locale: Locale, onText: (value: string) => void): void {
  const host = window as Window & {
    webkitSpeechRecognition?: new () => {
      lang: string;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      start: () => void;
    };
    SpeechRecognition?: new () => {
      lang: string;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      start: () => void;
    };
  };
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (!Ctor) return;
  const rec = new Ctor();
  rec.lang = locale === 'ar' ? 'ar-SA' : 'en-US';
  rec.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript ?? '';
    if (transcript.trim()) onText(transcript);
  };
  rec.start();
}

/**
 * Phone stylist. Catalog text, a mannequin, and try-on status only.
 * The realistic photo is never requested.
 */
export function LookDesk({
  items,
  selected,
  size,
  readToken,
  usingCache,
  onApply,
}: {
  readonly items: readonly CustomerCatalogItem[];
  readonly selected: CustomerCatalogItem | null;
  readonly size: string | null;
  readonly readToken: () => string | null;
  readonly usingCache: boolean;
  readonly onApply: (item: CustomerCatalogItem, size: string | null) => void;
}) {
  const [locale, setLocale] = useState<Locale>('en');
  const [commandText, setCommandText] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const [matches, setMatches] = useState<readonly CustomerCatalogItem[] | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [chart, setChart] = useState<readonly ChartSize[]>([]);
  const [tryOnStatus, setTryOnStatus] = useState<string | null>(null);
  const [view, setView] = useState<MannequinView>('front');
  const [rotation, setRotation] = useState(0);
  const copy = UI_COPY[locale];

  useEffect(() => {
    const token = readToken();
    if (!token || !selected) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/session/size?garment_id=${selected.garmentId}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { sizes?: unknown[] };
        if (cancelled || !Array.isArray(body.sizes)) return;
        const next: ChartSize[] = [];
        for (const row of body.sizes) {
          if (!row || typeof row !== 'object') continue;
          const record = row as Record<string, unknown>;
          if (typeof record['label'] !== 'string') continue;
          const cm = (key: string): number | null =>
            typeof record[key] === 'number' ? record[key] : null;
          next.push({
            label: record['label'],
            chestCm: cm('chest_cm'),
            waistCm: cm('waist_cm'),
            hipCm: cm('hip_cm'),
            lengthCm: cm('length_cm'),
            sleeveCm: cm('sleeve_cm'),
            inseamCm: cm('inseam_cm'),
          });
        }
        if (!cancelled) setChart(next);
      } catch {
        if (!cancelled) setChart([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readToken, selected]);

  useEffect(() => {
    const token = readToken();
    if (!token || !selected) return;
    let cancelled = false;
    const pull = () => {
      void (async () => {
        try {
          const response = await fetch('/api/session/tryon-status', {
            headers: { authorization: `Bearer ${token}` },
          });
          if (!response.ok || cancelled) return;
          const body = (await response.json()) as { status?: string | null };
          if (!cancelled) setTryOnStatus(typeof body.status === 'string' ? body.status : null);
        } catch {
          if (!cancelled) setTryOnStatus(null);
        }
      })();
    };
    pull();
    const timer = window.setInterval(pull, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [readToken, selected]);

  function applyCommand(command: ShopCommand): void {
    if (command.type === 'show') {
      const found = items.filter((item) => itemMatchesQuery(asExperience(item), command.query));
      setMatches(found);
      setReply(assistantReply(command, locale, found.length));
      return;
    }
    if (command.type === 'size' && selected) {
      if (selected.sizes.length === 0 || selected.sizes.includes(command.size)) {
        onApply(selected, command.size);
      }
      setReply(assistantReply(command, locale, null));
      return;
    }
    if (command.type === 'next-color' && selected) {
      const colors = items.filter((item) => item.garmentId === selected.garmentId);
      const index = colors.findIndex((item) => item.variantId === selected.variantId);
      const next = colors[(index + 1) % colors.length];
      if (next) onApply(next, size);
      setReply(assistantReply(command, locale, null));
      return;
    }
    if (command.type === 'compare') {
      setReply(assistantReply(command, locale, null));
      return;
    }
    if (command.type === 'view') {
      setView(command.view);
      setReply(assistantReply(command, locale, null));
      return;
    }
    if (command.type === 'complete-look') {
      setReply(assistantReply(command, locale, null));
      return;
    }
    setReply(assistantReply(command, locale, null));
  }

  const advice =
    selected && heightCm
      ? adviceForItem(asExperience(selected), chart, {
          chestCm: null,
          waistCm: null,
          hipCm: null,
          heightCm: Number(heightCm),
        })
      : null;
  const companions = selected ? completeLook(asExperience(selected), items.map(asExperience)) : [];
  const compare = compareId ? (items.find((item) => item.variantId === compareId) ?? null) : null;
  const spec = buildMannequinSpec({
    view,
    rotationDeg: rotation,
    fit: resolveFitCategory(selected?.category ?? null),
    colorHex: colorHex(selected?.colorName),
    size,
    length: 1,
    sleeve: 1,
    waist: 1,
  });

  return (
    <section className="space-y-4" dir={locale === 'ar' ? 'rtl' : 'ltr'} data-testid="look-desk">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-customer-ink">
          {locale === 'ar' ? 'المساعد' : 'Stylist'}
        </h3>
        <button
          type="button"
          className="text-xs uppercase tracking-[0.2em] text-customer-quiet"
          onClick={() => setLocale((current) => (current === 'en' ? 'ar' : 'en'))}
        >
          {locale === 'en' ? 'العربية' : 'English'}
        </button>
      </div>
      <p className="text-sm text-customer-quiet">{copy.resultOnMirror}</p>
      {usingCache ? <p className="text-sm text-customer-quiet">{copy.offline}</p> : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          applyCommand(parseShopCommand(commandText));
        }}
      >
        <input
          value={commandText}
          onChange={(event) => setCommandText(event.target.value)}
          placeholder={locale === 'ar' ? 'أرني عباية سوداء' : 'show black abayas'}
          className="min-w-0 flex-1 rounded-full bg-[#ebe6dc] px-4 py-2 text-sm text-customer-ink"
          aria-label={locale === 'ar' ? 'أمر' : 'Command'}
        />
        <button
          type="button"
          className="text-xs text-customer-quiet"
          onClick={() =>
            startDictation(locale, (text) => {
              setCommandText(text);
              applyCommand(parseShopCommand(text));
            })
          }
        >
          {locale === 'ar' ? 'صوت' : 'Voice'}
        </button>
      </form>
      {reply ? <p className="text-sm text-customer-ink">{reply}</p> : null}
      {tryOnStatus ? (
        <p className="text-sm text-customer-quiet" role="status">
          {locale === 'ar' ? 'حالة المرآة' : 'Mirror job'}: {tryOnStatus}
        </p>
      ) : null}
      {matches && matches.length > 0 ? (
        <ul className="space-y-2">
          {matches.slice(0, 6).map((item) => (
            <li key={item.variantId}>
              <button
                type="button"
                className="text-sm text-customer-ink underline-offset-2 hover:underline"
                onClick={() => onApply(item, size)}
              >
                {item.name} · {item.colorName}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <div className="space-y-3 rounded-2xl bg-customer-surface p-4">
          <p className="text-sm text-customer-ink">
            {productDescription(asExperience(selected), locale)}
          </p>
          <p className="text-xs text-customer-quiet">{copy.notSaved}</p>
          <label className="block text-xs text-customer-quiet">
            {locale === 'ar' ? 'الطول بالسنتيمتر' : 'Height in centimetres'}
            <input
              inputMode="decimal"
              value={heightCm}
              onChange={(event) => setHeightCm(event.target.value)}
              className="mt-1 w-full rounded-full bg-[#ebe6dc] px-4 py-2 text-sm text-customer-ink"
            />
          </label>
          {advice && 'size' in advice ? (
            <button
              type="button"
              className="text-sm text-customer-ink"
              onClick={() => onApply(selected, advice.size)}
            >
              {advice.rationale} {advice.size} ({advice.source}, {advice.fit})
            </button>
          ) : null}
          {companions.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-customer-quiet">
                {locale === 'ar' ? 'أكمل الإطلالة' : 'Complete this look'}
              </p>
              {companions.map((item) => {
                const row = items.find((candidate) => candidate.variantId === item.variantId);
                if (!row) return null;
                return (
                  <button
                    key={row.variantId}
                    type="button"
                    className="block text-sm text-customer-ink"
                    onClick={() => onApply(row, isSizeLabel(size) ? size : null)}
                  >
                    {row.name} · {row.colorName}
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            className="text-xs uppercase tracking-[0.2em] text-customer-quiet"
            onClick={() => {
              const other = items.find((item) => item.variantId !== selected.variantId);
              setCompareId(other?.variantId ?? null);
            }}
          >
            {locale === 'ar' ? 'قارن' : 'Compare'}
          </button>
          {compare && compare.variantId !== selected.variantId ? (
            <p className="text-sm text-customer-quiet">
              {productDescription(asExperience(compare), locale)}
            </p>
          ) : null}
          <p className="text-xs text-customer-quiet">{copy.mannequin}</p>
          <MannequinStage spec={spec} />
          <div className="flex gap-2">
            <button
              type="button"
              className="text-xs text-customer-quiet"
              onClick={() => setView((current) => nextView(current))}
            >
              {view}
            </button>
            <input
              type="range"
              min={-180}
              max={180}
              value={rotation}
              aria-label="rotation"
              onChange={(event) => setRotation(Number(event.target.value))}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
