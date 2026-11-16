import { useQuery } from '@tanstack/react-query';
import { MessageSquareReply, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { PageShell } from '@/components/Layout';
import { RequestCard } from '@/components/requests';
import { Button, EmptyState, ErrorState, PageSpinner } from '@/components/ui';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePageMeta } from '@/lib/seo';
import type { PartRequest } from '@/lib/types';

/** The buyer's part requests and how many shops answered each. */
export default function MyRequests() {
  const { tr } = useI18n();
  usePageMeta(tr('طلباتي', 'My requests'), null, { noindex: true });
  const list = useQuery({ queryKey: ['requests', 'mine'], queryFn: () => get<{ items: PartRequest[] }>('/requests/mine') });

  return (
    <PageShell title={tr('طلباتي', 'My requests')}>
      <div className="mb-4 flex justify-end">
        <Link to="/requests/new">
          <Button variant="accent" size="sm" tabIndex={-1}><Plus className="h-4 w-4" />{tr('اطلب قطعة', 'Ask for a part')}</Button>
        </Link>
      </div>
      {list.isLoading ? (
        <PageSpinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState
          icon={<MessageSquareReply className="h-10 w-10" />}
          title={tr('لسه ما طلبتش قطعة', 'No requests yet')}
          body={tr('مش لاقي القطعة؟ اطلبها والمحلات ترد عليك بأسعارها.', "Can't find a part? Ask for it and shops answer with their prices.")}
        />
      ) : (
        <div className="space-y-3">
          {list.data.items.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              to={`/requests/${request.id}`}
              footer={
                <p className="mt-3 border-t border-line pt-3 text-sm font-bold text-navy">
                  {request.replyCount
                    ? tr(`${request.replyCount} ${request.replyCount === 1 ? 'محل رد' : 'محلات ردت'} عليك`, `${request.replyCount} shop${request.replyCount === 1 ? '' : 's'} answered`)
                    : tr('لسه محدش رد', 'No answers yet')}
                </p>
              }
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}
