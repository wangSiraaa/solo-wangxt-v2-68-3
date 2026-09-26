<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { Application, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
  import { Animator } from "../core/animator";
  import { frames, packResult, selectedId } from "../core/store";
  import type { PackedFrame } from "../core/types";

  let wrap: HTMLDivElement;
  let app: Application | null = null;
  let sprite: Sprite | null = null;
  let border: Graphics | null = null;
  /** pivot（红）/ anchor（蓝）/ 九宫格（绿）叠加层，坐标以原始未裁切画布为准 */
  let metaGfx: Graphics | null = null;
  /** 原始画布上的九宫格矩形填充，用于让九宫格区域在预览中可见 */
  let curMetaInfo = "";

  const animator = new Animator([]);
  let playing = true;

  // 当前展示的帧信息（用于面板与测试断言）
  let curIndex = -1;
  let curName = "";
  let curDuration = 0;
  let curAtlasInfo = "";
  let curOffsetInfo = "";

  let textures: Texture[] = [];
  let offsets: Array<{ x: number; y: number }> = [];
  let packedFrames: PackedFrame[] | null = null;
  let baseTexture: Texture | null = null;
  let rebuildToken = 0;
  let baseX = 0;
  let baseY = 0;
  let stageScale = 1;

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = url;
    });
  }

  function disposeTextures(): void {
    for (const t of textures) t.destroy(false);
    textures = [];
    if (baseTexture) {
      baseTexture.destroy(true);
      baseTexture = null;
    }
  }

  async function rebuild(): Promise<void> {
    const token = ++rebuildToken;
    if (!app) return;
    const list = $frames;
    const pack = $packResult;

    disposeTextures();
    offsets = [];
    packedFrames = pack ? pack.frames : null;
    animator.reset();

    if (list.length === 0) {
      if (sprite) sprite.visible = false;
      curIndex = -1;
      curName = "";
      curAtlasInfo = "";
      curOffsetInfo = "";
      curMetaInfo = "";
      metaGfx?.clear();
      return;
    }

    if (pack) {
      // 引擎视角：从图集取子纹理，按裁切偏移摆回原始位置
      const img = await loadImage(pack.atlasUrl);
      if (token !== rebuildToken) return;
      baseTexture = Texture.from(img);
      textures = pack.frames.map(
        (f) => new Texture({ source: baseTexture!.source, frame: new Rectangle(f.x, f.y, f.w, f.h) })
      );
      offsets = pack.frames.map((f) => ({ x: f.trim.x, y: f.trim.y }));
    } else {
      const imgs = await Promise.all(list.map((f) => loadImage(f.url)));
      if (token !== rebuildToken) return;
      textures = imgs.map((img) => Texture.from(img));
      offsets = list.map(() => ({ x: 0, y: 0 }));
    }

    layoutStage();
    if (sprite) {
      sprite.visible = true;
      applyFrame(0);
    }
  }

  function layoutStage(): void {
    if (!app || !sprite) return;
    const list = $frames;
    if (list.length === 0) return;
    const maxW = Math.max(...list.map((f) => f.width));
    const maxH = Math.max(...list.map((f) => f.height));
    const cw = app.renderer.width / app.renderer.resolution;
    const ch = app.renderer.height / app.renderer.resolution;
    stageScale = Math.max(0.05, Math.min(cw / maxW, ch / maxH) * 0.85);
    baseX = (cw - maxW * stageScale) / 2;
    baseY = (ch - maxH * stageScale) / 2;
    sprite.scale.set(stageScale);
    if (border) {
      border.clear();
      border.rect(0, 0, maxW, maxH).stroke({ width: 1, color: 0x4f8cff, alpha: 0.5 });
      border.scale.set(stageScale);
      border.position.set(baseX, baseY);
    }
    if (curIndex >= 0) drawMeta();
  }

  function applyFrame(i: number): void {
    if (!sprite || i < 0 || i >= textures.length) return;
    const tex = textures[i];
    const off = offsets[i];
    if (!tex || !off) return;
    sprite.texture = tex;
    sprite.position.set(baseX + off.x * stageScale, baseY + off.y * stageScale);

    curIndex = i;
    const list = $frames;
    const item = list[i];
    curName = item?.name ?? "";
    curDuration = item?.duration ?? 0;
    const pf = packedFrames?.[i];
    curAtlasInfo = pf ? `图集 (${pf.x}, ${pf.y}) ${pf.w}×${pf.h}` : "未打包";
    curOffsetInfo = pf ? `偏移 (${pf.trim.x}, ${pf.trim.y}) 原始 ${pf.srcW}×${pf.srcH}` : "";
    drawMeta();
    selectedId.set(item?.id ?? null);
  }

  /** 绘制当前帧 pivot / anchor / 九宫格（原始画布坐标，随预览整体缩放/偏移） */
  function drawMeta(): void {
    if (!metaGfx) return;
    metaGfx.clear();
    const list = $frames;
    const item = list[curIndex];
    if (!item) return;
    metaGfx.scale.set(stageScale);
    metaGfx.position.set(baseX, baseY);

    const m = item.meta;
    if (m.nineSlice) {
      const ns = m.nineSlice;
      // 中心拉伸区淡绿底
      metaGfx
        .rect(ns.left, ns.top, Math.max(0, ns.right - ns.left), Math.max(0, ns.bottom - ns.top))
        .fill({ color: 0x38c793, alpha: 0.12 });
      // 四条边界线
      metaGfx
        .moveTo(ns.left, 0).lineTo(ns.left, item.height)
        .moveTo(ns.right, 0).lineTo(ns.right, item.height)
        .moveTo(0, ns.top).lineTo(item.width, ns.top)
        .moveTo(0, ns.bottom).lineTo(item.width, ns.bottom)
        .stroke({ width: 1 / stageScale, color: 0x38c793, alpha: 0.9 });
      curMetaInfo = `九宫格 [${ns.left},${ns.right},${ns.top},${ns.bottom}]`;
    } else {
      curMetaInfo = "";
    }

    // pivot：红圆 + 十字
    const pw = 4 / stageScale;
    metaGfx
      .circle(m.pivot.x, m.pivot.y, pw)
      .fill({ color: 0xe5534b })
      .moveTo(m.pivot.x - pw * 2, m.pivot.y).lineTo(m.pivot.x + pw * 2, m.pivot.y)
      .moveTo(m.pivot.x, m.pivot.y - pw * 2).lineTo(m.pivot.x, m.pivot.y + pw * 2)
      .stroke({ width: 1 / stageScale, color: 0xe5534b });

    // anchor：蓝方块
    const aw = 3.5 / stageScale;
    metaGfx
      .rect(m.anchor.x * item.width - aw, m.anchor.y * item.height - aw, aw * 2, aw * 2)
      .fill({ color: 0x4f8cff });
  }

  onMount(async () => {
    app = new Application();
    await app.init({
      backgroundAlpha: 0,
      antialias: false,
      resizeTo: wrap
    });
    app.canvas.style.imageRendering = "pixelated";
    wrap.appendChild(app.canvas);

    border = new Graphics();
    sprite = new Sprite();
    metaGfx = new Graphics();
    app.stage.addChild(border);
    app.stage.addChild(sprite);
    app.stage.addChild(metaGfx);

    app.ticker.add((ticker) => {
      animator.playing = playing;
      const i = animator.tick(ticker.deltaMS);
      if (i !== curIndex && i >= 0) applyFrame(i);
    });
    app.renderer.on("resize", () => layoutStage());

    await rebuild();
  });

  onDestroy(() => {
    disposeTextures();
    app?.destroy(true, { children: true, texture: true });
    app = null;
  });

  // 帧集合或打包结果变化 → 重建纹理；时长变化 → 只更新动画器
  $: frameKey = $frames.map((f) => f.id).join(",");
  $: packKey = $packResult ? $packResult.atlasUrl : "";
  $: if (app) {
    void frameKey;
    void packKey;
    void rebuild();
  }
  $: if (app) {
    animator.setDurations($frames.map((f) => f.duration));
  }
  // 元数据变化（未触发纹理重建）→ 仅重画叠加层
  $: metaKey = $frames.map((f) => JSON.stringify(f.meta)).join("|");
  $: if (app) {
    void metaKey;
    drawMeta();
  }

  function togglePlay(): void {
    playing = !playing;
  }

  /** 暂停并把预览切到当前在帧列表中选中的帧 */
  function jumpToSelected(): void {
    if (!packedFrames) {
      // 未打包时纹理顺序与帧列表一致
      const i = $frames.findIndex((f) => f.id === $selectedId);
      if (i >= 0) {
        playing = false;
        animator.reset();
        animator.index = i;
        applyFrame(i);
      }
      return;
    }
    const i = packedFrames.findIndex((f) => f.id === $selectedId);
    if (i >= 0) {
      playing = false;
      animator.reset();
      animator.index = i;
      applyFrame(i);
    }
  }
