import { isOrderableRareFoodTag } from '@/companion/domain/service-recommendations';
import type { RareCustomerCatalogItem } from '@/lib/catalog-types';

/**
 * 稀客偏好分组。料理与酒水分开，因为点单和评价都按这两种对象各自计算。
 */
export type RareCustomerPreferenceKind = 'food-liked' | 'food-disliked' | 'beverage-liked';

export interface RareCustomerPreferenceGroup {
  kind: RareCustomerPreferenceKind;
  label: string;
  tags: string[];
}

export interface RareCustomerPreferenceSummary {
  groups: RareCustomerPreferenceGroup[];
}

const PREFERENCE_GROUP_DEFINITIONS: Array<{
  kind: RareCustomerPreferenceKind;
  label: string;
  selectTags: (customer: RareCustomerCatalogItem) => string[];
}> = [
  {
    kind: 'food-liked',
    label: '料理喜好',
    selectTags: (customer) => customer.positiveTags.filter(isOrderableRareFoodTag),
  },
  {
    kind: 'food-disliked',
    label: '料理厌恶',
    selectTags: (customer) => customer.negativeTags.filter(isOrderableRareFoodTag),
  },
  {
    kind: 'beverage-liked',
    label: '酒水喜好',
    selectTags: (customer) => customer.beverageTags,
  },
];

/**
 * 把稀客的喜好、厌恶和酒水偏好整理成订单卡片可直接渲染的分组。
 *
 * 这里只描述稀客自身的偏好事实。
 * 流行喜爱/流行厌恶是运行时派生 Tag，不属于稀客个人偏好，不进入展示。
 */
export function buildRareCustomerPreferenceSummary(
  customer: RareCustomerCatalogItem,
): RareCustomerPreferenceSummary {
  return {
    groups: PREFERENCE_GROUP_DEFINITIONS.map((definition) => ({
      kind: definition.kind,
      label: definition.label,
      tags: definition.selectTags(customer),
    })),
  };
}