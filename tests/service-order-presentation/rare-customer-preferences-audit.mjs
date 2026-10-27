import assert from 'node:assert/strict';

import { MantineProvider } from '@mantine/core';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

/**
 * 经营中稀客订单卡片的喜好/厌恶展示审计。
 *
 * 验证两件事：领域层只输出稀客自身的偏好事实（不含任何候选或方案的命中判断）；
 * 卡片在没有可执行方案时也仍然显示稀客偏好。
 */
const vite = await createServer({
  configFile: 'apps/companion/vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const [
    { buildRareCustomerPreferenceSummary, matchRarePreferenceTags },
    { RareCustomerPreferenceSummaryPanel },
    { RareOrderRecommendationCard },
    { RecipeRecommendationRow },
    { selectExtraIngredientTags },
    { emptyFavoriteData },
    { emptyCustomRecipeData },
    { buildRecommendationDataIndexes, DEFAULT_RECOMMENDATION_DATA },
  ] = await Promise.all([
    vite.ssrLoadModule('/src/companion/domain/rare-customer-preferences.ts'),
    vite.ssrLoadModule('/src/companion/pages/service/RareCustomerPreferenceSummaryPanel.tsx'),
    vite.ssrLoadModule('/src/companion/pages/service/RareOrderRecommendationCard.tsx'),
    vite.ssrLoadModule('/src/companion/pages/shared.tsx'),
    vite.ssrLoadModule('/src/recommendation-engine/index.ts'),
    vite.ssrLoadModule('/src/companion/domain/favorites.ts'),
    vite.ssrLoadModule('/src/companion/domain/custom-recipes.ts'),
    vite.ssrLoadModule('/src/lib/recommendation-data.ts'),
  ]);

  const customer = buildCustomer();
  const recipe = buildRecipe();
  const beverage = buildBeverage();
  const plan = buildPlan({ customer, recipe, beverage });

  assertPreferenceGroups(buildRareCustomerPreferenceSummary, customer, {
    liked: ['甜', '梦幻'],
    disliked: ['肉'],
    beverage: ['水果', '无酒精'],
  });
  assertPreferenceGroups(buildRareCustomerPreferenceSummary, { ...customer, negativeTags: [] }, {
    liked: ['甜', '梦幻'],
    disliked: [],
    beverage: ['水果', '无酒精'],
  });

  const panelMarkup = renderWithProvider(RareCustomerPreferenceSummaryPanel, {
    summary: buildRareCustomerPreferenceSummary(customer),
  });
  assert.ok(panelMarkup.includes('data-rare-customer-preferences="true"'),
    '偏好摘要必须标记容器，便于界面审计定位。');
  for (const label of ['料理喜好', '料理厌恶', '酒水喜好']) {
    assert.ok(panelMarkup.includes(label), `偏好摘要必须显示分组 ${label}。`);
  }
  assert.equal(countMatches(panelMarkup, 'steward-tag-matched'), 0,
    '偏好摘要只描述稀客偏好，不得判断候选或方案是否命中。');
  assert.equal(countMatches(panelMarkup, 'steward-tag-preferred'), 4,
    '料理喜好和酒水喜好的 Tag 全部使用喜好样式。');
  assert.equal(countMatches(panelMarkup, 'steward-tag-disliked'), 1,
    '厌恶 Tag 全部使用厌恶样式。');
  assert.ok(panelMarkup.includes('无酒精'), '未命中的酒水喜好也必须显示。');
  assert.ok(!panelMarkup.includes('流行'), '流行喜爱/厌恶属于运行时派生 Tag，不进入偏好展示。');
  for (const marker of ['命中', '已含']) {
    assert.ok(!panelMarkup.includes(marker), `偏好摘要不得出现“${marker}”这类候选命中判断。`);
  }

  const emptyDislikeMarkup = renderWithProvider(RareCustomerPreferenceSummaryPanel, {
    summary: buildRareCustomerPreferenceSummary({ ...customer, negativeTags: [] }),
  });
  assert.ok(emptyDislikeMarkup.includes('>无<'), '没有厌恶 Tag 时必须显示“无”，而不是省略分组。');

  const cardOptions = {
    runtimeSets: null,
    dataIndexes: buildRecommendationDataIndexes(DEFAULT_RECOMMENDATION_DATA),
    favorites: emptyFavoriteData(),
    customRecipes: emptyCustomRecipeData(),
    gamepadOccurrenceKey: 'audit',
    favoriteBusyKey: '',
    showDebugDetails: false,
    onToggleRecipeFavorite: () => {},
    onToggleBeverageFavorite: () => {},
  };

  const cardMarkup = renderWithProvider(RareOrderRecommendationCard, {
    ...cardOptions,
    item: buildItem({ customer, recipe, beverage, executionPlans: [plan] }),
  });
  assert.ok(cardMarkup.includes('data-rare-customer-preferences="true"'),
    '稀客订单卡片必须显示喜好与厌恶 Tag。');
  assert.ok(cardMarkup.includes('料理厌恶'), '惩罚符卡任务需要的厌恶 Tag 必须直接可见。');
  assert.ok(!cardMarkup.includes('data-rare-customer-preference-matched'),
    '订单卡片不得把候选命中状态投影到偏好摘要上。');

  const blockedCardMarkup = renderWithProvider(RareOrderRecommendationCard, {
    ...cardOptions,
    item: buildItem({ customer, recipe, beverage, executionPlans: [] }),
  });
  assert.ok(blockedCardMarkup.includes('料理喜好') && blockedCardMarkup.includes('料理厌恶'),
    '没有可执行方案时，卡片仍必须显示稀客偏好。');

  const compactCardMarkup = renderWithProvider(RareOrderRecommendationCard, {
    ...cardOptions,
    compact: true,
    item: buildItem({ customer, recipe, beverage, executionPlans: [plan] }),
  });
  assert.ok(compactCardMarkup.includes('data-rare-customer-preferences="true"'),
    '精简模式同样必须保留稀客偏好展示。');

  assertPreferenceMatch(matchRarePreferenceTags, customer);

  const rowOptions = {
    index: 0,
    ownedIngredientQty: {},
    ingredientIdByName: new Map(),
    gamepadOccurrenceKey: 'audit',
  };
  const matchedRowMarkup = renderWithProvider(RecipeRecommendationRow, {
    ...rowOptions,
    recipe: { recipe, extraIngredients: [], allTags: ['甜', '肉', '素'], cancelledTags: [] },
    customer,
  });
  assert.ok(hasTonePill(matchedRowMarkup, 'matched', '甜'),
    '候选料理命中的喜好 Tag 必须用命中色标注。');
  assert.ok(hasTonePill(matchedRowMarkup, 'disliked', '肉'),
    '候选料理包含的厌恶 Tag 必须用厌恶色标注。');
  assert.ok(hasTonePill(matchedRowMarkup, 'default', '素'),
    '与这个稀客无关的 Tag 必须保持普通色。');

  const plainRowMarkup = renderWithProvider(RecipeRecommendationRow, {
    ...rowOptions,
    recipe: { recipe, extraIngredients: [], allTags: ['甜', '肉', '素'], cancelledTags: [] },
  });
  assert.ok(!plainRowMarkup.includes('steward-tag-matched') && !plainRowMarkup.includes('steward-tag-disliked'),
    '没有稀客上下文时不得凭空标注命中。');

  assertExtraIngredientTags(selectExtraIngredientTags, recipe);

  const extraIngredient = buildExtraIngredient();
  const extraRowMarkup = renderWithProvider(RecipeRecommendationRow, {
    ...rowOptions,
    recipe: {
      recipe,
      extraIngredients: [extraIngredient],
      allTags: ['甜', '高级', '招牌'],
      cancelledTags: [],
    },
    customer,
  });
  assert.ok(extraRowMarkup.includes('data-recipe-extra-ingredient-tags="true"'),
    '加料带来的 Tag 必须单独成组标出。');
  assert.ok(hasTonePill(extraRowMarkup, 'extra', '高级'),
    '与稀客无关的加料 Tag 使用加料色突出。');
  assert.ok(hasTonePill(extraRowMarkup, 'matched', '甜'),
    '配方自带且命中喜好的 Tag 仍使用命中色，不得被移进加料组。');
  assert.ok(!hasTonePill(extraRowMarkup, 'extra', '甜'),
    '配方已经自带的 Tag 不得因为加料也有就算作加料 Tag。');
} finally {
  await vite.close();
}

