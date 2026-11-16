import { useQuery } from '@tanstack/react-query';
import { Heart, Store } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import { PageShell } from '@/components/Layout';
import { PartGrid, PartGridSkeleton } from '@/components/parts';
import { ShopCard } from '@/components/shops';
import { Button, cx, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { get } from '@/lib/api';
import { saved, savedShops } from '@/lib/collections';
import { useI18n } from '@/lib/i18n';
import { LoadMore, usePaged } from '@/lib/paging';
import type { Part, Shop } from '@/lib/types';
import { usePageMeta } from '@/lib/seo';

export default function Saved() {
  const { tr } = useI18n();
  usePageMeta(tr('المحفوظات', 'Saved'));
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'shops' ? 'shops' : 'parts';
  const partCount = saved.use().length;
  const shopCount = savedShops.use().length;

  const tabClass = (on: boolean) =>
    cx('flex-1 rounded-lg px-4 py-2 text-sm font-bold transition-colors md:flex-none', on ? 'bg-white text-navy shadow-sm' : 'text-ink-soft hover:text-navy');

  return (
    <PageShell title={tr('المحفوظات', 'Saved')} wide>
      <div role="tablist" className="mb-6 flex gap-1 rounded-xl bg-canvas p-1 md:inline-flex">
        <button role="tab" aria-selected={tab === 'parts'} className={tabClass(tab === 'parts')} onClick={() => setParams({}, { replace: true })}>
          {tr('القطع', 'Parts')} {partCount > 0 && `(${partCount})`}
        </button>
        <button role="tab" aria-selected={tab === 'shops'} className={tabClass(tab === 'shops')} onClick={() => setParams({ tab: 'shops' }, { replace: true })}>
          {tr('المحلات', 'Shops')} {shopCount > 0 && `(${shopCount})`}
        </button>
      </div>
      {tab === 'parts' ? <SavedParts /> : <SavedShops />}
    </PageShell>
  );
}

function SavedParts() {
  const { tr } = useI18n();
  const ids = saved.use();
  // The ids drive the list, so removing one hides it at once.
  const parts = useQuery({
    queryKey: ['parts', 'batch', 'saved', ids.join(',')],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < Math.min(ids.length, 200); i += 50) chunks.push(ids.slice(i, i + 50));
      const pages = await Promise.all(chunks.map((c) => get<{ items: Part[] }>('/parts/batch', { ids: c.join(',') })));
      return { items: pages.flatMap((p) => p.items) };
    },
    enabled: ids.length > 0,
    placeholderData: (previous) => previous,
  });
  const items = (parts.data?.items ?? []).filter((p) => ids.includes(p.id));

  if (ids.length === 0) {
    return (
      <EmptyState
        icon={<Heart className="h-10 w-10" />}
        title={tr('لسه محفظتش حاجة', 'Nothing saved yet')}
        body={tr('دوس على القلب في أي قطعة عشان ترجعلها بسهولة، وهنقولك لو سعرها نزل.', "Tap the heart on any part to find it again, and we'll tell you if its price drops.")}
        action={<Link to="/search"><Button tabIndex={-1}>{tr('دوّر على قطع', 'Browse parts')}</Button></Link>}
      />
    );
  }
  if (parts.isLoading) return <PartGridSkeleton count={Math.min(ids.length, 8)} />;
  if (parts.isError) return <ErrorState error={parts.error} onRetry={() => parts.refetch()} />;
  return <PartGrid parts={items} />;
}

function SavedShops() {
  const { tr } = useI18n();
  const ids = savedShops.use();
  const list = usePaged<Shop>(['me', 'saved-shops'], '/users/me/saved-shops', {}, { enabled: ids.length > 0 });
  // Unsaving one hides it at once, before the list reloads.
  const items = list.items.filter((s) => ids.includes(s.id));

  if (ids.length === 0) {
    return (
      <EmptyState
        icon={<Store className="h-10 w-10" />}
        title={tr('لسه محفظتش محلات', 'No saved shops yet')}
        body={tr('دوس على القلب في أي محل عشان ترجعله بسهولة.', 'Tap the heart on any shop to find it again.')}
        action={<Link to="/shops"><Button tabIndex={-1}>{tr('شوف المحلات', 'Browse shops')}</Button></Link>}
      />
    );
  }
  if (list.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: Math.min(ids.length, 6) }, (_, i) => <Skeleton key={i} className="h-52" />)}
      </div>
    );
  }
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => <ShopCard key={s.id} shop={s} />)}
      </div>
      <LoadMore hasNext={list.hasNextPage} loading={list.isFetchingNextPage} onLoad={() => list.fetchNextPage()} />
    </>
  );
}
