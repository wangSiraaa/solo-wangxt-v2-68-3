/**
 * 集成测试：用生成的真实 PNG（不同尺寸 + 透明边缘）走完整管线——
 * 裁切 → maxrects 打包 → 合成图集 → 导出 JSON → 重新导入恢复，
 * 并验证预览位置（裁切偏移）与每帧时长。
 * 在 Node 中用 @napi-rs/canvas 模拟浏览器画布。
 */
import { describe, expect, it } from "vitest";
import { createCanvas, loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeAlphaBBox } from "../../src/lib/core/trim";
import { packFrames, type PackInput } from "../../src/lib/core/pack";
import { buildAtlasJSON, parseAtlasJSON } from "../../src/lib/core/serialize";
import { Animator, frameIndexAt } from "../../src/lib/core/animator";
import { DEFAULT_SETTINGS, type Pixels, type TrimRect } from "../../src/lib/core/types";

const ASSETS = join(__dirname, "..", "..", "test-assets");

// 与 scripts/gen-test-assets.mjs 中 SPECS 对应：[宽, 高, 上, 右, 下, 左]
const EXPECTED: Record<string, { size: [number, number]; margin: [number, number, number, number] }> = {
  "walk_01.png": { size: [64, 64], margin: [10, 14, 6, 8] },
  "walk_02.png": { size: [64, 64], margin: [12, 10, 8, 12] },
  "walk_03.png": { size: [96, 48], margin: [4, 20, 4, 6] },
  "walk_04.png": { size: [128, 128], margin: [30, 30, 30, 30] },
  "walk_05.png": { size: [37, 53], margin: [3, 5, 7, 2] },
  "walk_06.png": { size: [200, 150], margin: [0, 0, 0, 0] },
  "walk_07.png": { size: [16, 16], margin: [2, 2, 2, 2] },
  "walk_08.png": { size: [80, 90], margin: [25, 5, 15, 35] }
};

const DURATIONS = [50, 80, 120, 100, 33, 200, 90, 60];
const PADDING = 3;

function pixelsOf(img: Image, w: number, h: number): Pixels {
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h);
  return { data: d.data, width: d.width, height: d.height };
}

function px(p: Pixels, x: number, y: number): [number, number, number, number] {
  const i = (y * p.width + x) * 4;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!, p.data[i + 3]!];
}

async function loadAll(): Promise<Array<{ name: string; img: Image; buf: Buffer }>> {
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".png")).sort();
  const out = [];
  for (const name of files) {
    const buf = readFileSync(join(ASSETS, name));
    out.push({ name, img: await loadImage(buf), buf });
  }
  return out;
}

