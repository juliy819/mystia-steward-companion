import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

import { RICH_PREVIEW_GUEST, buildRichPreviewScenario } from './preview-scenario-rich.mjs';

/**
 * 伴随窗口本地预览截图。
 *
 * 不安装到游戏，只用 mock 运行时数据渲染生产构建并截图，便于人工确认界面改动。
 * 使用前先启动 mock 本地 API 和已构建前端：
 *
 *   corepack pnpm mock:api
 *   corepack pnpm build
 *   corepack pnpm preview -- --host 127.0.0.1 --port 4173
 *   corepack pnpm preview:capture
 *
 * 默认输出到 `temp/preview-screenshots/`（`temp/` 已被 .gitignore 忽略）。
 *
 * 设置 `PREVIEW_SCENARIO=rich` 时改用预览专用的富数据场景：拦截 `/runtime-data` 和 `/snapshot`，
 * 换成一位多标签稀客和更长的候选列表，用来检查标签多、候选多时的排版与标注。
 */
const APP_URL = process.env.MYSTIA_APP_URL || 'http://127.0.0.1:4173/';
const API_URL = process.env.MYSTIA_API_URL || 'http://127.0.0.1:32145';
const API_TOKEN = process.env.MYSTIA_API_TOKEN || 'mock-token';
const OUTPUT_DIR = process.env.PREVIEW_OUTPUT_DIR || 'temp/preview-screenshots';
const SCENARIO = process.env.PREVIEW_SCENARIO?.trim() || '';
const STORAGE_PREFIX = 'mystia-steward-companion';
/** 富数据场景的拦截载荷，只在第一次加载时抓取并叠加。 */
let scenarioPayloads;
const CHROMIUM_EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim()
  || findSystemChromium();

/** 只在截图时给新增的偏好摘要加红框，便于人工确认改动位置。 */
const ANNOTATION_STYLE = `
  [data-rare-customer-preferences="true"] {
    position: relative;
    outline: 3px solid #ff2d55;
    outline-offset: 2px;
  }
  [data-rare-customer-preferences="true"]::after {
    content: "本次新增";
    position: absolute;
    top: -1.4em;
    right: -2px;
    padding: 0 4px;
    background: #ff2d55;
    color: #ffffff;
    font-size: 11px;
    line-height: 1.4em;
    white-space: nowrap;
  }
`;

const viewports = [
  { name: 'desktop-1280', width: 1280, height: 900 },
  { name: 'minimum-640', width: 640, height: 800 },
  { name: 'android-390', width: 390, height: 760 },
];

await assertReachable(`${API_URL}/snapshot`, { 'X-Mystia-Steward-Companion-Token': API_TOKEN },
  'mock 本地 API：先运行 corepack pnpm mock:api');
await assertReachable(APP_URL, {},
  '前端预览服务：先运行 corepack pnpm build 和 corepack pnpm preview -- --host 127.0.0.1 --port 4173');

await mkdir(OUTPUT_DIR, { recursive: true });
const scenario = await loadScenario();
if (scenario) {
  console.log(`预览场景 rich：${RICH_PREVIEW_GUEST.name} `
    + `(喜好 ${RICH_PREVIEW_GUEST.likedTags.length} · 厌恶 ${RICH_PREVIEW_GUEST.dislikedTags.length} · `
    + `酒水 ${RICH_PREVIEW_GUEST.beverageTags.length})，新增料理 ${RICH_PREVIEW_GUEST.recipeCount} 道、`
    + `酒水 ${RICH_PREVIEW_GUEST.beverageCount} 款。`);
}
const browser = await chromium.launch({
  headless: true,
  ...(CHROMIUM_EXECUTABLE_PATH ? { executablePath: CHROMIUM_EXECUTABLE_PATH } : {}),
});

const written = [];
try {
  for (const viewport of viewports) {
    written.push(...await captureServiceView(browser, viewport));
    written.push(...await captureRareRecommendationPage(browser, viewport));
  }
} finally {
  await browser.close();
}

console.log(`PASS: captured ${written.length} companion screenshots with mock runtime data.`);
for (const file of written) console.log(`  ${file}`);

