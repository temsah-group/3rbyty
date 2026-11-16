import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, MessageSquareReply } from 'lucide-react';
import { useState } from 'react';

import { PageShell } from '@/components/Layout';
import { ReplyForm, RequestCard } from '@/components/requests';
import { Button, Dialog, EmptyState, ErrorState, PageSpinner } from '@/components/ui';
import { ApiError, get } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo';
import type { PartRequest } from '@/lib/types';

/**
 * A shop's inbox: the open requests for the makes it carries, in its
 * governorate or where it delivers, newest first, each answered in a tap.
 */
export default function ShopRequests() {
  const { tr, lang } = useI18n();
  usePageMeta(tr('طلبات المشترين', "Buyers' requests"), null, { noindex: true });
  const queryClient = useQueryClient();
  const inbox = useQuery({ queryKey: ['requests', 'inbox'], queryFn: () => get<{ items: PartRequest[] }>('/requests/inbox'), retry: false });
  const [answering, setAnswering] = useState<PartRequest | null>(null);

  const notShop = inbox.error instanceof ApiError && inbox.error.code === 'SHOP_REQUIRED';
  return (
    <PageShell title={tr('طلبات المشترين', "Buyers' requests")}>
      <p className="mb-4 text-sm text-ink-soft">
        {tr('مشترين بيدوّروا على قطع للعربيات اللي محلك بيشتغل عليها، في محافظتك أو الأماكن اللي بتوصّلها. رد بسعرك والمشتري هيكلمك.', 'Buyers looking for parts for the makes your shop carries, in your governorate or where you deliver. Answer with your price and the buyer will contact you.')}
      </p>
      {inbox.isLoading ? (
        <PageSpinner />
      ) : notShop ? (
        <EmptyState icon={<MessageSquareReply className="h-10 w-10" />} title={tr('الطلبات للمحلات اللي اتوافق عليها', 'Requests are for approved shops')} body={tr('أول ما محلك يتوافق عليه، طلبات المشترين هتظهر هنا.', "As soon as your shop is approved, buyers' requests show here.")} />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />
      ) : !inbox.data?.items.length ? (
        <EmptyState icon={<MessageSquareReply className="h-10 w-10" />} title={tr('مفيش طلبات دلوقتي', 'No requests right now')} body={tr('هيوصلك إشعار أول ما مشتري يطلب قطعة لعربية بتشتغل عليها.', "You'll be notified when a buyer asks for a part for a make you carry.")} />
      ) : (
        <div className="space-y-3">
          {inbox.data.items.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              to={`/requests/${request.id}`}
              footer={
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                  {request.myReply ? (
                    <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      {tr(`رديت بـ ${formatPrice(request.myReply.price, lang)}`, `Answered: ${formatPrice(request.myReply.price, lang)}`)}
                    </span>
                  ) : (
                    <span className="text-sm text-ink-soft">{tr('لسه ما ردتش', 'Not answered yet')}</span>
                  )}
                  <Button size="sm" variant={request.myReply ? 'outline' : 'accent'} onClick={() => setAnswering(request)}>
                    {request.myReply ? tr('عدّل ردك', 'Change') : tr('رد بسعرك', 'Answer')}
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      )}
      <Dialog open={answering !== null} onClose={() => setAnswering(null)} title={answering?.partName ?? ''}>
        {answering && (
          <ReplyForm
            request={answering}
            onSent={() => {
              setAnswering(null);
              queryClient.invalidateQueries({ queryKey: ['requests', 'inbox'] });
            }}
          />
        )}
      </Dialog>
    </PageShell>
  );
}
