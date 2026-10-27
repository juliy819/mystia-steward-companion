import { TagPillGroup, type TagPillTone } from '@/components/recommendation/TagPillGroup';
import { composeClassNames } from '@/components/ui/style';
import type {
  RareCustomerPreferenceKind,
  RareCustomerPreferenceSummary,
} from '@/companion/domain/rare-customer-preferences';

const PREFERENCE_TONES: Record<RareCustomerPreferenceKind, TagPillTone> = {
  'food-liked': 'positive',
  'food-disliked': 'negative',
  'beverage-liked': 'positive',
};

/**
 * 订单卡片上的稀客偏好摘要：只列出这个稀客喜好、厌恶和偏好的 Tag。
 *
 * 不加任何"命中"判断：下面的推荐料理和酒水只是候选，实际做什么由玩家决定，
 * 候选与偏好的命中关系属于各自候选项。
 */
export function RareCustomerPreferenceSummaryPanel({
  summary,
  compact = false,
  className,
}: {
  summary: RareCustomerPreferenceSummary;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={composeClassNames(
        'steward-inline-panel',
        compact ? 'space-y-1 px-2 py-1.5' : 'space-y-1.5 px-2 py-2',
        className,
      )}
      data-rare-customer-preferences="true"
    >
      {summary.groups.map((group) => (
        <div
          key={group.kind}
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
          data-rare-customer-preference-group={group.kind}
        >
          <span className="shrink-0 text-muted-foreground">{group.label}</span>
          {group.tags.length === 0
            ? <span className="text-muted-foreground">无</span>
            : <TagPillGroup tags={group.tags} tone={PREFERENCE_TONES[group.kind]} />}
        </div>
      ))}
    </div>
  );
}