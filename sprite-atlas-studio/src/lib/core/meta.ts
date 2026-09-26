import type {
  AtlasFrameMeta,
  FrameMeta,
  NineSlice,
  Point,
  TrimRect
} from "./types";

/**
 * pivot / anchor / 九宫格元数据的纯函数工具：
 * 默认值、合法性校验、原始画布坐标 ↔ 裁切后内容坐标 ↔ 图集坐标换算。
 * 浏览器与 Node 均可运行。
 */

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 新导入帧的默认元数据：pivot 与 anchor 均在原始画布中心，不启用九宫格 */
export function defaultMeta(srcW: number, srcH: number): FrameMeta {
  return {
    pivot: { x: srcW / 2, y: srcH / 2 },
    anchor: { x: 0.5, y: 0.5 },
    nineSlice: null
  };
}

/** 九宫格默认线：内容方向各三分处 */
export function defaultNineSlice(srcW: number, srcH: number): NineSlice {
  return {
    left: Math.round(srcW / 3),
    right: Math.round((srcW * 2) / 3),
    top: Math.round(srcH / 3),
    bottom: Math.round((srcH * 2) / 3)
  };
}

export function clampPoint(p: Point, srcW: number, srcH: number): Point {
  return {
    x: round2(Math.min(srcW, Math.max(0, p.x))),
    y: round2(Math.min(srcH, Math.max(0, p.y)))
  };
}

export function clampAnchor(a: Point): Point {
  return {
    x: round2(Math.min(1, Math.max(0, a.x))),
    y: round2(Math.min(1, Math.max(0, a.y)))
  };
}

/**
 * 校验九宫格四条边界（原始画布像素，整数）：
 * 必须落在原图之内且不相互交叉（允许两侧线重合，表示该方向不拉伸）。
 * @returns 合法时返回 null；否则返回中文错误信息
 */
export function validateNineSlice(
  n: NineSlice,
  srcW: number,
  srcH: number
): string | null {
  const { left, right, top, bottom } = n;
  for (const [label, v] of [
    ["left", left],
    ["right", right],
    ["top", top],
    ["bottom", bottom]
  ] as const) {
    if (!finite(v) || !Number.isInteger(v)) return `九宫格 ${label} 必须是整数像素`;
  }
  if (
    left < 0 || right < 0 || top < 0 || bottom < 0 ||
    left > srcW || right > srcW || top > srcH || bottom > srcH
  ) {
    return `九宫格边界超出原图（原图 ${srcW}×${srcH}）`;
  }
  if (right < left) return "九宫格竖线交叉：right 不得小于 left";
  if (bottom < top) return "九宫格横线交叉：bottom 不得小于 top";
  return null;
}

/** pivot 必须是有限数值且落在原始画布内 */
export function validatePivot(p: Point, srcW: number, srcH: number): string | null {
  if (!finite(p.x) || !finite(p.y)) return "pivot 必须是数字";
  if (p.x < 0 || p.y < 0 || p.x > srcW || p.y > srcH) {
    return `pivot 超出原始画布（${srcW}×${srcH}）`;
  }
  return null;
}

/** anchor 必须是 [0,1] 内的数值 */
export function validateAnchor(a: Point): string | null {
  if (!finite(a.x) || !finite(a.y)) return "anchor 必须是数字";
  if (a.x < 0 || a.y < 0 || a.x > 1 || a.y > 1) return "anchor 必须在 0–1 之间";
  return null;
}

// ---------- 坐标系换算 ----------
//
// 原始画布 (sourceSize)：用户看到的未裁切图像，原点在左上角。
// 裁切后内容画布 (trim/w × h)：去掉透明包围盒后的图像；
//   内容坐标 v_c = v_s - trim.x
// 图集 (atlas)：内容绘制在 (frame.x, frame.y)，而
//   frame.x = 打包矩形.x + padding，因此
//   v_atlas = v_s - trim.x + frame.x
// 该式对落在被裁掉透明区的点同样成立（结果为负表示落在内容框外的留白中）。

/** 原始画布 x → 图集 x */
export function sourceXToAtlas(sx: number, trimX: number, frameX: number): number {
  return sx - trimX + frameX;
}

/** 原始画布 y → 图集 y */
export function sourceYToAtlas(sy: number, trimY: number, frameY: number): number {
  return sy - trimY + frameY;
}

/** 图集 x → 原始画布 x（导入恢复时的逆变换） */
export function atlasXToSource(ax: number, trimX: number, frameX: number): number {
  return ax + trimX - frameX;
}

/** 图集 y → 原始画布 y */
export function atlasYToSource(ay: number, trimY: number, frameY: number): number {
  return ay + trimY - frameY;
}

/**
 * 由规范元数据 + 当次打包信息换算图集坐标（纯函数）。
 * anchor 的原始像素位置 = anchor * sourceSize。
 */
export function deriveAtlasMeta(
  meta: FrameMeta,
  frame: { x: number; y: number },
  trim: TrimRect,
  srcW: number,
  srcH: number
): AtlasFrameMeta {
  const ax = (sx: number): number => sourceXToAtlas(sx, trim.x, frame.x);
  const ay = (sy: number): number => sourceYToAtlas(sy, trim.y, frame.y);
  return {
    pivot: { x: ax(meta.pivot.x), y: ay(meta.pivot.y) },
    anchor: { x: ax(meta.anchor.x * srcW), y: ay(meta.anchor.y * srcH) },
    nineSlice: meta.nineSlice
      ? {
          left: ax(meta.nineSlice.left),
          right: ax(meta.nineSlice.right),
          top: ay(meta.nineSlice.top),
          bottom: ay(meta.nineSlice.bottom)
        }
      : null
  };
}
