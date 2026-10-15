# 控制模型

## A0-A6 动作等级

| 等级 | 语义 | 典型动作 |
| --- | --- | --- |
| A0 | Cocos 只读调查 | `cocos-inspect`；只读取项目事实 |
| A1 | 项目规格和候选 | `cocos-spec-candidate` |
| A2 | Cocos 隔离原型 | `cocos-prototype`；不得触达正式入口 |
| A3 | Cocos 生产实现 | `cocos-code-change`、资源/UI/音频/数值变更及 `cocos-qa-build` |
| A4 | 游戏集成与迁移 | `cocos-integration`；正式入口、迁移、删除旧实现和跨模块整合 |
| A5 | Cocos 外部状态 | `cocos-build-upload`、`cocos-backend-config`、`cocos-channel-config` |
| A6 | Cocos 高风险和发布 | 真机、商店、正式发布和线上游戏回滚 |

动作等级描述 Cocos 生命周期风险，不表示审批存在。每个白名单 actionType 只有一个固定等级；A0-A3 直接依据当前用户任务；无外部副作用的本地 A4 集成可按任务执行，涉及外部写入、付费、真机、破坏性或外部删除、发布的 A4-A6 操作才逐对象取得显式批准，A6 的发布/真机等高风险动作永不自动。

本控制面不是通用操作控制器。Git、Shell、文件管理、包管理、浏览器、消息、GitHub、普通云配置、第三方 API 和通用进程管理全部为 `OUT_OF_SCOPE`，无需 Work Item、F 门或 Approval Ledger。Git diff 仅作为 Cocos 候选证据读取。

## F0-F4 唯一语义

| 门 | 唯一语义 | 核心问题 |
| --- | --- | --- |
| F0 | 范围与流程合规 | 当前用户任务、状态、A 等级、路径、目标、基线和停止门是否允许动作？涉及副作用的 A4-A6 是否具备对应的显式批准？ |
| F1 | 规格一致性 | 实际交付是否满足当前明确需求、范围、公开接口和硬约束？合同中的早期实现方案是否只是非强制参考？ |
| F2 | 领域质量 | 产品、架构、玩法、视觉、资源、音频、数值、QA 等专业质量是否达标？ |
| F3 | 工程验证 | 构建、测试、性能、迁移演练与可复现证据是否绑定当前候选？ |
| F4 | 高影响集成/发布决策 | 是否允许具有外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作？无副作用本地 A4 不因等级标签额外进入批准门。 |

任何领域不得重新定义 F0-F4。测试通过不能覆盖 F0 路径越界，领域通过不能覆盖 F1 规格漂移，F4 不能补签早先未批准的副作用动作。

## 执行优先与证据收敛

证据的职责是确认进入执行/实施或验证的最小充分条件，并绑定当前候选的真实性，不是穷尽性研究目标。在当前用户任务和适用前置硬门允许的边界内，入口、关键调用链或契约、任务范围、主要风险和验收目标已经明确，且没有直接冲突或未决实质取舍时，必须停止探索：A1/A2 冻结当前候选的范围、假设与验收边界，直接进入适用执行/验证；A3 冻结 `Implementation Package` 后进入 `IMPLEMENTING`。

可逆、本地且属于当前任务的 A1/A2 修改可以记录合理假设后直接执行/验证；A3 修改可以记录合理假设后实施，但必须先冻结 `Implementation Package`；无外部副作用的本地 A4 集成也可按任务执行。缺少完全证明不构成停滞理由。仅 A3 包冻结后 implementer 不做开放式重新方案探索，只有需求/范围变化、实质冲突或无法实施才返回。任务内路径、方案、资源清单和验证范围可以随实施更新计划并重验受影响部分。外部写入、付费、真机、破坏性或外部删除、发布等具体副作用仍需精确批准；用户决定、V0/V1/V2/V3/V4 硬门、证据来源与真实性和共享工作区安全约束不因执行优先而放宽。

