import { describe, expect, it } from "vitest";
import {
  atlasXToSource,
  atlasYToSource,
  clampAnchor,
  clampPoint,
  defaultMeta,
  defaultNineSlice,
  deriveAtlasMeta,
  sourceXToAtlas,
  sourceYToAtlas,
  validateAnchor,
  validateNineSlice,
  validatePivot
} from "../../src/lib/core/meta";
import type { FrameMeta } from "../../src/lib/core/types";

describe("默认值与夹取", () => {
  it("默认 pivot/anchor 在原始画布中心、无九宫格", () => {
    expect(defaultMeta(64, 48)).toEqual({
      pivot: { x: 32, y: 24 },
      anchor: { x: 0.5, y: 0.5 },
      nineSlice: null
    });
  });

  it("默认九宫格为三分线且在原图内、不交叉", () => {
    const ns = defaultNineSlice(90, 60);
    expect(ns).toEqual({ left: 30, right: 60, top: 20, bottom: 40 });
    expect(validateNineSlice(ns, 90, 60)).toBeNull();
  });

  it("clampPoint / clampAnchor 夹到范围内", () => {
    expect(clampPoint({ x: -5, y: 100 }, 64, 64)).toEqual({ x: 0, y: 64 });
    expect(clampPoint({ x: 64.004, y: 10 / 3 }, 64, 64)).toEqual({ x: 64, y: 3.33 });
    expect(clampAnchor({ x: 2, y: -0.1 })).toEqual({ x: 1, y: 0 });
  });
});

describe("validatePivot / validateAnchor", () => {
  it("pivot 允许落在画布任意位置（含被裁透明区），但不得越界", () => {
    expect(validatePivot({ x: 0, y: 0 }, 64, 64)).toBeNull();
    expect(validatePivot({ x: 1.5, y: 2.25 }, 64, 64)).toBeNull();
    expect(validatePivot({ x: 64, y: 64 }, 64, 64)).toBeNull();
    expect(validatePivot({ x: -0.01, y: 0 }, 64, 64)).toMatch(/超出/);
    expect(validatePivot({ x: 0, y: 64.01 }, 64, 64)).toMatch(/超出/);
    expect(validatePivot({ x: NaN, y: 0 }, 64, 64)).toMatch(/数字/);
  });

  it("anchor 必须在 0–1", () => {
    expect(validateAnchor({ x: 0, y: 1 })).toBeNull();
    expect(validateAnchor({ x: 1.01, y: 0 })).toMatch(/0–1/);
    expect(validateAnchor({ x: 0, y: -1 })).toMatch(/0–1/);
  });
});

describe("validateNineSlice：边界不得落到原图之外或相互交叉", () => {
  it("合法：边重合（该方向不拉伸）也允许", () => {
    expect(validateNineSlice({ left: 10, right: 10, top: 0, bottom: 48 }, 64, 48)).toBeNull();
  });

  it("拒绝越界", () => {
    expect(validateNineSlice({ left: -1, right: 10, top: 0, bottom: 10 }, 64, 48)).toMatch(/超出原图/);
    expect(validateNineSlice({ left: 0, right: 65, top: 0, bottom: 10 }, 64, 48)).toMatch(/超出原图/);
    expect(validateNineSlice({ left: 0, right: 10, top: -1, bottom: 10 }, 64, 48)).toMatch(/超出原图/);
    expect(validateNineSlice({ left: 0, right: 10, top: 0, bottom: 49 }, 64, 48)).toMatch(/超出原图/);
  });

  it("拒绝相互交叉", () => {
    expect(validateNineSlice({ left: 30, right: 10, top: 0, bottom: 10 }, 64, 48)).toMatch(/竖线交叉/);
    expect(validateNineSlice({ left: 0, right: 10, top: 30, bottom: 10 }, 64, 48)).toMatch(/横线交叉/);
  });

  it("拒绝非整数", () => {
    expect(validateNineSlice({ left: 1.5, right: 10, top: 0, bottom: 10 }, 64, 48)).toMatch(/整数/);
    expect(validateNineSlice({ left: 0, right: NaN, top: 0, bottom: 10 }, 64, 48)).toMatch(/整数/);
  });

  it("九宫格允许落在透明裁切区内（只受原图边界约束）", () => {
    // trim = {x:8,y:10,w:42,h:48}（src 64×64），线 2/62 均在裁切区外的透明带
    const ns = { left: 2, right: 62, top: 3, bottom: 60 };
    expect(validateNineSlice(ns, 64, 64)).toBeNull();
  });
});

