import { describe, expect, it } from "vitest";
import { buildAtlasJSON, parseAtlasJSON, JSON_APP_ID } from "../../src/lib/core/serialize";
import { packFrames, type PackInput } from "../../src/lib/core/pack";
import { defaultMeta } from "../../src/lib/core/meta";
import { DEFAULT_SETTINGS } from "../../src/lib/core/types";

function makeLayout() {
  const inputs: PackInput[] = [
    { id: "1", name: "run_01.png", w: 42, h: 48, trim: { x: 8, y: 10, w: 42, h: 48 }, srcW: 64, srcH: 64, duration: 50, meta: defaultMeta(64, 64) },
    { id: "2", name: "run_02.png", w: 70, h: 40, trim: { x: 6, y: 4, w: 70, h: 40 }, srcW: 96, srcH: 48, duration: 80, meta: defaultMeta(96, 48) },
    { id: "3", name: "run_03.png", w: 200, h: 150, trim: { x: 0, y: 0, w: 200, h: 150 }, srcW: 200, srcH: 150, duration: 120, meta: defaultMeta(200, 150) }
  ];
  return packFrames(inputs, 2, 1024, true);
}

describe("buildAtlasJSON / parseAtlasJSON", () => {
  it("导出后再导入：帧列表、顺序、时长、位置、裁切信息完整恢复", () => {
    const layout = makeLayout();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: { ...DEFAULT_SETTINGS, padding: 2, maxSize: 1024 },
      atlasDataURL: "data:image/png;base64,AAAA"
    });

    const parsed = parseAtlasJSON(JSON.parse(JSON.stringify(json)));

    expect(parsed.size).toEqual({ w: layout.atlasWidth, h: layout.atlasHeight });
    expect(parsed.frames.map((f) => f.name)).toEqual(["run_01.png", "run_02.png", "run_03.png"]);
    expect(parsed.frames.map((f) => f.duration)).toEqual([50, 80, 120]);
    expect(parsed.settings.padding).toBe(2);
    expect(parsed.atlasDataURL).toBe("data:image/png;base64,AAAA");

    for (const [i, f] of parsed.frames.entries()) {
      const src = layout.frames[i]!;
      expect(f.frame).toEqual({ x: src.x, y: src.y, w: src.w, h: src.h });
      expect(f.spriteSourceSize).toEqual({
        x: src.trim.x,
        y: src.trim.y,
        w: src.trim.w,
        h: src.trim.h
      });
      expect(f.sourceSize).toEqual({ w: src.srcW, h: src.srcH });
    }
  });

  it("JSON 可序列化为字符串再解析（模拟写盘/读盘）", () => {
    const layout = makeLayout();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const text = JSON.stringify(json, null, 2);
    const parsed = parseAtlasJSON(JSON.parse(text));
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.imageName).toBe("atlas.png");
  });

  it("拒绝非本工具 JSON", () => {
    expect(() => parseAtlasJSON({ frames: {}, meta: { app: "other" } })).toThrow(/meta\.app/);
    expect(() => parseAtlasJSON(null)).toThrow(/顶层/);
    expect(() => parseAtlasJSON({})).toThrow(/meta/);
  });

  it("拒绝越界帧矩形", () => {
    const layout = makeLayout();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const tampered = JSON.parse(JSON.stringify(json));
    tampered.frames["run_01.png"].frame.x = 10000;
    expect(() => parseAtlasJSON(tampered)).toThrow(/超出图集范围/);
  });

  it("meta.app 标识正确", () => {
    const layout = makeLayout();
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: false,
      settings: DEFAULT_SETTINGS
    });
    expect(json.meta.app).toBe(JSON_APP_ID);
    expect(json.meta.totalDuration).toBe(50 + 80 + 120);
  });
});

