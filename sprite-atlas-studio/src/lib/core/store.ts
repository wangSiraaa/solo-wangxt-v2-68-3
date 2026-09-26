import { derived, get, writable } from "svelte/store";
import type {
  FrameItem,
  FrameMeta,
  NineSlice,
  PackResult,
  PackedFrame,
  Point,
  Settings,
  TrimRect
} from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { computeAlphaBBox } from "./trim";
import { packFrames, type PackInput, type PackLayout } from "./pack";
import {
  defaultFrameMeta,
  frameMetaToAtlas,
  validateNineSlice,
  validatePoint
} from "./meta";
import { buildAtlasJSON, parseAtlasJSON, type AtlasJSON, type ParsedFrameEntry } from "./serialize";
import {
  blobToImage,
  canvasToBlob,
  canvasToDataURL,
  ctx2d,
  dataURLToBlob,
  downloadBlob,
  imageToPixels,
  makeCanvas,
  uid
} from "./image";
import { clearProject, loadProject, saveProject, toStored } from "./db";

export const frames = writable<FrameItem[]>([]);
export const settings = writable<Settings>({ ...DEFAULT_SETTINGS });
export const packResult = writable<PackResult | null>(null);
export const selectedId = writable<string | null>(null);
/** 元数据编辑器当前编辑的帧（只随显式点击变化，不随动画播放跳动） */
export const editId = writable<string | null>(null);
export const busy = writable(false);
export const status = writable<{ kind: "info" | "error"; text: string } | null>(null);

export const frameCount = derived(frames, ($f) => $f.length);

let statusTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, kind: "info" | "error" = "info"): void {
  status.set({ kind, text });
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.set(null), 5000);
}

/** 当前打包结果对应的 JSON（不含内嵌图集，供存储/导出复用） */
let lastJSON: AtlasJSON | null = null;
export function getLastJSON(): AtlasJSON | null {
  return lastJSON;
}

// ---------- 帧导入 ----------

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let i = 2;
  while (taken.has(`${stem}_${i}${ext}`)) i++;
  return `${stem}_${i}${ext}`;
}

export async function addFiles(files: Iterable<File>): Promise<void> {
  const list = [...files].filter((f) => /png$/i.test(f.type) || /\.png$/i.test(f.name));
  if (list.length === 0) {
    notify("请选择 PNG 图片", "error");
    return;
  }
  busy.set(true);
  try {
    const current = get(frames);
    const taken = new Set(current.map((f) => f.name));
    const added: FrameItem[] = [];
    for (const file of list) {
      try {
        const img = await blobToImage(file);
        const name = uniqueName(file.name, taken);
        taken.add(name);
        added.push({
          id: uid(),
          name,
          duration: 100,
          width: img.naturalWidth,
          height: img.naturalHeight,
          blob: file,
          url: URL.createObjectURL(file),
          meta: defaultFrameMeta(img.naturalWidth, img.naturalHeight)
        });
      } catch {
        notify(`无法解码图片：${file.name}`, "error");
      }
    }
    if (added.length > 0) {
      frames.set([...current, ...added]);
      packResult.set(null); // 帧变化后旧的打包结果失效
      notify(`已导入 ${added.length} 帧`);
    }
  } finally {
    busy.set(false);
  }
}

export function removeFrame(id: string): void {
  const list = get(frames);
  const f = list.find((x) => x.id === id);
  if (!f) return;
  URL.revokeObjectURL(f.url);
  frames.set(list.filter((x) => x.id !== id));
  packResult.set(null);
}

export function moveFrame(id: string, dir: -1 | 1): void {
  const list = [...get(frames)];
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i]!;
  list[i] = list[j]!;
  list[j] = a;
  frames.set(list);
  packResult.set(null);
}

export function setDuration(id: string, ms: number): void {
  if (!Number.isFinite(ms)) return;
  const v = Math.max(1, Math.round(ms));
  frames.set(get(frames).map((f) => (f.id === id ? { ...f, duration: v } : f)));
}

export function setAllDurations(ms: number): void {
  const v = Math.max(1, Math.round(ms));
  frames.set(get(frames).map((f) => ({ ...f, duration: v })));
}

// ---------- 帧元数据（pivot / anchor / 九宫格） ----------

/**
 * 用当前打包结果重建 lastJSON（元数据变化后保持导出数据同步）。
 * settings 沿用上次 JSON 中记录的打包时设置，保证 JSON 与实际图集自洽。
 */