describe("坐标换算：四周透明边不同的帧", () => {
  // 原图 64×64，裁切 trim=(8,10,42,48)，打包留白 padding=3 → frame=(11,13)
  const trim = { x: 8, y: 10, w: 42, h: 48 };
  const frame = { x: 11, y: 13 };

  it("原始 → 裁切后 → 加留白后的图集坐标", () => {
    // 内容左上角 (8,10) → 图集 (11,13)
    expect(sourceXToAtlas(8, trim.x, frame.x)).toBe(11);
    expect(sourceYToAtlas(10, trim.y, frame.y)).toBe(13);
    // 内容右下角 (49,57) → 图集 (52,60) = 11+41 / 13+47
    expect(sourceXToAtlas(49, trim.x, frame.x)).toBe(52);
    expect(sourceYToAtlas(57, trim.y, frame.y)).toBe(60);
  });

  it("pivot 落在被裁掉的透明区时图集坐标为负（落在留白中），仍可表达", () => {
    // pivot (1,2) 位于左侧/上侧透明带：1-8+11=4；2-10+13=5
    expect(sourceXToAtlas(1, trim.x, frame.x)).toBe(4);
    expect(sourceYToAtlas(2, trim.y, frame.y)).toBe(5);
    // 角落 (0,0) → 3,3（内容框外 8px/10px，留白仅 3px，最终落到内容框外 5/7px）
    expect(sourceXToAtlas(0, trim.x, frame.x)).toBe(3);
    expect(sourceYToAtlas(0, trim.y, frame.y)).toBe(3);
  });

  it("逆变换无损往返", () => {
    for (const sx of [0, 1.5, 8, 49, 64]) {
      expect(atlasXToSource(sourceXToAtlas(sx, trim.x, frame.x), trim.x, frame.x)).toBeCloseTo(sx, 10);
    }
    for (const sy of [0, 2.25, 10, 57, 64]) {
      expect(atlasYToSource(sourceYToAtlas(sy, trim.y, frame.y), trim.y, frame.y)).toBeCloseTo(sy, 10);
    }
  });

  it("deriveAtlasMeta：pivot/anchor/九宫格整体换算", () => {
    const meta: FrameMeta = {
      pivot: { x: 1, y: 2 },
      anchor: { x: 0.25, y: 0.75 },
      nineSlice: { left: 2, right: 62, top: 3, bottom: 60 }
    };
    const got = deriveAtlasMeta(meta, frame, trim, 64, 64);
    expect(got.pivot).toEqual({ x: 4, y: 5 });
    // anchor 像素位置 (16,48) → (16-8+11, 48-10+13) = (19,51)
    expect(got.anchor).toEqual({ x: 19, y: 51 });
    expect(got.nineSlice).toEqual({
      left: 2 - 8 + 11,
      right: 62 - 8 + 11,
      top: 3 - 10 + 13,
      bottom: 60 - 10 + 13
    });
  });

  it("留白改变只影响图集坐标，不影响规范值", () => {
    const meta: FrameMeta = {
      pivot: { x: 16, y: 20 },
      anchor: { x: 0.5, y: 0.5 },
      nineSlice: null
    };
    const withPadding3 = deriveAtlasMeta(meta, { x: 11, y: 13 }, trim, 64, 64);
    const withPadding10 = deriveAtlasMeta(meta, { x: 18, y: 20 }, trim, 64, 64);
    // 图集坐标随留白平移
    expect(withPadding10.pivot.x - withPadding3.pivot.x).toBe(7);
    expect(withPadding10.pivot.y - withPadding3.pivot.y).toBe(7);
    // 原始坐标完全不变
    expect(meta.pivot).toEqual({ x: 16, y: 20 });
    expect(meta.anchor).toEqual({ x: 0.5, y: 0.5 });
  });
});
