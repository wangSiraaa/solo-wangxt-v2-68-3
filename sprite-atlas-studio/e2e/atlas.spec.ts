import { expect, test, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "test-assets");
const FRAME_NAMES = readdirSync(ASSETS).filter((f) => f.endsWith(".png")).sort();

async function importFrames(page: Page): Promise<void> {
  const files = FRAME_NAMES.map((f) => join(ASSETS, f));
  await page.locator("#png-input").setInputFiles(files);
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
}

/**
 * 选中一帧：用 focus + Enter 而非鼠标点击。
 * 软件渲染（swiftshader）headless 环境下鼠标按下-抬起会被误判为 HTML5 拖拽，
 * 导致帧列表重排；键盘选择不受影响。
 */
async function selectFrame(page: Page, name: string): Promise<void> {
  await page.locator(`[data-frame-name="${name}"]`).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".frame-item.selected")).toHaveAttribute("data-frame-name", name);
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

  // 4.1) 元数据：walk_04 四周透明边均为 30px（128×128，内容 68×68）
  //      暂停播放（避免动画自动切换选中帧），把 pivot 设到被裁掉的透明区
  //      (5, 6)，anchor 设 (0.1, 0.2)，九宫格 [40,90,30,100]
  await page.locator("#play-btn").click();
  await selectFrame(page, "walk_04.png");
  await page.locator("#jump-selected-btn").click();
  await expect(page.locator('[data-testid="meta-stage"]')).toBeVisible();
  await page.locator('[data-testid="pivot-x"]').fill("5");
  await page.locator('[data-testid="pivot-x"]').dispatchEvent("change");
  await page.locator('[data-testid="pivot-y"]').fill("6");
  await page.locator('[data-testid="pivot-y"]').dispatchEvent("change");
  await page.locator('[data-testid="anchor-x"]').fill("0.1");
  await page.locator('[data-testid="anchor-x"]').dispatchEvent("change");
  await page.locator('[data-testid="anchor-y"]').fill("0.2");
  await page.locator('[data-testid="anchor-y"]').dispatchEvent("change");
  await page.locator('[data-testid="ns-enable"]').check();
  await page.locator('[data-testid="ns-left"]').fill("40");
  await page.locator('[data-testid="ns-left"]').dispatchEvent("change");
  await page.locator('[data-testid="ns-right"]').fill("90");
  await page.locator('[data-testid="ns-right"]').dispatchEvent("change");
  await page.locator('[data-testid="ns-top"]').fill("30");
  await page.locator('[data-testid="ns-top"]').dispatchEvent("change");
  await page.locator('[data-testid="ns-bottom"]').fill("100");
  await page.locator('[data-testid="ns-bottom"]').dispatchEvent("change");
  // 非法九宫格（交叉 right<left）被阻止，且输入框保留上次有效值 90
  await page.locator('[data-testid="ns-right"]').fill("20");
  await page.locator('[data-testid="ns-right"]').dispatchEvent("change");
  await expect(page.locator('[data-testid="meta-error"]')).toContainText("交叉");
  await expect(page.locator('[data-testid="ns-right"]')).toHaveValue("90");
  // 越界同样被阻止
  await page.locator('[data-testid="ns-left"]').fill("200");
  await page.locator('[data-testid="ns-left"]').dispatchEvent("change");
  await expect(page.locator('[data-testid="meta-error"]')).toContainText("超出原图");
  await expect(page.locator('[data-testid="ns-left"]')).toHaveValue("40");
  // pivot 越界被夹回/阻止
  await page.locator('[data-testid="pivot-x"]').fill("999");
  await page.locator('[data-testid="pivot-x"]').dispatchEvent("change");
  await expect(page.locator('[data-testid="pivot-x"]')).not.toHaveValue("999");

  // 4.2) 预览坐标读数：pivot (5, 6) 显示在原始画布坐标系
  await expect(page.locator('[data-testid="preview-meta-coords"]')).toContainText("pivot (5.00, 6.00)");
  await expect(page.locator('[data-testid="preview-meta-coords"]')).toContainText("anchor (0.10, 0.20)");

  // 4.3) 留白改为 8px 重新打包：原始 pivot/anchor 不变，图集派生坐标变化
  const derivedBefore = await page.locator('[data-testid="meta-derived"]').innerText();
  // 先把焦点移出 pack 按钮，避免软件渲染环境下残留激活态触发额外打包
  await page.locator("#opt-padding").focus();
  await page.locator("#opt-padding").fill("8");
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-image")).toBeVisible();
  // 等待 8px 的打包结果确实就绪（软件渲染下打包较慢，避免读到上一次 3px 的结果）
  await expect(page.locator("#atlas-summary")).toContainText("留白 8px");
  await selectFrame(page, "walk_04.png");
  await expect(page.locator('[data-testid="pivot-x"]')).toHaveValue("5");
  await expect(page.locator('[data-testid="pivot-y"]')).toHaveValue("6");
  await expect(page.locator('[data-testid="anchor-x"]')).toHaveValue("0.1");
  await expect(page.locator('[data-testid="anchor-y"]')).toHaveValue("0.2");
  await expect(page.locator('[data-testid="ns-left"]')).toHaveValue("40");
  await expect(page.locator('[data-testid="ns-right"]')).toHaveValue("90");
  await expect(page.locator('[data-testid="ns-top"]')).toHaveValue("30");
  await expect(page.locator('[data-testid="ns-bottom"]')).toHaveValue("100");
  const derivedAfter = await page.locator('[data-testid="meta-derived"]').innerText();
  expect(derivedAfter, "留白变化后图集坐标应改变").not.toBe(derivedBefore);
  expect(derivedAfter).toContain("留白 8px");

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

  // 元数据使用明确的原始画布坐标系与原图尺寸
  const f04 = json.frames["walk_04.png"];
  expect(f04.sourceSize).toEqual({ w: 128, h: 128 });
  expect(f04.pivot).toEqual({ x: 5, y: 6 });
  expect(f04.anchor).toEqual({ x: 0.1, y: 0.2 });
  expect(f04.nineSlice).toEqual({ left: 40, right: 90, top: 30, bottom: 100 });
  // pivot 位于被裁掉的透明区：图集派生 x/y 小于内容框 x/y
  expect(f04.atlasMeta.pivot.x).toBe(f04.pivot.x - f04.spriteSourceSize.x + f04.frame.x);
  expect(f04.atlasMeta.pivot.x).toBeLessThan(f04.frame.x);
  expect(f04.atlasMeta.nineSlice.left).toBe(40 - f04.spriteSourceSize.x + f04.frame.x);

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

  // 打包结果恢复：位置尺寸与导出时（留白 8px）一致
  const tableAfter = await readAtlasTable(page);
  const tableExport = Object.fromEntries(
    Object.entries(json.frames).map(([name, f]) => [
      name,
      [f.frame.x, f.frame.y, f.frame.w, f.frame.h]
    ])
  );
  expect(tableAfter).toEqual(tableExport);

  // 元数据无损还原：暂停播放后选中 walk_04，数值与导出前完全一致
  await page.locator("#play-btn").click();
  await selectFrame(page, "walk_04.png");
  await expect(page.locator('[data-testid="pivot-x"]')).toHaveValue("5");
  await expect(page.locator('[data-testid="pivot-y"]')).toHaveValue("6");
  await expect(page.locator('[data-testid="anchor-x"]')).toHaveValue("0.1");
  await expect(page.locator('[data-testid="anchor-y"]')).toHaveValue("0.2");
  await expect(page.locator('[data-testid="ns-enable"]')).toBeChecked();
  await expect(page.locator('[data-testid="ns-left"]')).toHaveValue("40");
  await expect(page.locator('[data-testid="ns-right"]')).toHaveValue("90");
  await expect(page.locator('[data-testid="ns-top"]')).toHaveValue("30");
  await expect(page.locator('[data-testid="ns-bottom"]')).toHaveValue("100");
  await expect(page.locator('[data-testid="preview-meta-coords"]')).toContainText("pivot (5.00, 6.00)");

  // 以恢复后的项目把留白改回 3px 并重新打包：规范值不变，图集矩形与第一次打包一致
  await page.locator("#opt-padding").focus();
  await page.locator("#opt-padding").fill("3");
  await page.locator("#pack-btn").click();
  await expect(page.locator("#atlas-image")).toBeVisible();
  await expect(page.locator("#atlas-summary")).toContainText("留白 3px");
  await selectFrame(page, "walk_04.png");
  await expect(page.locator('[data-testid="pivot-x"]')).toHaveValue("5");
  await expect(page.locator('[data-testid="pivot-y"]')).toHaveValue("6");
  await expect(page.locator('[data-testid="anchor-x"]')).toHaveValue("0.1");
  await expect(page.locator('[data-testid="anchor-y"]')).toHaveValue("0.2");
  await expect(page.locator('[data-testid="ns-left"]')).toHaveValue("40");
  await expect(page.locator('[data-testid="ns-right"]')).toHaveValue("90");
  await expect(page.locator('[data-testid="ns-top"]')).toHaveValue("30");
  await expect(page.locator('[data-testid="ns-bottom"]')).toHaveValue("100");
  const tableRepacked = await readAtlasTable(page);
  expect(tableRepacked).toEqual(tableBefore);
  // 预览对齐：仍能按帧序播放且显示图集信息
  await expect(page.locator("#preview-frame-label")).toContainText("帧 1/8");
  await expect(page.locator("#preview-atlas-info")).toContainText("图集 (");

  // 8) IndexedDB 持久化：等待自动保存落盘后刷新页面，项目应恢复
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator("#frame-list .frame-item")).toHaveCount(FRAME_NAMES.length);
  await expect(page.locator("#atlas-table tbody tr")).toHaveCount(FRAME_NAMES.length);

  // 刷新后元数据仍在
  await page.locator("#play-btn").click();
  await selectFrame(page, "walk_04.png");
  await expect(page.locator('[data-testid="pivot-x"]')).toHaveValue("5");
  await expect(page.locator('[data-testid="anchor-y"]')).toHaveValue("0.2");
  await expect(page.locator('[data-testid="ns-enable"]')).toBeChecked();
  await expect(page.locator('[data-testid="ns-bottom"]')).toHaveValue("100");
});