function rebuildLastJSON(pack: PackResult): void {
  const prev = lastJSON;
  const packedSettings = prev?.meta.settings;
  const current = get(settings);
  lastJSON = buildAtlasJSON(
    { atlasWidth: pack.atlasWidth, atlasHeight: pack.atlasHeight, frames: pack.frames },
    {
      imageName: prev?.meta.image ?? "atlas.png",
      trimmed: pack.trimmed,
      settings: packedSettings
        ? {
            ...current,
            trim: packedSettings.trim,
            padding: packedSettings.padding,
            maxSize: packedSettings.maxSize,
            pot: packedSettings.pot
          }
        : current
    }
  );
}

/**
 * 应用新的元数据。元数据不影响打包布局（矩形尺寸不变），
 * 因此同步刷新已有打包结果中的图集坐标即可，无需重新打包；
 * 原始图像坐标系中的值保持不变——重新裁切/改留白/重新打包都不会改变它。
 */
function applyFrameMeta(id: string, meta: FrameMeta): void {
  frames.set(get(frames).map((f) => (f.id === id ? { ...f, meta } : f)));
  const pack = get(packResult);
  if (pack) {
    const nextFrames = pack.frames.map((pf) => {
      if (pf.id !== id) return pf;
      const atlasMeta = frameMetaToAtlas(meta, pf.trim, pf.x, pf.y);
      return {
        ...pf,
        meta,
        atlasPivot: atlasMeta.pivot,
        atlasAnchor: atlasMeta.anchor,
        atlasNineSlice: atlasMeta.nineSlice
      };
    });
    const next = { ...pack, frames: nextFrames };
    packResult.set(next);
    rebuildLastJSON(next);
  }
}

/**
 * 设置 pivot（原始图像坐标系，像素）。允许位于被裁掉的透明区。
 * 非法值（非有限数、超出原图范围）被拒绝并保留上次有效值。
 * @returns 是否接受
 */
export function setFramePivot(id: string, p: Point): boolean {
  const f = get(frames).find((x) => x.id === id);
  if (!f) return false;
  const err = validatePoint(p, f.width, f.height);
  if (err) {
    notify(`pivot 非法：${err}`, "error");
    return false;
  }
  applyFrameMeta(id, { ...f.meta, pivot: { x: p.x, y: p.y } });
  return true;
}

/** 设置 anchor（原始图像坐标系，像素）。非法值被拒绝并保留上次有效值。 */
export function setFrameAnchor(id: string, p: Point): boolean {
  const f = get(frames).find((x) => x.id === id);
  if (!f) return false;
  const err = validatePoint(p, f.width, f.height);
  if (err) {
    notify(`anchor 非法：${err}`, "error");
    return false;
  }
  applyFrameMeta(id, { ...f.meta, anchor: { x: p.x, y: p.y } });
  return true;
}

/**
 * 设置九宫格边界（原始图像坐标系，像素）；传 null 表示不可拉伸。
 * 边界不得落到原图之外或相互交叉；非法值被拒绝并保留上次有效值。
 * @returns 是否接受
 */
export function setFrameNineSlice(id: string, ns: NineSlice | null): boolean {
  const f = get(frames).find((x) => x.id === id);
  if (!f) return false;
  if (ns !== null) {
    const err = validateNineSlice(ns, f.width, f.height);
    if (err) {
      notify(`九宫格非法：${err}`, "error");
      return false;
    }
  }
  applyFrameMeta(id, { ...f.meta, nineSlice: ns ? { ...ns } : null });
  return true;
}

export function clearAll(): void {
  for (const f of get(frames)) URL.revokeObjectURL(f.url);
  const pack = get(packResult);
  if (pack) URL.revokeObjectURL(pack.atlasUrl);
  frames.set([]);
  packResult.set(null);
  selectedId.set(null);
  editId.set(null);
  lastJSON = null;
}

// ---------- 打包 ----------

interface TrimmedFrame {
  item: FrameItem;
  canvas: HTMLCanvasElement;
  trim: TrimRect;
}

/** 裁切（或保留）单帧，返回内容画布与裁切信息 */
async function trimFrame(item: FrameItem, doTrim: boolean): Promise<TrimmedFrame> {
  const img = await blobToImage(item.blob);
  if (!doTrim) {
    const canvas = makeCanvas(item.width, item.height);
    ctx2d(canvas).drawImage(img, 0, 0);
    return { item, canvas, trim: { x: 0, y: 0, w: item.width, h: item.height } };
  }
  const pixels = imageToPixels(img, item.width, item.height);
  const bbox = computeAlphaBBox(pixels);
  if (!bbox) {
    // 完全透明：保留 1×1，避免 0 尺寸
    const canvas = makeCanvas(1, 1);
    return { item, canvas, trim: { x: 0, y: 0, w: 1, h: 1 } };
  }
  const canvas = makeCanvas(bbox.w, bbox.h);
  ctx2d(canvas).drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  return { item, canvas, trim: bbox };
}

