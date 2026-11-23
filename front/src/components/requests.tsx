import { Car, Clock, MapPin, MessageSquareReply } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, post } from '@/lib/api';
import { CONDITIONS, useLabels } from '@/lib/catalog';
import { formatPrice, relativeDay } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Condition, MyReply, PartRequest } from '@/lib/types';

import { Button, cx, Field, TextField, Textarea, useToast } from './ui';

/** What a request asks for, in one line: "تويوتا كورولا 2016". */
export function useRequestCar() {
  const labels = useLabels();
  return (request: PartRequest) => `${labels.carName(request.car)}${request.car.year ? ` ${request.car.year}` : ''}`;
}

/** One request in a list: the part, the car, where, how long ago, and its state. */
export function RequestCard({ request, to, footer }: { request: PartRequest; to: string; footer?: React.ReactNode }) {
  const { tr, lang } = useI18n();
  const labels = useLabels();
  const car = useRequestCar();
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
      <Link to={to} className="block">
        <div className="flex items-start justify-between gap-3">
          <p className="text-lg font-extrabold">{request.partName}</p>
          <span className={cx('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold', request.open ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-ink-soft')}>
            {request.open ? tr('مفتوح', 'Open') : tr('مقفول', 'Closed')}
          </span>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span className="flex items-center gap-1"><Car className="h-4 w-4" />{car(request)}</span>
          <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{request.city ? labels.city(request.city) : tr('كل مصر', 'All of Egypt')}</span>
          <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{relativeDay(request.createdAt, lang)}</span>
          {request.category && <span className="rounded-md bg-canvas px-2 text-xs font-bold">{labels.category(request.category)}</span>}
        </p>
        {request.note && <p className="mt-2 line-clamp-2 text-sm">{request.note}</p>}
      </Link>
      {footer}
    </div>
  );
}

/**
 * A shop's answer to a request: its price, the part's condition, a note.
 * Sending again changes the answer.
 */
export function ReplyForm({ request, onSent }: { request: PartRequest; onSent: (reply: MyReply) => void }) {
  const { tr, lang } = useI18n();
  const toast = useToast();
  const mine = request.myReply;
  const [price, setPrice] = useState(mine ? String(mine.price) : '');
  const [condition, setCondition] = useState<Condition>(mine?.condition ?? 'NEW');
  const [isOriginal, setIsOriginal] = useState(mine?.isOriginal ?? true);
  const [note, setNote] = useState(mine?.note ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(price);
    if (!Number.isInteger(value) || value < 1) {
      setError(tr('اكتب السعر بالجنيه', 'Enter the price in pounds'));
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const reply = await post<MyReply>(`/requests/${request.id}/replies`, { price: value, condition, isOriginal, note: note.trim() || null });
      toast(mine ? tr('اتعدّل ردك', 'Your answer was changed') : tr('اتبعت ردك للمشتري', 'Your answer was sent'));
      onSent(reply);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('محصلش، حاول تاني', "Didn't work, try again"));
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <TextField label={tr('سعرك بالجنيه', 'Your price (EGP)')} type="number" inputMode="numeric" min={1} value={price} onChange={(e) => setPrice(e.target.value)} error={error} autoFocus />
      <Field label={tr('الحالة', 'Condition')}>
        <div className="flex flex-wrap gap-2">
          {CONDITIONS.map((c) => (
            <button key={c.id} type="button" aria-pressed={condition === c.id} onClick={() => setCondition(c.id)} className={cx('rounded-xl px-4 py-2 text-sm font-bold ring-1', condition === c.id ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}>
              {lang === 'ar' ? c.ar : c.en}
            </button>
          ))}
          <button type="button" aria-pressed={isOriginal} onClick={() => setIsOriginal(!isOriginal)} className={cx('rounded-xl px-4 py-2 text-sm font-bold ring-1', isOriginal ? 'bg-navy text-white ring-navy' : 'bg-white ring-line hover:ring-navy')}>
            {isOriginal ? tr('أصلي', 'Original') : tr('تجاري', 'Aftermarket')}
          </button>
        </div>
      </Field>
      <Field label={tr('ملاحظة (اختياري)', 'Note (optional)')}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={tr('متوفر عندنا، فيه توصيل، ضمان…', 'In stock, delivery, warranty…')} />
      </Field>
      <Button type="submit" variant="accent" className="w-full" loading={sending}>
        <MessageSquareReply className="h-4 w-4" />
        {mine ? tr('عدّل ردك', 'Change your answer') : tr('ابعت ردك', 'Send your answer')}
      </Button>
      {mine && <p className="text-center text-xs text-ink-soft">{tr(`ردك الحالي: ${formatPrice(mine.price, lang)}`, `Your answer: ${formatPrice(mine.price, lang)}`)}</p>}
    </form>
  );
}
