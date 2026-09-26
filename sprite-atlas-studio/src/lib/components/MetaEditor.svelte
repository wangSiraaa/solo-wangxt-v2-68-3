<script lang="ts">
  import {
    editId,
    frames,
    notify,
    packResult,
    setFrameAnchor,
    setFrameNineSlice,
    setFramePivot,
    settings
  } from "../core/store";
  import { computeAlphaBBox } from "../core/trim";
  import { imageToPixels } from "../core/image";
  import type { FrameItem, NineSlice, Point, TrimRect } from "../core/types";

  /**
   * 帧元数据编辑器：在原始未裁切画布上设置 pivot / anchor / 九宫格。
   * 所有数值均为原始图像坐标系（原图左上角原点，单位像素），
   * 与裁切、留白、打包布局无关；已打包时另显示换算后的图集坐标。
   */

  // 当前编辑的帧：显式点击的帧优先，否则第一帧
  $: current = ($frames.find((f) => f.id === $editId) ?? $frames[0]) as FrameItem | undefined;
  $: packed = current ? ($packResult?.frames.find((f) => f.id === current!.id) ?? null) : null;

  let lastError = "";
  let lastFrameId = "";
  $: if (current && current.id !== lastFrameId) {
    lastFrameId = current.id;
    lastError = ""; // 切换帧时清掉上一帧的错误提示
  }

  // ---------- 裁切框显示（帮助看清哪些区域会被裁掉） ----------

  let trimRect: TrimRect | null = null;
  let trimKey = "";

  $: if (current) {
    const key = `${current.id}|${$settings.trim}`;
    if (key !== trimKey) {
      trimKey = key;
      void computeTrim(current, $settings.trim);
    }
  }

  async function computeTrim(f: FrameItem, doTrim: boolean): Promise<void> {
    if (!doTrim) {
      trimRect = { x: 0, y: 0, w: f.width, h: f.height };
      return;
    }
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("图片加载失败"));
      el.src = f.url;
    });
    if (trimKey !== `${f.id}|${doTrim}`) return; // 期间已切换帧
    const bbox = computeAlphaBBox(imageToPixels(img, f.width, f.height));
    trimRect = bbox ?? { x: 0, y: 0, w: 1, h: 1 };
  }

  // ---------- 数值输入 ----------

  function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function readPoint(e: Event): Point | null {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    return Number.isFinite(v) ? { x: v, y: v } : null;
  }

  function revert(e: Event, v: number): void {
    (e.currentTarget as HTMLInputElement).value = fmt(v);
  }

  function onPivotAxis(e: Event, axis: "x" | "y"): void {
    if (!current) return;
    const p = readPoint(e);
    if (p === null) {
      lastError = "pivot 坐标必须是数字";
      revert(e, current.meta.pivot[axis]);
      return;
    }
    const next = { ...current.meta.pivot, [axis]: p[axis] };
    if (setFramePivot(current.id, next)) lastError = "";
    else {
      lastError = `pivot 非法：超出原图范围 0..${current.width} × 0..${current.height}`;
      revert(e, current.meta.pivot[axis]);
    }
  }

  function onAnchorAxis(e: Event, axis: "x" | "y"): void {
    if (!current) return;
    const p = readPoint(e);
    if (p === null) {
      lastError = "anchor 坐标必须是数字";
      revert(e, current.meta.anchor[axis]);
      return;
    }
    const next = { ...current.meta.anchor, [axis]: p[axis] };
    if (setFrameAnchor(current.id, next)) lastError = "";
    else {
      lastError = `anchor 非法：超出原图范围 0..${current.width} × 0..${current.height}`;
      revert(e, current.meta.anchor[axis]);
    }
  }

  function onNineSliceEdge(e: Event, edge: keyof NineSlice): void {
    if (!current || !current.meta.nineSlice) return;
    const el = e.currentTarget as HTMLInputElement;
    const v = Number(el.value);
    if (!Number.isFinite(v)) {
      lastError = "九宫格边界必须是数字";
      revert(e, current.meta.nineSlice[edge]);
      return;
    }
    const next = { ...current.meta.nineSlice, [edge]: v };
    if (setFrameNineSlice(current.id, next)) lastError = "";
    else {
      lastError = "九宫格非法：边界不得超出原图或相互交叉，已保留上次有效值";
      revert(e, current.meta.nineSlice[edge]);
    }
  }

  function toggleNineSlice(e: Event): void {
    if (!current) return;
    const on = (e.currentTarget as HTMLInputElement).checked;
    if (!on) {
      setFrameNineSlice(current.id, null);
      lastError = "";
      return;
    }
    // 默认三等分，保证合法
    const w = current.width;
    const h = current.height;
    const ns: NineSlice = {
      left: Math.floor(w / 3),
      right: Math.max(Math.floor(w / 3) + 1, Math.ceil((w * 2) / 3)),
      top: Math.floor(h / 3),
      bottom: Math.max(Math.floor(h / 3) + 1, Math.ceil((h * 2) / 3))
    };
    if (!setFrameNineSlice(current.id, ns)) {
      lastError = "当前帧尺寸过小，无法设置九宫格";
      (e.currentTarget as HTMLInputElement).checked = false;
    } else {
      lastError = "";
    }
  }

  function centerPivot(): void {
    if (!current) return;
    if (setFramePivot(current.id, { x: current.width / 2, y: current.height / 2 })) lastError = "";
  }
  function centerAnchor(): void {
    if (!current) return;
    if (setFrameAnchor(current.id, { x: current.width / 2, y: current.height / 2 })) lastError = "";
  }

  // ---------- 预览拖拽 ----------

  type DragTarget = "pivot" | "anchor" | "left" | "right" | "top" | "bottom";
  let dragging: DragTarget | null = null;
  let svgEl: SVGSVGElement | null = null;

  function toImagePoint(e: PointerEvent): Point | null {
    if (!svgEl || !current) return null;
    const r = svgEl.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * current.width,
      y: ((e.clientY - r.top) / r.height) * current.height
    };
  }

  function clampRound(p: Point): Point {
    if (!current) return p;
    return {
      x: Math.round(Math.min(current.width, Math.max(0, p.x))),
      y: Math.round(Math.min(current.height, Math.max(0, p.y)))
    };
  }

  /** 命中的拖拽手柄（data-handle）开始拖拽；指针捕获在 svg 根上统一处理 */
  function onSvgPointerDown(e: PointerEvent): void {
    if (!svgEl) return;
    const handle = (e.target as Element | null)?.closest?.("[data-handle]");
    if (!handle) return;
    e.preventDefault();
    dragging = handle.getAttribute("data-handle") as DragTarget;
    svgEl.setPointerCapture(e.pointerId);
  }

  function onDragMove(e: PointerEvent): void {
    if (!dragging || !current) return;
    const p = toImagePoint(e);
    if (!p) return;
    const q = clampRound(p);
    const id = current.id;
    switch (dragging) {
      case "pivot":
        setFramePivot(id, q); // 已钳制到原图内，必然合法
        break;
      case "anchor":
        setFrameAnchor(id, q);
        break;
      default: {
        // 九宫格边线：非法（交叉/越界）时 store 拒绝并保留上次有效值，线即被挡住
        const ns = current.meta.nineSlice;
        if (!ns) return;
        const next: NineSlice = { ...ns };
        if (dragging === "left" || dragging === "right") next[dragging] = q.x;
        else next[dragging] = q.y;
        setFrameNineSlice(id, next);
      }
    }
  }

  function endDrag(): void {
    dragging = null;
  }

  $: handleR = current ? Math.max(2.5, Math.max(current.width, current.height) * 0.018) : 3;
  $: nsLine = current?.meta.nineSlice ?? null;