默认闭环为：`最小必要事实确认 → 冻结候选边界（A3 冻结 Implementation Package）→ 执行/实施 → diff-audit → 推荐并自动执行适用等级的定向验证 → 仅按失败证据修正 → 完成`。已确认事实不得重复读取、搜索或复核，除非出现新的测试/类型/构建失败、运行异常、直接矛盾、需求/范围明确变化、候选身份实际变化或硬门明确失败；审查不得仅因另一种可行方案推翻已满足需求的候选。非阻塞发现记录为未覆盖项/后续事项，不扩大当前 Work Item。

### 按实际完成情况验收

所有阶段取消 SHA-1、SHA-256、文件哈希及候选/差异摘要的验收校验。摘要字段仅为可选追踪记录，缺失、格式错误、陈旧或不一致不影响门判断；不要求补生成、复算或回写摘要，也不据此回退或使人工确认失效。最终人工验收后再处理摘要核对，当前工作流不自动启动该处理。保留文件可读性、真实内容、任务/阶段/单元/场景归属、状态、顺序、明确要求和适用人工确认；内部缓存与防止并发覆盖的事务比较不属于验收。

本规则适用于工作流内所有任务和阶段，包括需求与设计、基础工程、场景、玩法、UI、资源、动画、音频、数值、测试、性能、集成与发布；弹窗只是示例。每项任务验收前都必须核对当前明确要求、实际交付结果和有效证据，再判断差异是否影响完成条件、后续依赖或硬约束，不能根据任务类型或“中途有改动”直接要求修订合同。

验收以当前用户明确要求和实际交付结果为准。合同用于追踪需求、公开接口和硬约束，早期实现方案不要求逐字回写成最终实现；已满足要求的交付，不得仅因过程中的调整或合同描述滞后而判为未完成、要求先修订合同或重新打开已完成工作项。

- 布局微调、资源路径、内部代码组织或其他未被明确要求固定的实现细节发生变化，但功能、交互、可用性和必要约束已满足时，只记录实际结果、必要偏差说明和当前候选证据；不为档案一致而追溯修订 GDD、功能合同、布局目标或其他上游合同。
- 用户在实施过程中已明确提出的调整纳入当前验收要求，直接在 Work Item 或决定记录中关联原文与实际结果；已经按该要求完成时，不以补改历史合同作为验收前置。只有真实改变后续工作依赖的范围、公开接口或硬约束时，才更新对应契约供后续消费，并只影响相关工作。
- 所有任务按自身范围和实际完成情况收尾；中途调整过排版、实现组织、处理流程或其他非强制细节，不要求重写合同，也不重开无关任务验收。后续再次修改时，在对应工作项内按实际影响验证当前候选，不因历史过程重做已完成阶段；例如弹窗完成不重开宿主场景验收，模块内部重构不重验未受影响的场景。
- 实际结果缺少要求的功能、交互失效、越界、不可读或违反明确接口、安全、资源来源、生产方法及精确还原约束时，修复实现；不得通过修改合同降低标准、抹去失败或把未完成包装为完成。
- 合同修订与证据更新是两件事。当前候选的实际文件、运行测量、生产记录和必要人工确认仍须真实有效；实际内容变化时只更新或重验受影响证据，不篡改冻结工件来消除差异。截图显示效果由用户人工检查，除非用户明确要求自动检查；未经适用验证不得宣称通过。

### 前进优先与三级处置

控制面默认推荐沿当前状态和 V0→V1→V2→V3→V4 工作流向前推进。门禁失败必须先区分处置级别，并只影响真实受影响范围及其下游：

1. `repair`（原地修复）：修复记录、字段、路径、文件绑定或可补证据；冻结上游事实不变，修复后重跑当前门。
2. `revalidate`（当前门重验）：上游事实未变，但机器证据缺失、过期或验证失败；只重跑当前门并生成新证据，不回退阶段。
3. `return`（必要回退）：上游事实失效、任务范围发生真实变化，或继续推进会绕过硬门并使下游无效；必须分别记录 `upstream-fact-invalidated`、`scope-changed` 或 `hard-gate-would-be-bypassed`，并写明最小 `affectedScope`，再回到最早受影响阶段。普通候选身份变化不触发 `RETURN`；优先在当前阶段 `repair` 或 `revalidate`。`RETURN` 不能承载 `repair` 或 `revalidate`。

