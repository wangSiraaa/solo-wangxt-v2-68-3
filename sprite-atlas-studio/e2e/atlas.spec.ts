import { expect, test, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "test-assets");
const FRAME_NAMES = readdirSync(ASSETS).filter((f) => f.endsWith(".png")).sort();

// walk_01.png：64×64，透明边 上10 右14 下6 左8 → 裁切偏移 (8, 10)，内容 42×48
const WALK01_TRIM = { x: 8, y: 10 };

async function importFrames(page: Page): Promise<void> {
  const files = FRAME_NAMES.map((f) => join(ASSETS, f));
  await page.locator("#png-input").setInputFiles(files);
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
}

/** 从图集表格读出 name → [x, y, w, h] */
async function readAtlasTable(page: Page): Promise<Record<string, number[]>> {
  const rows = page.locator("#atlas-table tbody tr");
  const out: Record<string, number[]> = {};
  for (const row of await rows.all()) {
    const name = await row.locator("td").nth(1).innerText();
    const nums: number[] = [];
    for (const col of [2, 3, 4, 5]) {
      nums.push(Number(await row.locator("td").nth(col).innerText()));
    }
    out[name] = nums;
  }
  return out;
}

test("完整流程：导入 → 设置时长 → 打包 → 预览 → 导出 → 清空 → 导入 JSON 恢复", async ({
  page
}) => {
  await page.goto("/");

  // 1) 导入不同尺寸 + 透明边缘的 PNG
  await importFrames(page);

  // 2) 设置：留白 3px、裁切透明边缘（默认开启）、全部帧 100ms，首帧改为 250ms
  await page.locator("#opt-padding").fill("3");
  await expect(page.locator("#opt-trim")).toBeChecked();
  await page.locator("#uniform-duration").fill("100");
  await page.getByRole("button", { name: "应用到全部帧" }).click();
  const firstDur = page.locator(`[data-duration-for="walk_01.png"]`);
  await firstDur.fill("250");
  await firstDur.dispatchEvent("change");

  // 3) 打包
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-image")).toBeVisible();
  await expect(page.locator("#atlas-table tbody tr")).toHaveCount(FRAME_NAMES.length);
  const summary = await page.locator("#atlas-summary").innerText();
  expect(summary).toContain("留白 3px");
  expect(summary).toContain("已裁切透明边缘");

  // 表格中的位置尺寸（供后面与恢复结果比对）
  const tableBefore = await readAtlasTable(page);
  expect(Object.keys(tableBefore)).toHaveLength(FRAME_NAMES.length);
  for (const [name, rect] of Object.entries(tableBefore)) {
    expect(rect[2], `${name} 宽度应大于 0`).toBeGreaterThan(0);
    expect(rect[3], `${name} 高度应大于 0`).toBeGreaterThan(0);
  }

  // 4) 预览：按原顺序与时长播放（首帧 250ms，其余 100ms）
  await expect(page.locator("#preview-frame-label")).toContainText("帧 1/8");
  await expect(page.locator("#preview-atlas-info")).toContainText("图集 (");
  // 等到播放进入后续帧（首帧 250ms 后应切到帧 2）
  await expect(page.locator("#preview-frame-label")).toContainText("帧 2/8", { timeout: 3000 });
  // 播完一轮应循环回帧 1（总时长 250 + 7*100 = 950ms）
  await expect(page.locator("#preview-frame-label")).toContainText("帧 1/8", { timeout: 5000 });

  // 5) 导出 JSON 与 PNG
  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-json-btn").click()
  ]);
  const jsonPath = await jsonDownload.path();
  const json = JSON.parse(readFileSync(jsonPath, "utf-8"));

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-png-btn").click()
  ]);
  expect((await pngDownload.path())).toBeTruthy();

  // 校验 JSON 内容：帧列表、顺序、时长、位置尺寸、内嵌图集
  expect(json.meta.app).toBe("sprite-atlas-studio");
  expect(json.meta.frameOrder).toEqual(FRAME_NAMES);
  expect(Object.keys(json.frames)).toHaveLength(FRAME_NAMES.length);
  expect(json.frames["walk_01.png"].duration).toBe(250);
  expect(json.frames["walk_02.png"].duration).toBe(100);
  expect(typeof json.meta.atlasDataURL).toBe("string");
  expect(json.meta.atlasDataURL.startsWith("data:image/png;base64,")).toBe(true);
  // JSON 中的矩形与页面表格一致
  for (const [name, rect] of Object.entries(tableBefore)) {
    const f = json.frames[name];
    expect([f.frame.x, f.frame.y, f.frame.w, f.frame.h], name).toEqual(rect);
    expect(f.rotated).toBe(false);
  }

  // 6) 清空（同时清掉 IndexedDB）
  await page.getByRole("button", { name: "清空" }).click();
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(0);

  // 7) 导入 JSON 恢复（图集内嵌，无需另选 PNG）
  await page.locator("#json-input").setInputFiles({
    name: "atlas.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(json))
  });
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
  await expect(page.locator("#atlas-table tbody tr")).toHaveCount(FRAME_NAMES.length);

  // 帧顺序与时长恢复
  const names = await page.locator("#frame-list .frame-item .name").allInnerTexts();
  expect(names).toEqual(FRAME_NAMES);
  await expect(page.locator(`[data-duration-for="walk_01.png"]`)).toHaveValue("250");
  await expect(page.locator(`[data-duration-for="walk_02.png"]`)).toHaveValue("100");

  // 打包结果恢复：位置尺寸与导出前一致
  const tableAfter = await readAtlasTable(page);
  expect(tableAfter).toEqual(tableBefore);

  // 预览恢复播放
  await expect(page.locator("#preview-frame-label")).toContainText("帧 1/8");
  await expect(page.locator("#preview-atlas-info")).toContainText("图集 (");

  // 8) IndexedDB 持久化：等待自动保存落盘后刷新页面，项目应恢复
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
  await expect(page.locator("#atlas-table tbody tr")).toHaveCount(FRAME_NAMES.length);
});

