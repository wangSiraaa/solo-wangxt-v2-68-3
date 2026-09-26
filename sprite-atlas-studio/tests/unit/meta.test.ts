import { describe, expect, it } from "vitest";
import {
  defaultFrameMeta,
  frameMetaToAtlas,
  sourceNineSliceToAtlas,
  sourcePointToAtlas,
  validateNineSlice,
  validatePoint
} from "../../src/lib/core/meta";
import { packFrames, type PackInput } from "../../src/lib/core/pack";
import { buildAtlasJSON, parseAtlasJSON, COORDINATE_SPACE } from "../../src/lib/core/serialize";
import { DEFAULT_SETTINGS, type FrameMeta, type NineSlice, type TrimRect } from "../../src/lib/core/types";

/** 内容 40×30，四周透明边各不相同：左 8、上 10、右 14、下 6（原图 62×46） */
const TRIM: TrimRect = { x: 8, y: 10, w: 40, h: 30 };
const SRC_W = 62;
const SRC_H = 46;
const CONTENT_X = 103; // 图集中内容左上角（已含留白）
const CONTENT_Y = 57;

function metaWith(pivot: { x: number; y: number }, nineSlice: NineSlice | null = null): FrameMeta {
  return { pivot, anchor: { ...pivot }, nineSlice };
}

describe("validatePoint", () => {
  it("原图范围内（含透明区与边缘）合法", () => {
    expect(validatePoint({ x: 0, y: 0 }, SRC_W, SRC_H)).toBeNull();
    expect(validatePoint({ x: 4, y: 5 }, SRC_W, SRC_H)).toBeNull(); // 透明区内
    expect(validatePoint({ x: SRC_W, y: SRC_H }, SRC_W, SRC_H)).toBeNull(); // 边缘
    expect(validatePoint({ x: 31.5, y: 23 }, SRC_W, SRC_H)).toBeNull(); // 半像素
  });

  it("超出原图或非有限数被拒绝", () => {
    expect(validatePoint({ x: -1, y: 0 }, SRC_W, SRC_H)).toMatch(/超出原图范围/);
    expect(validatePoint({ x: 0, y: SRC_H + 1 }, SRC_W, SRC_H)).toMatch(/超出原图范围/);
    expect(validatePoint({ x: NaN, y: 0 }, SRC_W, SRC_H)).toMatch(/有限数字/);
    expect(validatePoint({ x: 0, y: Infinity }, SRC_W, SRC_H)).toMatch(/有限数字/);
  });
});

describe("validateNineSlice", () => {
  it("合法九宫格通过", () => {
    expect(validateNineSlice({ left: 8, right: 54, top: 10, bottom: 40 }, SRC_W, SRC_H)).toBeNull();
    // 贴原图边缘也合法
    expect(validateNineSlice({ left: 0, right: SRC_W, top: 0, bottom: SRC_H }, SRC_W, SRC_H)).toBeNull();
  });

  it("边界落到原图之外被拒绝", () => {
    expect(validateNineSlice({ left: -1, right: 54, top: 10, bottom: 40 }, SRC_W, SRC_H)).toMatch(/超出原图范围/);
    expect(validateNineSlice({ left: 8, right: SRC_W + 1, top: 10, bottom: 40 }, SRC_W, SRC_H)).toMatch(/超出原图范围/);
    expect(validateNineSlice({ left: 8, right: 54, top: -2, bottom: 40 }, SRC_W, SRC_H)).toMatch(/超出原图范围/);
    expect(validateNineSlice({ left: 8, right: 54, top: 10, bottom: SRC_H + 1 }, SRC_W, SRC_H)).toMatch(/超出原图范围/);
  });

  it("边界相互交叉（含相等）被拒绝", () => {
    expect(validateNineSlice({ left: 54, right: 8, top: 10, bottom: 40 }, SRC_W, SRC_H)).toMatch(/交叉/);
    expect(validateNineSlice({ left: 30, right: 30, top: 10, bottom: 40 }, SRC_W, SRC_H)).toMatch(/交叉/);
    expect(validateNineSlice({ left: 8, right: 54, top: 40, bottom: 10 }, SRC_W, SRC_H)).toMatch(/交叉/);
    expect(validateNineSlice({ left: 8, right: 54, top: 25, bottom: 25 }, SRC_W, SRC_H)).toMatch(/交叉/);
  });

  it("非有限数被拒绝", () => {
    expect(validateNineSlice({ left: NaN, right: 54, top: 10, bottom: 40 }, SRC_W, SRC_H)).toMatch(/有限数字/);
  });
});