console.log('PASS: rare cards show guest preference facts, per-candidate preference matches and extra-ingredient tags.');

function buildCustomer() {
  return {
    id: 1001,
    name: '米斯蒂娅',
    description: '',
    dlc: 0,
    places: ['妖怪兽道'],
    price: [120, 380],
    enduranceLimit: 3,
    positiveTags: ['甜', '梦幻', '流行喜爱'],
    negativeTags: ['肉', '流行厌恶'],
    beverageTags: ['水果', '无酒精'],
    collection: false,
    evaluation: {},
    spellCards: { positive: [], negative: [] },
  };
}

function buildRecipe() {
  return {
    id: 1,
    recipeId: 1,
    name: '审计料理',
    description: '',
    ingredients: ['糖'],
    positiveTags: ['甜'],
    negativeTags: [],
    cooker: '锅',
    baseCookTime: 5,
    dlc: 0,
    level: 1,
    price: 50,
    from: {},
  };
}

function buildBeverage() {
  return {
    id: 9,
    name: '审计酒水',
    description: '',
    tags: ['水果'],
    dlc: 0,
    level: 1,
    price: 20,
    from: {},
  };
}

function buildPlan({ customer, recipe, beverage }) {
  return {
    demand: {
      type: 'rare-tag-order',
      customer,
      requiredFoodTag: '甜',
      requiredBeverageTag: '水果',
    },
    food: {
      recipe,
      extraIngredients: [],
      extraIngredientReasonTags: {},
      activeTags: ['甜', '肉'],
      suppressedTags: [],
      matchedPositiveTags: ['甜'],
      matchedNegativeTags: ['肉'],
      matchedSpecialFoodTargetTags: [],
      meetsRequiredFood: true,
      baseCost: 10,
      extraCost: 0,
      resourcePressure: 0,
      cookerAvailable: true,
      conditionResults: [],
    },
    beverage: {
      beverage,
      activeTags: ['水果'],
      matchedTags: ['水果'],
      meetsRequiredBeverage: true,
      ownedQuantity: 1,
      conditionResults: [],
    },
    bucket: 'complete',
    estimatedPrice: 100,
    budget: null,
    conditionResults: [],
    reasons: [],
    warnings: [],
  };
}