/** 富数据预览场景只叠加在截图请求上，mock 服务本身和它的其它消费者不受影响。 */
async function loadScenario() {
  if (SCENARIO !== 'rich') return null;
  if (scenarioPayloads) return scenarioPayloads;
  const headers = { 'X-Mystia-Steward-Companion-Token': API_TOKEN };
  const [runtimeData, snapshot] = await Promise.all([
    fetch(`${API_URL}/runtime-data`, { headers }).then((response) => response.json()),
    fetch(`${API_URL}/snapshot`, { headers }).then((response) => response.json()),
  ]);
  scenarioPayloads = buildRichPreviewScenario({ runtimeData, snapshot });
  return scenarioPayloads;
}

async function applyScenario(page) {
  const payloads = await loadScenario();
  if (!payloads) return;
  const corsHeaders = { 'access-control-allow-origin': '*' };
  await page.route(`${API_URL}/runtime-data**`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(payloads.runtimeData),
    });
  });
  await page.route(`${API_URL}/snapshot**`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const knownSignature = new URL(route.request().url()).searchParams.get('knownSignature');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify(knownSignature === payloads.snapshot.snapshotSignature
        ? { unchanged: true, snapshotSignature: payloads.snapshot.snapshotSignature }
        : payloads.snapshot),
    });
  });
}

async function captureServiceView(browserInstance, viewport) {
  const page = await browserInstance.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const files = [];
  try {
    await page.addInitScript(seedLocalStorage, { apiUrl: API_URL, apiToken: API_TOKEN, storagePrefix: STORAGE_PREFIX });
    await applyScenario(page);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-gamepad-tab-value="service"]').first().click();
    await selectRecommendationView(page);
    await page.locator('[data-service-order-tab-trigger="rare"]').click();

    const card = page.locator('[data-service-order-card="true"]').first();
    await card.waitFor({ state: 'visible', timeout: 20000 });
    const preferences = card.locator('[data-rare-customer-preferences="true"]').first();
    await preferences.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(
      await card.locator('[data-rare-customer-preference-group]').count(),
      3,
      `${viewport.name} 稀客订单卡片必须显示料理喜好、料理厌恶和酒水喜好三组偏好。`,
    );
    const preferenceText = (await preferences.innerText()).replace(/\s+/gu, ' ');
    for (const label of ['料理喜好', '料理厌恶', '酒水喜好']) {
      assert.ok(preferenceText.includes(label), `${viewport.name} 偏好摘要必须包含 ${label}。`);
    }
    assert.ok(!preferenceText.includes('命中') && !preferenceText.includes('已含'),
      `${viewport.name} 偏好摘要只列稀客偏好，不得判断候选是否命中。`);
    assertScenarioPreferenceText(preferenceText, viewport.name, '经营中卡片');
    console.log(`[${viewport.name}] 卡片偏好摘要文本：${preferenceText}`);
    if (viewport.name === 'desktop-1280') await assertToneColors(page);
    await assertServiceLayout(card, viewport.name);

    files.push(await shoot(page, `${viewport.name}-01-service-rare.png`, true));
    files.push(await shoot(card, `${viewport.name}-02-rare-order-card.png`));
    files.push(await shoot(preferences, `${viewport.name}-03-rare-preferences.png`));

    if (viewport.name === 'desktop-1280') {
      await page.getByRole('button', { name: '稀客订单专注模式', exact: true }).click();
      await page.locator('[data-service-focus-page="true"]').waitFor({ state: 'visible', timeout: 20000 });
      files.push(await shoot(page, `${viewport.name}-04-focus-mode.png`, true));
      await page.getByRole('button', { name: '退出专注模式', exact: true }).click();
      await page.locator('[data-service-focus-page="true"]').waitFor({ state: 'detached', timeout: 20000 });
    }

    // 标注截图放在最后：红框只服务于人工确认，不需要还原页面状态。
    await page.addStyleTag({ content: ANNOTATION_STYLE });
    files.push(await shoot(card, `${viewport.name}-05-rare-order-card-highlighted.png`));

    // 对照图：隐藏新增区块，其余内容不变，等价于改动前的订单卡片。
    await page.addStyleTag({ content: '[data-rare-customer-preferences="true"] { display: none !important; }' });
    assert.equal(await preferences.evaluate((element) => getComputedStyle(element).display), 'none',
      '对照图必须隐藏偏好摘要。');
    files.push(await shoot(card, `${viewport.name}-06-rare-order-card-without-preferences.png`));

    return files;
  } finally {
    await page.close();
  }
}