/** 设置数值输入并触发 change（与页面交互方式一致） */
async function setNumber(page: Page, selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await input.fill(value);
  await input.dispatchEvent("change");
}

/** 读出 #meta-atlas-info 中 pivot 的图集坐标 */
async function readAtlasPivot(page: Page): Promise<[number, number]> {
  const text = await page.locator("#meta-atlas-info").innerText();
  const m = /pivot \((-?[\d.]+), (-?[\d.]+)\)/.exec(text);
  if (!m) throw new Error(`无法解析图集坐标：${text}`);
  return [Number(m[1]), Number(m[2])];
}

test("帧元数据：pivot/anchor/九宫格 设置、校验、换算、导出导入与持久化", async ({ page }) => {
  await page.goto("/");
  await importFrames(page);

  // 1) 选中首帧（walk_01.png，64×64，透明边 上10 左8）
  await page.locator("#frame-list .frame-item").first().click();
  await expect(page.locator("#meta-frame-name")).toHaveText("walk_01.png");
  // 默认 pivot/anchor 在原图中心
  await expect(page.locator("#meta-pivot-x")).toHaveValue("32");
  await expect(page.locator("#meta-pivot-y")).toHaveValue("32");

  // 2) 数值设置 pivot 到左上透明区（x<8, y<10 会被裁掉，仍可表达）
  await setNumber(page, "#meta-pivot-x", "4");
  await setNumber(page, "#meta-pivot-y", "5");
  await expect(page.locator("#meta-pivot-x")).toHaveValue("4");
  await expect(page.locator("#meta-pivot-y")).toHaveValue("5");
  await setNumber(page, "#meta-anchor-x", "60");
  await setNumber(page, "#meta-anchor-y", "61");

  // 3) 非法 pivot 被拒绝并保留上次有效值
  await setNumber(page, "#meta-pivot-x", "-3");
  await expect(page.locator("#meta-error")).toBeVisible();
  await expect(page.locator("#meta-pivot-x")).toHaveValue("4");

  // 4) 预览拖拽 pivot：拖到原图 (20, 30) 附近
  const svg = page.locator("[data-testid='meta-preview'] svg");
  const box = (await svg.boundingBox())!;
  const toClient = (x: number, y: number) => ({
    x: box.x + (x / 64) * box.width,
    y: box.y + (y / 64) * box.height
  });
  const from = toClient(4, 5);
  const to = toClient(20, 30);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  const px = Number(await page.locator("#meta-pivot-x").inputValue());
  const py = Number(await page.locator("#meta-pivot-y").inputValue());
  expect(Math.abs(px - 20)).toBeLessThanOrEqual(1);
  expect(Math.abs(py - 30)).toBeLessThanOrEqual(1);
  // 拖回透明区，后续断言用确定值
  await setNumber(page, "#meta-pivot-x", "4");
  await setNumber(page, "#meta-pivot-y", "5");

  // 5) 启用九宫格：默认三等分；非法边界被阻止且保留上次有效值
  await page.locator("#meta-ns-enabled").check();
  await expect(page.locator("#meta-ns-left")).toHaveValue("21");
  await expect(page.locator("#meta-ns-right")).toHaveValue("43");
  await expect(page.locator("#meta-ns-top")).toHaveValue("21");
  await expect(page.locator("#meta-ns-bottom")).toHaveValue("43");
  // 交叉：left > right
  await setNumber(page, "#meta-ns-left", "50");
  await expect(page.locator("#meta-error")).toBeVisible();
  await expect(page.locator("#meta-ns-left")).toHaveValue("21");
  // 越界
  await setNumber(page, "#meta-ns-top", "-2");
  await expect(page.locator("#meta-error")).toBeVisible();
  await expect(page.locator("#meta-ns-top")).toHaveValue("21");
  // 合法修改
  await setNumber(page, "#meta-ns-left", "10");
  await setNumber(page, "#meta-ns-right", "50");
  await setNumber(page, "#meta-ns-top", "12");
  await setNumber(page, "#meta-ns-bottom", "52");
  await expect(page.locator("#meta-error")).toBeHidden();

  // 6) 打包（留白 3）：图集坐标 = 内容位置 + (原图坐标 - 裁切偏移)
  await page.locator("#opt-padding").fill("3");
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-image")).toBeVisible();
  const table1 = await readAtlasTable(page);
  const [fx1, fy1] = table1["walk_01.png"]!;
  const [apx1, apy1] = await readAtlasPivot(page);
  expect(apx1).toBe(fx1 + (4 - WALK01_TRIM.x));
  expect(apy1).toBe(fy1 + (5 - WALK01_TRIM.y));
  // pivot 在透明区 → 图集坐标落在内容框外
  expect(apx1).toBeLessThan(fx1);
  expect(apy1).toBeLessThan(fy1);
  const atlasInfo1 = await page.locator("#meta-atlas-info").innerText();
  expect(atlasInfo1).toContain("九宫格");

  // 7) 修改留白重打包：图集坐标变化，原始坐标不变
  await page.locator("#opt-padding").fill("6");
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-summary")).toContainText("留白 6px");
  const table2 = await readAtlasTable(page);
  const [fx2, fy2] = table2["walk_01.png"]!;
  const [apx2, apy2] = await readAtlasPivot(page);
  expect(apx2).toBe(fx2 + (4 - WALK01_TRIM.x));
  expect(apy2).toBe(fy2 + (5 - WALK01_TRIM.y));
  expect([apx2, apy2]).not.toEqual([apx1, apy1]); // 图集坐标变了
  await expect(page.locator("#meta-pivot-x")).toHaveValue("4"); // 原始坐标不变
  await expect(page.locator("#meta-pivot-y")).toHaveValue("5");
  await expect(page.locator("#meta-ns-left")).toHaveValue("10");
  await page.locator("#opt-padding").fill("3");
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-summary")).toContainText("留白 3px");

  // 8) 导出 JSON：pivot/anchor/九宫格为原始图像坐标，坐标系有声明
  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-json-btn").click()
  ]);
  const json = JSON.parse(readFileSync(await jsonDownload.path(), "utf-8"));
  expect(json.meta.coordinateSpace).toBe("source-image");
  const jf = json.frames["walk_01.png"];
  expect(jf.pivot).toEqual({ x: 4, y: 5 });
  expect(jf.anchor).toEqual({ x: 60, y: 61 });
  expect(jf.nineSlice).toEqual({ left: 10, right: 50, top: 12, bottom: 52 });
  expect(jf.sourceSize).toEqual({ w: 64, h: 64 });
  // 其余帧为默认值（中心 pivot/anchor、不可拉伸）
  expect(json.frames["walk_02.png"].pivot).toEqual({ x: 32, y: 32 });
  expect(json.frames["walk_02.png"].nineSlice).toBeNull();

  // 9) 清空 → 导入 JSON 恢复：元数据与打包结果完整还原
  await page.getByRole("button", { name: "清空" }).click();
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(0);
  await page.locator("#json-input").setInputFiles({
    name: "atlas.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(json))
  });
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
  await page.locator("#frame-list .frame-item").first().click();
  await expect(page.locator("#meta-pivot-x")).toHaveValue("4");
  await expect(page.locator("#meta-pivot-y")).toHaveValue("5");
  await expect(page.locator("#meta-anchor-x")).toHaveValue("60");
  await expect(page.locator("#meta-anchor-y")).toHaveValue("61");
  await expect(page.locator("#meta-ns-enabled")).toBeChecked();
  await expect(page.locator("#meta-ns-left")).toHaveValue("10");
  await expect(page.locator("#meta-ns-right")).toHaveValue("50");
  await expect(page.locator("#meta-ns-top")).toHaveValue("12");
  await expect(page.locator("#meta-ns-bottom")).toHaveValue("52");

  // 10) 恢复后重新打包：预览对齐（裁切偏移一致）、图集坐标与边界完全一致
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-image")).toBeVisible();
  const table3 = await readAtlasTable(page);
  expect(table3).toEqual(table1); // 与首次打包（留白 3）完全一致
  const [apx3, apy3] = await readAtlasPivot(page);
  expect([apx3, apy3]).toEqual([apx1, apy1]);
  await expect(page.locator("#preview-atlas-info")).toContainText("偏移 (8, 10)");

  // 11) IndexedDB 持久化：自动保存后刷新，元数据仍在
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
  await page.locator("#frame-list .frame-item").first().click();
  await expect(page.locator("#meta-pivot-x")).toHaveValue("4");
  await expect(page.locator("#meta-pivot-y")).toHaveValue("5");
  await expect(page.locator("#meta-ns-left")).toHaveValue("10");
  await expect(page.locator("#meta-ns-bottom")).toHaveValue("52");
});
