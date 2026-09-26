/** 帧条目：导入的一张 PNG 及其播放参数 */
export interface FrameItem {
  id: string;
  name: string;
  /** 帧时长（毫秒） */
  duration: number;
  /** 原始宽度 */
  width: number;
  /** 原始高度 */
  height: number;
  /** 原始 PNG 数据（不离开浏览器） */
  blob: Blob;
  /** 预览用 object URL */
  url: string;
  /** 每帧 pivot / anchor / 九宫格元数据（始终以原始未裁切画布为坐标系） */
  meta: FrameMeta;
}

/** 点（x/y 像素，允许小数） */
export interface Point {
  x: number;
  y: number;
}

/**
 * 九宫格四条边界线（像素坐标）：
 * 两条竖线 x = left / x = right，两条横线 y = top / y = bottom，
 * 把图像分成 3×3。坐标系由使用处说明（原始画布 or 图集）。
 */
export interface NineSlice {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 透明边缘裁切结果（相对原始图的偏移与内容尺寸） */
export interface TrimRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 每帧元数据（规范值）。所有字段都以**原始未裁切画布**为坐标系：
 * - pivot：像素点，范围 [0, srcW] × [0, srcH]（含小数）。
 *   即使该点落在被裁掉的透明区也完全有效。
 * - anchor：相对原始尺寸的归一化比例，范围 [0, 1]（含小数）。
 * - nineSlice：九宫格四条边界线的原始像素坐标（整数）；
 *   null 表示该帧不拉伸、不输出九宫格。
 *
 * 重新裁切、修改统一留白、重新打包都不得改变这些值。
 */
export interface FrameMeta {
  pivot: Point;
  anchor: Point;
  nineSlice: NineSlice | null;
}

/**
 * 由规范元数据换算出的图集坐标（派生值，不单独持久化）。
 * 依赖当次打包的裁切偏移与统一留白，重新打包后允许变化。
 * 坐标可为负或落在图集内容区之外——例如 pivot 位于被裁掉的
 * 透明区时，它会落到该帧四周的留白中。
 */
export interface AtlasFrameMeta {
  /** pivot 在图集中的像素坐标 */
  pivot: Point;
  /** anchor 在图集中的像素坐标（原始画布归一化比例换算） */
  anchor: Point;
  /** 九宫格四条边界线在图集中的 x/y 像素坐标；null 表示未启用 */
  nineSlice: NineSlice | null;
}

/** 打包后单帧在图集中的信息 */
export interface PackedFrame {
  id: string;
  name: string;
  /** 图集中内容区左上角 x（不含留白） */
  x: number;
  /** 图集中内容区左上角 y（不含留白） */
  y: number;
  /** 图集中内容区宽度（裁切后） */
  w: number;
  /** 图集中内容区高度（裁切后） */
  h: number;
  /** 裁切偏移与内容尺寸（spriteSourceSize） */
  trim: TrimRect;
  /** 原始尺寸（sourceSize） */
  srcW: number;
  srcH: number;
  duration: number;
  /** 规范元数据（原始画布坐标系） */
  meta: FrameMeta;
  /** 由规范元数据换算出的图集坐标（含留白偏移） */
  atlasMeta: AtlasFrameMeta;
}

/** 一次打包的结果 */
export interface PackResult {
  atlasWidth: number;
  atlasHeight: number;
  /** 按原始帧顺序排列 */
  frames: PackedFrame[];
  atlasBlob: Blob;
  atlasUrl: string;
  padding: number;
  trimmed: boolean;
}

/** 打包/导出设置 */
export interface Settings {
  /** 裁切透明边缘 */
  trim: boolean;
  /** 统一留白（每帧四周的透明像素） */
  padding: number;
  /** 图集最大边长 */
  maxSize: number;
  /** 图集尺寸取 2 的幂 */
  pot: boolean;
  /** 导出 JSON 时内嵌图集 dataURL（可独立恢复） */
  embedAtlas: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  trim: true,
  padding: 2,
  maxSize: 2048,
  pot: true,
  embedAtlas: true
};

/** 类 ImageData 的最小结构，便于在 Node 中测试 */
export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