/** 执行打包并生成图集 */
export async function pack(): Promise<void> {
  const list = get(frames);
  if (list.length === 0) {
    notify("请先导入 PNG 帧", "error");
    return;
  }
  const s = get(settings);
  busy.set(true);
  try {
    const trimmed: TrimmedFrame[] = [];
    for (const item of list) trimmed.push(await trimFrame(item, s.trim));

    const inputs: PackInput[] = trimmed.map((t) => ({
      id: t.item.id,
      name: t.item.name,
      w: t.canvas.width,
      h: t.canvas.height,
      trim: t.trim,
      srcW: t.item.width,
      srcH: t.item.height,
      duration: t.item.duration,
      meta: t.item.meta
    }));

    const layout: PackLayout = packFrames(inputs, s.padding, s.maxSize, s.pot);

    // 合成图集画布
    const atlas = makeCanvas(layout.atlasWidth, layout.atlasHeight);
    const ctx = ctx2d(atlas);
    const canvasById = new Map(trimmed.map((t) => [t.item.id, t.canvas]));
    for (const f of layout.frames) {
      const c = canvasById.get(f.id);
      if (c) ctx.drawImage(c, f.x, f.y);
    }

    const old = get(packResult);
    if (old) URL.revokeObjectURL(old.atlasUrl);
    const atlasBlob = await canvasToBlob(atlas);
    const result: PackResult = {
      atlasWidth: layout.atlasWidth,
      atlasHeight: layout.atlasHeight,
      frames: layout.frames,
      atlasBlob,
      atlasUrl: URL.createObjectURL(atlasBlob),
      padding: s.padding,
      trimmed: s.trim
    };
    packResult.set(result);
    lastJSON = buildAtlasJSON(layout, {
      imageName: "atlas.png",
      trimmed: s.trim,
      settings: s
    });
    notify(`打包完成：${layout.atlasWidth}×${layout.atlasHeight}，共 ${layout.frames.length} 帧`);
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), "error");
  } finally {
    busy.set(false);
  }
}

// ---------- 导出 ----------

export function exportPNG(): void {
  const p = get(packResult);
  if (!p) {
    notify("请先打包", "error");
    return;
  }
  downloadBlob(p.atlasBlob, "atlas.png");
}

export async function exportJSON(): Promise<void> {
  const p = get(packResult);
  if (!p || !lastJSON) {
    notify("请先打包", "error");
    return;
  }
  const s = get(settings);
  let json = lastJSON;
  if (s.embedAtlas) {
    const dataURL = canvasToDataURL(await blobToCanvas(p.atlasBlob));
    json = { ...lastJSON, meta: { ...lastJSON.meta, atlasDataURL: dataURL } };
  }
  downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }), "atlas.json");
  notify("已导出 atlas.png 与 atlas.json");
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await blobToImage(blob);
  const c = makeCanvas(img.naturalWidth, img.naturalHeight);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}

// ---------- 导入 JSON 恢复 ----------

/** 由解析出的 JSON 帧条目构造 PackedFrame（含图集坐标系换算） */
function packedFrameFromParsed(f: ParsedFrameEntry, id: string): PackedFrame {
  const atlasMeta = frameMetaToAtlas(f.meta, f.spriteSourceSize, f.frame.x, f.frame.y);
  return {
    id,
    name: f.name,
    x: f.frame.x,
    y: f.frame.y,
    w: f.frame.w,
    h: f.frame.h,
    trim: { ...f.spriteSourceSize },
    srcW: f.sourceSize.w,
    srcH: f.sourceSize.h,
    duration: f.duration,
    meta: f.meta,
    atlasPivot: atlasMeta.pivot,
    atlasAnchor: atlasMeta.anchor,
    atlasNineSlice: atlasMeta.nineSlice
  };
}

/**
 * 从导出的 JSON 恢复帧列表、时长与打包结果。
 * 图集图片来源：JSON 内嵌的 atlasDataURL，或用户同时选择的 atlas.png。
 */
