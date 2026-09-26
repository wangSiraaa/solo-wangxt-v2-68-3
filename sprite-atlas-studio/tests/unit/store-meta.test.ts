/**
 * store 层元数据行为：非法输入被阻止并保留上次有效值；
 * 修改元数据后已有打包结果的图集坐标同步刷新（无需重新打包）。
 * 在 Node 中运行（store 的浏览器 API 在这些路径上不会被触达）。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  frames,
  packResult,
  setFrameAnchor,
  setFrameNineSlice,
  setFramePivot,
  getLastJSON
} from "../../src/lib/core/store";
import type { FrameItem, PackedFrame } from "../../src/lib/core/types";
import { defaultFrameMeta } from "../../src/lib/core/meta";

function fakeFrame(id: string, w: number, h: number): FrameItem {
  return {
    id,
    name: `${id}.png`,
    duration: 100,
    width: w,
    height: h,
    blob: new Blob(),
    url: "",
    meta: defaultFrameMeta(w, h)
  };
}

function fakePacked(item: FrameItem): PackedFrame {
  return {
    id: item.id,
    name: item.name,
    x: 12,
    y: 8,
    w: 40,
    h: 30,
    trim: { x: 8, y: 10, w: 40, h: 30 },
    srcW: item.width,
    srcH: item.height,
    duration: 100,
    meta: item.meta,
    atlasPivot: { x: 12 + (item.meta.pivot.x - 8), y: 8 + (item.meta.pivot.y - 10) },
    atlasAnchor: { x: 12 + (item.meta.anchor.x - 8), y: 8 + (item.meta.anchor.y - 10) },
    atlasNineSlice: null
  };
}

beforeEach(() => {
  frames.set([fakeFrame("a", 62, 46)]);
  packResult.set(null);
});

describe("setFramePivot / setFrameAnchor", () => {
  it("合法值被接受（含被裁掉的透明区）", () => {
    expect(setFramePivot("a", { x: 4, y: 5 })).toBe(true); // 左8上10 透明边内
    expect(get(frames)[0]!.meta.pivot).toEqual({ x: 4, y: 5 });
    expect(setFrameAnchor("a", { x: 61, y: 0 })).toBe(true); // 边缘
    expect(get(frames)[0]!.meta.anchor).toEqual({ x: 61, y: 0 });
  });

  it("非法值被拒绝并保留上次有效值", () => {
    setFramePivot("a", { x: 10, y: 10 });
    expect(setFramePivot("a", { x: -1, y: 10 })).toBe(false);
    expect(setFramePivot("a", { x: 10, y: 100 })).toBe(false);
    expect(setFramePivot("a", { x: NaN, y: 10 })).toBe(false);
    expect(get(frames)[0]!.meta.pivot).toEqual({ x: 10, y: 10 });

    setFrameAnchor("a", { x: 20, y: 20 });
    expect(setFrameAnchor("a", { x: 20, y: -5 })).toBe(false);
    expect(get(frames)[0]!.meta.anchor).toEqual({ x: 20, y: 20 });
  });
});

describe("setFrameNineSlice", () => {
  it("合法九宫格被接受；传 null 取消拉伸", () => {
    expect(setFrameNineSlice("a", { left: 8, right: 54, top: 10, bottom: 40 })).toBe(true);
    expect(get(frames)[0]!.meta.nineSlice).toEqual({ left: 8, right: 54, top: 10, bottom: 40 });
    expect(setFrameNineSlice("a", null)).toBe(true);
    expect(get(frames)[0]!.meta.nineSlice).toBeNull();
  });

  it("交叉或越界被阻止，且保留上次有效值", () => {
    setFrameNineSlice("a", { left: 8, right: 54, top: 10, bottom: 40 });
    // 左右交叉
    expect(setFrameNineSlice("a", { left: 60, right: 54, top: 10, bottom: 40 })).toBe(false);
    // 上下相等
    expect(setFrameNineSlice("a", { left: 8, right: 54, top: 40, bottom: 40 })).toBe(false);
    // 越界
    expect(setFrameNineSlice("a", { left: -2, right: 54, top: 10, bottom: 40 })).toBe(false);
    expect(setFrameNineSlice("a", { left: 8, right: 54, top: 10, bottom: 99 })).toBe(false);
    // 上次有效值原样保留
    expect(get(frames)[0]!.meta.nineSlice).toEqual({ left: 8, right: 54, top: 10, bottom: 40 });
  });
});

describe("元数据修改同步已有打包结果", () => {
  it("图集坐标随 meta 重算，布局不变，lastJSON 同步更新", () => {
    const item = get(frames)[0]!;
    packResult.set({
      atlasWidth: 64,
      atlasHeight: 64,
      frames: [fakePacked(item)],
      atlasBlob: new Blob(),
      atlasUrl: "",
      padding: 2,
      trimmed: true
    });

    expect(setFramePivot("a", { x: 4, y: 5 })).toBe(true);
    const pf = get(packResult)!.frames[0]!;
    // 布局（内容位置）不变
    expect([pf.x, pf.y, pf.w, pf.h]).toEqual([12, 8, 40, 30]);
    // 图集坐标按新 pivot 重算：内容位置 + (pivot - trim)
    expect(pf.atlasPivot).toEqual({ x: 12 + (4 - 8), y: 8 + (5 - 10) });
    // 原始图像坐标
    expect(pf.meta.pivot).toEqual({ x: 4, y: 5 });
    // 导出用 JSON 同步
    const json = getLastJSON();
    expect(json?.frames["a.png"]?.pivot).toEqual({ x: 4, y: 5 });
  });
});
