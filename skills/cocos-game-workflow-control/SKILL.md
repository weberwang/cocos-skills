---
name: cocos-game-workflow-control
description: Cocos Creator 3.x 游戏仓库的唯一全局工作流控制面；按当前任务范围和确定性风险分类处理本地工作，并仅对带副作用的 A4-A6 操作及影响保留精确显式批准。
---

# Cocos Creator 3.x 全局工作流控制

本 Skill 是 Cocos 项目的唯一状态、风险门、任务范围和证据控制面。普通任务直接依据当前用户指令，领域 Skill 可在 Work Item 范围内迭代，完成后回到本控制面；非 Cocos 操作不进入本流程。普通任务不要求独立 taskAuthorization、授权记录或 F0 授权有效门；无副作用本地 A4 可按任务执行，带副作用的 A4-A6 操作仍保留逐对象批准。

Creator 编辑器、AssetDB、Scene/Node/Component、Prefab、构建和预览操作统一遵循[Creator MCP 协议](references/cocos-mcp-protocol.md)，按当次 `tools/list` 的 schema 调用；不手写 `.scene`、`.prefab` 或 `.meta` 绑定。当前 MCP 对构建/预览的能力边界与真实证据要求以该协议为准。

## 最短主闭环

弹窗类瞬态显示层按[独立工作项规则](references/control-model.md#弹窗工作项与场景解耦)规划、实现和验收；`hostSceneId` 仅绑定运行上下文，不表示归属。场景只闭环自身玩法、画面和常驻 HUD，弹窗未完成不阻断场景 V4，也不属于大厅或其他宿主场景的实现范围。

用户日常按 [`simplified-workflow.md`](references/simplified-workflow.md) 的六阶段项目视图理解进度：需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布。单场景视觉任务在逐场景生产内按场景定义 → 拆解与布局确认 → 正式资源验收 → 正式还原与运行验收推进。

1. 读取当前 Work Item，记录用户原文、目标、范围、基线和验收边界；任务内修改时同步更新计划。
2. 按当前阶段读取必要 reference，运行 `run` 或 `check`；缺少事实时先通过代码、配置、现有工件及已授权的验证查明。只有剩余问题涉及无法合理推断的实质用户取舍，才提出精确问题；可独立推进的工作继续执行。
3. A3 实施前冻结实施包；实施单元、执行状态、视觉证据和文件所有权必须可复核，任务内路径、方案或资源清单变化可更新该包。
4. 实施后记录候选变更审计，先推荐测试等级、理由、覆盖和命令，再自动执行定向验证并提交当前候选证据；所有任务逐一按[实际完成情况](references/control-model.md#按实际完成情况验收)判断验收，已满足当前要求时不以回改历史合同作为完成前置。
5. 失败只按证据选择 `repair`、`revalidate` 或必要的 `return`；不得自动回滚共享工作区、扩大范围或重复已确认事实。
6. 阶段任务满足验收条件后，由执行代理按下述“阶段收尾与 Git 提交”自动提交本次任务改动，再交接下一阶段。

## 阶段收尾与 Git 提交

- 阶段验收后需要清理本任务临时文件时，使用 [`cocos-game-artifact-cleanup`](../cocos-game-artifact-cleanup/SKILL.md) 核对引用与再生成条件后执行；用户要求历史记录或中间产物清理时也路由到该 Skill。保留有效证据和审计链，不因记录失效、任务终态或 Git 忽略自动删除；清理范围与风险仍由本控制面管理。
- 每个阶段任务完成并通过适用验证后，执行代理自动在当前分支创建本地 Git 提交，无需再次询问；不自动创建分支、worktree 或推送远端。`run`、`check` 和状态迁移命令本身不执行 Git 提交。
- 任务开始时记录已有工作区和暂存区改动；阶段收尾按[最小 Git 提交集](references/minimal-git.md)和[产物存放与证据边界](../cocos-game-architecture/references/artifact-storage.md)核对实际 diff、文件所有权和当前 Work Item 的真实引用，逐层收齐恢复当前工作所需的文件。Creator 正式 `assets/` 资源与对应 `.meta` 必须一并保留；`settings/`、`profiles/`、必要的 `native/` 与 `extensions/` 源配置保持可跟踪。按 Creator 工程约定忽略 `library/`、`temp/`、`local/`、`build/`、`cache/` 等可再生成目录，不整体忽略源码或正式资源。禁止无差别 `git add .` 或 `git add -A`；同一文件混有他人改动时按块隔离，无法可靠分离则保留现场并报告阻塞，不夹带已有暂存内容。
- 提交前将最小忽略模板合并到项目 `.gitignore`：`output/`、根级 `evidence/`、`docs/`、源素材和 `.workflow-control/` 默认忽略文件并保持父目录可遍历，再按真实引用逐文件放行；不能整体放行某个工作项或产物目录。用户确认账本和回执实际位于 `.workflow-control/user-resolutions/`，沿用此路径，不另造控制目录。人工作业 `evidence/<workItemId>/reviews/` 与 `validation/` 不等于机器 `evidenceRoot`；受 `evidenceRoot` 限制的字段只能引用对应 Work Item 实际配置根目录中的文件。本地秘密配置与凭据不入库。将必要 `.gitignore` 修改纳入提交，并逐文件用 `git check-ignore --no-index` 检查最终规则；不得用宽泛规则掩盖未完成工作。
- `.gitignore` 不会取消已跟踪文件的跟踪；仅对确认属于本次任务且不应入库的产物移出索引并保留本地文件，不批量清理其他历史文件，不强制添加被忽略的秘密配置。
- 提交前检查选定差异与暂存内容，使用简洁中文提交说明；提交后核对提交包含的文件和剩余工作区状态，报告提交哈希、验证结果及未提交项。没有本次可提交差异时跳过空提交。验证失败、提交失败或文件归属不明时报告原因，不宣称收尾完成，不跳过 Git 钩子或自动回滚。

## 渐进式读取

- 只做路由或状态查询：读取本文件与 `references/control-model.md` 的相关段落。
- 需要状态迁移或门判断：再读取 `references/state-gates.md`。
- 需要工件字段：按命令读取对应 `references/*.schema.json`，不要预加载全部 Schema。
- 需要视觉任务：读取 `references/visual-stage.schema.json` 及对应领域合同；效果图、生成式位图、全局基线和高保真前置只在适用时读取。
- 需要 A3 委派、执行或证据：读取对应的 `implementation-package`、`delegation`、`execution-state`、`evidence` Schema。
- 阶段收尾或检查提交范围：读取 `references/minimal-git.md` 与架构 Skill 的 `references/artifact-storage.md`。

## 不可绕过约束

- `INTAKE → BASELINE → PROPOSAL → REVIEW → IMPLEMENTING → VALIDATING → PASSED` 是普通前向路径；`run` 连续推进已满足条件的安全控制面状态，进入实施或遇到缺证据、用户决定时停止，永不自动选择 `RETURN`。
- 上述停止仅指控制命令返回。执行代理应接续完成已授权的实施、补证、修复和适用验证，再调用控制面推进；仅在缺少必要用户决定、明确批准或存在无法自行消除的外部阻塞时暂停对应工作，无依赖工作继续。
- A0-A3 直接依据当前用户任务；无外部副作用的本地 A4 集成也可按任务执行。任务内可调整方案、路径、资源清单和验证范围，并同步更新计划后继续。涉及外部写入、付费、真机、破坏性或外部删除、发布的 A4-A6 操作必须创建精确 pending，并逐对象获得显式批准。控制面不执行这些动作。
- V0→V1→V2→V3→V4 的实际产物、全局基线人工选择、场景 V2 拆解与布局确认、高保真前置和 V4 运行验收仍须核对；手写状态或根 PASS 不能代替实际文件及适用人工确认，文件引用不再要求或比较 SHA。
- `AUTO` 仅表示不存在额外产品取舍，不替代全局选图、V2 拆解、独立布局或 Spine 批次人工确认。每个门只请求其尚缺的确认；覆盖事实与绑定身份未变时复用已有有效证据，不重复询问。
- 美术方向和质量遵循[游戏美术体验与质量契约](../cocos-game-asset-integration/references/art-quality-contract.md)。全局选图的结构化 brief 与逐候选人工质量结果必须通过真实文件门，所选候选任一失败或未验证均不能冻结；机器出口只核对事实，不替代观看舒适、主题与完成度的人工结果，未明确授权时代理不自动分析截图或视频画面。
- 程序化文本纳入实施与审查硬约束：必须同时实现英语 `en`、简体中文 `zh-CN`、日语 `ja`、俄语 `ru`、西班牙语 `es`，并以各语言真实字形宽度、基线、字体回退和容器适配完成显示验证。文案在语义准确、玩家可理解的前提下保持短促、游戏化，优先使用 `x3`、`+10`、图标+数值等熟悉表达，不写可由符号直接表达的说明句。每种语言独立声明单行或换行策略，允许部分语言单行、部分语言换行；禁止截断。放不下时应按该语言策略调整文案、字距、字号或容器，同时保持可读字号。
- `check` 只读；`run` 只读校验、推导路线并可连续写入已满足条件的安全状态步骤，不运行业务代码、测试、服务、发布或外部动作。
- 只有上游事实、任务范围、实际内容、审批对象或实施计划真实变化，才重验受影响部分；摘要缺失或变化不使旧证据失效。任务内普通路径、方案和资源清单调整只更新计划并重验受影响部分。禁止覆盖他人修改。

## 图片任务交付

效果图生成与界面实现共用[游戏内文案](../cocos-game-ui-layout/references/game-copy.md)规则：内部策划说明与玩家可见表达分开，生成提示词明确可见文字范围，正式界面绑定同一表达与动态数据。全局候选、场景主图、弹窗及无效果图路径均适用；复用现有生成记录、领域文档与人工验收，不新增审批门，也不把机器检查视为文案显示通过。

视觉任务遵循[图片优先的确认方式](references/simplified-workflow.md#图片优先的确认方式)：代理内部维护分析、技术记录与提示词，直接交付真实图片或预览供人工确认，不设常规文字提案、拆解记录或布局决策的制作前确认门。帧动画例外：先说明动作方案的设计理念并等待用户明确确认，再制作真实素材或进入具体实现。已确认目标范围内的返修直接给前后对照；有决定性需求歧义才暂停受影响部分。实际拆解、布局、资源、父帧与视频确认及操作授权沿用原门，不能以内部记录替代真实候选。

## 宽松执行原则

- 工作流所有任务与阶段取消 SHA-1、SHA-256、文件哈希和候选摘要的验收校验：不要求填写、复算或比较这些字段，不因缺失、格式错误或摘要变化阻断、退回或重开任务。摘要核对交给最终人工验收后的处理环节；已有摘要仅作可选追踪。实际文件、任务归属、适用内容约束、命令结果和人工确认仍须核对。内部缓存、计划展示和事务并发保护的摘要不属于验收门。
- 普通任务不建立独立授权凭据。用户当前指令同时提供 A0-A3 的执行依据；Work Item 只记录目标、范围、计划和结果，作为协作上下文与追踪信息。
- 所有任务和阶段验收均核对当前明确要求、实际结果和必要约束，逐一判断差异影响；过程中的非强制实现细节调整只记录结果并重验受影响证据，不追溯修订合同或重开已完成工作。用户已明确提出的调整直接纳入当前要求；真实改变后续依赖的范围、公开接口或硬约束时才更新对应契约。
- 缺少非关键元数据时先提醒并自动补齐；只有无法确认身份、所有权、关键产物、安全边界或用户实质取舍时才阻断。普通问题默认原地 `repair`，候选未变时只 `revalidate`。
- 视觉默认检查可用性和合理关系，允许位置、尺寸、边距和换行存在小幅偏差；像素级容差、全视口/全状态矩阵仅在用户明确要求或项目合同明确指定时启用。越界、裁切、关键遮挡、不可读和交互失效仍必须修复。
- 测试按改动风险推荐 T0-T3，展示理由、覆盖和拟执行命令后自动执行适用等级；不等待人工选择，也不自动发起真机验收。

## 代理入口

```powershell
node <skill-dir>\scripts\workflow-control.mjs run --repo . --work-item <work-item> [--input <file> ...]
node <skill-dir>\scripts\workflow-control.mjs check --repo . --work-item <work-item> [--implementation-package <package>] [--evidence <manifest>] [--input <file> ...]
node <skill-dir>\scripts\workflow-control.mjs status --repo . --work-item <work-item> [--input <file> ...]
```

三个入口可重复传入 `--input <file>` 绑定显式关键输入；默认文本优先显示六阶段/四步场景视图，`--json` 仍输出稳定的 `status/stage/changed/blocking/next/metadata` 顶层协议，并在 `metadata.workflowView` 提供展示映射、`metadata.planFingerprint` 提供绑定基线、授权、状态、实施包和关键输入文件哈希的确定性计划指纹。重复 `check` 必须只读且结果一致。

## 高级诊断

`route` 推导路线，`preflight` 校验动作，`advance` 迁移一个已满足门的状态，`transition` 执行显式状态迁移，`diff-audit` 记录候选 diff，`evidence-check` 校验证据，`delegate-check`/`parallel-check`/`unit-check` 管理 A3 执行单元，`prepare-approval`/`handoff`/`approve` 只服务带副作用的 A4-A6 精确操作，`lint` 做仓库级静态检查。高级命令不改变上述范围和硬门语义。

## 领域协作

`$cocos-game-orchestrator` 负责领域编排；制作、架构、玩法、视觉、资源、音频、数值、QA、性能和发布 Skill 只能提交提议、审查结论、实施包或证据，并回到本控制面完成状态迁移。

详细状态、门、Schema、视觉合同和返工规则分别见 [`control-model.md`](references/control-model.md)、[`state-gates.md`](references/state-gates.md)、[`schemas.md`](references/schemas.md)、[`visual-stage.schema.json`](references/visual-stage.schema.json) 和 [`return-disposition.mjs`](scripts/return-disposition.mjs)。
