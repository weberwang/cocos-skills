# 状态、阶段与停止门

场景与弹窗按[独立工作项规则](control-model.md#弹窗工作项与场景解耦)分别推进。场景只验收自身画面和常驻 HUD；modal/popup 等弹窗使用独立 DISPLAY_LAYER Work Item，宿主图与运行轨迹只约束弹窗自身 V1、V2、V3、V4，不阻断场景 V4。

效果图还原是当前场景实现 Work Item 内的可选视觉模式；foundation-only 基础实施完成后进入场景 V1，由 V1 生成或接收并冻结 `scene_reconstruction_contract`、scene master/reference target、必需宿主上下文图和初步还原草案，再进入 V2 拆解确认门。工作流默认沿 V0→V1→V2→V3→V4 和当前全局状态向前推进：缺字段、格式、路径或可补证据问题先在当前阶段原地修复，上游事实未变的机器验证失败只重验当前门。只有上游事实失效、任务范围真实变化，或继续推进会绕过硬门并使下游无效，才使用 `RETURN` 回到最早受影响阶段；普通候选身份变化不触发回退。

## 全局状态

生产主路径按风险跳过不适用的人工状态：A1 走候选、验证与完成；A2 走隔离实现、验证与完成；安全 A3 走 `IMPLEMENTING → VALIDATING → PASSED → COMPLETE`。实质用户取舍形成 `USER_INPUT_REQUIRED` 澄清阻塞而不进入审批状态；只有具有外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作进入操作批准门，无副作用本地 A4 可直接进入 `INTEGRATING`，发布工作项进入 `RELEASE_APPROVAL_REQUIRED → RELEASING`。

任一活动状态可在硬门失败或真实范围变化时进入 `BLOCKED`；只有满足 `return` 条件并显式记录分类、理由和最小影响范围时才可进入 `RETURN`。`RETURN` 只能回到 `BASELINE`、`PROPOSAL`、`REVIEW` 或 `IMPLEMENTING`；阻断解除后必须回到明确的前序状态，不得跳门。

## 三级处置

先按[实际完成情况验收](control-model.md#按实际完成情况验收)判断是否存在真实失败。交付已满足当前明确要求，只有非强制实现细节与早期合同描述不同，不构成门禁失败，也不要求修订合同或进入 `RETURN`；当前候选证据缺失或失效仍按下述规则补齐。

所有门禁失败必须先给出以下三类处置之一，并只使真实受影响范围及其下游失效：

1. `repair`：修复当前记录、字段、路径、文件绑定或可补的证据；不改变冻结候选，不回退阶段，修复后重新运行当前门。
2. `revalidate`：候选及其上游冻结 target/candidate/diff/baseline 身份未变，但机器证据缺失、过期或验证失败；只补生成或重跑当前门证据。
3. `return`：上游事实失效、任务范围发生真实变化，或者继续推进会绕过硬门并使下游无效；必须记录 `upstream-fact-invalidated`、`scope-changed` 或 `hard-gate-would-be-bypassed`、理由和最小 `affectedScope`，再回到最早受影响阶段。普通候选身份变化优先 `repair`/`revalidate`，不触发回退。

`route` 默认推荐当前阶段的下一步，`advance` 只执行合法的前向迁移且永不自动选择 `RETURN`。显式 `transition --to RETURN` 必须提供必要回退分类、非空理由和唯一的 `stage:`/`scene:`/`artifact:` 影响范围；控制面据此推导 `returnState`，清空 approval/pending 视觉快照与展示/Diff Audit，失效实施包和 Execution State，轮换 `validationBatchId` 并写入 `invalidatedArtifacts`、`recordedAt`、`resolvedAt=null`。

## 阶段映射

| 领域阶段 | 全局状态落点 |
| --- | --- |
| G0 立项门 | `BASELINE` 至任务范围/必要决定完成后进入实现 |
| G1 完整场景与功能实施 | `IMPLEMENTING` 至 `PASSED` |
| G2 制作冻结/完整集成 | `VALIDATING` 至 `INTEGRATING` |
| G3 发布候选 | `RELEASE_APPROVAL_REQUIRED` 至 `COMPLETE` |
| V0 分流、V1 场景定义 | `PROPOSAL/REVIEW` |
| V2 拆解确认与生产方案 | `REVIEW/IMPLEMENTING`；实质视觉取舍进入 `USER_INPUT_REQUIRED` |
| V3 正式资源生产与验收 | `REVIEW/IMPLEMENTING/VALIDATING/PASSED` |
| V4 正式还原与运行态集成 | `IMPLEMENTING/VALIDATING/PASSED/INTEGRATING` |
| 产品/需求/架构提案 | `PROPOSAL/REVIEW`；未决用户选择以 `USER_INPUT_REQUIRED` 阻断 |
| 代码/资源/音频/数值生产 | `IMPLEMENTING` |
| 测试/性能 | `VALIDATING/PASSED` |
| 发布 | 独立工作项的 `RELEASE_APPROVAL_REQUIRED/RELEASING/COMPLETE` |

V0、V1、V2、V3、V4、G0-G3 与领域阶段是 `stageId`，不是另一套状态机。只有全局控制面改变 `globalState`。

## V0/V1/V2/V3/V4 机器状态依赖

| 阶段 | 唯一完成状态 | 下游硬依赖 |
| --- | --- | --- |
| V0 | `not-started`/`in-progress` 等过程状态 | 分流对象与范围 |
| V1 | `in-progress`/过程状态 | 视觉契约、冻结图、布局和容差 |
| V2 | `v2-production-planning-complete` | 拆解图、技术 JSON、coverage、component×state、父子/停靠/对齐/显示层事实、生产方案和拆解确认 |
| V3 | `v3-formal-acceptance-complete` | 正式资产、组件资源状态、`visualManifestFile`/`visualManifestSha256` 与生产验收 |
| V4 | `v4-runtime-integration-candidate` | 当前 V2/V3 事实、正式 Scene 消费、runtime replay、fresh fidelity、无替代 |

V3 资源验收通过后，V4 直接激活正式实施包并读取当前 V2 拆解/布局和 V3 资源证据。正式执行准入和 COMPLETE 仍须复核这些上游事实及 V4 实际运行候选。

`global-static-baseline-frozen` 是静态基线的独立状态，不是 V2 完成状态。正式可见 Scene/UI 工作进入集成状态前，校验器必须从 V2→V3→V4 的不可变文件证据派生运行候选；无副作用本地 A4 不因等级标签额外进入批准门。裸 `frozen`、未知阶段、根摘要、手写 PASS 或 `stageId=main/integration/production-entry` 均失败。

## 全局视觉冻结与实施顺序

全局选择的 brief/质量门按[Schema](schemas.md#视觉阶段-schema)和[游戏美术体验与质量契约](../../cocos-game-asset-integration/references/art-quality-contract.md)执行：结构化 brief 必须绑定生产者并定义三层刺激预算，所选候选的主题、受众、可读性、静态舒适和完成度人工结果全部通过，且根与实际决定文件一致，才可冻结。全不合格或缺少实际人工评价时不得放行。静态基线通过不推导持续游玩通过；V4 实际运行候选内的 `artExperienceAcceptance` 必须绑定当前身份、真实动态片段与通过的实际用户结果，缺失、失败或未验证都阻断完成门。该材料属于既有运行验收，不新增审批阶段。

任务范围和工程基线完成后，纯工程 foundation-only 包可先完成 `SHARED` 最小项目骨架和 `MODULE` 场景无关基础模块；只有具有视觉合同或资产生产依赖的基础包才需先建立全局基线 brief，生成恰好三张同条件候选效果图并同屏交给人工，人工选择确认一张后以 `globalVisualBaselineSelectionRef` 正式冻结 `visual_baseline`。基础实施完成后按各场景 Work Item 进入 V1；每个 V1 内生成或接收并冻结当前场景的 scene master/reference target、必需 transient display-layer 宿主上下文图、`scene_reconstruction_contract` 和初步还原草案，集合按 scene/state 分项而非一张合并图；随后该场景才在 V2 完成拆解图确认与生产方案。

具有视觉依赖的 foundation-only 包必须同时通过 `globalVisualBaselineSelectionRef` 的三候选/唯一人工确认/实际文件门和 `globalStaticBaselineState=global-static-baseline-frozen`，缺失任一项时 fail closed；纯工程包只需当前任务范围、工程基线、冻结实施包和工程证据，不等待全局选图；一旦基础包声明正式入口或可见资源消费等视觉行为，即回到正式 V2/V3 门。混入 SCENE/DISPLAY_LAYER/INTEGRATION 的包以 V2 `v2-production-planning-complete` 和 V3 正式资源验收作为正式实施前置。全局选择是独立硬门，不能替代逐场景 V2。参考模式的 `effect-image` 仍在同一 Work Item 内完成 V1→V2→V3→V4。

正式代码包按 `SHARED`→`MODULE`→`SCENE`→`INTEGRATION` 或 `SHARED`→`MODULE`→`DISPLAY_LAYER`→`INTEGRATION` 排列；SCENE 与 DISPLAY_LAYER 不得混在同一包。各正式单元直接读取所属 Work Item 的 V2/V3 证据，`hostSceneId` 不构成宿主场景完成依赖。

## 高保真前置

`highFidelityPrerequisite` 必须是不可变引用：`workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、`sceneId`/`displayLayerId`/`hostSceneId`、仓库内相对 `evidenceFile`；摘要字段可选且不参与验收。证据文件须为 `cocos-scene-v2-reconstruction-plan/1.0` 的单一场景根结果：根提供 `sceneMaster`、`sceneReconstructionContract`、`decompositionAnnotation`、`technicalDecomposition`、`visualDecompositionConfirmation`、`visualProductionContract`、`visualProductionUnits` 和 `displayLayerContexts[]`。

SCENE 与 DISPLAY_LAYER 分别绑定各自 Work Item 的 V2 证据，并使用独立 `evidenceFile`；不得共用同一证据包或同一文件。各自的 scene/layer/host 及任务归属必须一致，candidate/diff/target 摘要仅作可选追踪。必要业务字段、格式、路径、越界或缺文件错误先 `repair` 并重验当前门；上游事实未变但机器证据过期/失败时为 `revalidate`。只有上游事实失效、任务范围真实变化或硬门将被绕过才 `return` 到最早受影响阶段；普通候选身份变化不触发回退。

V2→V3 是同一场景 Work Item 的阶段推进。V2 拆解与布局确认、V3 正式资源证据、V4 运行态证据分别写入同一 `workItemId` 的不可变阶段引用；V4 正式实施包进入 `IMPLEMENTING` 前必须消费当前 Work Item 的 V2/V3 证据。阶段实施序列完成只表示当前包完成，只有当前 Work Item 的 V4 运行态联合验收证据闭合后才允许场景 `COMPLETE`。

## 强制停止门

- 用户请求范围变化：停止受影响实现，创建 Change Request；只有存在实质产品、行为、预算、合规或数据边界取舍时请求决定。
- 首次模块或边界变化先通过代码、配置和权威工件确定事实；仅实质架构取舍触发模块决定门与 grilling。
- 架构或视觉方案选择记录为 `USER_DECISION` 并回写权威工件；它不是实现操作授权。
- 路径、外部目标、基线或所有权不匹配：停止且报告，不自动回滚。
- 验证通过但实际 diff 越界：不得进入 `PASSED`。
- 发布：必须是独立 Work Item；本地构建或测试通过不授权 A5/A6。
- 非 Cocos 操作：完全处于 `OUT_OF_SCOPE`，不读取 Work Item/Ledger，不进入状态机、F 门或操作批准门。

## 视觉生产硬门

V2 必须完成逐 region 状态分析，记录实际分析证据、目标文件、分析 ID 和完成时间后，才能声明 `component_inventory`。`annotation_number` 只是审阅区域编号，不是资产数量单位；唯一原子部件由 `component_id/atomic_visual_key` 标识，重复实例用 `placements` 表达。效果图拆解分析 PNG、原子部件、状态和资产需求清单必须使用 `visual-decomposition-confirmation/1.0` 记录并由用户 `status=accepted`、`confirmation_mode=manual` 确认后才能进入 Implementation Package；缺失、pending、AUTO、旧字段、漏编号或区域定义变化一律拒绝。

生成式位图的每个唯一 `component_id × required state_id` 必须绑定一个独立位图，并强制 `delivery_mode=individual`、`atlas_allowed=false`，不能使用图集；其尺寸由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max)` 自动计算，`expected_assets.width/height` 必须精确等于该最小值，图片生产基线 `max_dpr=1` 和 `padding_policy=none` 必须存在；运行时实际 DPR 仍由设备动态读取并封顶为 2，历史 1.5/2 倍生产证据须重生成或标记 `stale`。固定视觉组件只允许 `image-generation`、`authored-raster` 或有证据的 `reuse`，交付为真实 PNG/JPG 位图；非图片逻辑、交互热区、碰撞或布局才能使用程序绘制。

V3 `production_contract_audit` 必须逐部件核对实际输出和 `component_usages`；F2 只消费 `validationMode=MACHINE` 的确定性机器事实，不再产生 `production_contract_review` 或 `component_reviews`；V4 还必须绑定 F3 runtime replay、非空 freshness-bound fidelity cases、运行时实际消费及无未批准替换。

Spine 换皮的 `spine_batch_acceptance` 只表示局部批次生产锁定。它必须核对批次 revision、实际审阅图、候选 Cell 和 Region 顺序，但不写入全局 Approval Ledger、不计为场景 V2 拆解确认，也不得绕过 V4 运行态证据。
