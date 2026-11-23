import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, Clock, MapPin, Store } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { ContactButtons } from '@/components/actions';
import { ReplyForm, useRequestCar } from '@/components/requests';
import { Button, ErrorState, Img, PageSpinner, Stars, useConfirm, useToast, Verified } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useLabels } from '@/lib/catalog';
import { formatPrice, relativeDay } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo';
import type { PartRequest } from '@/lib/types';

/**
 * One part request. Its buyer sees the shops' answers, cheapest first, and
 * calls or messages them; a shop it was meant for answers with its price.
 */
export default function RequestDetails() {
  const { id = '' } = useParams();
  const { tr, lang } = useI18n();
  const labels = useLabels();
  const car = useRequestCar();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const request = useQuery({ queryKey: ['request', id], queryFn: () => get<PartRequest>(`/requests/${id}`) });
  usePageMeta(request.data?.partName ?? tr('طلب قطعة', 'Part request'), null, { noindex: true });

  if (request.isLoading) return <PageSpinner />;
  if (request.isError || !request.data) return <ErrorState error={request.error} onRetry={() => request.refetch()} />;
  const r = request.data;

  const close = async () => {
    const ok = await confirm({
      title: tr('تقفل الطلب؟', 'Close the request?'),
      body: tr('المحلات مش هتقدر ترد عليه تاني. اقفله لما تلاقي القطعة.', "Shops won't be able to answer any more. Close it once you've found the part."),
      confirmLabel: tr('اقفله', 'Close it'),
    });
    if (!ok) return;
    await post(`/requests/${r.id}/close`);
    queryClient.invalidateQueries({ queryKey: ['request', id] });
    queryClient.invalidateQueries({ queryKey: ['requests', 'mine'] });
    toast(tr('اتقفل الطلب', 'Request closed'));
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <div className="rounded-2xl bg-white p-5 ring-1 ring-line">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-extrabold">{r.partName}</h1>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${r.open ? 'bg-emerald-50 text-emerald-700' : 'bg-canvas text-ink-soft'}`}>{r.open ? tr('مفتوح', 'Open') : tr('مقفول', 'Closed')}</span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          <span className="flex items-center gap-1"><Car className="h-4 w-4" />{car(r)}</span>
          <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{r.city ? labels.city(r.city) : tr('كل مصر', 'All of Egypt')}</span>
          <span className="flex items-center gap-1"><Clock className="h-4 w-4" />{relativeDay(r.createdAt, lang)}</span>
          {r.category && <span className="rounded-md bg-canvas px-2 text-xs font-bold">{labels.category(r.category)}</span>}
        </p>
        {r.note && <p className="mt-3 rounded-xl bg-canvas p-3 text-sm leading-6">{r.note}</p>}
      </div>

      {r.mine ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">{tr('ردود المحلات', "Shops' answers")}</h2>
            {r.open && <Button variant="outline" size="sm" onClick={close}>{tr('لقيت القطعة، اقفل الطلب', 'Found it, close')}</Button>}
          </div>
          {!r.replies?.length ? (
            <p className="rounded-2xl bg-white p-6 text-center text-ink-soft ring-1 ring-line">
              {r.open
                ? tr('بعتنا طلبك للمحلات اللي بتشتغل على عربيتك. هيوصلك إشعار أول ما حد يرد.', "We sent your request to the shops that work on your car. You'll be notified as soon as one answers.")
                : tr('الطلب ده اتقفل من غير ردود.', 'This request closed without answers.')}
            </p>
          ) : (
            <ul className="space-y-3">
              {r.replies.map((reply) => (
                <li key={reply.id} className="rounded-2xl bg-white p-4 ring-1 ring-line">
                  <div className="flex items-start gap-3">
                    <Link to={`/shops/${reply.shop.id}`} className="shrink-0">
                      {reply.shop.logoUrl ? <Img size="thumb" src={reply.shop.logoUrl} alt="" className="h-12 w-12 rounded-xl" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-mist text-navy"><Store className="h-6 w-6" /></span>}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link to={`/shops/${reply.shop.id}`} className="flex items-center gap-1 font-extrabold hover:underline">
                        <span className="truncate">{reply.shop.name}</span>
                        {reply.shop.verified && <Verified />}
                      </Link>
                      <p className="flex items-center gap-2 text-xs text-ink-soft">
                        {labels.city(reply.shop.city)}
                        {reply.shop.rating.count > 0 && <span className="flex items-center gap-1"><Stars value={reply.shop.rating.avg} size={12} />({reply.shop.rating.count})</span>}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-xl font-extrabold">{formatPrice(reply.price, lang)}</p>
                      <p className="text-xs font-bold text-ink-soft">{labels.condition(reply.condition)} · {reply.isOriginal ? tr('أصلي', 'Original') : tr('تجاري', 'Aftermarket')}</p>
                    </div>
                  </div>
                  {reply.note && <p className="mt-3 rounded-xl bg-canvas p-3 text-sm">{reply.note}</p>}
                  <ContactButtons
                    className="mt-3"
                    phone={reply.shop.phone}
                    whatsapp={reply.shop.whatsapp}
                    message={tr(`السلام عليكم، بخصوص طلبي "${r.partName}" على عربيتي، ردكم كان ${reply.price} جنيه.`, `Hi, about my request "${r.partName}" on 3arabity, your answer was ${reply.price} EGP.`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-line">
          <h2 className="mb-4 text-lg font-extrabold">{r.myReply ? tr('ردك', 'Your answer') : tr('عندك القطعة دي؟ رد بسعرك', 'Have it? Answer with your price')}</h2>
          {r.open ? (
            <ReplyForm request={r} onSent={() => queryClient.invalidateQueries({ queryKey: ['request', id] })} />
          ) : (
            <p className="text-ink-soft">{tr('الطلب ده اتقفل.', 'This request is closed.')}</p>
          )}
        </section>
      )}
    </div>
  );
}
