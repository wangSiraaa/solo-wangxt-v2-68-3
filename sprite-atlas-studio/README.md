# Sprite Atlas Studio

游戏美术本地序列帧 → 精灵图集工具。**纯 Web、纯本地**：所有图片处理都在浏览器内完成，不上传任何数据。

## 功能

- **导入 PNG 序列帧**：文件选择或拖拽，保持导入顺序（可拖拽/按钮调整）
- **帧时长**：逐帧设置毫秒数，或一键应用到全部帧
- **每帧 pivot / anchor / 九宫格**：在**原始未裁切画布**上数值或拖拽设置；pivot 可落在被裁掉的透明区；九宫格四条边界不得越界或交叉（非法输入被阻止并保留上次有效值）
- **透明边缘裁切**：按 alpha 通道计算包围盒，记录 `spriteSourceSize` 偏移
- **统一留白**：每帧四周固定像素留白（打包时把矩形放大 `padding*2` 后排布，内容居中）
- **矩形打包**：maxrects-packer，**固定方向不旋转**，图集尺寸支持 POT（2 的幂）
- **动画预览**：PixiJS 按原始顺序与每帧时长循环播放；从图集取子纹理并按裁切偏移摆放（等同引擎行为），叠加显示 pivot（红）/anchor（蓝）/九宫格（绿），实时显示当前帧在图集中的位置/尺寸
- **图集视图**：编号框标注每帧位置，表格列出 x/y/w/h、裁切偏移、原始尺寸、时长
- **导出**：`atlas.png` + `atlas.json`（TexturePacker Hash 兼容结构，扩展 `duration` / `frameOrder` / `settings` / `pivot` / `anchor` / `nineSlice` / `atlasMeta`；可内嵌图集 dataURL）
- **导入 JSON 恢复**：从导出的 JSON 完整恢复帧列表、顺序、时长、每帧元数据与打包结果（图集内嵌时无需另选图片；否则连同 `atlas.png` 一起选择）
- **IndexedDB 持久化**：帧 PNG（Blob）、每帧元数据、设置与打包结果自动保存到浏览器本地，刷新后恢复（兼容无元数据的旧版本项目）

## 技术栈

Svelte 5 + TypeScript（状态与 UI）· PixiJS v8（动画预览）· maxrects-packer（矩形打包）· idb（IndexedDB）· Vite

## 开发

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 构建到 dist/
npm run preview    # 预览构建产物
npm run check      # svelte-check 类型检查
```

## 测试

```bash
npm run gen-assets # 生成验证素材到 test-assets/（8 帧：不同尺寸 + 不等厚透明边缘）
npm test           # vitest：单元（裁切/打包/计时/序列化）+ 集成（真实 PNG 全管线）
npm run e2e        # Playwright：浏览器全流程（导入→打包→预览→导出→导入 JSON 恢复→刷新恢复）
```

集成测试（`tests/integration/pipeline.test.ts`）用真实 PNG 验证：

- 裁切包围盒与生成素材的透明边缘完全一致
- 图集中每帧内容位置、统一留白（四周透明像素）
- 四周透明边不同的帧，pivot/anchor/九宫格换算到裁切后、加留白后的图集坐标正确；pivot 位于被裁掉的透明区时仍可表达（图集坐标可落在内容框之外）
- 非法九宫格（越界/交叉/非整数）被阻止且保留上次有效值
- 修改留白后图集派生坐标变化、原始坐标不变；重新裁切/重打包不改变规范值
- 导出 JSON → 重新导入后帧列表/顺序/时长/位置尺寸/元数据完整恢复，且恢复帧与原图**逐像素一致**
- 导出 → 导入 → 再重打包后预览对齐、九宫格边界与数值完全一致
- 预览计时：按每帧时长推进的帧序与解析式 `frameIndexAt` 一致

## JSON 格式

所有每帧元数据都以**原始未裁切画布**为规范坐标系，原点为左上角；
九宫格边界为整数像素，pivot 允许小数。重新导入只信任规范值，
`atlasMeta` 仅为方便引擎直接消费的只读派生值（会在导入后按
`v_atlas = v_source - spriteSourceSize + frame` 重新换算）。

```jsonc
{
  "frames": {
    "walk_01.png": {
      "frame": { "x": 2, "y": 2, "w": 42, "h": 48 },   // 图集中的位置与尺寸（不含留白）
      "rotated": false,                                 // 固定方向，恒为 false
      "trimmed": true,
      "spriteSourceSize": { "x": 8, "y": 10, "w": 42, "h": 48 }, // 裁切偏移
      "sourceSize": { "w": 64, "h": 64 },               // 原始尺寸（元数据坐标系基准）
      "duration": 100,                                  // 帧时长 ms
      "pivot": { "x": 32, "y": 32 },                    // 原始画布像素；可落在被裁透明区
      "anchor": { "x": 0.5, "y": 0.5 },                 // 相对原始尺寸的归一化 0–1
      "nineSlice": { "left": 10, "right": 54, "top": 8, "bottom": 56 }, // 原始像素整数；可省略
      "atlasMeta": {                                    // 上述点换算到当前图集的只读结果
        "pivot": { "x": 26, "y": 24 },                  // = source - trim + frame
        "anchor": { "x": 26, "y": 24 },
        "nineSlice": { "left": 4, "right": 48, "top": 0, "bottom": 48 }
      }
    }
  },
  "meta": {
    "app": "sprite-atlas-studio",
    "version": "1.1.0",
    "image": "atlas.png",
    "size": { "w": 256, "h": 512 },
    "frameOrder": ["walk_01.png", "..."],   // 原始播放顺序
    "settings": { "trim": true, "padding": 2, "maxSize": 2048, "pot": true },
    "totalDuration": 950,
    "atlasDataURL": "data:image/png;base64,..."  // 可选：内嵌图集，JSON 可独立恢复
  }
}
```

旧版本（1.0.0，无 pivot/anchor）JSON 仍可导入，缺失值按原始画布中心与
`(0.5, 0.5)` 恢复。
