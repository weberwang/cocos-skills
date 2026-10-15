---
name: cocos-spine-generative-reskin
description: 对 Cocos Creator 3.x Spine 资产执行可审计的 schema v3 换皮、Skeleton 结构审计、逐批人工锁定、Atlas 重建与真实 Cocos 运行验证。
---

# Cocos Creator 3.x Spine 生成式换皮

本 Skill 只在已授权的 Cocos Work Item 内使用。它保留原 Skeleton、Attachment、锚点、Atlas Region 几何和 Mesh UV 语义；候选资源始终在独立诊断目录中验证，未通过运行态门前不得接入主游戏。

Creator 资源、`sp.Skeleton` 组件、Scene/Node/Prefab、AssetDB 和构建操作遵循[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)，并按实时 `tools/list` schema 调用；不得手写 `.meta`、`.scene` 或 `.prefab` 绑定。同一 Creator 项目保持唯一活动写入者。当前 MCP 的构建/预览能力不等于真实构建/运行；没有真实 Runtime 证据时，受影响验证保持 pending/blocked。

`target_runtime` 必须取自目标项目实际启用的 `sp.SPINE_VERSION` 分支，而不是 Creator 项目版本号。核对项目配置中的 Spine feature（Creator 3.8.6 源码包含 `spine-3.8` 与 `spine-4.2` 两个 feature）及真实解析证据；`creator_version` 单独记录项目实际 Creator 引擎版本。3.8 分支的导出限制只适用于该分支，不把它推广到 4.2 或所有 Creator 3.x 版本，也不以项目版本号推断 Spine Runtime。[Creator 3.8.6 feature 配置](https://raw.githubusercontent.com/cocos/cocos-engine/v3.8.6/cc.config.json)

## 入口

```powershell
node <skill-dir>/scripts/spine_reskin_progress.mjs --help
```

正式原版目录可用 `inspect --asset-dir <原版资源目录>` 或 `init --asset-dir <原版资源目录>`；独立 Skeleton/Atlas/Page 会直接审计，Cocos `sp.SkeletonData` 的 `_atlasText`/`_skeletonJson` 会先导出到独立规范化候选目录，绝不改写源目录。`init` 必须同时传入控制面 manifest，绑定 Work Item、production contract 和适用的 V2 方案证据。

进度清单必须是 schema v3。所有会修改清单的命令使用跨进程锁和原子写入；禁止手动编辑状态伪造完成。详细规则见：

- [Skeleton 审计与升级](references/skeleton-upgrade.md)
- [批次计划与人工锁定](references/batch-review.md)
- [运行态验证与最终交付](references/runtime-validation.md)
- [状态、恢复与锁](references/progress-state.md)
- [Atlas 重建](references/atlas-rebuild.md)

## 固定流程

1. `inspect` 读取 Skeleton JSON 与 Atlas，输出版本、Bone、Slot、Skin、Attachment、Mesh、Animation、Page、Region 统计、attachment path 映射和 Mesh 顶点/三角形/UV 稳定哈希。
2. `init` 建立 schema v3 清单，读取真实源文件，SHA-256 仅作可选追踪。低于目标 Runtime 时只接受外部官方工具生成的候选，使用 `upgrade-check` 比较结构投影；未通过目标 Runtime 解析证据前，任何批次命令都会阻断。
3. `freeze-contract` 冻结角色名、目标 Runtime、暗黑视觉方向、六项色板、材质语言、光向和默认 `strict_alpha=true`。首批前不得使用临时色板。
4. `plan-batches` 导入精确 Region 顺序、mode、alpha lock 和可选连续特效序列，机器校验全集覆盖、无重复/遗漏、Mesh 使用 `mesh-safe` 且锁 Alpha。
5. 按 `batch prepare → mark generated → batch review → 停止 → batch accept` 执行。`batch accept` 核对当前批次 revision、实际候选、审阅图和人工确认，不要求提供或比较 SHA/fingerprint；在刚展示且由 `--batch` 明确指定的审阅上下文中，简短“确认”即可通过，也可使用当前批次对应的完整确认句（初始批次“确认第N批”、返工“确认重启版第N批”）。空白、无关或否定文本仍拒绝。回执是 V3 正式资源生产中的局部 `spine_batch_acceptance`，不是全局第二次视觉审批。返工使用 `batch reopen` 增加 revision，只影响当前批。
6. 所有批次 `ACCEPTED+locked` 后执行 `pack`。默认且正式固定 `padding=0`、`extrusion=0`，Page 名必须保持原名并且实际为 PNG；Atlas Page/Region 间空行格式由序列化器固定。
7. 使用 `runtime-validate` 提交 `cocos-spine-runtime-validation/2.0` 报告：绑定真实已启用的 `sp.Skeleton` 组件和其 `SkeletonData` UUID，从 `sp.Skeleton.skeletonData` 读取完整动画集；另绑定实际 `sp.SPINE_VERSION` 解析证据、Idle 循环、纹理/锚点/Mesh/闪烁/裁剪检查、诊断 URL、浏览器日志及桌面和约 390px 移动证据。Creator 版本与 Spine Runtime 版本分别记录。只有当前 Creator/Runtime 实际运行结果齐备才可通过；没有经核实的 Preview/运行能力时保持 pending/blocked，不用构建面板或 worker ready 代替。通过后才能 `finalize`，最后用 `report` 生成最终交付报告。

## 状态硬门

Cell 状态固定为：

```text
pending → generating → generated → validating → packing → packed → runtime_validating → completed
```

正式 Cell 必须是实际 PNG、含 Alpha、尺寸等于正向 Atlas Region；`alpha_lock=true` 时 Alpha 掩码像素级一致，Mesh 永远锁 Alpha。`constrained-redraw` 只有显式 `alpha_lock=false` 才允许使用。

## 全局视觉与批次确认边界

全局视觉阶段、状态和确认规则以 `cocos-game-workflow-control` 的[控制模型](../cocos-game-workflow-control/references/control-model.md)、[状态与门](../cocos-game-workflow-control/references/state-gates.md)及 Schema 为准。Spine 换皮中的方案提议、审查或审阅、批次锁定都必须在当前用户任务的既有 Work Item 范围内完成；本 Skill 只修改自身候选工件，不自行扩展任务范围或创建全局审批。任务内范围、方案或路径变化同步更新计划并重验受影响部分；需要改变产品方向、视觉方向或接入主游戏时，回到控制面重新审查。Spine 批次确认属于 V3 正式资源生产中的局部锁定回执，不进入 Approval Ledger，也不改变场景 V2 的拆解与布局确认。