describe("坐标换算：原始图像坐标系 → 图集坐标系（裁切 + 留白后）", () => {
  it("四周透明边不同的帧：逐点换算正确", () => {
    // 内容区左上角（原图坐标 = trim 原点）
    expect(sourcePointToAtlas({ x: 8, y: 10 }, TRIM, CONTENT_X, CONTENT_Y)).toEqual({ x: 103, y: 57 });
    // 内容区右下角
    expect(sourcePointToAtlas({ x: 47, y: 39 }, TRIM, CONTENT_X, CONTENT_Y)).toEqual({ x: 142, y: 86 });
    // 原图左上角（透明区内）→ 内容框之外
    expect(sourcePointToAtlas({ x: 0, y: 0 }, TRIM, CONTENT_X, CONTENT_Y)).toEqual({ x: 95, y: 47 });
  });

  it("pivot 位于被裁掉的透明区时仍可表达（图集坐标可落在内容框外）", () => {
    // pivot 在原图 (4, 5)：位于左 8、上 10 的透明边内
    const atlas = sourcePointToAtlas({ x: 4, y: 5 }, TRIM, CONTENT_X, CONTENT_Y);
    expect(atlas).toEqual({ x: 99, y: 52 });
    // 确实在内容框 (103,57,40×30) 之外，但仍是合法数值
    expect(atlas.x).toBeLessThan(CONTENT_X);
    expect(atlas.y).toBeLessThan(CONTENT_Y);
    expect(Number.isFinite(atlas.x)).toBe(true);
  });

  it("九宫格四条边界逐线换算", () => {
    const ns = { left: 12, right: 50, top: 14, bottom: 36 };
    expect(sourceNineSliceToAtlas(ns, TRIM, CONTENT_X, CONTENT_Y)).toEqual({
      left: 107, // 103 + (12-8)
      right: 145, // 103 + (50-8)
      top: 61, // 57 + (14-10)
      bottom: 83 // 57 + (36-10)
    });
  });

  it("frameMetaToAtlas 整体换算；不可拉伸时九宫格保持 null", () => {
    const meta: FrameMeta = {
      pivot: { x: 20, y: 22 },
      anchor: { x: 30, y: 12 },
      nineSlice: { left: 12, right: 50, top: 14, bottom: 36 }
    };
    const out = frameMetaToAtlas(meta, TRIM, CONTENT_X, CONTENT_Y);
    expect(out.pivot).toEqual({ x: 115, y: 69 });
    expect(out.anchor).toEqual({ x: 125, y: 59 });
    expect(out.nineSlice).toEqual({ left: 107, right: 145, top: 61, bottom: 83 });

    const bare = frameMetaToAtlas(metaWith({ x: 10, y: 10 }), TRIM, CONTENT_X, CONTENT_Y);
    expect(bare.nineSlice).toBeNull();
  });
});

describe("packFrames 携带元数据", () => {
  function input(id: string, w: number, h: number, meta: FrameMeta): PackInput {
    return {
      id,
      name: `${id}.png`,
      w,
      h,
      trim: { x: 8, y: 10, w, h },
      srcW: w + 22,
      srcH: h + 16,
      duration: 100,
      meta
    };
  }

  it("打包后图集坐标 = 内容位置 + (原图坐标 - 裁切偏移)，留白已计入", () => {
    const meta: FrameMeta = {
      pivot: { x: 8, y: 10 }, // 内容左上角
      anchor: { x: 4, y: 5 }, // 透明区内
      nineSlice: { left: 10, right: 40, top: 12, bottom: 30 }
    };
    const layout = packFrames([input("a", 40, 30, meta)], 3, 256, false);
    const f = layout.frames[0]!;
    // 内容位置含留白
    expect(f.x).toBeGreaterThanOrEqual(3);
    expect(f.y).toBeGreaterThanOrEqual(3);
    expect(f.atlasPivot).toEqual({ x: f.x, y: f.y });
    expect(f.atlasAnchor).toEqual({ x: f.x - 4, y: f.y - 5 });
    expect(f.atlasNineSlice).toEqual({
      left: f.x + 2,
      right: f.x + 32,
      top: f.y + 2,
      bottom: f.y + 20
    });
    // 规范形式（原图坐标）原样保留
    expect(f.meta).toEqual(meta);
  });

  it("修改留白：图集坐标变化，原始图像坐标不变", () => {
    const meta = metaWith({ x: 20, y: 25 }, { left: 12, right: 40, top: 14, bottom: 30 });
    const small = packFrames([input("a", 40, 30, meta)], 1, 256, false);
    const large = packFrames([input("a", 40, 30, meta)], 9, 256, false);
    const f1 = small.frames[0]!;
    const f2 = large.frames[0]!;

    // 原始图像语义坐标完全一致
    expect(f2.meta).toEqual(f1.meta);
    // 图集坐标随布局/留白变化，但相对内容位置的偏移不变
    expect(f2.atlasPivot.x - f2.x).toBe(f1.atlasPivot.x - f1.x);
    expect(f2.atlasPivot.y - f2.y).toBe(f1.atlasPivot.y - f1.y);
    expect(f2.atlasNineSlice!.left - f2.x).toBe(f1.atlasNineSlice!.left - f1.x);
    // 留白不同 → 内容位置不同 → 图集坐标不同
    expect(f2.atlasPivot).not.toEqual(f1.atlasPivot);
  });
});

