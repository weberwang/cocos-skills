---
name: cocos-game-orchestrator
description: Cocos Creator 3.x 游戏领域编排角色；在全局控制面已建立 Work Item 后协调各领域交付，不拥有全局状态或审批账本。
---

# Cocos Creator 3.x 游戏编排

以 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 为唯一全局状态、风险门和任务范围权威。本 Skill 负责拆分领域工作、冻结交接物、收集证据并回到控制面，不批准操作、不扩展范围、不创建第二套状态机。

编排 Creator 实施时，Scene/Node/Component、Prefab、AssetDB、资源 UUID 与编辑器操作统一经[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)路由，并使用实时 `tools/list` schema；不得手写 `.scene`、`.prefab` 或 `.meta` 绑定。刷新、挂脚本或打开构建面板不证明导入、编译、预览或构建成功，必须以读回和真实运行/构建结果报告状态。

## 最短流程

用户先按[`simplified-workflow.md`](../cocos-game-workflow-control/references/simplified-workflow.md)理解六阶段项目视图：需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布；单场景按场景定义 → 拆解与布局确认 → 正式资源验收 → 正式还原与运行验收理解。该视图不改变 G0-G3、V0、V1、V2、V3、V4、A0-A6、F0-F4 或证据硬门。

1. 读取 Work Item、当前任务说明、当前基线和适用状态门；需要字段时按需读取 [`quality-gates.md`](references/quality-gates.md)、[`module-decomposition.md`](references/module-decomposition.md)、[`game-implementation.md`](references/game-implementation.md)、[`delivery-artifacts.md`](references/delivery-artifacts.md) 等 reference。
2. 先提交最小领域提议和验收边界，完成审查后由控制面运行 `check`；已有入口、调用链、任务范围和风险事实足够时停止探索。
3. A3 实施前冻结绑定当前任务范围、基线、文件所有权、执行单元、验收命令和停止条件的实施包；实施后记录候选变更审计并提交当前候选验证证据。
4. 领域交付只在当前任务路径内进行；任务内方案、路径或资源清单变化时更新计划并重验受影响部分，需求或范围真实变化时提交 Change Request。所有领域、阶段和工作项逐一按[实际完成情况](../cocos-game-workflow-control/references/control-model.md#按实际完成情况验收)判断，已满足当前明确要求时不因中途调整而追补历史合同修订；最终回到控制面运行 `run`/`check`，由控制面推进状态。
5. 阶段验收完成后，执行代理按[阶段收尾与 Git 提交](../cocos-game-workflow-control/SKILL.md#阶段收尾与-git-提交)自动维护必要的 `.gitignore` 并提交本次任务文件，记录提交哈希后交接；并行任务由主代理统一收尾，子代理不各自提交共享工作区。

## 交付边界

- 记录和中间产物整理交给 [`cocos-game-artifact-cleanup`](../cocos-game-artifact-cleanup/SKILL.md)：阶段收尾仅清理本任务可再生成且无引用的临时文件，跨任务历史清理须在用户指定范围内另行规划，保留审批、返工及有效证据依赖链。
- 制作、架构、玩法、视觉、资源、音频、数值、QA、性能和发布工作均只能提议、审查或在当前任务内修改。
- A0-A3 依据当前用户任务；无外部副作用的本地 A4 集成可按任务执行。外部写入、付费、真机、破坏性或外部删除和发布由控制面建立精确 pending 并等待显式批准，本 Skill 不执行这些动作。
- V0→V1→V2→V3→V4、全局静态基线、场景拆解与布局确认和高保真前置继续使用控制面的不可绕过证据门；领域文档只补充本领域事实。
- 不覆盖并行代理的修改，不自动回滚共享工作区；启动本地验证服务前先按 [`local-service-validation.md`](references/local-service-validation.md) 查找可复用健康实例。

## 视觉与场景

策划、效果图和实现交接同一份[玩家可见表达](../cocos-game-ui-layout/references/game-copy.md#工作流接入)。委派生成任务时附带可见文字范围与禁止绘制内部说明的约束，委派界面实现时附带短标签、数值来源和显示条件；内部 GDD/brief 全文不能替代这份交接，也不能直接进入画面。

图片交付按[图片优先的确认方式](../cocos-game-workflow-control/references/simplified-workflow.md#图片优先的确认方式)执行：领域代理内部整理记录并直接产图或真实预览，主代理展示候选及少量检查点，不以文字提案确认作为常规制作前置；已确认目标内返修直接提交前后对照。真实图片与素材依赖仍按对应阶段确认。

效果图还原和正式 Scene 接入属于当前场景 Work Item；常驻 HUD 随场景闭环。modal/popup 等弹窗按[独立工作项规则](../cocos-game-workflow-control/references/control-model.md#弹窗工作项与场景解耦)另建 DISPLAY_LAYER Work Item，独立提交宿主上下文、组件/状态、布局合同和运行态证据，不影响大厅或其他宿主场景验收。

场景 V2 的布局交付必须同时提供标准布局 PNG、`layout-nodes.json`、`layout-decision.json`、自包含 `review.html` 和 `generation-result.json`，并在独立布局确认及场景根计划中关联同批参考、拆解、决策、节点、PNG 和实际审阅页。屏幕 UI 还按[Cocos UI 节点组织](../cocos-game-ui-layout/references/layout-hierarchy.md)在 V1 定义根层级，在 V2 确认父级职责与 `ui_layout` 字段，在 V4 正式场景中检查职责、输入、裁切边界及视口变化下的运行结果。编排只引用[离线布局审阅产物](../cocos-game-ui-layout/references/layout-review-artifacts.md)的通用规则，不为场景手写审阅页；页面候选状态不等于人工确认。

## 汁水感与动态反馈路由

汁水感是按需调用的独立领域能力：用户明确提出汁水、打击感或动态反馈需求时调用；已有任务包含核心反馈，但事件语义仍不清楚时也可按需引用。它沿用当前场景或玩法 Work Item，不把普通玩法修改扩为全量润色，也不增加阶段、审批门或强制工件。按[工作流接入说明](../cocos-game-juice/references/workflow-integration.md)安排职责：制作在既有 GDD/契约确定意图和关键事件，玩法负责规则、碰撞、状态、触发与交互代码，架构维护跨模块坐标约定；UI 负责布局、焦点表现与布局坐标合同，反馈对象仅使用独立表现偏移，不覆盖基础布局值、不争抢焦点或输入处理。动画与音频沿用各自的生产及生命周期规则，QA 核对事件边界并将动态显示、舒适度和手感交由用户人工验收。完整语义与类型规则见[汁水感设计指南](../cocos-game-juice/references/design-guide.md)。

## 状态与返工

本领域不直接迁移全局状态。证据失败优先原地 `repair`，上游事实未变时 `revalidate`，只有上游事实失效、任务范围真实变化或硬门将被绕过时才按最小范围 `return`；普通候选身份变化不触发回退，已确认事实不重复搜索或推翻。