export async function importJSON(jsonFile: File, atlasFile?: File): Promise<void> {
  busy.set(true);
  try {
    const raw: unknown = JSON.parse(await jsonFile.text());
    const parsed = parseAtlasJSON(raw);

    let atlasBlob: Blob;
    if (parsed.atlasDataURL) {
      atlasBlob = dataURLToBlob(parsed.atlasDataURL);
    } else if (atlasFile) {
      atlasBlob = atlasFile;
    } else {
      throw new Error("该 JSON 未内嵌图集，请同时选择导出的 atlas.png");
    }

    const atlasImg = await blobToImage(atlasBlob);
    if (atlasImg.naturalWidth < parsed.size.w || atlasImg.naturalHeight < parsed.size.h) {
      throw new Error(
        `图集图片尺寸 ${atlasImg.naturalWidth}×${atlasImg.naturalHeight} 小于 JSON 声明的 ${parsed.size.w}×${parsed.size.h}`
      );
    }

    // 从图集切出每帧内容，再按 spriteSourceSize 放回原始尺寸画布
    const restored: FrameItem[] = [];
    const packedFrames: PackedFrame[] = [];
    for (const f of parsed.frames) {
      const full = makeCanvas(f.sourceSize.w, f.sourceSize.h);
      ctx2d(full).drawImage(
        atlasImg,
        f.frame.x,
        f.frame.y,
        f.frame.w,
        f.frame.h,
        f.spriteSourceSize.x,
        f.spriteSourceSize.y,
        f.frame.w,
        f.frame.h
      );
      const blob = await canvasToBlob(full);
      const id = uid();
      restored.push({
        id,
        name: f.name,
        duration: f.duration,
        width: f.sourceSize.w,
        height: f.sourceSize.h,
        blob,
        url: URL.createObjectURL(blob),
        meta: f.meta
      });
      packedFrames.push(packedFrameFromParsed(f, id));
    }

    clearAll();
    frames.set(restored);
    settings.set({ ...parsed.settings });
    packResult.set({
      atlasWidth: parsed.size.w,
      atlasHeight: parsed.size.h,
      frames: packedFrames,
      atlasBlob,
      atlasUrl: URL.createObjectURL(atlasBlob),
      padding: parsed.settings.padding,
      trimmed: parsed.settings.trim
    });
    lastJSON = buildAtlasJSON(
      { atlasWidth: parsed.size.w, atlasHeight: parsed.size.h, frames: packedFrames },
      { imageName: parsed.imageName, trimmed: parsed.settings.trim, settings: parsed.settings }
    );
    notify(`已从 JSON 恢复 ${restored.length} 帧与打包结果`);
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), "error");
  } finally {
    busy.set(false);
  }
}

// ---------- IndexedDB 持久化 ----------

export async function saveNow(): Promise<void> {
  try {
    await saveProject(toStored(get(frames), get(settings), get(packResult), lastJSON));
    notify("项目已保存到浏览器本地");
  } catch (e) {
    notify(`保存失败：${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

export async function restoreFromDB(): Promise<boolean> {
  try {
    const stored = await loadProject();
    if (!stored || stored.frames.length === 0) return false;
    const restored: FrameItem[] = stored.frames.map((f) => ({
      id: f.id,
      name: f.name,
      duration: f.duration,
      width: f.width,
      height: f.height,
      blob: f.blob,
      url: URL.createObjectURL(f.blob),
      // 旧版本数据可能没有元数据：补默认值（中心 pivot/anchor，不可拉伸）
      meta: f.meta ?? defaultFrameMeta(f.width, f.height)
    }));
    frames.set(restored);
    settings.set({ ...DEFAULT_SETTINGS, ...stored.settings });
    if (stored.pack) {
      const parsed = parseAtlasJSON(stored.pack.json);
      const packedFrames: PackedFrame[] = parsed.frames.map((f, i) =>
        packedFrameFromParsed(f, restored[i]?.id ?? uid())
      );
      packResult.set({
        atlasWidth: parsed.size.w,
        atlasHeight: parsed.size.h,
        frames: packedFrames,
        atlasBlob: stored.pack.atlasBlob,
        atlasUrl: URL.createObjectURL(stored.pack.atlasBlob),
        padding: parsed.settings.padding,
        trimmed: parsed.settings.trim
      });
      lastJSON = stored.pack.json;
    }
    return true;
  } catch {
    return false;
  }
}

export async function clearStorage(): Promise<void> {
  await clearProject();
  clearAll();
  notify("已清空本地项目");
}

// 自动保存（防抖）
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveProject(toStored(get(frames), get(settings), get(packResult), lastJSON)).catch(() => {});
  }, 600);
}

export function startAutoSave(): void {
  frames.subscribe(() => scheduleSave());
  settings.subscribe(() => scheduleSave());
  packResult.subscribe(() => scheduleSave());
}
