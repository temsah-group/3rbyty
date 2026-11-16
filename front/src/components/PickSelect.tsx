import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useI18n } from '@/lib/i18n';

import { cx } from './ui';

export interface PickOption {
  value: string;
  label: string;
  /** Other names it is found by, e.g. a governorate's cities ("طنطا" finds الغربية). */
  keywords?: string[];
}

/** Arabic letter forms people type interchangeably made the same, for the search box. */
const fold = (text: string) => text.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

/**
 * A drop-down drawn by the page rather than the browser: the browser's own
 * list on Windows cuts off the first letter of Arabic names ("لقاهرة"). Long
 * lists get a search box ("اس" → الإسكندرية، الإسماعيلية).
 */
export function PickSelect({
  options,
  value,
  onChange,
  placeholder,
  ariaLabel,
  searchLabel,
  disabled,
  invalid,
}: {
  options: PickOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  /** The search box's placeholder; lists of more than eight get one. */
  searchLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { tr, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const searchable = options.length > 8;

  // Matches by name first, then by another name it goes by (shown under it).
  const shown = useMemo(() => {
    const f = fold(filter.trim());
    if (!f) return options.map((o) => ({ ...o, via: null as string | null }));
    const byName = options.filter((o) => fold(o.label).includes(f)).map((o) => ({ ...o, via: null as string | null }));
    const byKeyword = options
      .filter((o) => !fold(o.label).includes(f))
      .map((o) => ({ ...o, via: o.keywords?.find((k) => fold(k).includes(f)) ?? null }))
      .filter((o) => o.via !== null);
    return [...byName, ...byKeyword];
  }, [options, filter]);

  const close = (focusButton = true) => {
    setOpen(false);
    setFilter('');
    if (focusButton) buttonRef.current?.focus();
  };
  const choose = (option: PickOption) => {
    onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => buttonRef.current && setRect(buttonRef.current.getBoundingClientRect());
    place();
    const outside = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);

  useEffect(() => {
    if (open) setHighlight(Math.max(0, shown.findIndex((o) => o.value === value)));
    // Only when it opens; typing resets it to the first match.
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight, rect]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Keeps a surrounding <dialog> open.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[highlight]) choose(shown[highlight]);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  // Opens upwards when there is no room below.
  const below = rect ? document.documentElement.clientHeight - rect.bottom : 0;
  const up = rect ? below < 300 && rect.top > below : false;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen(true);
          } else if (open) onKeyDown(e);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className={cx(
          'flex h-12 w-full items-center gap-2.5 rounded-xl border bg-white px-4 text-start text-[15px] text-navy focus:outline-none focus:ring-2 focus:ring-navy/15 disabled:bg-canvas disabled:text-ink-muted',
          invalid ? 'border-red-500' : open ? 'border-navy ring-2 ring-navy/15' : 'border-line focus:border-navy',
        )}
      >
        <span className={cx('flex-1 truncate', !selected && 'text-ink-muted')}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cx('h-4 w-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && rect && (
        <div
          ref={listRef}
          onKeyDown={onKeyDown}
          className="fixed z-50 flex max-h-80 flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-line"
          style={{
            // Lines up with the field's start edge and grows towards its end.
            ...(lang === 'ar' ? { right: document.documentElement.clientWidth - rect.right } : { left: rect.left }),
            width: Math.min(Math.max(rect.width, 220), document.documentElement.clientWidth - 16),
            ...(up ? { bottom: document.documentElement.clientHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
          }}
        >
          {searchable && (
            <div className="relative border-b border-line p-2">
              <Search className="pointer-events-none absolute start-5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setHighlight(0);
                }}
                placeholder={searchLabel ?? tr('دوّر…', 'Search…')}
                aria-label={searchLabel ?? tr('دوّر', 'Search')}
                aria-controls={listId}
                aria-activedescendant={shown[highlight] ? `${listId}-${highlight}` : undefined}
                className="h-10 w-full rounded-lg bg-canvas pe-3 ps-9 text-sm text-navy placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
            </div>
          )}
          <ul id={listId} role="listbox" aria-label={ariaLabel} tabIndex={searchable ? undefined : -1} className="overflow-y-auto p-1.5">
            {shown.map((option, i) => (
              <li
                key={option.value || '_'}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={option.value === value}
                onPointerMove={() => setHighlight(i)}
                onClick={() => choose(option)}
                className={cx(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold',
                  i === highlight && 'bg-canvas',
                  option.value === value && 'text-orange-deep',
                )}
              >
                <span className="flex-1">
                  {option.label}
                  {option.via && <span className="block text-xs font-normal text-ink-soft">{option.via}</span>}
                </span>
                {option.value === value && <Check className="h-4 w-4 shrink-0" />}
              </li>
            ))}
            {!shown.length && <li className="px-3 py-6 text-center text-sm text-ink-muted">{tr('مفيش نتايج', 'No matches')}</li>}
          </ul>
        </div>
      )}
    </>
  );
}
