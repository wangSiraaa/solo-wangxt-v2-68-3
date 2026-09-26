import type { PackLayout } from "./pack";
import type { FrameMeta, NineSlice, Point, Settings } from "./types";
import { defaultFrameMeta, validateNineSlice, validatePoint } from "./meta";

/**
 * 图集 JSON 格式：兼容 TexturePacker "Hash" 结构，
 * 并扩展 duration / frameOrder / settings / atlasDataURL，
 * 使重新导入后能完整恢复帧列表、顺序、时长与打包结果。
 *
 * pivot / anchor / nineSlice 的坐标系（重要）：
 * 一律基于该帧「原始未裁切图像」的左上角原点，单位像素（见 meta.coordinateSpace），
 * 原图尺寸见每帧 sourceSize。它们不随裁切、留白或打包布局变化；
 * 需要图集坐标时由读取方按 frame / spriteSourceSize 换算：
 *   atlasX = frame.x + (sourceX - spriteSourceSize.x)
 *   atlasY = frame.y + (sourceY - spriteSourceSize.y)
 */

export const JSON_APP_ID = "sprite-atlas-studio";
export const JSON_VERSION = "1.1.0";

/** meta.coordinateSpace 的取值：pivot/anchor/nineSlice 均基于原始未裁切图像坐标系 */
export const COORDINATE_SPACE = "source-image";

export interface AtlasJSONFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  /** 帧时长（毫秒） */
  duration: number;
  /** 旋转/缩放中心，原始图像坐标系（像素），可位于被裁掉的透明区 */
  pivot: Point;
  /** 定位锚点，原始图像坐标系（像素） */
  anchor: Point;
  /** 九宫格边界（原始图像坐标系）；null 或缺失表示不可拉伸 */
  nineSlice?: NineSlice | null;
}

export interface AtlasJSON {
  frames: Record<string, AtlasJSONFrame>;
  meta: {
    app: string;
    version: string;
    image: string;
    format: string;
    size: { w: number; h: number };
    scale: string;
    /** 原始帧顺序（frames 对象的键按此排列） */
    frameOrder: string[];
    /** pivot/anchor/nineSlice 的坐标系：原始未裁切图像左上角原点、像素单位 */
    coordinateSpace: typeof COORDINATE_SPACE;
    settings: {
      trim: boolean;
      padding: number;
      maxSize: number;
      pot: boolean;
    };
    /** 一轮动画总时长（毫秒） */
    totalDuration: number;
    /** 内嵌图集（data:image/png;base64,...），存在时可独立恢复 */
    atlasDataURL?: string;
  };
}

export interface BuildJsonOptions {
  imageName: string;
  trimmed: boolean;
  settings: Settings;
  atlasDataURL?: string;
}

/** 由打包结果生成 JSON 对象（纯函数） */
export function buildAtlasJSON(layout: PackLayout, opts: BuildJsonOptions): AtlasJSON {
  const frames: Record<string, AtlasJSONFrame> = {};
  const frameOrder: string[] = [];
  let total = 0;

  for (const f of layout.frames) {
    frames[f.name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: opts.trimmed,
      spriteSourceSize: { x: f.trim.x, y: f.trim.y, w: f.trim.w, h: f.trim.h },
      sourceSize: { w: f.srcW, h: f.srcH },
      duration: f.duration,
      // 规范形式：原始图像坐标系，与裁切/留白/布局无关
      pivot: { x: f.meta.pivot.x, y: f.meta.pivot.y },
      anchor: { x: f.meta.anchor.x, y: f.meta.anchor.y },
      nineSlice: f.meta.nineSlice ? { ...f.meta.nineSlice } : null
    };
    frameOrder.push(f.name);
    total += Math.max(1, f.duration);
  }

  const meta: AtlasJSON["meta"] = {
    app: JSON_APP_ID,
    version: JSON_VERSION,
    image: opts.imageName,
    format: "RGBA8888",
    size: { w: layout.atlasWidth, h: layout.atlasHeight },
    scale: "1",
    frameOrder,
    coordinateSpace: COORDINATE_SPACE,
    settings: {
      trim: opts.settings.trim,
      padding: opts.settings.padding,
      maxSize: opts.settings.maxSize,
      pot: opts.settings.pot
    },
    totalDuration: total
  };
  if (opts.atlasDataURL) meta.atlasDataURL = opts.atlasDataURL;

  return { frames, meta };
}

export interface ParsedFrameEntry {
  name: string;
  duration: number;
  frame: { x: number; y: number; w: number; h: number };
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  trimmed: boolean;
  /** 原始图像坐标系的元数据（缺失字段以默认值补齐） */
  meta: FrameMeta;
}

export interface ParsedAtlasJSON {
  /** 按 frameOrder 排列的帧 */
  frames: ParsedFrameEntry[];
  size: { w: number; h: number };
  settings: Settings;
  imageName: string;
  atlasDataURL?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`JSON 格式错误：字段 ${field} 应为数字`);
  }
  return v;
}

function rect(v: unknown, field: string, keys: readonly string[]): Record<string, number> {
  if (!isRecord(v)) throw new Error(`JSON 格式错误：字段 ${field} 应为对象`);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = num(v[k], `${field}.${k}`);
  return out;
}

/** 解析可选的 pivot/anchor 点；缺失时返回 null（由调用方补默认值） */
function optionalPoint(v: unknown, field: string): Point | null {
  if (v === undefined || v === null) return null;
  const r = rect(v, field, ["x", "y"]);
  return { x: r.x!, y: r.y! };
}