describe("完整管线：真实 PNG（不同尺寸 + 透明边缘）", () => {
  it("裁切结果与生成时的透明边缘一致", async () => {
    const frames = await loadAll();
    expect(frames.length).toBe(8);
    for (const [i, f] of frames.entries()) {
      const spec = EXPECTED[f.name]!;
      const [w, h] = spec.size;
      const [mt, mr, mb, ml] = spec.margin;
      const bbox = computeAlphaBBox(pixelsOf(f.img, w, h));
      expect(bbox, f.name).toEqual({ x: ml, y: mt, w: w - ml - mr, h: h - mt - mb });
      void i;
    }
  });

  it("打包 → 合成图集 → 导出 JSON → 重新导入完整恢复", async () => {
    const frames = await loadAll();

    // 1) 裁切
    const trimmed = frames.map((f, i) => {
      const spec = EXPECTED[f.name]!;
      const [w, h] = spec.size;
      const bbox = computeAlphaBBox(pixelsOf(f.img, w, h))!;
      return { name: f.name, img: f.img, srcW: w, srcH: h, trim: bbox, duration: DURATIONS[i]! };
    });

    // 2) 打包（固定方向 + 统一留白）
    const inputs: PackInput[] = trimmed.map((t, i) => ({
      id: `f${i}`,
      name: t.name,
      w: t.trim.w,
      h: t.trim.h,
      trim: t.trim,
      srcW: t.srcW,
      srcH: t.srcH,
      duration: t.duration,
      meta: {
        // 故意把 pivot 放在左上角的透明区，验证“落在被裁区域仍可表达”
        pivot: { x: 1.5, y: 2.25 },
        anchor: { x: 0.25, y: 0.75 },
        nineSlice: {
          left: Math.max(1, Math.round(t.srcW * 0.2)),
          right: Math.min(t.srcW - 1, Math.round(t.srcW * 0.8)),
          top: Math.max(1, Math.round(t.srcH * 0.2)),
          bottom: Math.min(t.srcH - 1, Math.round(t.srcH * 0.8))
        }
      }
    }));
    const layout = packFrames(inputs, PADDING, 1024, true);

    // 3) 合成图集
    const atlas = createCanvas(layout.atlasWidth, layout.atlasHeight);
    const actx = atlas.getContext("2d");
    for (const [i, f] of layout.frames.entries()) {
      const t = trimmed[i]!;
      actx.drawImage(t.img, t.trim.x, t.trim.y, t.trim.w, t.trim.h, f.x, f.y, f.w, f.h);
    }
    const atlasPixels: Pixels = (() => {
      const d = actx.getImageData(0, 0, atlas.width, atlas.height);
      return { data: d.data, width: d.width, height: d.height };
    })();

    // 4) 验证图集中每帧位置：内容左上角标记点（绿色）应出现在 (x, y)
    for (const [i, f] of layout.frames.entries()) {
      const t = trimmed[i]!;
      void i;
      const [r, g, b, a] = px(atlasPixels, f.x, f.y);
      expect([r, g, b], `${t.name} 内容左上角`).toEqual([0, 255, 128]);
      expect(a).toBe(255);
      // 内容右下角标记（蓝色）
      const [r2, g2, b2] = px(atlasPixels, f.x + f.w - 1, f.y + f.h - 1);
      expect([r2, g2, b2], `${t.name} 内容右下角`).toEqual([0, 128, 255]);
      // 统一留白：内容四周 PADDING 范围内应全透明
      for (let k = 1; k <= PADDING; k++) {
        if (f.x - k >= 0) expect(px(atlasPixels, f.x - k, f.y)[3], `${t.name} 左侧留白`).toBe(0);
        if (f.y - k >= 0) expect(px(atlasPixels, f.x, f.y - k)[3], `${t.name} 上侧留白`).toBe(0);
      }
    }

    // 5) 导出 JSON（内嵌图集 dataURL）
    const settings = { ...DEFAULT_SETTINGS, padding: PADDING, maxSize: 1024 };
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings,
      atlasDataURL: atlas.toDataURL("image/png")
    });
    const jsonText = JSON.stringify(json, null, 2);

    // 6) 重新导入：解析 JSON + 从内嵌图集恢复
    const parsed = parseAtlasJSON(JSON.parse(jsonText));
    expect(parsed.frames.map((f) => f.name)).toEqual(trimmed.map((t) => t.name));
    expect(parsed.frames.map((f) => f.duration)).toEqual(DURATIONS);
    expect(parsed.settings.padding).toBe(PADDING);

    // 6.1) pivot/anchor/九宫格无损还原，且与输入的规范值一致
    for (const [i, pf] of parsed.frames.entries()) {
      const t = trimmed[i]!;
      const src = layout.frames[i]!;
      expect(pf.meta.pivot, `${t.name} pivot`).toEqual(src.meta.pivot);
      expect(pf.meta.anchor, `${t.name} anchor`).toEqual(src.meta.anchor);
      expect(pf.meta.nineSlice, `${t.name} nineSlice`).toEqual(src.meta.nineSlice);

      // pivot 位于四周透明边不同的区域：换算后的图集坐标 = 原始 - trim + frame
      const expectedPivotX = src.meta.pivot.x - src.trim.x + src.x;
      const expectedPivotY = src.meta.pivot.y - src.trim.y + src.y;
      expect(src.atlasMeta.pivot.x, `${t.name} atlas pivot x`).toBeCloseTo(expectedPivotX, 6);
      expect(src.atlasMeta.pivot.y, `${t.name} atlas pivot y`).toBeCloseTo(expectedPivotY, 6);
      // walk_04 四周边 30px、留白只有 3px：pivot(1.5,2.25) 换算后落在内容框外留白中
      if (t.name === "walk_04.png") {
        expect(src.atlasMeta.pivot.x).toBeLessThan(src.x);
        expect(src.atlasMeta.pivot.y).toBeLessThan(src.y);
      }
    }

    const restoredAtlas = await loadImage(Buffer.from(atlas.toBuffer("image/png")));
    for (const [i, pf] of parsed.frames.entries()) {
      // 从图集切出内容，按 spriteSourceSize 放回原始尺寸 —— 应与原 PNG 逐像素一致
      const full: Canvas = createCanvas(pf.sourceSize.w, pf.sourceSize.h);
      const fctx = full.getContext("2d");
      fctx.drawImage(
        restoredAtlas,
        pf.frame.x, pf.frame.y, pf.frame.w, pf.frame.h,
        pf.spriteSourceSize.x, pf.spriteSourceSize.y, pf.frame.w, pf.frame.h
      );
      const got = fctx.getImageData(0, 0, full.width, full.height);
      const orig = pixelsOf(frames[i]!.img, pf.sourceSize.w, pf.sourceSize.h);
      expect(Buffer.from(got.data).equals(Buffer.from(orig.data)),
        `${pf.name} 恢复后应与原图逐像素一致`).toBe(true);

      // 打包结果恢复：位置尺寸与 layout 一致
      const src = layout.frames[i]!;
      expect([pf.frame.x, pf.frame.y, pf.frame.w, pf.frame.h]).toEqual([src.x, src.y, src.w, src.h]);
    }
  });

  it("预览位置：裁切内容按偏移放回后与原始帧一致", async () => {
    const frames = await loadAll();
    for (const f of frames) {
      const spec = EXPECTED[f.name]!;
      const [w, h] = spec.size;
      const bbox: TrimRect = computeAlphaBBox(pixelsOf(f.img, w, h))!;
      // 模拟预览：把裁切内容绘制到 (trim.x, trim.y)
      const stage = createCanvas(w, h);
      const sctx = stage.getContext("2d");
      sctx.drawImage(f.img, bbox.x, bbox.y, bbox.w, bbox.h, bbox.x, bbox.y, bbox.w, bbox.h);
      const got = sctx.getImageData(0, 0, w, h);
      const orig = pixelsOf(f.img, w, h);
      expect(Buffer.from(got.data).equals(Buffer.from(orig.data)), f.name).toBe(true);
    }
  });

  it("预览时长：按每帧时长推进的帧序与解析式一致", () => {
    const animator = new Animator(DURATIONS);
    const seq: number[] = [];
    // 以 16ms 步进模拟 ticker，跑两轮
    const total = DURATIONS.reduce((a, b) => a + b, 0);
    for (let t = 0; t < total * 2; t += 16) {
      seq.push(animator.tick(16));
    }
    // 与解析式抽样比对
    const sample = [0, 49, 50, 129, 130, 249, 250, 369, 370, 469, 470, 502, 503, 669, 670, 759, 760, 849, 850, 909, 910];
    for (const t of sample) {
      if (t < total) {
        const a = new Animator(DURATIONS);
        expect(a.tick(t), `t=${t}`).toBe(frameIndexAt(DURATIONS, t));
      }
    }
    // 帧序应包含循环：第一轮 8 帧播完后回到 0
    expect(seq).toContain(0);
    expect(seq.filter((v) => v === 0).length).toBeGreaterThan(1);
  });

  it("改留白/重新裁切/重打包不动原始坐标；导出→导入→再重打包完全一致", async () => {
    const frames = await loadAll();

    const buildInputs = (padding: { shift: number } | null = null): PackInput[] => {
      void padding;
      return frames.map((f, i) => {
        const spec = EXPECTED[f.name]!;
        const [w, h] = spec.size;
        const bbox = computeAlphaBBox(pixelsOf(f.img, w, h))!;
        return {
          id: `f${i}`,
          name: f.name,
          w: bbox.w,
          h: bbox.h,
          trim: bbox,
          srcW: w,
          srcH: h,
          duration: DURATIONS[i]!,
          // 每帧不同的 pivot/anchor/九宫格，且 pivot 故意在透明区
          meta: {
            pivot: { x: (i * 7) % w, y: ((i * 13) % h) + 0.5 },
            anchor: { x: (i % 5) * 0.2, y: ((i + 1) % 5) * 0.2 },
            nineSlice: {
              left: Math.min(1, w - 1),
              right: w - Math.min(1, w - 1),
              top: Math.min(1, h - 1),
              bottom: h - Math.min(1, h - 1)
            }
          }
        };
      });
    };

    // 1) padding=3 打包
    const inputs3 = buildInputs();
    const canonical3 = inputs3.map((i) => structuredClone(i.meta));
    const layout3 = packFrames(inputs3, 3, 1024, true);

    // 2) 改留白 padding=12 重打包
    const inputs12 = buildInputs();
    const layout12 = packFrames(inputs12, 12, 1024, true);

    // 规范值不变
    for (const [i, inp] of inputs12.entries()) {
      expect(inp.meta).toEqual(canonical3[i]);
    }
    // 图集派生坐标随留白变化（同一帧内容位置整体平移量两布局可能不同，
    // 这里直接验证派生值 = 规范值 - trim + frame，且两布局在 padding 差上体现）
    for (const [i, f3] of layout3.frames.entries()) {
      const f12 = layout12.frames[i]!;
      // atlasMeta 与 frame/trim 的数学关系
      expect(f12.atlasMeta.pivot.x).toBeCloseTo(f12.meta.pivot.x - f12.trim.x + f12.x, 6);
      expect(f3.atlasMeta.pivot.x).toBeCloseTo(f3.meta.pivot.x - f3.trim.x + f3.x, 6);
      // 九宫格换算
      expect(f12.atlasMeta.nineSlice!.left).toBe(f12.meta.nineSlice!.left - f12.trim.x + f12.x);
      expect(f12.atlasMeta.nineSlice!.bottom).toBe(f12.meta.nineSlice!.bottom - f12.trim.y + f12.y);
    }

    // 3) 导出 padding=12 的 JSON，重新导入（规范值无损），再按 padding=3 重打包
    const atlas = createCanvas(layout12.atlasWidth, layout12.atlasHeight);
    const actx = atlas.getContext("2d");
    for (const [i, f] of layout12.frames.entries()) {
      actx.drawImage(
        frames[i]!.img,
        f.trim.x, f.trim.y, f.trim.w, f.trim.h,
        f.x, f.y, f.w, f.h
      );
    }
    const json12 = buildAtlasJSON(layout12, {
      imageName: "atlas.png",
      trimmed: true,
      settings: { ...DEFAULT_SETTINGS, padding: 12, maxSize: 1024 },
      atlasDataURL: atlas.toDataURL("image/png")
    });
    const parsed = parseAtlasJSON(JSON.parse(JSON.stringify(json12)));

    // 导入还原的规范值与最初一致
    for (const [i, pf] of parsed.frames.entries()) {
      expect(pf.meta, pf.name).toEqual(canonical3[i]);
    }

    // 以恢复的元数据按 padding=3 重新打包：预览对齐所需的 frame/trim 与布局
    // 应与第一次 padding=3 完全一致（maxrects 对相同输入确定性布局）
    const repackInputs: PackInput[] = parsed.frames.map((f, i) => ({
      id: `r${i}`,
      name: f.name,
      w: f.spriteSourceSize.w,
      h: f.spriteSourceSize.h,
      trim: { ...f.spriteSourceSize },
      srcW: f.sourceSize.w,
      srcH: f.sourceSize.h,
      duration: f.duration,
      meta: f.meta
    }));
    const repacked3 = packFrames(repackInputs, 3, 1024, true);
    expect(repacked3.atlasWidth).toBe(layout3.atlasWidth);
    expect(repacked3.atlasHeight).toBe(layout3.atlasHeight);
    for (const [i, f] of repacked3.frames.entries()) {
      const o = layout3.frames[i]!;
      expect([f.x, f.y, f.w, f.h], f.name).toEqual([o.x, o.y, o.w, o.h]);
      expect(f.trim).toEqual(o.trim);
      // 边界与数值完全一致
      expect(f.meta).toEqual(o.meta);
      expect(f.atlasMeta).toEqual(o.atlasMeta);
    }
  });
});