</script>

<div class="panel">
  <h2>帧元数据 · pivot / anchor / 九宫格</h2>

  {#if !current}
    <div class="empty">导入并选择帧后，可在原始未裁切画布上设置 pivot / anchor 与九宫格。</div>
  {:else}
    <div class="meta-head">
      <span class="mono" id="meta-frame-name">{current.name}</span>
      <span class="dim mono">原图 {current.width}×{current.height} · 坐标系：原图左上角原点，单位 px</span>
    </div>

    <div class="meta-body">
      <div class="preview checker" data-testid="meta-preview">
        <img src={current.url} alt={current.name} draggable="false" />
        <svg
          bind:this={svgEl}
          viewBox="0 0 {current.width} {current.height}"
          preserveAspectRatio="none"
          role="application"
          aria-label="pivot / anchor / 九宫格拖拽编辑区（数值可在右侧表单精确输入）"
          on:pointerdown={onSvgPointerDown}
          on:pointermove={onDragMove}
          on:pointerup={endDrag}
        >
          <!-- 裁切框：框外透明区将被裁掉 -->
          {#if trimRect && $settings.trim}
            <rect
              class="trim-rect"
              x={trimRect.x}
              y={trimRect.y}
              width={trimRect.w}
              height={trimRect.h}
            />
          {/if}

          <!-- 九宫格 -->
          {#if nsLine}
            <g class="ns">
              <line x1={nsLine.left} y1="0" x2={nsLine.left} y2={current.height} />
              <line x1={nsLine.right} y1="0" x2={nsLine.right} y2={current.height} />
              <line x1="0" y1={nsLine.top} x2={current.width} y2={nsLine.top} />
              <line x1="0" y1={nsLine.bottom} x2={current.width} y2={nsLine.bottom} />
            </g>
            <g class="ns-hit">
              <line data-handle="left" x1={nsLine.left} y1="0" x2={nsLine.left} y2={current.height} />
              <line data-handle="right" x1={nsLine.right} y1="0" x2={nsLine.right} y2={current.height} />
              <line data-handle="top" x1="0" y1={nsLine.top} x2={current.width} y2={nsLine.top} />
              <line data-handle="bottom" x1="0" y1={nsLine.bottom} x2={current.width} y2={nsLine.bottom} />
            </g>
          {/if}

          <!-- anchor：黄色菱形 -->
          <g
            class="handle anchor"
            data-handle="anchor"
            transform="translate({current.meta.anchor.x}, {current.meta.anchor.y})"
          >
            <title>anchor ({fmt(current.meta.anchor.x)}, {fmt(current.meta.anchor.y)})</title>
            <polygon points="0,{-handleR * 1.4} {handleR * 1.4},0 0,{handleR * 1.4} {-handleR * 1.4},0" />
          </g>

          <!-- pivot：蓝色十字圆点 -->
          <g
            class="handle pivot"
            data-handle="pivot"
            transform="translate({current.meta.pivot.x}, {current.meta.pivot.y})"
          >
            <title>pivot ({fmt(current.meta.pivot.x)}, {fmt(current.meta.pivot.y)})</title>
            <line x1={-handleR * 1.8} y1="0" x2={handleR * 1.8} y2="0" />
            <line x1="0" y1={-handleR * 1.8} x2="0" y2={handleR * 1.8} />
            <circle r={handleR} />
          </g>
        </svg>
      </div>

      <div class="form">
        <div class="group">
          <span class="label pivot-dot">pivot</span>
          <input id="meta-pivot-x" type="number" step="any" value={fmt(current.meta.pivot.x)}
            on:change={(e) => onPivotAxis(e, "x")} />
          <input id="meta-pivot-y" type="number" step="any" value={fmt(current.meta.pivot.y)}
            on:change={(e) => onPivotAxis(e, "y")} />
          <button class="mini" on:click={centerPivot}>居中</button>
        </div>

        <div class="group">
          <span class="label anchor-dot">anchor</span>
          <input id="meta-anchor-x" type="number" step="any" value={fmt(current.meta.anchor.x)}
            on:change={(e) => onAnchorAxis(e, "x")} />
          <input id="meta-anchor-y" type="number" step="any" value={fmt(current.meta.anchor.y)}
            on:change={(e) => onAnchorAxis(e, "y")} />
          <button class="mini" on:click={centerAnchor}>居中</button>
        </div>

        <label class="group check">
          <input id="meta-ns-enabled" type="checkbox" checked={current.meta.nineSlice !== null}
            on:change={toggleNineSlice} />
          可拉伸（九宫格）
        </label>

        {#if current.meta.nineSlice}
          <div class="group ns-grid">
            <span class="label">左</span>
            <input id="meta-ns-left" type="number" step="any" value={fmt(current.meta.nineSlice.left)}
              on:change={(e) => onNineSliceEdge(e, "left")} />
            <span class="label">右</span>
            <input id="meta-ns-right" type="number" step="any" value={fmt(current.meta.nineSlice.right)}
              on:change={(e) => onNineSliceEdge(e, "right")} />
            <span class="label">上</span>
            <input id="meta-ns-top" type="number" step="any" value={fmt(current.meta.nineSlice.top)}
              on:change={(e) => onNineSliceEdge(e, "top")} />
            <span class="label">下</span>
            <input id="meta-ns-bottom" type="number" step="any" value={fmt(current.meta.nineSlice.bottom)}
              on:change={(e) => onNineSliceEdge(e, "bottom")} />
          </div>
        {/if}

        {#if lastError}
          <div class="error" id="meta-error" role="alert">{lastError}</div>
        {:else}
          <div class="error" id="meta-error" hidden></div>
        {/if}

        <div class="dim atlas-info" id="meta-atlas-info">
          {#if packed}
            图集坐标（裁切+留白后）：pivot ({fmt(packed.atlasPivot.x)}, {fmt(packed.atlasPivot.y)})
            · anchor ({fmt(packed.atlasAnchor.x)}, {fmt(packed.atlasAnchor.y)})
            {#if packed.atlasNineSlice}
              · 九宫格 L{fmt(packed.atlasNineSlice.left)} R{fmt(packed.atlasNineSlice.right)}
              T{fmt(packed.atlasNineSlice.top)} B{fmt(packed.atlasNineSlice.bottom)}
            {/if}
          {:else}
            打包后此处显示换算到图集的坐标
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .empty {
    color: var(--text-dim);
    padding: 12px 4px;
  }
  .meta-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
  }
  .meta-body {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .preview {
    position: relative;
    width: 220px;
    flex: none;
    line-height: 0;
    border-radius: 6px;
    overflow: hidden;
  }
  .preview img {
    width: 100%;
    image-rendering: pixelated;
    display: block;
  }
  .preview svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .trim-rect {
    fill: none;
    stroke: #e5534b;
    stroke-width: 1;
    stroke-dasharray: 4 3;
    vector-effect: non-scaling-stroke;
  }
  .ns line {
    stroke: #38c793;
    stroke-width: 1;
    stroke-dasharray: 5 3;
    vector-effect: non-scaling-stroke;
  }
  .ns-hit line {
    stroke: transparent;
    stroke-width: 10;
    vector-effect: non-scaling-stroke;
    cursor: ew-resize;
  }
  .handle {
    cursor: grab;
  }
  .handle:active {
    cursor: grabbing;
  }
  .pivot circle {
    fill: rgba(79, 140, 255, 0.9);
    stroke: #fff;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .pivot line {
    stroke: #4f8cff;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .anchor polygon {
    fill: rgba(255, 209, 102, 0.9);
    stroke: #7a5c00;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .form {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .group input[type="number"] {
    width: 64px;
  }
  .label {
    width: 52px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .pivot-dot::before {
    content: "●";
    color: #4f8cff;
    margin-right: 4px;
  }
  .anchor-dot::before {
    content: "◆";
    color: #ffd166;
    margin-right: 4px;
  }
  .check {
    font-size: 13px;
  }
  .ns-grid {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 6px;
  }
  .ns-grid .label {
    width: auto;
    text-align: right;
  }
  .ns-grid input {
    width: 100%;
    min-width: 0;
  }
  .mini {
    padding: 2px 8px;
    font-size: 12px;
  }
  .error {
    color: var(--danger);
    font-size: 12px;
  }
  .atlas-info {
    font-size: 12px;
    line-height: 1.5;
  }
</style>
