---
name: cocos-orchestrate-web-workflow
description: Use when starting, coordinating, resuming, or auditing a Cocos Creator 2D Web Mobile project workflow that spans requirements, visual production, implementation, editor integration, Chrome verification, and local delivery.
---

# Cocos Web 工作流总控

## 核心原则

只编排阶段 Skill、验证阶段结果并维护流程状态，不替代任何阶段 Skill 执行需求、设计、资源生产、编码、编辑器集成、浏览器验证或交付。将 `.cocos-workflow/workflow.yaml` 视为单写者状态：只有总控可以写入。

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
| `visual-direction` | `$cocos-freeze-visual-direction` |
| `scene-concepts` | `$cocos-create-visual-concept` |
| `planning` | `$cocos-plan-project` |
| `production` | 按 `business_flow_levels` 从低到高编排每个 `scene_loop` 的 `$cocos-create-pencil-draft` → `$cocos-create-visual-concept` → `$cocos-generate-game-assets` / `$cocos-implement-game`；仅在当前等级、依赖已通过且路径所有权无冲突时并行 |
| `integration` | `$cocos-integrate-assets` |
| `verification` | `$cocos-verify-game` |
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

## 业务流等级门禁

进入 `production` 前读取已批准实施计划的 `business_flow_levels`。总控只派发当前最低未完成等级的任务，并将任务中的 `business_flow_level` 与计划一致地写入任务记录。

1. 同一等级仅可派发无共享写路径且已满足显式依赖的任务；Cocos Editor 写入仍必须串行。
2. 等级大于 `1` 时，必须先验证前一等级全部 `completion_task_ids` 的结果均为 `passed`，其证据、输入哈希和验收检查均有效。
3. 前一等级有 `failed`、`blocked`、`stale`、缺失结果或未通过退出检查时，保留后续等级任务为 `blocked`，不得提前派发、接受结果或写入集成状态。
4. 模块、页面/场景循环、任务等级或依赖与计划不一致时，拒绝该任务并将 planning 标记为 `stale`；不得靠调整任务顺序绕过等级门禁。

## 人工门禁

在项目配置、需求、系统设计、技术设计、视觉方向、Pencil 场景/UI 草图、高保真场景效果图、实施计划、垂直切片、视觉验证和交付各门禁处记录明确的人工批准及其版本。生产阶段按单场景循环执行 `Pencil 草图 → 高保真效果图 → 资源/代码 → 集成 → 验证`，不得要求其他场景先完成设计。高保真图必须绑定冻结视觉版本、内容哈希和两张全局参考效果图，任何局部视觉变更均须返回视觉冻结。Never advance past an approval gate without explicit human approval.

项目配置的 `review_mode` 仅可为 `full` 或 `lean`：`full` 在每次设计、技术、视觉与生产交接时追加领域审查；`lean` 只在阶段交接时追加审查。两者都不得跳过哈希绑定的人工审批、P0 或垂直切片门禁，禁止 `solo` 模式。

## 子代理规则

只并行没有共享写入面且依赖已经满足的独立任务。允许分析、检查和资源准备并行；所有 Cocos Editor 写入必须排队，由一个明确的写入者按批次执行并在每批之后读取验证。Never allow two agents to write through the same Cocos Editor concurrently.

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
