<script lang="ts">
  import { frames, packResult, selectedId } from "../core/store";
  import {
    setAnchor,
    setNineSlice,
    setNineSliceEnabled,
    setPivot
  } from "../core/store";
  import type { FrameItem, NineSlice, Point } from "../core/types";

  let stageEl: HTMLDivElement;
  let errorMsg = "";
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  // 非法输入时自增以强制数值框回滚到上次有效值
  let revertToken = 0;

  function fail(msg: string): void {
    errorMsg = msg;
    revertToken++;
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => (errorMsg = ""), 3000);
  }

  let frame: FrameItem | null = null;
  let packed: {
    trim: { x: number; y: number; w: number; h: number };
    atlasMeta: {
      pivot: Point;
      anchor: Point;
      nineSlice: NineSlice | null;
    };
  } | null = null;

  $: frame = $frames.find((f) => f.id === $selectedId) ?? null;
  $: packed =
    frame && $packResult
      ? $packResult.frames.find((f) => f.id === frame!.id) ?? null
      : null;

  // ---------- 拖拽 ----------

  type DragKind = "pivot" | "anchor" | "ns-left" | "ns-right" | "ns-top" | "ns-bottom";

  function toSource(e: PointerEvent): Point {
    const r = stageEl.getBoundingClientRect();
    const f = frame!;
    return {
      x: Math.min(f.width, Math.max(0, ((e.clientX - r.left) / r.width) * f.width)),
      y: Math.min(f.height, Math.max(0, ((e.clientY - r.top) / r.height) * f.height))
    };
  }

  function startDrag(kind: DragKind) {
    return (e: PointerEvent) => {
      if (!frame) return;
      e.preventDefault();
      e.stopPropagation();
      const id = frame.id;
      const move = (ev: PointerEvent): void => {
        // 每次移动都读最新帧，避免用按下时的旧基线覆盖其他手柄的改动
        const f = $frames.find((x) => x.id === id);
        if (!f) return;
        const p = toSource(ev);
        if (kind === "pivot") {
          setPivot(f.id, p);
        } else if (kind === "anchor") {
          setAnchor(f.id, { x: p.x / f.width, y: p.y / f.height });
        } else {
          const ns = f.meta.nineSlice ?? { left: 0, right: 0, top: 0, bottom: 0 };
          const next: NineSlice = { ...ns };
          if (kind === "ns-left") next.left = Math.min(Math.round(p.x), ns.right);
          if (kind === "ns-right") next.right = Math.max(Math.round(p.x), ns.left);
          if (kind === "ns-top") next.top = Math.min(Math.round(p.y), ns.bottom);
          if (kind === "ns-bottom") next.bottom = Math.max(Math.round(p.y), ns.top);
          setNineSlice(f.id, next);
        }
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };
  }

  // ---------- 数值输入 ----------

  function numFrom(el: HTMLInputElement): number {
    return Number(el.value);
  }

  function onPivotInput(axis: "x" | "y", e: Event): void {
    if (!frame) return;
    const v = numFrom(e.currentTarget as HTMLInputElement);
    if (!Number.isFinite(v)) {
      fail("pivot 必须是数字");
      return;
    }
    const err = setPivot(frame.id, { ...frame.meta.pivot, [axis]: v });
    if (err) fail(err);
  }

  function onAnchorInput(axis: "x" | "y", e: Event): void {
    if (!frame) return;
    const v = numFrom(e.currentTarget as HTMLInputElement);
    if (!Number.isFinite(v)) {
      fail("anchor 必须是数字");
      return;
    }
    const err = setAnchor(frame.id, { ...frame.meta.anchor, [axis]: v });
    if (err) fail(err);
  }

  function onNineSliceInput(k: keyof NineSlice, e: Event): void {
    if (!frame || !frame.meta.nineSlice) return;
    const v = numFrom(e.currentTarget as HTMLInputElement);
    if (!Number.isFinite(v) || !Number.isInteger(v)) {
      fail("九宫格边界必须是整数像素");
      return;
    }
    const err = setNineSlice(frame.id, { ...frame.meta.nineSlice, [k]: v });
    if (err) fail(err);
  }

  function resetCenter(): void {
    if (!frame) return;
    setPivot(frame.id, { x: frame.width / 2, y: frame.height / 2 });
    setAnchor(frame.id, { x: 0.5, y: 0.5 });
  }
</script>

<div class="panel meta-panel">
  <h2>帧元数据（原始未裁切画布坐标系）</h2>

  {#if !frame}
    <div class="empty" data-testid="meta-empty">在左侧帧序列中选择一帧，以编辑 pivot / anchor / 九宫格。</div>
  {:else}
    <div class="stage-wrap">
      <div
        class="stage checker"
        bind:this={stageEl}
        style={`aspect-ratio: ${frame.width} / ${frame.height}`}
        data-testid="meta-stage"
      >
        <img src={frame.url} alt={frame.name} draggable="false" />

        <!-- 裁切包围盒（虚线）：直观展示 pivot 可落在被裁掉的透明区 -->
        {#if packed}
          <div
            class="trim-box"
            style:left={`${(packed.trim.x / frame.width) * 100}%`}
            style:top={`${(packed.trim.y / frame.height) * 100}%`}
            style:width={`${(packed.trim.w / frame.width) * 100}%`}
            style:height={`${(packed.trim.h / frame.height) * 100}%`}
            title={`裁切区 (${packed.trim.x}, ${packed.trim.y}) ${packed.trim.w}×${packed.trim.h}`}
          ></div>
        {/if}

        {#key revertToken}
          <!-- 九宫格四条可拖拽边界 -->
          {#if frame.meta.nineSlice}
            {@const ns = frame.meta.nineSlice}
            <div class="ns-v" style:left={`${(ns.left / frame.width) * 100}%`}>
              <button
                class="grab v-grab"
                title="拖动九宫格左边界"
                data-testid="ns-drag-left"
                on:pointerdown={startDrag("ns-left")}
              ></button>
            </div>
            <div class="ns-v" style:left={`${(ns.right / frame.width) * 100}%`}>
              <button
                class="grab v-grab"
                title="拖动九宫格右边界"
                data-testid="ns-drag-right"
                on:pointerdown={startDrag("ns-right")}
              ></button>
            </div>
            <div class="ns-h" style:top={`${(ns.top / frame.height) * 100}%`}>
              <button
                class="grab h-grab"
                title="拖动九宫格上边界"
                data-testid="ns-drag-top"
                on:pointerdown={startDrag("ns-top")}
              ></button>
            </div>
            <div class="ns-h" style:top={`${(ns.bottom / frame.height) * 100}%`}>
              <button
                class="grab h-grab"
                title="拖动九宫格下边界"
                data-testid="ns-drag-bottom"
                on:pointerdown={startDrag("ns-bottom")}
              ></button>
            </div>
          {/if}

          <!-- anchor（蓝）与 pivot（红）拖拽点 -->
          <button
            class="handle anchor"
            style:left={`${frame.meta.anchor.x * 100}%`}
            style:top={`${frame.meta.anchor.y * 100}%`}
            title="拖动 anchor（归一化 0–1）"
            data-testid="anchor-handle"
            on:pointerdown={startDrag("anchor")}
          ></button>
          <button
            class="handle pivot"
            style:left={`${(frame.meta.pivot.x / frame.width) * 100}%`}
            style:top={`${(frame.meta.pivot.y / frame.height) * 100}%`}
            title="拖动 pivot（原始画布像素）"
            data-testid="pivot-handle"
            on:pointerdown={startDrag("pivot")}
          ></button>
        {/key}
      </div>
    </div>

    {#if errorMsg}
      <div class="error" data-testid="meta-error" role="alert">{errorMsg}</div>
    {/if}

    <div class="legend dim">
      <span><i class="dot pivot-dot"></i> pivot 原始像素</span>
      <span><i class="dot anchor-dot"></i> anchor 归一化</span>
      <span><i class="ns-legend"></i> 九宫格</span>
      <span><i class="trim-legend"></i> 裁切区</span>
    </div>

    {#key revertToken}
      <div class="fields">
        <fieldset>
          <legend>pivot（像素 · 原图 {frame.width}×{frame.height}）</legend>
          <label>x
            <input
              type="number"
              step="0.01"
              min="0"
              max={frame.width}
              value={frame.meta.pivot.x}
              data-testid="pivot-x"
              on:change={(e) => onPivotInput("x", e)}
            />
          </label>
          <label>y
            <input
              type="number"
              step="0.01"
              min="0"
              max={frame.height}
              value={frame.meta.pivot.y}
              data-testid="pivot-y"
              on:change={(e) => onPivotInput("y", e)}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>anchor（归一化 0–1）</legend>
          <label>x
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={frame.meta.anchor.x}
              data-testid="anchor-x"
              on:change={(e) => onAnchorInput("x", e)}
            />
          </label>
          <label>y
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={frame.meta.anchor.y}
              data-testid="anchor-y"
              on:change={(e) => onAnchorInput("y", e)}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>
            <label class="enable">
              <input
                type="checkbox"
                checked={frame.meta.nineSlice !== null}
                data-testid="ns-enable"
                on:change={(e) =>
                  setNineSliceEnabled(frame.id, e.currentTarget.checked)}
              />
              九宫格（整数像素，可拉伸帧）
            </label>
          </legend>
          {#if frame.meta.nineSlice}
            {@const ns = frame.meta.nineSlice}
            <div class="ns-fields">
              <label>left
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={frame.width}
                  value={ns.left}
                  data-testid="ns-left"
                  on:change={(e) => onNineSliceInput("left", e)}
                />
              </label>
              <label>right
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={frame.width}
                  value={ns.right}
                  data-testid="ns-right"
                  on:change={(e) => onNineSliceInput("right", e)}
                />
              </label>
              <label>top
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={frame.height}
                  value={ns.top}
                  data-testid="ns-top"
                  on:change={(e) => onNineSliceInput("top", e)}
                />
              </label>
              <label>bottom
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={frame.height}
                  value={ns.bottom}
                  data-testid="ns-bottom"
                  on:change={(e) => onNineSliceInput("bottom", e)}
                />
              </label>
            </div>
          {/if}
        </fieldset>
      </div>
    {/key}

    <div class="row">
      <button data-testid="meta-reset" on:click={resetCenter}>pivot / anchor 回到中心</button>
      {#if packed}
        <span class="dim mono derived" data-testid="meta-derived">
          图集坐标（含留白 {$packResult?.padding}px）：
          pivot ({packed.atlasMeta.pivot.x.toFixed(2)}, {packed.atlasMeta.pivot.y.toFixed(2)})
          · anchor ({packed.atlasMeta.anchor.x.toFixed(2)}, {packed.atlasMeta.anchor.y.toFixed(2)})
          {#if packed.atlasMeta.nineSlice}
            · 九宫格 {packed.atlasMeta.nineSlice.left},{packed.atlasMeta.nineSlice.right},
            {packed.atlasMeta.nineSlice.top},{packed.atlasMeta.nineSlice.bottom}
          {/if}
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .empty {
    color: var(--text-dim);
    padding: 12px 4px;
    font-size: 13px;
  }
  .stage-wrap {
    display: flex;
    justify-content: center;
    margin: 8px 0;
  }
  .stage {
    position: relative;
    width: 100%;
    max-width: 340px;
    max-height: 300px;
    border-radius: 6px;
    overflow: hidden;
    touch-action: none;
    line-height: 0;
  }
  .stage img {
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
    display: block;
  }
  .trim-box {
    position: absolute;
    border: 1px dashed rgba(79, 140, 255, 0.9);
    pointer-events: none;
  }
  .handle {
    position: absolute;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #fff;
    padding: 0;
    margin: 0;
    transform: translate(-50%, -50%);
    cursor: grab;
    touch-action: none;
  }
  .handle:active {
    cursor: grabbing;
  }
  .handle.pivot {
    background: #e5534b;
    z-index: 3;
  }
  .handle.anchor {
    background: #4f8cff;
    z-index: 2;
  }
  .ns-v {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px solid #38c793;
    z-index: 2;
    pointer-events: none;
  }
  .ns-h {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 1px solid #38c793;
    z-index: 2;
    pointer-events: none;
  }
  .grab {
    position: absolute;
    padding: 0;
    margin: 0;
    background: #38c793;
    border: 1.5px solid #fff;
    cursor: grab;
    touch-action: none;
    pointer-events: auto;
  }
  .v-grab {
    width: 9px;
    height: 22px;
    left: -5px;
    top: calc(50% - 11px);
  }
  .h-grab {
    width: 22px;
    height: 9px;
    top: -5px;
    left: calc(50% - 11px);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 11px;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }
  .pivot-dot {
    background: #e5534b;
  }
  .anchor-dot {
    background: #4f8cff;
  }
  .ns-legend {
    width: 9px;
    height: 0;
    border-top: 2px solid #38c793;
    display: inline-block;
  }
  .trim-legend {
    width: 9px;
    height: 6px;
    border: 1px dashed #4f8cff;
    display: inline-block;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 8px;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
  }
  legend {
    font-size: 12px;
    color: var(--text-dim);
    padding: 0 4px;
  }
  label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }
  label.enable {
    color: var(--text);
  }
  input[type="number"] {
    width: 72px;
  }
  .ns-fields {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .error {
    margin: 6px 0;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--danger);
    background: rgba(229, 83, 75, 0.12);
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .derived {
    font-size: 11px;
  }
</style>