describe("JSON 导出/导入中的元数据", () => {
  function layoutWithMeta() {
    const inputs: PackInput[] = [
      {
        id: "1",
        name: "run_01.png",
        w: 40,
        h: 30,
        trim: { x: 8, y: 10, w: 40, h: 30 },
        srcW: 62,
        srcH: 46,
        duration: 50,
        meta: {
          pivot: { x: 4, y: 5 }, // 透明区内
          anchor: { x: 31, y: 23 },
          nineSlice: { left: 12, right: 50, top: 14, bottom: 36 }
        }
      },
      {
        id: "2",
        name: "run_02.png",
        w: 20,
        h: 20,
        trim: { x: 0, y: 0, w: 20, h: 20 },
        srcW: 20,
        srcH: 20,
        duration: 80,
        meta: defaultFrameMeta(20, 20) // 不可拉伸
      }
    ];
    return packFrames(inputs, 2, 256, true);
  }

  it("导出使用原始图像坐标系并声明 coordinateSpace，重新导入无损还原", () => {
    const layout = layoutWithMeta();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });

    expect(json.meta.coordinateSpace).toBe(COORDINATE_SPACE);
    // JSON 中是原始图像坐标（不是图集坐标）
    const jf = json.frames["run_01.png"]!;
    expect(jf.pivot).toEqual({ x: 4, y: 5 });
    expect(jf.anchor).toEqual({ x: 31, y: 23 });
    expect(jf.nineSlice).toEqual({ left: 12, right: 50, top: 14, bottom: 36 });
    expect(json.frames["run_02.png"]!.nineSlice).toBeNull();

    // 序列化 → 解析：数值完全一致
    const parsed = parseAtlasJSON(JSON.parse(JSON.stringify(json)));
    expect(parsed.frames[0]!.meta).toEqual(layout.frames[0]!.meta);
    expect(parsed.frames[1]!.meta).toEqual(layout.frames[1]!.meta);
  });

  it("缺失元数据的旧版 JSON 以默认值补齐", () => {
    const layout = layoutWithMeta();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const legacy = JSON.parse(JSON.stringify(json));
    delete legacy.frames["run_01.png"].pivot;
    delete legacy.frames["run_01.png"].anchor;
    delete legacy.frames["run_01.png"].nineSlice;
    delete legacy.meta.coordinateSpace;

    const parsed = parseAtlasJSON(legacy);
    expect(parsed.frames[0]!.meta).toEqual(defaultFrameMeta(62, 46));
  });

  it("拒绝非法元数据（越界 pivot / 交叉九宫格）", () => {
    const layout = layoutWithMeta();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const bad1 = JSON.parse(JSON.stringify(json));
    bad1.frames["run_01.png"].pivot = { x: -3, y: 5 };
    expect(() => parseAtlasJSON(bad1)).toThrow(/pivot 非法/);

    const bad2 = JSON.parse(JSON.stringify(json));
    bad2.frames["run_01.png"].nineSlice = { left: 50, right: 12, top: 14, bottom: 36 };
    expect(() => parseAtlasJSON(bad2)).toThrow(/九宫格非法/);

    const bad3 = JSON.parse(JSON.stringify(json));
    bad3.frames["run_01.png"].nineSlice = { left: 12, right: 500, top: 14, bottom: 36 };
    expect(() => parseAtlasJSON(bad3)).toThrow(/九宫格非法/);
  });

  it("重新打包后图集坐标与首次打包完全一致（确定性）", () => {
    const layout = layoutWithMeta();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const parsed = parseAtlasJSON(JSON.parse(JSON.stringify(json)));

    // 用解析结果重建打包输入（等同导入 JSON 后重新打包）
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
    const repacked = packFrames(repackInputs, parsed.settings.padding, 256, true);

    for (const [i, f] of repacked.frames.entries()) {
      const src = layout.frames[i]!;
      expect([f.x, f.y, f.w, f.h]).toEqual([src.x, src.y, src.w, src.h]);
      expect(f.atlasPivot).toEqual(src.atlasPivot);
      expect(f.atlasAnchor).toEqual(src.atlasAnchor);
      expect(f.atlasNineSlice).toEqual(src.atlasNineSlice);
      expect(f.meta).toEqual(src.meta);
    }
  });
});
