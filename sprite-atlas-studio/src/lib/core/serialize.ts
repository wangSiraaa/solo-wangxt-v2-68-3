import type { FrameMeta, NineSlice, Point } from "./types";
import type { PackLayout } from "./pack";
import type { Settings } from "./types";

/**
 * 图集 JSON 格式：兼容 TexturePacker "Hash" 结构，
 * 并扩展 duration / frameOrder / settings / atlasDataURL / pivot / anchor / nineSlice，
 * 使重新导入后能完整恢复帧列表、顺序、时长、打包结果与每帧元数据。
 */

export const JSON_APP_ID = "sprite-atlas-studio";
export const JSON_VERSION = "1.1.0";

/** 二维点的 JSON 结构 */
export interface JSONPoint {
  x: number;
  y: number;
}

export interface AtlasJSONFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  /** 帧时长（毫秒） */
  duration: number;
  /**
   * 枢轴点。坐标系：**原始未裁切画布像素**，原点左上角，
   * 范围 [0, sourceSize.w] × [0, sourceSize.h]；可落在被裁掉的透明区。
   * 缺省时由旧版本 JSON 按原始画布中心恢复。
   */
  pivot?: JSONPoint;
  /**
   * 锚点。坐标系：**相对原始未裁切画布的归一化比例**，范围 0–1。
   * 缺省时按 (0.5, 0.5) 恢复。
   */
  anchor?: JSONPoint;
  /**
   * 九宫格四条边界线（像素）。坐标系：**原始未裁切画布**，
   * 0 ≤ left ≤ right ≤ sourceSize.w，0 ≤ top ≤ bottom ≤ sourceSize.h，
   * 均为整数。缺省表示该帧不使用九宫格。
   */
  nineSlice?: NineSlice;
  /**
   * 上述元数据在**当前图集像素坐标系**中的换算结果（只读派生值），
   * 原点为图集左上角，可能为负（点落在该帧留白中时）。
   * 重新导入时不以此为准——会依据 frame/spriteSourceSize 重新换算。
   */
  atlasMeta?: {
    pivot: JSONPoint;
    anchor: JSONPoint;
    nineSlice: NineSlice | null;
  };
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
      pivot: { x: f.meta.pivot.x, y: f.meta.pivot.y },
      anchor: { x: f.meta.anchor.x, y: f.meta.anchor.y },
      ...(f.meta.nineSlice ? { nineSlice: { ...f.meta.nineSlice } } : {}),
      atlasMeta: {
        pivot: { x: f.atlasMeta.pivot.x, y: f.atlasMeta.pivot.y },
        anchor: { x: f.atlasMeta.anchor.x, y: f.atlasMeta.anchor.y },
        nineSlice: f.atlasMeta.nineSlice ? { ...f.atlasMeta.nineSlice } : null
      }
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
  /** pivot / anchor / 九宫格（原始画布坐标系，已校验） */
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

/** 解析并校验图集 JSON（纯函数），不合法时抛出中文错误 */
export function parseAtlasJSON(raw: unknown): ParsedAtlasJSON {
  if (!isRecord(raw)) throw new Error("JSON 格式错误：顶层应为对象");
  if (!isRecord(raw.meta)) throw new Error("JSON 格式错误：缺少 meta");
  if (!isRecord(raw.frames)) throw new Error("JSON 格式错误：缺少 frames");

  const meta = raw.meta;
  if (meta.app !== JSON_APP_ID) {
    throw new Error(`无法识别的 JSON：meta.app 应为 "${JSON_APP_ID}"`);
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

    // pivot / anchor：旧版本 JSON 缺省时按中心恢复
    let pivot: Point;
    if (isRecord(f.pivot)) {
      pivot = { x: num(f.pivot.x, `frames.${name}.pivot.x`), y: num(f.pivot.y, `frames.${name}.pivot.y`) };
      if (pivot.x < 0 || pivot.y < 0 || pivot.x > sourceSize.w || pivot.y > sourceSize.h) {
        throw new Error(`JSON 格式错误：帧 "${name}" 的 pivot 超出原始尺寸 ${sourceSize.w}×${sourceSize.h}`);
      }
    } else {
      pivot = { x: sourceSize.w / 2, y: sourceSize.h / 2 };
    }

    let anchor: Point;
    if (isRecord(f.anchor)) {
      anchor = {
        x: num(f.anchor.x, `frames.${name}.anchor.x`),
        y: num(f.anchor.y, `frames.${name}.anchor.y`)
      };
      if (anchor.x < 0 || anchor.y < 0 || anchor.x > 1 || anchor.y > 1) {
        throw new Error(`JSON 格式错误：帧 "${name}" 的 anchor 必须在 0–1 之间`);
      }
    } else {
      anchor = { x: 0.5, y: 0.5 };
    }

    let nineSlice: NineSlice | null = null;
    if (f.nineSlice !== undefined && f.nineSlice !== null) {
      const ns = rect(
        f.nineSlice,
        `frames.${name}.nineSlice`,
        ["left", "right", "top", "bottom"]
      );
      nineSlice = {
        left: ns.left!,
        right: ns.right!,
        top: ns.top!,
        bottom: ns.bottom!
      };
      if (
        !Number.isInteger(nineSlice.left) ||
        !Number.isInteger(nineSlice.right) ||
        !Number.isInteger(nineSlice.top) ||
        !Number.isInteger(nineSlice.bottom)
      ) {
        throw new Error(`JSON 格式错误：帧 "${name}" 的九宫格边界必须是整数像素`);
      }
      if (
        nineSlice.left < 0 || nineSlice.right < 0 ||
        nineSlice.top < 0 || nineSlice.bottom < 0 ||
        nineSlice.left > sourceSize.w || nineSlice.right > sourceSize.w ||
        nineSlice.top > sourceSize.h || nineSlice.bottom > sourceSize.h
      ) {
        throw new Error(`JSON 格式错误：帧 "${name}" 的九宫格边界超出原始尺寸`);
      }
      if (nineSlice.right < nineSlice.left || nineSlice.bottom < nineSlice.top) {
        throw new Error(`JSON 格式错误：帧 "${name}" 的九宫格边界相互交叉`);
      }
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