async function selectRecommendationView(page) {
  const viewControl = page.locator('[data-slot="segmented-control"]').filter({ hasText: '推荐' }).first();
  await viewControl.locator('label').filter({ hasText: /^推荐$/u }).click();
}

/** 富数据场景下，偏好摘要必须真的列出这位多标签稀客的全部标签。 */
function assertScenarioPreferenceText(preferenceText, viewportName, surface) {
  if (!scenario) return;
  for (const tag of [...RICH_PREVIEW_GUEST.likedTags, ...RICH_PREVIEW_GUEST.dislikedTags,
    ...RICH_PREVIEW_GUEST.beverageTags]) {
    assert.ok(preferenceText.includes(tag), `${viewportName} ${surface}偏好摘要缺少 ${tag}。`);
  }
}

/**
 * 推荐料理 → 稀客页：确认偏好摘要同样显示，并检查候选行的偏好/加料标注。
 */
async function captureRareRecommendationPage(browserInstance, viewport) {
  const page = await browserInstance.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const files = [];
  try {
    await page.addInitScript(seedLocalStorage, { apiUrl: API_URL, apiToken: API_TOKEN, storagePrefix: STORAGE_PREFIX });
    await applyScenario(page);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-gamepad-tab-value="recommendations"]').first().click();
    await page.locator('[data-recommendation-tabs]').getByRole('tab', { name: '稀客', exact: true }).click();

    const panel = page.locator('[data-rare-customer-preferences="true"]').first();
    await panel.waitFor({ state: 'visible', timeout: 20000 });
    const preferenceText = (await panel.innerText()).replace(/\s+/gu, ' ');
    for (const label of ['料理喜好', '料理厌恶', '酒水喜好']) {
      assert.ok(preferenceText.includes(label), `${viewport.name} 稀客页偏好摘要必须包含 ${label}。`);
    }
    assert.ok(!preferenceText.includes('命中') && !preferenceText.includes('已含'),
      `${viewport.name} 稀客页偏好摘要只列稀客偏好，不得判断候选是否命中。`);
    assertScenarioPreferenceText(preferenceText, viewport.name, '稀客页');

    // 稀客页推荐由 Worker 计算，偏好摘要先出现，候选行后出现，这里等到真正有候选行再统计。
    const recipePanel = page.locator('.steward-list-panel').filter({ hasText: '料理推荐' }).first();
    await recipePanel.locator('[data-slot="badge"]').first().waitFor({ state: 'visible', timeout: 30000 });

    const rowStats = await recipePanel.evaluate((panel) => {
      const toneOf = (element) => Array.from(element.classList).find((name) => name.startsWith('steward-tag-')) ?? '';
      const tones = Array.from(panel.querySelectorAll('[data-slot="badge"]')).map(toneOf);
      return {
        matched: tones.filter((tone) => tone === 'steward-tag-matched').length,
        disliked: tones.filter((tone) => tone === 'steward-tag-disliked').length,
        extraIngredientGroups: panel.querySelectorAll('[data-recipe-extra-ingredient-tags="true"]').length,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    assert.ok(rowStats.matched > 0,
      `${viewport.name} 稀客页候选行必须标出命中喜好的 Tag（实际 ${rowStats.matched}）。`);
    if (scenario) {
      assert.ok(rowStats.disliked > 0,
        `${viewport.name} 富数据场景必须能同时看到包含厌恶的标注（实际 ${rowStats.disliked}）。`);
    }
    assert.ok(rowStats.documentOverflow <= 1,
      `${viewport.name} 稀客页横向溢出 ${rowStats.documentOverflow}px。`);
    console.log(`[${viewport.name}] 稀客页偏好：${preferenceText}`);
    console.log(`[${viewport.name}] 稀客页候选标注：命中 ${rowStats.matched} · 厌恶 ${rowStats.disliked} · 加料分组 ${rowStats.extraIngredientGroups}`);

    files.push(await shoot(page, `${viewport.name}-07-rare-recommendation-page.png`, true));
    files.push(await shoot(panel, `${viewport.name}-08-rare-recommendation-preferences.png`));

    if (rowStats.extraIngredientGroups > 0) {
      files.push(await shoot(recipePanel.locator('.steward-data-row').first(),
        `${viewport.name}-09-rare-recipe-row.png`));
      files.push(await shoot(page.locator('[data-recipe-extra-ingredient-tags="true"]').first(),
        `${viewport.name}-10-rare-extra-ingredient-tags.png`));
    }

    return files;
  } finally {
    await page.close();
  }
}

/**
 * 截图之外还要证明新增的偏好摘要在卡片里真的可见、没有被裁切，并且排在推荐列表之前。
 */
async function assertServiceLayout(card, viewportName) {
  const metrics = await card.evaluate((element) => {
    const toRect = (node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const cardRect = toRect(element);
    const preferences = element.querySelector('[data-rare-customer-preferences="true"]');
    const heading = element.querySelector('h3');
    return {
      card: cardRect,
      preferences: toRect(preferences),
      heading: heading ? toRect(heading) : null,
      clippedBadgeCount: Array.from(element.querySelectorAll('[data-slot="badge"]'))
        .map((badge) => toRect(badge))
        .filter((rect) => rect.left < cardRect.left - 1
          || rect.right > cardRect.right + 1
          || rect.top < cardRect.top - 1
          || rect.bottom > cardRect.bottom + 1)
        .length,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      collectionOverflow: Array.from(document.querySelectorAll('[data-service-order-collection]'))
        .map((collection) => collection.scrollWidth - collection.clientWidth),
    };
  });

  assert.ok(metrics.preferences.height > 0 && metrics.preferences.width > 0,
    `${viewportName} 偏好摘要必须有可见尺寸。`);
  assert.ok(metrics.preferences.left >= metrics.card.left - 1
    && metrics.preferences.right <= metrics.card.right + 1
    && metrics.preferences.bottom <= metrics.card.bottom + 1,
    `${viewportName} 偏好摘要不能超出订单卡片。`);
  assert.equal(metrics.clippedBadgeCount, 0, `${viewportName} 订单卡片存在被裁切的偏好徽标。`);
  assert.ok(metrics.heading && metrics.preferences.bottom <= metrics.heading.top,
    `${viewportName} 偏好摘要必须排在推荐料理列表之前。`);
  assert.ok(metrics.documentOverflow <= 1, `${viewportName} 页面横向溢出 ${metrics.documentOverflow}px。`);
  assert.ok(metrics.collectionOverflow.every((value) => value <= 1),
    `${viewportName} 订单区域横向溢出：${metrics.collectionOverflow.join('/')}。`);
}

async function shoot(target, name, fullPage = false) {
  const file = path.join(OUTPUT_DIR, name);
  await target.screenshot({ path: file, fullPage });
  return file;
}

/**
 * Tag 语义色的回归守卫。
 *
 * `.steward-badge[data-ui-variant=...]` 的中性配色是双类选择器；语义色必须比它更具体，
 * 否则喜好、厌恶、命中、抵消和加料色会全部退化成同一种米色（历史上就是这样）。
 */
async function assertToneColors(page) {
  const samples = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.dataset.previewToneProbe = 'true';
    if (!document.body) throw new Error('页面还未就绪。');
    document.body.appendChild(probe);
    const tones = ['preferred', 'disliked', 'matched', 'extra', 'cancelled', 'default'];
    const result = tones.map((tone) => {
      const span = document.createElement('span');
      span.className = `steward-badge steward-tag-${tone}`;
      span.dataset.uiVariant = 'outline';
      span.textContent = tone;
      probe.appendChild(span);
      const style = getComputedStyle(span);
      return { tone, background: style.backgroundColor, color: style.color, border: style.borderColor };
    });
    probe.remove();
    return result;
  });

  const signatures = new Set(samples.map((sample) => `${sample.background}|${sample.color}|${sample.border}`));
  assert.equal(signatures.size, samples.length,
    `Tag 语义色必须两两不同：${JSON.stringify(samples)}`);
  console.log(`Tag 语义色：${samples.map((sample) => `${sample.tone}=${sample.background}`).join(' / ')}`);
}

async function assertReachable(url, headers, hint) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    assert.fail(`${url} 不可达：${error.message}。${hint}`);
  }
  assert.equal(response.ok, true, `${url} 返回 HTTP ${response.status}。${hint}`);
}

function seedLocalStorage({ apiUrl, apiToken, storagePrefix }) {
  localStorage.setItem(`${storagePrefix}-mod-api-endpoint`, apiUrl);
  localStorage.setItem(`${storagePrefix}-mod-api-token`, apiToken);
}

function findSystemChromium() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}