`route` 应优先给出当前阶段的修复、重验或下一前向命令；`advance` 只推进合法的下一状态，永不自动选择 `RETURN`。只有显式 `transition --to RETURN` 并提供必要回退分类、非空理由和唯一的 `stage:`/`scene:`/`artifact:` 影响范围时，控制面才接受阶段回退。控制面必须从影响范围推导 `returnState`，持久化 `returnRecord` 的 `invalidatedArtifacts`、`previousValidationBatchId`、`recordedAt` 和 `resolvedAt=null`，并清空当前审批、pending 视觉快照/展示、Diff Audit，按范围失效实施包/Execution State、轮换 validationBatchId；历史账本和证据文件可保留但不得再被 `effectiveApproval` 使用。退出 RETURN 只能迁移到该记录的 `returnState`，确认失效动作完成后写入 `resolvedAt`。控制面始终 fail closed、不可绕过硬门，也不删除审计文件或用户数据。

## 任务范围与显式批准

Work Item 保存用户原始请求、目标、当前范围、实施计划、路径和时间，作为协作上下文与追踪信息。普通 A0-A3 不建立独立 `taskAuthorization` 或授权记录，也不以 F0 授权有效作为硬门；Implementation Package 直接绑定当前 Work Item 和实际计划。任务内方案、路径、资源清单或测试范围调整时同步更新计划，不要求重新建立独立凭据。

`substantiveTradeoffRequired` 或 `visualDecisionRequired` 为 true 时，即使动作是 A1-A3 也必须进入显式决定门。普通 A1-A3 禁止创建多余 pending。

产品、视觉、架构、预算、合规和数据边界取舍属于 `USER_DECISION`，只更新 Work Item、权威工件或决策记录，不进入审批账本。显式批准只用于 A4-A6 中具有外部写入、付费、真机、破坏性或外部删除、发布副作用的具体操作，保存用户原文、时间、明确对象、阶段、模块、基线、动作、非空影响摘要、路径/服务/外部目标、副作用与失效条件。`handoff` 后的短回复只确认当前展示的操作及影响；A6 永不自动执行高风险动作。

`route` 依据确定性规则输出 INSPECTION(A0) 至 RELEASE(A6)：Cocos A0-A3 以当前任务范围为依据，未决用户选择额外标记 `USER_INPUT_REQUIRED`，只有涉及副作用的 Cocos A4-A6 标记 `EXPLICIT_APPROVAL`。普通 A3 和无副作用本地 A4 保持真实 diff、独立 F2 和必要 F0-F3 证据；外部写入、付费、真机、破坏性或外部删除和发布操作保持精确批准硬门。