</script>

<div class="panel">
  <h2>动画预览（PixiJS · 按原顺序与帧时长播放）</h2>
  <div class="stage checker" bind:this={wrap} data-testid="preview-stage"></div>
  <div class="controls">
    <button id="play-btn" on:click={togglePlay}>{playing ? "⏸ 暂停" : "▶ 播放"}</button>
    <button id="jump-selected-btn" on:click={jumpToSelected} title="暂停并在预览中显示当前选中帧">
      ⤓ 显示选中帧
    </button>
    <span class="mono info" id="preview-frame-label">
      {#if curIndex >= 0}
        帧 {curIndex + 1}/{$frames.length} · {curName} · {curDuration}ms
      {:else}
        无帧
      {/if}
    </span>
  </div>
  <div class="mono dim" id="preview-atlas-info">
    {#if curIndex >= 0}
      {curAtlasInfo}{curOffsetInfo ? ` · ${curOffsetInfo}` : ""}{curMetaInfo ? ` · ${curMetaInfo}` : ""}
    {/if}
  </div>
  <div class="mono dim" data-testid="preview-meta-coords">
    {#if curIndex >= 0 && $frames[curIndex]}
      {@const mf = $frames[curIndex]!}
      pivot ({mf.meta.pivot.x.toFixed(2)}, {mf.meta.pivot.y.toFixed(2)})
      · anchor ({mf.meta.anchor.x.toFixed(2)}, {mf.meta.anchor.y.toFixed(2)})
    {/if}
  </div>
</div>

<style>
  .stage {
    width: 100%;
    height: 380px;
    border-radius: 8px;
    overflow: hidden;
    position: relative;
  }
  .stage :global(canvas) {
    display: block;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }
  .info {
    color: var(--text);
  }
  .dim {
    color: var(--text-dim);
    margin-top: 6px;
    min-height: 16px;
  }
</style>