function buildItem({ customer, recipe, beverage, executionPlans }) {
  return {
    customer,
    order: {
      deskCode: 3,
      guestName: customer.name,
      foodTag: '甜',
      beverageTag: '水果',
      source: 'audit',
      automationAllowed: true,
    },
    executionPlans,
    budget: null,
    blockedMessages: [],
    blockedDiagnostic: null,
    recipes: [{
      recipe,
      extraIngredients: [],
      allTags: ['甜', '肉'],
      cancelledTags: [],
      meetsRequiredFood: true,
      baseCost: 10,
      extraCost: 0,
    }],
    beverages: [{
      beverage,
      meetsRequiredBev: true,
      matchedTags: ['水果'],
    }],
  };
}

function assertPreferenceGroups(buildPreferenceSummary, customer, expected) {
  const summary = buildPreferenceSummary(customer);
  assert.deepEqual(summary.groups.map((group) => group.kind),
    ['food-liked', 'food-disliked', 'beverage-liked'],
    '偏好分组必须固定为料理喜好、料理厌恶和酒水喜好。');
  assert.deepEqual(summary.groups.map((group) => Object.keys(group).sort()),
    [['kind', 'label', 'tags'], ['kind', 'label', 'tags'], ['kind', 'label', 'tags']],
    '偏好分组只描述稀客偏好事实，不得携带候选或方案的命中字段。');
  assert.deepEqual(summary.groups[0].tags, expected.liked,
    '料理喜好必须使用运行时喜好 Tag 并排除流行派生 Tag。');
  assert.deepEqual(summary.groups[1].tags, expected.disliked,
    '料理厌恶必须保留运行时厌恶 Tag 并排除流行派生 Tag。');
  assert.deepEqual(summary.groups[2].tags, expected.beverage,
    '酒水喜好必须使用运行时酒水 Tag。');
}

function buildExtraIngredient() {
  return {
    id: 77,
    name: '审计加料',
    description: '',
    type: 'meat',
    tags: ['甜', '高级'],
    dlc: 0,
    level: 1,
    price: 30,
    from: {},
  };
}

function assertExtraIngredientTags(selectExtraTags, recipe) {
  const extraIngredient = buildExtraIngredient();
  assert.deepEqual(
    selectExtraTags({
      recipe,
      extraIngredients: [extraIngredient],
      activeTags: ['甜', '高级', '招牌', '流行喜爱'],
    }),
    ['高级'],
    '加料 Tag 必须只保留加料带来、配方没有、且最终生效的 Tag。',
  );
  assert.deepEqual(
    selectExtraTags({ recipe, extraIngredients: [], activeTags: ['甜', '高级'] }),
    [],
    '没有加料时不得标出加料 Tag。',
  );
  assert.deepEqual(
    selectExtraTags({
      recipe: { ...recipe, positiveTags: ['甜', '高级'] },
      extraIngredients: [extraIngredient],
      activeTags: ['甜', '高级'],
    }),
    [],
    '配方已自带加料 Tag 时不得标成加料贡献。',
  );
}

function assertPreferenceMatch(matchPreferenceTags, customer) {
  const match = matchPreferenceTags(customer, ['甜', '肉', '素', '水果', '梦幻']);
  assert.deepEqual(match.likedTags, ['甜', '梦幻'],
    '候选项与喜好的比对必须保持候选项真实命中的喜好 Tag。');
  assert.deepEqual(match.dislikedTags, ['肉'],
    '候选项与厌恶的比对必须保持候选项真实包含的厌恶 Tag。');
  assert.deepEqual(matchPreferenceTags(customer, []), { likedTags: [], dislikedTags: [] },
    '没有生效 Tag 的候选项不得声明任何命中。');
  assert.deepEqual(matchPreferenceTags(customer, ['完全不相关']), { likedTags: [], dislikedTags: [] },
    '不属于该稀客偏好的 Tag 不得计入命中。');
}

function hasTonePill(markup, tone, tag) {
  return new RegExp(`steward-tag-${tone}[^>]*>\\s*<span[^>]*>${tag}</span>`, 'u').test(markup);
}

function renderWithProvider(Component, props) {
  return renderToStaticMarkup(React.createElement(
    MantineProvider,
    null,
    React.createElement(Component, props),
  ));
}

function countMatches(markup, value) {
  return markup.split(value).length - 1;
}
