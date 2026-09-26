# Sprite Atlas Studio

游戏美术本地序列帧 → 精灵图集工具。**纯 Web、纯本地**：所有图片处理都在浏览器内完成，不上传任何数据。

## 功能

- **导入 PNG 序列帧**：文件选择或拖拽，保持导入顺序（可拖拽/按钮调整）
- **帧时长**：逐帧设置毫秒数，或一键应用到全部帧
- **透明边缘裁切**：按 alpha 通道计算包围盒，记录 `spriteSourceSize` 偏移
- **统一留白**：每帧四周固定像素留白（打包时把矩形放大 `padding*2` 后排布，内容居中）
- **帧元数据（pivot / anchor / 九宫格）**：在**原始未裁切画布**上用数值输入或预览拖拽设置；
  一律以原始图像坐标系存储（原图左上角原点、单位像素），与裁切/留白/打包布局无关——
  重新裁切、修改留白或重新打包都不会改变它们在原图中的位置；
  pivot/anchor 可位于被裁掉的透明区；九宫格边界不得落到原图之外或相互交叉，非法输入被阻止并保留上次有效值；
  打包时自动换算为裁切 + 留白后的图集坐标并实时显示
- **矩形打包**：maxrects-packer，**固定方向不旋转**，图集尺寸支持 POT（2 的幂）
- **动画预览**：PixiJS 按原始顺序与每帧时长循环播放；从图集取子纹理并按裁切偏移摆放（等同引擎行为），实时显示当前帧在图集中的位置/尺寸
- **图集视图**：编号框标注每帧位置，表格列出 x/y/w/h、裁切偏移、原始尺寸、时长
- **导出**：`atlas.png` + `atlas.json`（TexturePacker Hash 兼容结构，扩展 `duration` / `frameOrder` / `settings` / `pivot` / `anchor` / `nineSlice`；可内嵌图集 dataURL）
- **导入 JSON 恢复**：从导出的 JSON 完整恢复帧列表、顺序、时长、元数据与打包结果（图集内嵌时无需另选图片；否则连同 `atlas.png` 一起选择）
- **IndexedDB 持久化**：帧 PNG（Blob）、每帧元数据、设置与打包结果自动保存到浏览器本地，刷新后恢复

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
npm test           # vitest：单元（裁切/打包/计时/元数据/序列化）+ 集成（真实 PNG 全管线）
npm run e2e        # Playwright：浏览器全流程（导入→打包→预览→导出→导入 JSON 恢复→刷新恢复）
```

集成测试（`tests/integration/pipeline.test.ts`）用真实 PNG 验证：

- 裁切包围盒与生成素材的透明边缘完全一致
- 图集中每帧内容位置、统一留白（四周透明像素）
- 导出 JSON → 重新导入后帧列表/顺序/时长/位置尺寸完整恢复，且恢复帧与原图**逐像素一致**
- 预览计时：按每帧时长推进的帧序与解析式 `frameIndexAt` 一致
- 元数据：四周透明边不同的帧换算正确；pivot 落在被裁掉的透明区仍可表达；
  导出 → 导入 → 重打包后预览对齐、九宫格边界与 pivot/anchor 数值完全一致；
  修改留白只改变图集坐标，原始图像坐标不变

## JSON 格式

```jsonc
{
  "frames": {
    "walk_01.png": {
      "frame": { "x": 2, "y": 2, "w": 42, "h": 48 },   // 图集中的位置与尺寸
      "rotated": false,                                 // 固定方向，恒为 false
      "trimmed": true,
      "spriteSourceSize": { "x": 8, "y": 10, "w": 42, "h": 48 }, // 裁切偏移
      "sourceSize": { "w": 64, "h": 64 },               // 原始尺寸
      "duration": 100,                                  // 帧时长 ms
      "pivot": { "x": 4, "y": 5 },                      // 原始图像坐标系（可位于被裁掉的透明区）
      "anchor": { "x": 60, "y": 61 },                   // 原始图像坐标系
      "nineSlice": { "left": 10, "right": 50, "top": 12, "bottom": 52 } // 原始图像坐标系；null 表示不可拉伸
    }
  },
  "meta": {
    "app": "sprite-atlas-studio",
    "version": "1.1.0",
    "image": "atlas.png",
    "size": { "w": 256, "h": 512 },
    "frameOrder": ["walk_01.png", "..."],   // 原始播放顺序
    "coordinateSpace": "source-image",      // pivot/anchor/nineSlice 坐标系：各帧原始未裁切图像左上角原点、单位像素
    "settings": { "trim": true, "padding": 2, "maxSize": 2048, "pot": true },
    "totalDuration": 950,
    "atlasDataURL": "data:image/png;base64,..."  // 可选：内嵌图集，JSON 可独立恢复
  }
}
```

**坐标系约定**：`pivot` / `anchor` / `nineSlice` 一律基于该帧**原始未裁切图像**（尺寸见 `sourceSize`），
不随裁切、留白或打包布局变化。需要图集坐标时按下式换算：

```
atlasX = frame.x + (sourceX - spriteSourceSize.x)
atlasY = frame.y + (sourceY - spriteSourceSize.y)
```

点位于被裁掉的透明区时，换算结果可能落到内容框外（甚至为负），属正常且可无损往返。
