---
name: cocos-orchestrate-web-workflow
description: Use when starting, coordinating, resuming, or auditing a Cocos Creator 2D Web Mobile project workflow that spans requirements, visual production, implementation, editor integration, human verification, and local delivery.
---

# Cocos Web 工作流总控

## 核心原则

所有可独立执行的阶段工作都必须创建子代理，并由子代理调用对应阶段 Skill 完成实际实现；不得只把工作描述成“可编排的子代理任务”，也不得由总控替代子代理执行需求、设计、资源生产、编码、编辑器集成、浏览器验证或交付。总控只负责任务派发、结果验证和流程状态维护。将 `.cocos-workflow/workflow.yaml` 视为单写者状态：只有总控可以写入。

Never accept a child-agent result that only says completion; require artifacts, checks, and evidence.

## 启动步骤

1. 读取项目根目录和现有 Cocos Creator 项目信息。
2. 检查 `.cocos-workflow/`；不存在时按契约初始化，存在时校验后恢复，不猜测缺失状态。
3. 初始化或恢复活动任务、冻结版本、人工门禁和失效标记。
4. 调用 MCP 健康与能力发现接口，并保存本次运行的能力快照。
5. 依据当前状态只派发下一项允许的阶段任务。

离开 `bootstrap` 前，要求安全的项目相对 `.scene` 初始场景、非空 MCP 能力快照，以及可从 `bootstrap/pending` 连续回放到当前状态的 canonical 迁移记录。空迁移链只允许初始 `bootstrap/pending`。任何项目配置变化都必须同步重算配置哈希和项目配置门禁绑定；`approval_gates.project-configuration` 只使用 `status`、`approved_by`、`approved_at`、`subject_hash` 四个固定字段，禁止以 `artifact` 或 `content_hash` 替代。

## 路由表

| 状态 | 阶段 Skill |
| --- | --- |
| `bootstrap` | 总控自身完成目录初始化、项目配置门禁和 MCP 能力发现，不派发阶段 Skill |
| `requirements` | `$cocos-define-game` |
| `systems-design` | `$cocos-design-game-systems` |
| `technical-design` | `$cocos-define-technical-design` |
| `visual-direction` | 先派发 `$grilling` 全局视觉方向拷问并获得哈希绑定人工确认，再派发 `$cocos-freeze-visual-direction` |
| `planning` | `$cocos-plan-project` |
| `production` | 先派发核心玩法原型（`vertical_slice`：`$cocos-implement-game` 原型代码 → `$cocos-integrate-assets`，传入 `integration_mode=prototype` → `$cocos-verify-game` vertical-slice → 人工确认）；确认后才派发 `$cocos-implement-game` 的模块拆分/全局骨架，再按 `business_flow_levels` 从低到高编排正式 `scene_loop` 的 `$grilling` 场景功能边界拷问 → `$cocos-create-pencil-draft` → `$cocos-create-visual-concept` → `$cocos-generate-game-assets` / `$cocos-implement-game` → 人工评审；推进到 `is_core_gameplay` 场景时必须按正式版本实现；同级无冲突任务可并行，但 `visual-concept` 始终逐场景串行 |
| `integration` | `$cocos-integrate-assets`，传入 `integration_mode=release`，并绑定全部已批准场景资源清单 |
| `verification` | `$cocos-verify-game`，传入 `verification_mode=human-review` |
| `building` | `$cocos-deliver-web`，传入 `entry_mode=build` |
| `delivery` | `$cocos-deliver-web`，传入 `entry_mode=package` |
| `completed` | 不派发阶段 Skill；只审计最终证据 |

若对应 Skill 未安装或能力不足，将工作流标记为 `blocked`，不要由总控代做。

## 决策变更拷问门禁

仅当已批准的 `requirements`、`systems-design`、`technical-design` 或 `planning` 工件将发生决策性变更时，才在重派发该阶段前派发 `$grilling`。决策性变更指会改变目标、范围、规则、架构、约束、依赖或验收标准的变更；事实勘误、文案调整、资产执行、代码实现、验证和交付不得触发此门禁。

1. 先查找当前工件、任务输入和代码库，区分可验证事实与待用户决定的事项。事实不确定时先查证，不将其伪装成决策。
2. 对决策性变更创建只读 `$grilling` 任务，输入 `decision_change.stage` 与该变更材料的 `decision_change.subject_hash`，并将目标阶段保持为 `blocked`。
3. 只有 `$grilling` 返回用户明确确认、与输入匹配的 `grilling_confirmation` 后，才由总控写入 `approval_gates.grilling-<stage>` 并重派发目标阶段。确认记录的主题哈希、阶段、确认者、时间和项目内证据路径必须齐全。
4. 缺少确认、确认记录与变更哈希不匹配，或用户继续提出未决决策时，保留 `blocked`；不得产出或接受目标阶段的新工件。

