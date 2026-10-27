/**
 * 预览用「多标签稀客 + 更长候选项列表」场景。
 *
 * `scripts/mock-local-api.mjs` 只有 8 道料理、6 款酒水和 4 个稀客，任何角色看起来都标签少、
 * 候选短。这个模块只给本地预览截图叠加一份更丰富的数据：新增一位多标签稀客、一批料理和酒水，
 * 并把经营中的点单换成这位稀客。
 *
 * 厌恶 Tag 特意包含「梦幻」：稀客点的是「高级」，而高级多数只能靠加料月光草补出来，
 * 月光草同时又带「梦幻」，因此候选行里既能出现命中喜好，也能出现包含厌恶，方便检查两种标注。
 * 月华刺身自带高级但不带梦幻，用来对照一条干净（只有命中绿）的行。
 *
 * 它不修改 mock 服务本身，只在截图时拦截 `/runtime-data` 和 `/snapshot`，
 * 因此其它审计看到的 mock 数据保持原样。
 */
const RICH_GUEST_ID = 1099;
const RICH_GUEST_NAME = '预览稀客';
const RICH_ORDER_TRACE_ID = 'R-9001';
const RICH_DESK_CODE = 5;

const RICH_GUEST_LIKED_TAGS = ['高级', '甜', '适合拍照', '清淡', '家常', '鲜'];
const RICH_GUEST_DISLIKED_TAGS = ['梦幻', '肉', '灼热', '昂贵'];
const RICH_GUEST_BEVERAGE_TAGS = ['水果', '无酒精', '可加热', '清酒', '低酒精'];

const RICH_RECIPES = [
  richRecipe(211, 1211, '蜜渍月光糕', ['月光草', '蜂蜜'], ['梦幻', '甜', '高级'], '料理台', 70),
  richRecipe(212, 1212, '鲜菇暖汤', ['蘑菇', '黄瓜'], ['鲜', '清淡', '菌类'], '煮锅', 28),
  richRecipe(213, 1213, '蜂蜜黄瓜卷', ['黄瓜', '蜂蜜'], ['清爽', '素', '适合拍照'], '料理台', 19),
  // 基础材料里有月光草，但月光草只在作为加料时才贡献 Tag，所以这道菜自带高级而不带梦幻。
  richRecipe(214, 1214, '月华刺身', ['鲑鱼', '月光草'], ['水产', '鲜', '高级'], '料理台', 58),
  richRecipe(215, 1215, '梦幻草沙拉', ['月光草', '黄瓜', '蜂蜜'], ['清爽', '梦幻', '适合拍照'], '料理台', 45),
  richRecipe(216, 1216, '甜辣蛋卷', ['鸡蛋', '辣椒'], ['灼热', '肉'], '烧烤架', 33),
  richRecipe(217, 1217, '蜜汁烤鲑鱼', ['鲑鱼', '蜂蜜'], ['甜', '水产', '高级'], '烧烤架', 58),
  richRecipe(218, 1218, '菌菇蒸蛋', ['鸡蛋', '蘑菇'], ['鲜', '菌类', '家常'], '蒸锅', 24),
  richRecipe(219, 1219, '月光甜甜圈', ['月光草', '鸡蛋', '蜂蜜'], ['梦幻', '甜', '适合拍照', '高级'], '料理台', 52),
  richRecipe(220, 1220, '牛肉月见锅', ['牛肉', '鸡蛋', '月光草'], ['肉', '灼热', '力量涌现', '高级'], '煮锅', 64),
];

const RICH_BEVERAGES = [
  richBeverage(106, '蜜酿清酒', ['清酒', '高级'], 62),
  richBeverage(107, '鲜榨果汁', ['水果', '无酒精', '可加冰'], 14),
  richBeverage(108, '温热米酒', ['可加热', '低酒精'], 20),
];

/** 让新增料理都能做出来：把基础材料库存提到不再缺货的量。 */
const RICH_INGREDIENT_STOCK = {
  1: 12, 2: 12, 3: 8, 4: 10, 5: 8, 6: 8, 7: 9, 8: 16,
};

