/** 二维点（像素坐标） */
export interface Point {
  x: number;
  y: number;
}

/**
 * 九宫格边界：四条分割线的位置。
 * 一律使用原始未裁切图像坐标系（原图左上角为原点，单位像素）：
 * left/right 为垂直分割线的 x 坐标，top/bottom 为水平分割线的 y 坐标。
 * 合法条件：0 ≤ left < right ≤ 原图宽，0 ≤ top < bottom ≤ 原图高。
 */
export interface NineSlice {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 每帧的变换元数据。规范形式一律基于原始未裁切图像坐标系，
 * 与裁切、留白、打包布局无关——重新裁切/改留白/重新打包都不会改变它。
 */
export interface FrameMeta {
  /** 旋转/缩放中心（原图坐标系，像素；可位于被裁掉的透明区） */
  pivot: Point;
  /** 定位锚点（原图坐标系，像素；可位于被裁掉的透明区） */
  anchor: Point;
  /** 九宫格边界（原图坐标系）；null 表示该帧不可拉伸 */
  nineSlice: NineSlice | null;
}

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
  /** pivot / anchor / 九宫格（原始图像坐标系） */
  meta: FrameMeta;
}

/** 透明边缘裁切结果（相对原始图的偏移与内容尺寸） */
export interface TrimRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** 元数据规范形式（原始图像坐标系），与打包参数无关 */
  meta: FrameMeta;
  /** pivot 换算到图集坐标系（裁切 + 留白后；在透明区时可能落到内容框外） */
  atlasPivot: Point;
  /** anchor 换算到图集坐标系 */
  atlasAnchor: Point;
  /** 九宫格边界换算到图集坐标系 */
  atlasNineSlice: NineSlice | null;
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