该门禁不新增主状态，也不替代原有的人工审批门禁。它只约束上述四个阶段的决策性返工；首次没有 PRD 的需求澄清同样先派发 `$grilling`，随后才允许确认 PRD。

## 核心玩法优先门禁

进入 `production` 后，总控必须**先**派发并完成实施计划中的 `vertical_slice` 原型任务（核心玩法可玩确认），再允许模块拆分与正式场景循环。

1. 仅派发 `vertical_slice.task_ids` 中的原型任务：`core-gameplay-code` → `integration_mode=prototype` 串行集成 → 人工垂直切片试玩与审核 → `vertical-slice-review`。
2. 原型阶段不得要求 Pencil 草图、高保真效果图、模块拆分或全局骨架；占位/最小资源可接受。
3. 未获得 `artifacts/vertical-slice.md` 的 `passed` 状态与哈希绑定人工批准前，禁止派发 `module_decomposition`、`global_scaffold` 及任何正式 `scene_loops` 任务。
4. 核心玩法确认后，才进入模块划分与业务流等级推进；`review_mode` 不得豁免此顺序。

## 场景功能边界拷问门禁

每个正式 `scene_loop` 开始时、Pencil 草图创建前，总控必须为该场景派发一次只读 `$grilling` 任务。此门禁不依赖“是否发生决策性返工”，也不能由 `review_mode`、Pencil 草图、高保真图或最终人工评审替代。

1. 任务只拥有一个 `scene_id`，读取该场景的 `scene_blueprint`、需求、系统设计、技术设计、冻结视觉方向和实施计划；输出 `artifacts/scene-boundaries/<scene_id>.md`。
2. 拷问必须将场景目的、进出条件、玩家动作、UI 状态、数据输入/输出与持久化、模块/事件/节点边界、失败与空态、返回路径、非范围和验收标准逐项落实；任何功能必须归属到一个稳定场景或明确下沉至全局模块。
3. 只有用户明确确认、`scene_boundary_confirmation.subject_hash` 等于边界工件 `content_hash` 且未决问题为空时，才接受为 `approved`。总控记录 `approval_gates.scene-boundary-<scene_id>` 的哈希绑定批准。
4. Pencil 草图、高保真图、资源准备、正式代码、绑定清单、集成和人工验证都必须携带同一场景边界工件哈希；缺失、过期、不匹配或未批准时保持 `blocked`。原型 `vertical_slice` 不进入本门禁，后续正式核心玩法场景仍必须进入。

## 业务流等级门禁

核心玩法确认通过后，读取已批准实施计划的 `business_flow_levels`。总控只派发当前最低未完成等级的任务，并将任务中的 `business_flow_level` 与计划一致地写入任务记录。

1. 同一等级仅可派发无共享写路径且已满足显式依赖的任务；Cocos Editor 写入仍必须串行。
2. 等级大于 `1` 时，必须先验证前一等级全部 `completion_task_ids` 的结果均为 `passed`，其证据、输入哈希和验收检查均有效。
3. 前一等级有 `failed`、`blocked`、`stale`、缺失结果或未通过退出检查时，保留后续等级任务为 `blocked`，不得提前派发、接受结果或写入集成状态。
4. 模块、页面/场景循环、任务等级或依赖与计划不一致时，拒绝该任务并将 planning 标记为 `stale`；不得靠调整任务顺序绕过等级门禁。
5. 当派发到 `is_core_gameplay: true` 的正式场景循环时，必须按正式版本执行完整小循环，用正式实现替换原型，不得把原型当作交付物。

## 视觉质量门禁

进入视觉冻结前，总控必须先派发唯一的只读 `$grilling` 全局视觉方向拷问任务，输出 `artifacts/visual-direction-brief.md`。工件必须覆盖目标用户与体验、原画/UI 风格、商业品质基准、统一视觉语言、颜色/字体/图标/材质/光影/动效边界、两张质量锚点职责、克制与焦点预算、设备与性能限制、禁止元素、全局不变量、场景可变量和人工验收标准；只有用户确认与人工审批都绑定当前 `content_hash` 且未决问题为空，才能派发 `$cocos-freeze-visual-direction`。

冻结视觉方向必须消费并绑定已批准的全局视觉方向拷问工件，同时包含完整的 `game_art_system`、`ui_system`、商业基准、颜色 token、克制/发散预算和功能 UI 规则，以及职责分别为 `game-art-quality-anchor` 和 `ui-system-quality-anchor` 的两张参考图。效果图严格按实施计划中的 `scene_loops` 顺序逐场景推进：任意时刻最多一个活动 `visual-concept` 任务；当前场景最终图通过质量门槛并获得哈希绑定人工批准后，才能派发下一个场景的效果图任务。禁止一次派发多个页面、整套页面生成或多页面拼图。