describe("pivot / anchor / 九宫格序列化", () => {
  function layoutWithMeta(meta: Parameters<typeof packFrames>[0][number]["meta"]) {
    const inputs: PackInput[] = [
      {
        id: "1",
        name: "run_01.png",
        w: 42,
        h: 48,
        trim: { x: 8, y: 10, w: 42, h: 48 },
        srcW: 64,
        srcH: 64,
        duration: 50,
        meta
      }
    ];
    return packFrames(inputs, 2, 1024, true);
  }

  it("导出使用原始画布坐标系并携带图集派生值", () => {
    const meta = {
      pivot: { x: 1.5, y: 2.25 }, // 落在被裁掉的透明区
      anchor: { x: 0.25, y: 0.75 },
      nineSlice: { left: 2, right: 60, top: 3, bottom: 61 }
    };
    const layout = layoutWithMeta(meta);
    const json = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: true,
      settings: { ...DEFAULT_SETTINGS, padding: 2 }
    });
    const f = json.frames["run_01.png"]!;

    // 规范值：原始像素/归一化，与留白无关
    expect(f.pivot).toEqual({ x: 1.5, y: 2.25 });
    expect(f.anchor).toEqual({ x: 0.25, y: 0.75 });
    expect(f.nineSlice).toEqual({ left: 2, right: 60, top: 3, bottom: 61 });
    expect(f.sourceSize).toEqual({ w: 64, h: 64 });

    // 派生值：图集坐标，pivot 在内容框之外（负偏移方向）但合法
    const pf = layout.frames[0]!;
    expect(f.atlasMeta?.pivot).toEqual({
      x: 1.5 - 8 + pf.x,
      y: 2.25 - 10 + pf.y
    });
    expect(f.atlasMeta?.pivot.x).toBeLessThan(pf.x);
    expect(f.atlasMeta?.nineSlice?.left).toBe(2 - 8 + pf.x);
  });

  it("导出再导入无损还原规范值（即使 atlasMeta 被篡改也以原始坐标重建）", () => {
    const meta = {
      pivot: { x: 1.5, y: 2.25 },
      anchor: { x: 0.25, y: 0.75 },
      nineSlice: { left: 2, right: 60, top: 3, bottom: 61 }
    };
    const json = buildAtlasJSON(layoutWithMeta(meta), {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const text = JSON.stringify(json);
    const parsed = parseAtlasJSON(JSON.parse(text));
    expect(parsed.frames[0]!.meta).toEqual(meta);
  });

  it("改留白后重新导出：原始坐标不变，图集派生坐标变化", () => {
    const meta = {
      pivot: { x: 16, y: 20 },
      anchor: { x: 0.5, y: 0.5 },
      nineSlice: { left: 4, right: 60, top: 4, bottom: 60 }
    };
    const j2 = buildAtlasJSON(layoutWithMeta(meta), {
      imageName: "atlas.png",
      trimmed: true,
      settings: { ...DEFAULT_SETTINGS, padding: 2 }
    });
    // padding=10：手工重打包
    const layout10 = packFrames(
      [
        {
          id: "1",
          name: "run_01.png",
          w: 42,
          h: 48,
          trim: { x: 8, y: 10, w: 42, h: 48 },
          srcW: 64,
          srcH: 64,
          duration: 50,
          meta
        }
      ],
      10,
      1024,
      true
    );
    const j10 = buildAtlasJSON(layout10, {
      imageName: "atlas.png",
      trimmed: true,
      settings: { ...DEFAULT_SETTINGS, padding: 10 }
    });

    const f2 = j2.frames["run_01.png"]!;
    const f10 = j10.frames["run_01.png"]!;
    expect(f10.pivot).toEqual(f2.pivot);
    expect(f10.anchor).toEqual(f2.anchor);
    expect(f10.nineSlice).toEqual(f2.nineSlice);
    expect(f10.atlasMeta!.pivot.x).toBeGreaterThan(f2.atlasMeta!.pivot.x);
    expect(f10.atlasMeta!.pivot.x - f2.atlasMeta!.pivot.x).toBe(8);
  });

  it("旧版本 JSON（无 pivot/anchor）按原始画布中心恢复", () => {
    const json = buildAtlasJSON(makeLayout(), {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    for (const f of Object.values(json.frames)) {
      delete f.pivot;
      delete f.anchor;
      delete f.nineSlice;
    }
    const parsed = parseAtlasJSON(JSON.parse(JSON.stringify(json)));
    expect(parsed.frames[0]!.meta.pivot).toEqual({ x: 32, y: 32 }); // 64×64 中心
    expect(parsed.frames[0]!.meta.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(parsed.frames[0]!.meta.nineSlice).toBeNull();
    expect(parsed.frames[1]!.meta.pivot).toEqual({ x: 48, y: 24 }); // 96×48 中心
  });

  it("非法九宫格：越界 / 交叉 / 非整数 均被拒绝", () => {
    const json = buildAtlasJSON(makeLayout(), {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const setNS = (v: unknown) => {
      const t = JSON.parse(JSON.stringify(json));
      t.frames["run_01.png"].nineSlice = v;
      return t;
    };
    expect(() => parseAtlasJSON(setNS({ left: -1, right: 10, top: 0, bottom: 10 }))).toThrow(/超出原始尺寸/);
    expect(() => parseAtlasJSON(setNS({ left: 30, right: 10, top: 0, bottom: 10 }))).toThrow(/交叉/);
    expect(() => parseAtlasJSON(setNS({ left: 1.5, right: 10, top: 0, bottom: 10 }))).toThrow(/整数/);
    expect(() => parseAtlasJSON(setNS({ left: 0, right: 65, top: 0, bottom: 10 }))).toThrow(/超出原始尺寸/);
  });

  it("非法 pivot / anchor 被拒绝", () => {
    const json = buildAtlasJSON(makeLayout(), {
      imageName: "atlas.png",
      trimmed: true,
      settings: DEFAULT_SETTINGS
    });
    const badPivot = JSON.parse(JSON.stringify(json));
    badPivot.frames["run_01.png"].pivot = { x: 65, y: 0 };
    expect(() => parseAtlasJSON(badPivot)).toThrow(/pivot 超出原始尺寸/);
    const badAnchor = JSON.parse(JSON.stringify(json));
    badAnchor.frames["run_01.png"].anchor = { x: 0, y: 1.2 };
    expect(() => parseAtlasJSON(badAnchor)).toThrow(/anchor/);
  });
});
