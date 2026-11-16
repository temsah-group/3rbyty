import { useQuery } from '@tanstack/react-query';

import { get } from './api';
import { useAuth } from './auth';
import type { Shop } from './types';

/** The signed-in account's shop, or null; shared with the shop page's cache. */
export function useMyShop() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['me', 'shop'],
    queryFn: () => get<Shop | null>('/shops/mine'),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
}

/**
 * Who the account shows as: a shop owner is their shop (its name and logo),
 * everyone else is themselves.
 */
export function useIdentity() {
  const { user } = useAuth();
  const shop = useMyShop().data ?? null;
  if (!user) return null;
  return shop
    ? { isShop: true as const, shop, name: shop.name, shortName: shop.name, photo: shop.logoUrl }
    : { isShop: false as const, shop: null, name: user.fullName, shortName: user.fullName.split(' ')[0], photo: user.profilePhotoUrl };
}