视觉生产合同属于 V2、V3、V4 的领域证据，不改变 F0-F4 唯一语义。`visual-assets` 中必须显式区分 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`；`independent-production`、`generate-now` 与视觉相似度都不能推断具体生成器或替代生产合同。使用 `production_method=image-generation` 时，V3/F2/V4 必须继续验证独立位图、实际生成器/版本、生成记录、运行时消费和无替换证据。

视觉验收通过 `visual_validation.mode` 区分 `usability` 与 `exact`，默认使用 `usability`。普通候选允许位置、尺寸、边距、换行和少量几何差异，只要没有越界、裁切、关键遮挡、不可读或交互失效；effect-image 也不自动切换到 `exact`。只有用户明确要求像素级还原或项目合同明确指定时才使用 `exact`，并启用严格容差、全视口/全状态矩阵和完整差异证据。V2 拆解、布局父子关系、顺序和内部几何一致性仍需保持。

## 视觉阶段硬门

### 弹窗工作项与场景解耦

场景工作项和弹窗工作项独立规划、实现、验收。场景只负责自身玩法、场景画面及属于 scene master 的常驻 HUD；modal、popup、drawer、toast 等瞬态显示层建立独立 `DISPLAY_LAYER` Work Item 和独立 Implementation Package。`host_scene_id` 只描述弹窗打开时的运行上下文及接线目标，不表示弹窗归属于宿主场景实现，也不把弹窗完成状态并入场景 V4。

- 场景 `display_layer_planning.inventory` 只记录场景自有的常驻显示层；没有自有显示层时显式使用 `inventory=[]`。`deferred_layers` 已移除，不得把未完成弹窗作为场景待办。
- 弹窗 Work Item 的 `inventory` 记录本任务实际交付的瞬态层，并独立完成参考、拆解确认、布局确认、正式资源、代码和 V4 运行轨迹。required state 仍必须绑定真实宿主上下文图，V4 仍验证打开→交互→关闭→恢复。
- `SCENE` 与 `DISPLAY_LAYER` 不得出现在同一个 Implementation Package。独立弹窗包可包含多个写范围和状态所有权互斥的 DISPLAY_LAYER 单元；每个单元保留 `displayLayerId` 和 `hostSceneId`。
- 大厅或其他宿主场景只实现自己范围内的稳定触发事件/公开接口。弹窗内容、资源、状态、接线和验收由弹窗 Work Item 负责；弹窗未开始、失败或延期均不阻断宿主场景验收。
- 弹窗与宿主需要联合调试时，在弹窗 Work Item 内消费宿主已冻结的公开接口与上下文证据。联合调试结果证明弹窗自身可用，不回写为场景完成前置，也不要求重新打开已通过的场景验收。

视觉阶段使用机器枚举 `V0`、`V1`、`V2`、`V3`、`V4`，且必须同时声明有语义的 `visualStageState`。V0/V1 必须先建立全局基线 brief、生成恰好三张同条件候选效果图、同屏交给人工并确认其中一张；`globalVisualBaselineSelectionRef` 通过后才可写入 `global-static-baseline-frozen`。该引用通过不可变 `path` 跨 Work Item 复用，根证据顶层 `workItemId` 始终是生产者身份，不是当前消费者；该状态只冻结颜色、字体、栅格等静态规则；它不等于 `v2-production-planning-complete`，三候选人工选择也不能替代逐场景 V2 拆解图确认。V2 方案冻结必须由拆解图、技术 JSON、coverage、生产计划和拆解确认证据派生。

全局 brief 使用结构化项目美术 JSON，明确主题、受众、核心循环、体验目标、观看情境、视觉层级与三层刺激预算。选择根/决定合同为 1.1，三候选各记录五项实际人工质量结果，所选候选全部通过才可冻结；三张均失败时保持待定并返工，不以“相对最好”放行。字段与文件门见[Schema](schemas.md#视觉阶段-schema)。场景目标、资源组合和持续游玩沿用[游戏美术体验与质量契约](../../cocos-game-asset-integration/references/art-quality-contract.md)与现有确认节点；V4 运行候选内的 `artExperienceAcceptance` 缺失或非通过时不得完成，机器事实出口不能替代用户视觉验收。

```text
建立全局视觉基线 brief
  → 生成三张同条件候选效果图并同屏交给人工
  → 人工选择确认一张，写入唯一 SINGLE_HUMAN/CONFIRMED 决定
  → 正式冻结全局静态 visual_baseline（global-static-baseline-frozen）
  → foundation-only：SHARED 最小项目骨架 + MODULE 场景无关基础模块
  → 各场景 Work Item：任务范围与功能规格
  → V1 生成或接收并冻结 scene master/reference target、宿主上下文效果图、视觉合同和初步还原草案
  → V2 先自动生成拆解图与技术 JSON，人工修改并确认最终拆解
  → 智能视觉判断生成双轴对齐决策，仅消费已确认元素与该决策生成布局图，人工修改并独立确认
  → V2 完成布局确认与合同回对/coverage/生产方案
  → V3 正式资源生产与验收
  → V4 直接消费 V2 拆解与目标布局、V3 正式资源，实施并校准正式 SCENE，完成运行态视觉接入与功能/视觉验收
  → 各弹窗 DISPLAY_LAYER Work Item 独立完成 V1→V2→V3→V4，可与场景按公开接口并行
  → 跨场景 INTEGRATION/联合验收 → A4 正式入口（带副作用时进入 F4）