/** 解析可选的九宫格；null/缺失表示不可拉伸 */
function optionalNineSlice(v: unknown, field: string): NineSlice | null {
  if (v === undefined || v === null) return null;
  const r = rect(v, field, ["left", "right", "top", "bottom"]);
  return { left: r.left!, right: r.right!, top: r.top!, bottom: r.bottom! };
}

/** 解析并校验图集 JSON（纯函数），不合法时抛出中文错误 */
export function parseAtlasJSON(raw: unknown): ParsedAtlasJSON {
  if (!isRecord(raw)) throw new Error("JSON 格式错误：顶层应为对象");
  if (!isRecord(raw.meta)) throw new Error("JSON 格式错误：缺少 meta");
  if (!isRecord(raw.frames)) throw new Error("JSON 格式错误：缺少 frames");

  const meta = raw.meta;
  if (meta.app !== JSON_APP_ID) {
    throw new Error(`无法识别的 JSON：meta.app 应为 "${JSON_APP_ID}"`);
  }
  // 坐标系声明：缺失视为旧版（无元数据，全部默认）；存在则必须是原始图像坐标系
  if (meta.coordinateSpace !== undefined && meta.coordinateSpace !== COORDINATE_SPACE) {
    throw new Error(
      `无法识别的坐标系：meta.coordinateSpace 应为 "${COORDINATE_SPACE}"，实际为 ${JSON.stringify(meta.coordinateSpace)}`
    );
  }
  if (!isRecord(meta.size)) throw new Error("JSON 格式错误：缺少 meta.size");
  const size = { w: num(meta.size.w, "meta.size.w"), h: num(meta.size.h, "meta.size.h") };

  const settingsRaw = isRecord(meta.settings) ? meta.settings : {};
  const settings: Settings = {
    trim: settingsRaw.trim !== false,
    padding: typeof settingsRaw.padding === "number" ? settingsRaw.padding : 0,
    maxSize: typeof settingsRaw.maxSize === "number" ? settingsRaw.maxSize : size.w,
    pot: settingsRaw.pot !== false,
    embedAtlas: true
  };

  const order: string[] = Array.isArray(meta.frameOrder)
    ? meta.frameOrder.filter((n): n is string => typeof n === "string")
    : Object.keys(raw.frames);

  const frames: ParsedFrameEntry[] = [];
  for (const name of order) {
    const f = raw.frames[name];
    if (!isRecord(f)) throw new Error(`JSON 格式错误：帧 "${name}" 缺少数据`);
    const fr = rect(f.frame, `frames.${name}.frame`, ["x", "y", "w", "h"]);
    const ss = rect(f.spriteSourceSize, `frames.${name}.spriteSourceSize`, ["x", "y", "w", "h"]);
    const src = rect(f.sourceSize, `frames.${name}.sourceSize`, ["w", "h"]);
    const frame = { x: fr.x!, y: fr.y!, w: fr.w!, h: fr.h! };
    const spriteSourceSize = { x: ss.x!, y: ss.y!, w: ss.w!, h: ss.h! };
    const sourceSize = { w: src.w!, h: src.h! };

    if (frame.w < 0 || frame.h < 0) throw new Error(`JSON 格式错误：帧 "${name}" 尺寸非法`);
    if (frame.x + frame.w > size.w || frame.y + frame.h > size.h) {
      throw new Error(`JSON 格式错误：帧 "${name}" 超出图集范围`);
    }
    if (spriteSourceSize.x + spriteSourceSize.w > sourceSize.w ||
        spriteSourceSize.y + spriteSourceSize.h > sourceSize.h) {
      throw new Error(`JSON 格式错误：帧 "${name}" 的裁切区域超出原始尺寸`);
    }

    // 元数据：缺失时补默认值；存在时必须在原图范围内且九宫格不交叉
    const defaults = defaultFrameMeta(sourceSize.w, sourceSize.h);
    const pivot = optionalPoint(f.pivot, `frames.${name}.pivot`) ?? defaults.pivot;
    const anchor = optionalPoint(f.anchor, `frames.${name}.anchor`) ?? defaults.anchor;
    const nineSlice = optionalNineSlice(f.nineSlice, `frames.${name}.nineSlice`);
    const pivotErr = validatePoint(pivot, sourceSize.w, sourceSize.h);
    if (pivotErr) throw new Error(`JSON 格式错误：帧 "${name}" 的 pivot 非法（${pivotErr}）`);
    const anchorErr = validatePoint(anchor, sourceSize.w, sourceSize.h);
    if (anchorErr) throw new Error(`JSON 格式错误：帧 "${name}" 的 anchor 非法（${anchorErr}）`);
    if (nineSlice) {
      const nsErr = validateNineSlice(nineSlice, sourceSize.w, sourceSize.h);
      if (nsErr) throw new Error(`JSON 格式错误：帧 "${name}" 的九宫格非法（${nsErr}）`);
    }

    frames.push({
      name,
      duration: typeof f.duration === "number" && f.duration > 0 ? f.duration : 100,
      frame,
      spriteSourceSize,
      sourceSize,
      trimmed: f.trimmed === true,
      meta: { pivot, anchor, nineSlice }
    });
  }

  if (frames.length === 0) throw new Error("JSON 中没有任何帧");

  const imageName = typeof meta.image === "string" ? meta.image : "atlas.png";
  const atlasDataURL = typeof meta.atlasDataURL === "string" ? meta.atlasDataURL : undefined;

  return { frames, size, settings, imageName, ...(atlasDataURL ? { atlasDataURL } : {}) };
}
