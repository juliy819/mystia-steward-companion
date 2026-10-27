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
 * 这里只描述稀客自身的偏好事实。下层候选列表只是候选，实际做什么由玩家决定，
 * 因此不在偏好摘要上判断任何候选或方案是否命中；命中关系属于具体候选项。
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

/**
 * 单个推荐候选项与该稀客偏好的比对结果。
 */
export interface RarePreferenceMatch {
  likedTags: string[];
  dislikedTags: string[];
}

/**
 * 把某个候选（料理或酒水）生效的 Tag 与这个稀客的喜好、厌恶比对。
 *
 * 结果只描述这一个候选项：哪些 Tag 命中喜好、哪些 Tag 命中厌恶。
 * 判据与推荐引擎一致（直接用运行时喜好/厌恶数组与候选项生效 Tag 求交集），
 * 因此界面标注和引擎用于排序、评价的命中判断不会漂移。
 */
export function matchRarePreferenceTags(
  customer: RareCustomerCatalogItem,
  activeTags: readonly string[],
): RarePreferenceMatch {
  const likedTags = new Set(customer.positiveTags);
  const dislikedTags = new Set(customer.negativeTags);
  return {
    likedTags: activeTags.filter((tag) => likedTags.has(tag)),
    dislikedTags: activeTags.filter((tag) => dislikedTags.has(tag)),
  };
}