```

正式 Scene/UI 注册、Boot→可见 Scene 入口修改、正式消费可见资产、删除旧视觉实现或声明视觉完成，必须由共享视觉前置校验器复核当前场景 Work Item 的 V2 拆解与目标布局、V3 正式资源验收；声明视觉完成时另需 V4 运行候选。仅含 `SHARED`/`MODULE` 的 foundation-only 包按是否声明视觉依赖分流：纯工程包不消费视觉产物或正式可见资产，只需当前任务范围、工程基线、冻结实施包和工程证据即可在全局选图前实施；声明视觉合同或资产生产依赖的基础包仍必须通过机器复核的 `globalVisualBaselineSelectionRef`（三张 generated 候选、唯一 SINGLE_HUMAN/CONFIRMED 决定、冻结正文实际文件）和 `globalStaticBaselineState=global-static-baseline-frozen`。一旦声明正式入口或可见资源消费等视觉行为，即使单元类型仍为 `SHARED`/`MODULE`，也回到正式 V2/V3 视觉门。包含 `SCENE`、`DISPLAY_LAYER` 或 `INTEGRATION` 的包以 V2 `v2-production-planning-complete` 作为规划边界、V3 正式资源验收作为正式实现前置。全局选择根证据的生产者 Work Item 可被多个消费者引用，但场景 V2/V3/V4 证据仍必须绑定当前场景 Work Item；阶段名、`stageId` 文本、根 PASS/布尔值、说明文字和 Approval Ledger 原文都不是证据；所有证据必须使用 Work Item、Unit Result、候选标识和实际文件引用。必要业务字段或路径缺失/格式错误先 `repair`，上游事实未变的机器验证失败按 `revalidate` 只重跑当前门；只有上游事实失效、任务范围真实变化或硬门将被绕过时，才按最小范围更新并 `return` 到最早受影响阶段。普通候选身份变化不触发 `RETURN`，不使 V2 拆解确认失效；下游按受影响范围失效，不默认整 Work Item 重做。

已完成的 A4-A6 副作用批准只覆盖其明确对象、阶段、模块、文件范围和动作等级；这些内容变化时创建新审批，旧记录只读保留。无副作用本地集成和普通任务内迭代不需要审批记录。

## 实施顺序状态硬门

effect-image 的 V2 功能归属是拆解确认的一部分，遵守[功能语义分组约束](../../cocos-game-ui-layout/references/functional-semantic-grouping.md)。最终元素必须显式声明 `parent_element_id` 与 `semantic_grouping.kind/rationale`；位置依赖决定父子归属，共同表达同一信息且没有位置依赖的元素列为同组同级项，布局严格继承，不以几何包含兜底。机器检查归属结构和身份，语义判断由人工确认；新增容器、归属或理由变化返回拆解确认并使旧布局身份失效，不自动改写已冻结的项目工件。

同一命令内，`loadExecutionState` 完整复核绑定 Result 后，READY 与完成证据只消费该已校验状态；独立命令入口仍重新读取并校验，不能跨命令缓存。
全局实施顺序先建立任务范围、工程基线和必要的全局视觉基线，再完成 foundation-only 的 `SHARED`/`MODULE`。随后 SCENE Work Item 与 DISPLAY_LAYER Work Item 分别完成自己的 V1→V2→V3→V4。正式代码包顺序为 `SHARED`→`MODULE`→`SCENE`→`INTEGRATION`，或 `SHARED`→`MODULE`→`DISPLAY_LAYER`→`INTEGRATION`；两类视觉单元不得混在同一包。每个正式单元直接读取所属 Work Item 的 V2/V3 结果，弹窗的 `hostSceneId` 只绑定宿主上下文和公开接口。

effect-image 的布局拆解在控制面按串行顺序处理：先在确认 proposal 中按原顺序冻结 `decomposition_elements`，再由布局阶段逐项继承 `parent_element_id` 为 `parent_layout_node_id` 并计算 `parent_target_bounds`。智能布局必须结合原图构图、视觉重心和元素语义，按同一顺序生成唯一决策并显式声明 `axis_alignment.horizontal=left|center|right` 与 `vertical=top|center|bottom`；不得依据四边距离自动决定对齐，也不得调序、生成多个布局方案或重新生成/替换视觉参考图。布局标注 PNG 只在冻结原图上叠加父子框与右栏说明。父内容框内的 `relative_position` 只承担测量和漂移复核，`offset` 与两个 `${vertical}-${horizontal}` 锚点按显式视觉决策计算。`reference_id` 必须等于父 ID，父级只能是节点、`viewport` 或 `safe-area`，不得循环或越界；视觉决策或父子几何实际变化时只重验受影响关系，不检查布局摘要。

进入 A3 `IMPLEMENTING` 时创建 `evidence/<workItemId>/execution-state.json`；纯工程 foundation-only 包在当前任务范围、工程基线、冻结实施包和工程证据就绪后即可在全局选图前初始化，具有视觉依赖的基础包仍须在三候选人工选择证据和全局静态基线冻结后初始化，场景/集成包在 V2 与 V3 前置闭合后进入 V4 正式实施。该状态记录绑定当前 Work Item、Implementation Package、baseline、执行计划指纹和 `executionUnits` 数组位置；只有通过 `unit-check` 的当前 PASS Result 可以把当前单元更新为 `COMPLETE`，并按预设数组激活下一串行单元或下一并行组的 `IN_PROGRESS`。并行组未全部完成时，后续顺序阶段不得提前激活；当前阶段实施序列完成后只输出 `WORKFLOW_COMPLETE`，表示该实施包已闭环，不表示场景 Work Item 已完成。场景 Work Item 继续推进时，必须在同一 `workItemId` 下通过显式阶段入口推进；V3 验收后进入 V4 并激活正式 Implementation Package，完成实施和运行验收。控制面先按旧包复核完整 Execution State，再清空旧 Diff Audit/validation batch；换包时归档旧状态并初始化新阶段状态，复用包时保留原单元结果。旧状态和 Result 只保留审计用途，不能证明新阶段候选。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移均必须读取并复核当前阶段状态，缺失、过期、篡改或身份/顺序不一致一律阻断；其中 SCENE/DISPLAY_LAYER 的 READY、委派和激活还必须复核当前 Work Item 的 V2/V3 结果。门禁问题先输出 `repair`/`revalidate` 及其真实受影响单元；只有上游事实失效、任务范围真实变化或硬门将被绕过时才输出 `return`；普通候选身份变化不触发 `RETURN`。

`highFidelityPrerequisite` 是 SCENE/DISPLAY_LAYER 必填、其他类型必须为 null 的严格 nullable 字段，引用当前单元所属 Work Item 的 V2 方案。SCENE 引用场景工作项证据；DISPLAY_LAYER 引用独立弹窗工作项证据，并额外以 scene/layer/host 身份绑定宿主上下文图。两者不得共用一个实施包，也不要求使用同一 `evidenceFile`；必要业务字段缺失、任务归属不符或文件缺失均拒绝；摘要不参与验收。

控制面读取 V2 布局候选目录的实际五份产物，并把 `layout_review_file`、`layout_nodes_file` 与 PNG、决策、拆解确认、proposal、target、scene/state 身份逐项复核。`review.html` 仅是候选审阅展示，不能改变状态或替代标准布局 PNG、F2 机器门；缺父节点、成环、越界、顺序/身份漂移或必要文件不可读取均拒绝。字段和页面约束见[离线布局审阅产物](../../cocos-game-ui-layout/references/layout-review-artifacts.md)。

V2→V3 是同一场景 Work Item 的阶段推进。V2 拆解与布局确认、V3 正式资源证据、V4 运行态证据写入同一 `workItemId` 的不可变阶段引用；V4 正式实施包进入 `IMPLEMENTING` 前必须消费当前 Work Item 的 V2/V3 证据。阶段实施序列完成只表示当前包完成，只有当前 Work Item 的 V4 运行态联合验收证据闭合后才允许场景 `COMPLETE`。