export function buildRichPreviewScenario({ runtimeData, snapshot }) {
  const nextRuntimeData = structuredClone(runtimeData);
  const nextSnapshot = structuredClone(snapshot);

  nextRuntimeData.recipes = [...nextRuntimeData.recipes, ...RICH_RECIPES];
  nextRuntimeData.beverages = [...nextRuntimeData.beverages, ...RICH_BEVERAGES];
  nextRuntimeData.rareCustomers = [buildRichCustomer(), ...nextRuntimeData.rareCustomers];
  nextRuntimeData.source = 'mock-local-api (preview-rich)';
  nextRuntimeData.status = 'mock runtime data complete (preview-rich)';

  const state = nextSnapshot.recommendationState;
  state.availableRecipeIds = nextRuntimeData.recipes.map((item) => item.id);
  state.availableBeverageIds = nextRuntimeData.beverages.map((item) => item.id);
  state.availableRareCustomerIds = nextRuntimeData.rareCustomers.map((item) => item.id);
  state.ownedIngredientQty = { ...state.ownedIngredientQty, ...RICH_INGREDIENT_STOCK };
  state.ownedBeverageQty = {
    ...state.ownedBeverageQty,
    106: 4,
    107: 6,
    108: 3,
  };

  nextSnapshot.runtimeDataSignature = 'mock-rich-preview';
  nextSnapshot.runtimeDataSource = 'mock-local-api (preview-rich)';
  nextSnapshot.runtimeDataStatus = 'mock runtime data complete (preview-rich)';
  nextSnapshot.nightBusiness.activeRareGuests = [{
    deskCode: RICH_DESK_CODE,
    guestId: RICH_GUEST_ID,
    guestName: RICH_GUEST_NAME,
    source: 'mock-rich-preview',
    fund: 640,
    baseFundCarry: 300,
    maxFundCarry: 720,
    extraFundByBuff: 120,
    willPayMoney: true,
  }];
  nextSnapshot.nightBusiness.orders = [{
    traceId: RICH_ORDER_TRACE_ID,
    orderLifecycleSequence: 1,
    deskCode: RICH_DESK_CODE,
    guestId: RICH_GUEST_ID,
    runtimeGuestId: RICH_GUEST_ID,
    guestName: RICH_GUEST_NAME,
    foodTagId: 16,
    foodTag: '高级',
    beverageTagId: 23,
    beverageTag: '清酒',
    source: 'mock-rich-preview',
    firstSeenAtUtc: new Date(Date.now() - 120_000).toISOString(),
    lastSeenAtUtc: new Date(Date.now() - 8_000).toISOString(),
    isFreeOrder: false,
    hasServedFood: false,
    hasServedBeverage: false,
  }];
  nextSnapshot.snapshotSignature = `${snapshot.snapshotSignature}-preview-rich`;

  return { runtimeData: nextRuntimeData, snapshot: nextSnapshot };
}

export const RICH_PREVIEW_GUEST = Object.freeze({
  id: RICH_GUEST_ID,
  name: RICH_GUEST_NAME,
  likedTags: RICH_GUEST_LIKED_TAGS,
  dislikedTags: RICH_GUEST_DISLIKED_TAGS,
  beverageTags: RICH_GUEST_BEVERAGE_TAGS,
  recipeCount: RICH_RECIPES.length,
  beverageCount: RICH_BEVERAGES.length,
});

function buildRichCustomer() {
  return {
    id: RICH_GUEST_ID,
    name: RICH_GUEST_NAME,
    description: '预览用多标签稀客：验证喜好、厌恶和加料标注在长列表下的表现。',
    dlc: 0,
    places: ['妖怪兽道'],
    price: [200, 640],
    enduranceLimit: 5,
    positiveTags: [...RICH_GUEST_LIKED_TAGS],
    negativeTags: [...RICH_GUEST_DISLIKED_TAGS],
    beverageTags: [...RICH_GUEST_BEVERAGE_TAGS],
    positiveTagMapping: {},
    beverageTagMapping: {},
    collection: false,
    evaluation: {},
    spellCards: { positive: [], negative: [] },
  };
}

function richRecipe(id, recipeId, name, ingredients, positiveTags, cooker, price) {
  return {
    id,
    recipeId,
    name,
    description: `预览用料理：${name}`,
    ingredients,
    positiveTags,
    negativeTags: [],
    cooker,
    baseCookTime: 7,
    dlc: 0,
    level: 1,
    price,
    from: { mock: true, previewRich: true },
  };
}

function richBeverage(id, name, tags, price) {
  return {
    id,
    name,
    description: `预览用酒水：${name}`,
    tags,
    dlc: 0,
    level: 1,
    price,
    from: { mock: true, previewRich: true },
  };
}