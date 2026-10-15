# 进度清单 Schema v3 与状态机

工具写入 `schema_version: 3`，不兼容旧版清单。清单根对象至少包含：

- `atlas.path/sha256/pages[]`：源 Atlas 与每个源 Page 的路径、SHA-256、声明尺寸、原始字段和 `output_name`。
- `skeletons[]`：一个或多个 `{path}`，实际文件初始化时必须存在；sha256仅作可选追踪。
- `target_runtime`、`skeleton_audit`、`source_audit`、`skeleton_upgrade`：版本、结构统计、attachment path 映射、Mesh 指纹、升级候选与未知变更。
- `asset_input`、`control_binding`：原版目录/独立导出或 Cocos 容器来源，以及 Work Item、production contract、适用 V2 方案证据的实际路径；SHA 仅作可选追踪。
- `visual_contract`：角色、方向、六项统一色板、材质语言、光向、`strict_alpha` 和冻结时间。
- `batches[]`：精确 Region 顺序、mode、alpha lock、revision、审阅板哈希、候选 fingerprint、V3 正式资源生产中的 `spine_batch_acceptance` 和 `ACCEPTED+locked` 状态。
- `style_references[]`：`{path, sha256}`；不存在或漂移会阻止重建。
- `cells[]`：稳定 `id/name/page_index/xy/size/orig/offset/rotate/index`，以及 attachment 类型、Mesh 哈希、`batch_id`、`alpha_lock`、`mode`、生成图哈希、源结构参考哈希、审阅证据、状态历史和重试次数。
- `packing`：`padding/extrusion`；`build`：重建 Atlas/Page 路径、哈希和阶段；`runtime_evidence[]`：运行态证据路径与哈希。

## Alpha 结构合同

正式 Cell 必须是实际 PNG、含 Alpha、尺寸等于正向 Atlas Region。验证按 alpha 掩码计算差异；`alpha_lock=true` 时像素级差异必须为 0。固定阈值为：

- `palette-refresh`：可见 alpha 掩码差异必须为 `0`。
- `mesh-safe`：alpha IoU `>= 0.85`，且包围盒最大边界漂移 `<= 0.10`（按宽高归一化）。
- `constrained-redraw`：只有显式 `alpha_lock=false` 才可用；alpha IoU `>= 0.45`，且 alpha 质心最大漂移 `<= 0.35`（按宽高归一化）。

这些阈值用于防止严格换色模式改变轮廓、Mesh 安全模式破坏关键范围，以及受约束重绘发生方向性整体漂移。

## 状态

正常路径是：

```text
pending -> generating -> generated -> validating -> packing -> packed
                                                        -> runtime_validating -> completed
```

`mark` 只能写 `pending/generating/generated/failed`，不能手工伪造 `validating/packed/runtime_validating/completed`；存在批次计划时只能写当前批。正式 `batch accept` 在审阅图和候选 SHA 通过后推进当前批 Cell 到 `validating` 并锁定批次；`pack` 要求全部批次 `ACCEPTED+locked`，成功只进入 `packed`；`runtime-validate` 先通过结构化 Cocos 报告，`finalize` 才推进运行态闭环。

`failed` 只能回到 `pending` 或 `generating`，不能直达 `generated`。`completed` 是终态；需要重新换皮时使用 `batch reopen` 仅重开当前批并增加 revision。`recover` 会把未锁定批次中断遗留的 `generating/validating` 退回 `pending`、把 `packing` 退回 `validating`、把 `runtime_validating` 退回 `packed` 并追加恢复事件；已 `ACCEPTED+locked` 批次的 `validating` Cell 保持原状态，以便直接继续后批或 pack。

## 哈希与锁

每个写清单命令都会先创建 `<progress>.json.lock` 的独占文件锁。锁有固定等待上限，并在超过陈旧阈值后回收；JSON 临时文件名包含进程号和随机 UUID。状态、结果哈希、证据哈希和历史事件通过临时文件写入后原子替换。

`pack/finalize/verify` 核对源 Atlas、全部源 Page、全部 Skeleton、升级后 Skeleton、style reference 和源 Cell 结构参考的实际文件及适用内容。生成图必须位于候选目录内且不能是源 Page、Skeleton、源 Cell 参考或受保护证据的路径。所有审阅证据与运行态证据都必须是候选目录内的真实文件。验收不要求或比较 SHA；摘要核对留到最终人工验收后。

## 完成不变量

1. 所有 Cell 都是 `completed`，且模式属于 `palette-refresh`、`mesh-safe`、`constrained-redraw` 之一。
2. 每个生成图、源参考、审阅证据和运行态证据都存在且实际内容满足对应要求，不比对 SHA-256。
3. 源 Atlas/Page/Skeleton/style reference 未漂移；重建 Atlas 和每个 PNG Page 文件可读取，摘要不参与验收。
4. Atlas Page 尺寸、顺序、Region 名称、坐标、trim/orig/offset/rotate/index 与源保持一致。
5. Page 未覆盖的区域保持透明，且没有从源 Page 回退的像素。
6. `runtime_validation.status=PASS` 的结构化报告绑定本次 build 的 Atlas/Skeleton/Page/批次指纹、目标 Runtime、完整动画切换、URL、桌面/390px 移动证据、Runtime 原始日志、validation run ID 及 SHA；最终报告明确 `independent-validation-candidate` 或 `integrated-main-game`。