单场景结果必须证明：至少三个实质不同的原画候选、候选评审、可编辑 UI 源、真实文案清单、至少一轮缺陷驱动精修、全部捕获视口证据和最终图人工批准。候选仅允许探索同一个场景，不构成批量页面生成。

总控验收 `scene-concepts/<scene_id>.md` 时，必须拒绝以下情况：任务包含多个 `scene_id`、修改其他场景目录、存在多页面拼图、任一质量维度低于 4、平均分低于 4.5、克制/发散 profile 缺失或超预算、阻塞缺陷非空、缺少可编辑 UI/真实文案、最终审核未绑定 `final_image_hash`、使用生成伪文字，或候选/精修/视口证据不存在。视觉质量门槛属于 P0，不允许通过 `review_mode` 或人工豁免跳过。

## 人工门禁

在项目配置、需求、系统设计、技术设计、全局视觉方向拷问、视觉冻结、实施计划、核心玩法垂直切片、场景功能边界、Pencil 场景/UI 草图、高保真场景效果图、人工验证和交付各门禁处记录明确的人工批准及其版本。技术设计与实施计划还必须分别批准每个场景的节点/组件结构与可执行 `scene_blueprint`；场景根、运行时根、Canvas/UI 根、游戏内容根及条件 UI/安全区/相机/输入节点的稳定 ID、父子关系、组件和读回断言不完整时，禁止派发正式代码或全局集成。视觉阶段必须先执行 `全局视觉方向拷问 → 视觉冻结`；拷问工件未获哈希绑定用户确认和人工审批前，不得生成视觉规范或质量锚点。生产阶段顺序为：先核心玩法原型确认，再模块拆分与全局骨架，再按单场景正式循环执行 `场景功能边界拷问 → Pencil 草图 → 高保真效果图 → 资源/代码 → 人工评审`，待全部循环完成后再执行全局 `集成 → 验证`；不得要求其他场景先完成设计，也不得在玩法未确认前启动正式模块划分。场景边界未通过用户确认不得进入 Pencil 草图；高保真图必须绑定已批准边界、冻结视觉版本、内容哈希、两张全局参考效果图、颜色 token、克制/发散 profile、功能 UI 规则和通过的质量评分，任一项缺失或超预算均不得进入资源/代码。任何局部视觉变更均须返回全局视觉方向拷问并产生新的视觉冻结版本。Never advance past an approval gate without explicit human approval.

项目配置的 `review_mode` 仅可为 `full` 或 `lean`：`full` 在每次设计、技术、视觉与生产交接时追加领域审查；`lean` 只在阶段交接时追加审查。两者都不得跳过哈希绑定的人工审批、视觉质量 P0、其他 P0 或核心玩法垂直切片门禁，禁止 `solo` 模式。

## 子代理规则

阶段工作一旦满足派发条件，总控必须创建子代理实施，并向子代理提供对应 Skill、明确输入、允许写入路径、预期工件、验收检查和证据要求；总控不得止于输出任务清单、建议后续派发或模拟子代理结果。只有 `workflow.yaml` 初始化、状态迁移、结果验收与门禁判断由总控亲自执行。

只并行没有共享写入面且依赖已经满足的独立子代理任务。允许分析、检查和资源准备并行；效果图生成即使路径不冲突也必须逐场景串行；所有 Cocos Editor 写入必须排队，每个批次只允许一个明确的子代理写入者执行，并在批次结束后读回验证。Never allow two agents to write through the same Cocos Editor concurrently.

## 状态变更

要求阶段返回契约规定的工件、检查和证据。总控验证路径所有权、验收检查、依赖、冻结版本与内容哈希后，才写入 `workflow.yaml` 并执行允许的状态迁移。Reject and mark stale any result whose frozen version or content hash does not match the active workflow.

## 失败处理

- **重试**：瞬时故障且输入仍有效时，记录尝试次数并执行 `failed → retrying → running`。
- **修复**：可定位的实现或检查失败时，生成限定路径的修复任务；通过原验收检查后再返回原状态。
- **阻塞**：缺少人工批准、必需输入、阶段 Skill 或 MCP 能力时，进入 `blocked` 并记录解除条件。
- **严重失败**：发现越权写入、并发编辑器写入、状态文件损坏或不可确认的破坏性操作时，立即停止写入，保留证据并请求人工处置。

## 引用路由

- 创建任务、接收结果或读写状态前，读取 [workflow-contracts.md](references/workflow-contracts.md)。
- 判断进入条件、迁移或失效范围前，读取 [state-machine.md](references/state-machine.md)。
- 任何 MCP 写入前，读取 [mcp-safety-policy.md](references/mcp-safety-policy.md)。
