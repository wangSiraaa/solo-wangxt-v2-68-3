import type { FrameMeta, NineSlice, Point, TrimRect } from "./types";

/**
 * 帧元数据（pivot / anchor / 九宫格）的默认值、校验与坐标系换算。
 *
 * 坐标系约定：
 * - 规范形式（存储、编辑、导出）一律使用「原始未裁切图像坐标系」：
 *   原图左上角为原点，单位像素，x 向右、y 向下。
 * - 图集坐标系：打包后帧内容（裁切后）左上角位于图集 (contentX, contentY)，
 *   该位置已包含统一留白。原图点 p 的图集坐标为
 *   (contentX + p.x - trim.x, contentY + p.y - trim.y)。
 *   点若落在被裁掉的透明区，换算结果可能为负或超出内容框——仍然合法可表达。
 *
 * 全部为纯函数，可在浏览器与 Node 中运行。
 */

/** 默认元数据：pivot / anchor 位于原图中心，不可拉伸 */
export function defaultFrameMeta(srcW: number, srcH: number): FrameMeta {
  return {
    pivot: { x: srcW / 2, y: srcH / 2 },
    anchor: { x: srcW / 2, y: srcH / 2 },
    nineSlice: null
  };
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 校验 pivot / anchor 点（原始图像坐标系）。
 * 允许位于原图范围内任意位置（包括会被裁掉的透明区）；
 * 边界上（0 或宽/高）合法。
 *
 * @returns 错误消息；合法时返回 null
 */
export function validatePoint(p: Point, srcW: number, srcH: number): string | null {
  if (!isFiniteNum(p.x) || !isFiniteNum(p.y)) return "pivot/anchor 坐标必须是有限数字";
  if (p.x < 0 || p.x > srcW || p.y < 0 || p.y > srcH) {
    return `坐标 (${p.x}, ${p.y}) 超出原图范围 0..${srcW} × 0..${srcH}`;
  }
  return null;
}

/**
 * 校验九宫格边界（原始图像坐标系）。
 * 边界不得落到原图之外，且不得相互交叉（left < right、top < bottom）。
 *
 * @returns 错误消息；合法时返回 null
 */
export function validateNineSlice(ns: NineSlice, srcW: number, srcH: number): string | null {
  const { left, right, top, bottom } = ns;
  if (![left, right, top, bottom].every(isFiniteNum)) {
    return "九宫格边界必须是有限数字";
  }
  if (left < 0 || top < 0 || right > srcW || bottom > srcH) {
    return `九宫格边界超出原图范围（宽 0..${srcW}，高 0..${srcH}）`;
  }
  if (left >= right) {
    return `九宫格左右边界交叉：left (${left}) 必须小于 right (${right})`;
  }
  if (top >= bottom) {
    return `九宫格上下边界交叉：top (${top}) 必须小于 bottom (${bottom})`;
  }
  return null;
}

/** 原图坐标系点 → 图集坐标系（contentX/contentY 为内容左上角在图集中的位置，已含留白） */
export function sourcePointToAtlas(
  p: Point,
  trim: TrimRect,
  contentX: number,
  contentY: number
): Point {
  return { x: contentX + (p.x - trim.x), y: contentY + (p.y - trim.y) };
}

/** 九宫格边界 → 图集坐标系（逐线换算，保持 left/right/top/bottom 语义） */
export function sourceNineSliceToAtlas(
  ns: NineSlice,
  trim: TrimRect,
  contentX: number,
  contentY: number
): NineSlice {
  return {
    left: contentX + (ns.left - trim.x),
    right: contentX + (ns.right - trim.x),
    top: contentY + (ns.top - trim.y),
    bottom: contentY + (ns.bottom - trim.y)
  };
}

/** 整份帧元数据 → 图集坐标系 */
export function frameMetaToAtlas(
  meta: FrameMeta,
  trim: TrimRect,
  contentX: number,
  contentY: number
): { pivot: Point; anchor: Point; nineSlice: NineSlice | null } {
  return {
    pivot: sourcePointToAtlas(meta.pivot, trim, contentX, contentY),
    anchor: sourcePointToAtlas(meta.anchor, trim, contentX, contentY),
    nineSlice: meta.nineSlice
      ? sourceNineSliceToAtlas(meta.nineSlice, trim, contentX, contentY)
      : null
  };
}
