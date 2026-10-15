# Spine Atlas 重建约束

## Page 与 Region 输入审计

- 一个 `.atlas` 可包含多个 Page；每个 Page 以图片名和 `size/format/filter/repeat/pma/scale` 等字段开始，后面列出 Region/Cell。
- 初始化必须核对 Page 声明尺寸与实际图片尺寸。Page 名称、同 Page Region 名称不能重复；Region `xy/size` 必须为正整数并完全位于 Page 内。
- 同一 Page 的 Region 矩形不得有面积交集。`orig` 必须为正数；`offset` 不得为负，且 `offset + 正向 size` 不能超出 `orig`。
- `bounds: x,y,w,h` 与 `offsets: offsetX,offsetY,origW,origH` 等价于传统字段；未知字段和字段顺序保留到输出 Atlas。
- Page 名必须保留原始字符串且实际扩展名为 `.png`；源 Page 为非 PNG 或与 PNG 输出冲突时初始化直接失败，禁止静默改名。

## trim、offset 与 rotate

正式 Cell 只接受已经裁剪到 Atlas Region 正向 `size`（两个维度均为正数）的透明 PNG；Cell 输入不得提供或依赖 `orig`、`offset` 或额外画布，相关字段一律拒绝，不在正式流程中替代裁剪、缩放或猜测尺寸。Atlas 的 `orig/offset` 仅作为重建文本语义保留。

Atlas 中 `rotate: true` 通常表示矩形顺时针旋转 90° 存放；数值旋转只接受 90° 倍数。生成图先按正向尺寸裁剪，再由打包器旋回 Atlas 方向，输出仍使用原 `xy/size`，所以 Skeleton 与 Mesh UV 不需改动。

## 透明空白 Page、padding 与 extrusion

每个新 Page 必须从与原 Page 相同尺寸的全透明 RGBA 画布开始。只能粘贴对应生成图，不能复制源 Page、源 Cell 或任何非 Region 像素；未被 Cell 覆盖的像素保持透明。

正式换皮固定使用 `padding=0`、`extrusion=0`。两者不能扩展矩形或移动 Region；若底层命令收到非零值必须 fail closed。无论输入尺寸如何，都要校验 `extrusion <= padding`，不允许静默忽略参数。

## PMA 与格式

Page `pma: true` 时，把 straight-alpha RGB 按 `rgb = rgb * alpha / 255` 预乘一次；完全透明像素的 RGB 清零。`pma: false` 保持 straight alpha。新 Page 内容必须真实编码为 PNG，不能只改扩展名。

## 受约束换皮结果

- `constrained-redraw` 保留方向、锚点、轮廓、尺寸和 UV 语义，重做配色、材质、明暗与装饰。
- `palette-refresh` 仅作低改动色板/材质调整。
- `mesh-safe` 锁定 Mesh 顶点顺序、变形关键点、连接点和透明边缘。

先通过保守基线覆盖全部动画，再增强刚体主体。生成图路径必须在候选目录内；源参考只能用于轮廓、比例、蒙版与结构审阅，不能成为结果像素或失败回退。

工具将 alpha 合同阈值固定为：`alpha_lock=true` 或 `palette-refresh` 掩码差异 `0`；`mesh-safe` IoU 至少 `0.85` 且包围盒漂移不超过 `0.10`；`constrained-redraw` 仅显式 `alpha_lock=false`，IoU 至少 `0.45` 且质心漂移不超过 `0.35`。正式 Cell 比较正向 Region 尺寸。

## 输出提交与恢复

`pack --force` 会把旧输出目录重命名为带随机后缀的备份，再将阶段目录重命名为正式目录；任何阶段失败都尝试恢复备份。输出目录不得等于或成为源 Atlas、Page、Skeleton、清单、生成图和证据的祖先，也不能通过符号链接绕过保护。

完成前必须验证：

1. 每个 Page 的尺寸、顺序和 PNG 文件存在；
2. 每个 Region 的名称、`xy/size/orig/offset/rotate/index` 与源一致；
3. 所有生成图、源参考、审阅证据、运行态证据和输出 Atlas/Page 按实际路径、批次和任务归属核对，不要求哈希绑定；
4. Cocos 运行态加载所有 Skin、Attachment、动画和 Mesh 变形无缺图、错位、翻转、PMA 黑边或 UV 断裂。
5. Atlas 文本中 Page Header 与第一个 Region、同 Page Region 之间无空行；仅不同 Page 之间保留一个空行。
