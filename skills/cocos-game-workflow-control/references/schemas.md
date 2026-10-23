# 结构化 Schema

所有 SHA、hash、fingerprint 摘要字段仅作可选追踪，工作流不要求、检查格式、复算或比较其值；例子中的摘要字段也不构成验收要求。最终人工验收后再处理摘要核对。实际文件、任务归属、状态、顺序和业务内容仍按下列合同校验；`share`、`shadow` 等业务字段不属于摘要字段。

场景视觉阶段依次使用 V0、V1、V2、V3 和 V4。V3 `v3-formal-acceptance` 证据绑定 `visualManifestFile` 与正式资源验收；V4 Implementation Package 与 runtime candidate 直接绑定当前场景 V2 拆解/布局、V3 资源和实际运行证据。

`display_layer_planning` 不再支持 `deferred_layers`。场景 Work Item 的 `inventory` 只记录场景自有常驻显示层；modal/popup 等弹窗建立独立 DISPLAY_LAYER Work Item，并在自己的 `inventory` 中记录完整事实。弹窗仍必须提供 `host_scene_id`、required state 上下文图和自身 V4 运行轨迹，但其状态不进入宿主场景验收。字段由 `display-layer-planning-contract.mjs` 校验，边界见[控制模型](control-model.md#弹窗工作项与场景解耦)。

机器文件使用 UTF-8 JSON。权威 JSON Schema 位于本目录：

- [Work Item](work-item.schema.json)
- [Approval Ledger](approval-ledger.schema.json)
- [Delegation Package](delegation-package.schema.json)
- [Parallel Delegation Batch](parallel-delegation-batch.schema.json)
- [Execution Unit Result](execution-unit-result.schema.json)
- [Execution State](execution-state.schema.json)
- [Evidence Manifest](evidence-manifest.schema.json)
- [Implementation Package](implementation-package.schema.json)
- [视觉拆解人工确认](visual-decomposition-confirmation.schema.json)
- [Change Request](change-request.schema.json)
- [视觉阶段硬门](visual-stage.schema.json)
- [项目美术 brief](game-art-brief.schema.json)
- [全局视觉基线选择](global-visual-baseline-selection.schema.json)
- [运行美术验收](art-experience-acceptance.schema.json)

## 视觉阶段 Schema

`visualStage` 只能是 `V0`、`V1`、`V2`、`V3` 或 `V4`，`visualStageState` 只能使用带上下文的状态：`global-static-baseline-frozen`、`v2-production-planning-complete`、`v3-formal-acceptance-complete`、`v4-runtime-integration-candidate`（以及明确的过程/失效状态）。裸 `frozen`、未知阶段、缺少阶段语义或冲突声明均失败。

全局基线冻结前必须先建立视觉 brief，生成恰好三张同条件候选效果图，同屏交给人工并由唯一 `SINGLE_HUMAN`/`CONFIRMED` 记录选择其中一张；候选图片路径只允许 PNG/JPEG，文件门还会检查真实图片魔数，不能用同后缀文本伪装。`globalVisualBaselineSelectionRef` 必须绑定独立的选择根证据、三张 generated 图片及生成记录、决定文件和冻结正文实际文件。完整字段见 [`global-visual-baseline-selection.schema.json`](global-visual-baseline-selection.schema.json)，机器文件门由 `global-visual-baseline-contract.mjs` 核对实际文件与业务内容。只有该引用完整通过文件门后才能写入 `global-static-baseline-frozen`；全局选择是独立硬门，不能替代逐场景 V2 拆解图确认。

选择根与决定文件分别使用 `cocos-global-visual-baseline-selection/1.1` 和 `cocos-global-visual-baseline-selection-decision/1.1`，不提供旧格式放行。`brief.path` 的真实内容为 `cocos-game-art-brief/1.0` JSON，绑定生产者 `workItemId`/`briefId`，并声明 `theme`、`audience`、`coreLoop`、`experienceGoals`、`viewingContext`、`visualHierarchy` 和 `stimulusBudget`。预算的 `baseline`、`interaction`、`peak` 各含 `brightnessContrast`、`screenCoverage`、`duration`、`triggerFrequency`、非负整数 `maxConcurrent`、`recovery`、`blendPolicy`；另含 `measurementMethod`。文本预算说明项目实际限制和单位，不虚构通用阈值。

`humanSelection.candidateAssessments` 与实际决定文件中的同名数组按三候选 ID 唯一完整绑定，每项为 `candidateId` 与 `checks`。`checks` 恰含 `themeFit`、`audienceFit`、`readability`、`comfort`、`craft`，各项为 `status=passed|failed|unverified` 和非空 `reason`。所选候选五项均须 passed；未选候选允许失败或未验证，三张全部不合格时不能形成可放行的冻结根。根与决定内容按语义核对，不因 JSON 对象键顺序或候选评估数组顺序变化误报，也不以摘要替代实际内容。判断标准见[游戏美术体验与质量契约](../../cocos-game-asset-integration/references/art-quality-contract.md)，机器验证的是实际人工结果的结构与绑定，不自动判断像素质量。

选择根证据顶层 `workItemId` 是生成并冻结三候选及人工决定的生产者身份；消费者 Work Item 只通过引用的 `path` 复用该根证据，不得将消费者身份写回根、候选生成记录或人工决定。

正式可见视觉集成的 `visualStageEvidenceRefs` 必须为适用的 V2、V3、V4 阶段提供 `path`，由控制面读取实际文件并核对业务归属；内联对象、根 `PASS`、布尔值、说明文字和 Ledger 文本不能满足依赖。V2 引用必须是冻结且 COMPLETE 的 `cocos-scene-v2-reconstruction-plan/1.0`，绑定拆解图、技术 JSON、布局、coverage、生产方案和人工确认；V3 引用绑定正式资产验收及 `visualManifestFile`；V4 引用绑定实际运行候选、正式 Scene 消费和运行证据。摘要仅可选追踪。旧式方向审批不能被 V3/V4/F2 的重复人工记录替代。

V2 布局候选的机器引用必须覆盖同一候选目录的 `layout.png`、唯一 `layout-nodes.json`、`layout-decision.json`、`review.html` 和 `generation-result.json`。scene contract 的 `layout_decomposition.layout_source.nodes_file`、annotation 与 layout confirmation 的 `layout_nodes_file` 必须逐字指向同一文件；布局/确认/decision/receipt 还须与 PNG、决策文件/ID、拆解确认、proposal、target、scene/state 身份逐项一致。scene contract 与 schema 2.0.0 UI 引用合同不得内联第二份布局树；控制面读取实际源文件核对内容与业务归属，不能以页面元数据或根 PASS 代替。PNG、`review.html` 和派生快照仅是只读展示投影，不是第二份手工事实。字段、候选状态、离线模板和自引用规避见[离线布局审阅产物](../../cocos-game-ui-layout/references/layout-review-artifacts.md)。

建议项目布局：

```text
.workflow-control/
  work-items/<workItemId>.json
  approvals/ledger.json
  delegations/<workItemId>-<agent>.json
  delegations/batches/<batchId>.json
  evidence/<workItemId>/<evidenceId>.json
  evidence/<workItemId>/units/<resultId>.json
  evidence/<workItemId>/execution-state.json
  change-requests/<changeRequestId>.json
```

所有新工件必须直接满足当前 Schema；旧单值模块或旧委派格式不能驱动当前任务，不提供兼容路径。

Work Item 保存用户原始请求、目标、当前范围、实施计划、路径和时间，作为协作上下文，不再使用独立 `taskAuthorization` 凭据，也不要求普通任务的授权记录或 F0 授权有效门。A0-A3 直接依据当前用户任务；任务内方案、路径、资源清单和测试范围变化时更新 Work Item/Implementation Package 并重验受影响部分。决定标志只产生 `USER_INPUT_REQUIRED`；只有带外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 具体操作使用 pending 与 Approval Ledger。

所有动作字段使用固定 `cocos-*` 白名单并绑定唯一 A 等级。Delegation Package 和 Approval Ledger 的 Schema 均拒绝非 Cocos 或未知动作；Approval Ledger 只允许 Cocos A4-A6。非 Cocos 操作不创建这些工件，误调用 route/preflight 时直接得到 `OUT_OF_SCOPE`。

操作 pending 与 Approval Ledger 都必须包含非空 `impactSummary`。操作类型、影响、路径、服务、外部目标或任一副作用字段变化后，旧记录不再精确匹配。

Work Item 与 Approval Ledger 使用排序后的非空 `moduleIds`。纯工程 foundation-only 包只需当前任务范围、工程基线、冻结实施包和工程证据即可完成项目骨架与场景无关基础模块，不等待全局三候选；该基础阶段允许最小 Boot/Preload 生命周期、公开契约、游戏数据配置加载与 schema 校验、状态/存档仓库、输入/平台适配、资源目录/加载基础设施和测试支撑，禁止具体场景玩法规则、场景 UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现。只要基础包声明 `visualProductionUnits`、`visualManifestFile`、`visualContractVersion` 等视觉合同或资产生产依赖，就必须通过 `globalVisualBaselineSelectionRef` 文件门和 `globalStaticBaselineState=global-static-baseline-frozen`；一旦声明正式入口或可见资源消费等视觉行为，则回到正式 V2/V3 视觉门。混入 `SCENE`/`DISPLAY_LAYER`/`INTEGRATION` 的包在 V2 `v2-production-planning-complete` 和 V3 正式资源验收通过后即可实施。`executionUnits` 数组顺序是计划制定者预设的唯一执行顺序，控制面只校验/执行，不通过依赖图、闭包或拓扑关系推导顺序。每个单元绑定 `moduleId`；`SCENE` 绑定 `sceneId`，`DISPLAY_LAYER` 绑定 `displayLayerId` 和 `hostSceneId` 且 `sceneId=null`，其他类型三个身份字段均为 null。SCENE/DISPLAY_LAYER 必须填写严格的 `highFidelityPrerequisite`，其他类型必须显式为 null；该对象只引用当前场景 Work Item 的 V2 方案，包含 `workItemId`、`status=COMPLETE`、`stage=V2`、`frozen=true`、scene/layer/host 与仓库内 `evidenceFile`；`targetSha256`、`candidateSha256`、`diffFingerprint`、`evidenceSha256` 均可省略。证据文件统一为 `cocos-scene-v2-reconstruction-plan/1.0` 的单一场景根结果，根提供 `sceneMaster`、`sceneReconstructionContract`、拆解标注图、技术拆解 JSON、拆解确认、生产合同、`visualProductionUnits` 和 `displayLayerContexts[]`。控制面复核任务、candidateVersion、scene/layer/host 与实际文件归属一致。必要业务字段缺失、PENDING、证据越界/缺失均 fail closed，并以 `repair` 原地修复；上游事实未变的机器验证问题以 `revalidate` 重验当前门。只有上游事实失效、任务范围真实变化或硬门将被绕过时才以 `return` 回到最早受影响阶段；普通候选身份变化不触发 `RETURN`。参考还原仅是当前场景实现 Work Item 的可选视觉模式，不建立第二条生命周期。SERIAL 单元各占一个顺序位置，同一非空 `parallelGroup` 的 PARALLEL 单元必须连续出现并视为一个顺序阶段。SHARED/INTEGRATION 强制 SERIAL，MODULE/SCENE/DISPLAY_LAYER 才可进入至少含两个单元的并行组。`fileOwnership` 与实施单元写范围必须双向唯一覆盖且 owner 相同，预期增删文件也必须唯一落入实施单元。

Execution Unit Result 绑定当前工作项、实施包、单元、基线、代码与该单元路径级 diff 指纹、实际成功命令和证据哈希；`files` 必须唯一并指向可读取的实际证据文件；`fileHashes` 可选且不参与验收，只有当前有效 PASS 才满足预设顺序的前序门。目标 SERIAL 单元需要其前面全部单元 PASS；目标 PARALLEL 单元只需要其并行组首项之前全部单元 PASS，同组 peer 不构成前序条件。Evidence Manifest 的 `completedUnitIds` 必须覆盖全部实施单元并由结果复核。A0-A2 Delegation Package 禁止实施单元字段；串行 A3 使用 `delegate-check`，并行 A3 必须通过保存于 `delegations/batches/` 的完整不可变批次执行 `parallel-check`，单独委派不得放行。

`execution-state.json` 是当前阶段实施顺序的可执行状态合同，只能在进入 `IMPLEMENTING` 时初始化，并由通过 `unit-check` 的当前 Result 原子更新：当前单元变为 `COMPLETE`，下一串行单元或下一并行组变为 `IN_PROGRESS`；并行组未全部完成时不得激活后续数组位置。全部单元完成后输出 `WORKFLOW_COMPLETE`，只表示当前 Implementation Package 已闭环，不表示场景 Work Item 完成。同一场景 Work Item 进入下一 V 阶段时，控制面先复核旧包和旧状态，再清空旧 Diff Audit/validation batch、保留旧状态审计并初始化或更新当前阶段状态；所有 V2/V3/V4 证据继续绑定同一 `workItemId`。状态绑定 `workItemId`、`packageId`、`executionUnitIds` 数组顺序和每个 Result 的真实路径；`baselineHash`、计划及结果指纹仅作可选追踪。`delegate-check`、`parallel-check`、`unit-check`、`evidence-check` 和进入 `VALIDATING` 的迁移缺少或篡改状态均 fail closed；SCENE/DISPLAY_LAYER 的 READY、委派和状态激活还必须重新读取并核对实际高保真证据，不能从缓存或全局 PASS 推断。V2→V3 通过显式阶段入口推进；V3 资源验收通过且 V2/V3 文件门闭合后，V4 正式包即可激活。

任务内更新未完成单元的路径或验收计划后，控制面按当前实施包重算执行计划摘要，并继续复核每个已完成单元的真实结果；不因摘要变化重建全部状态。其他模块的 Git 提交不会单独使当前单元失效，当前单元的路径内容或验收命令变化才要求重验。只读检查不写回状态文件，后续正常状态迁移保存新摘要。

构造 Parallel Delegation Batch 时，先将位于 `.workflow-control/delegations/` 且不在 `batches/` 下的全部委派路径排序，记录逐文件 `delegationHashes`，再从委派内容推导排序唯一的 `executionUnitIds` 和 `assignedAgents`，最后计算覆盖这些不可变字段的 `fingerprint`。`parallel-check` 会先复核路径与文件可读取性，再复核派生数组；扫描历史批次时只使用批次内不可变单元/代理索引，不重新读取可能已变化的历史委派文件，任何历史批次结构或指纹损坏都会阻断。

证据必须绑定工作项、批次、时间、实际命令输出、环境、数据源、证据文件、适用门、完成输出、退出条件、判定与未覆盖项；摘要仅作可选追踪。F2 明确 `reviewMode`：A1/A2 可由 assignedAgent 使用 `SELF`，A3-A6 必须 `INDEPENDENT`。安全 A3 和无副作用本地 A4 只要求必要 F0-F3；F4 仅用于带外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6。证据时间不得早于审计；A3/A4 禁止空 diff，A5/A6 回执工件必须位于 evidenceRoot 且可读取。

视觉实施包使用唯一的 camelCase 字段 `visualProductionUnits`，并必须同时提供 `candidateVersion` 和 `visualManifestFile`，摘要字段可选；只要包包含带 `annotation_number` 的区域，就必须携带覆盖全部编号的 `visualDecompositionConfirmation`，每个单元登记同一 `decomposition_confirmation_id`。每个单元按稳定 `annotation_number`、`region_id`、owner、`ownedPaths`、`outputPaths` 和生产方法绑定覆盖区域。固定视觉单元还必须携带 `state_analysis` 和 `component_inventory`：先以 `phase=before-component-splitting` 完成所有常见状态的 `required/not-applicable+reason` 分析，并记录实际证据、目标文件、`analysis_id`、`completed_at`，且 `completed_at` 必须严格早于 `component_inventory.created_at`（相等也失败），再登记唯一原子部件和 placements；runtime-data/runtime-rendered 单元不得携带 component/asset/expected/actual/runtime consumption 身份。效果图拆解分析 PNG、原子部件、状态和资产需求清单必须经过 `visual-decomposition-confirmation/1.0` 的人工 accepted 记录；确认集合同时冻结本次生成、复用既有资源和非图片逻辑编号，缺失、AUTO、pending、漏编号均不能从分析阶段进入实施阶段。`expected_assets` 必须按 `component_id × required state_id` 一一对应；生成式位图使用 `delivery_mode=individual` 且 `atlas_allowed=false`，禁止共享横向组图和图集；固定视觉图片只允许 `image-generation`、`authored-raster` 或有证据的 `reuse`，不得用 `authored-svg`、`cocos-graphics`、`runtime-program`、Canvas/CanvasTexture 或 runtime drawing 生成或替代游戏图片。只有非图片逻辑、交互热区、碰撞或布局才能使用程序绘制。图集切片必须登记 `atlas_size.width/height`，x/y 不得为负且右/下边界不得越界，V3 必须核对正式 atlas 资产真实尺寸。每个 placement 必须显式声明 `interaction_required`；热区必须通过 `interaction_hotspots` 按 placement 一一绑定且不得携带 `asset_id`，不计入视觉资产数量。`visual-assets` 的新合同字段不兼容旧的隐式推断：只有明确 `image_generation_required=true` 才进入 `image-generation` 分类；方法变化必须由绑定区域、工作项、候选版本、用户原文和时间的 `ACCEPTED` Change Request 支持。V3/V4 的审计与复核证据分别使用 `production_contract_audit`、F2 两类机器证据、F3 replay 和 freshness-bound fidelity cases。

旧的单数 `visualDecompositionConfirmation` 不再兼容；实施包必须使用按 `scene_id+state_id` 分组的 `visualDecompositionConfirmations[]`，每组覆盖该组全部新生成、复用和非图片逻辑编号，并冻结 annotation/proposal/decision/receipt 身份。

Work Item 不得内嵌 `userDecisionReceipt` 或 `visualConfirmationAuthority` 自称权威，只能使用 `visualConfirmationAuthorityRefs[]` 引用 `.workflow-control/user-resolutions/` 下的 `user-resolution-ledger/1.0`。编排层收到用户确认消息后才可落盘 ledger；loader 必须读取 ledger/entry/receipt 实际文件，并核对用户消息、线程、当前 Work Item、manifest 的 target/candidate、scene/state 和拆解身份。ledger 只记录视觉确认事实，不是普通任务授权记录，且不得被 Implementation Package ownedPaths/outputPaths 或委派动作覆盖。

确认前置文件只能冻结在 Work Item 根的 `visualConfirmationPrerequisiteFiles` 列表中，不能由实施代理补写。收到用户确认后，非委派控制面写入 ledger/receipt；loader 读取实际文件并核对用户决定来源和任务归属，不比较 `baselineHash` 或 Git blob。V2 ledger 不再记录 `task_authorization_id`；实施代理和委派单元不得创建或修改 ledger；`delegate-check`/`parallel-check` 会把实际委派数组显式交给 authority loader，ledger 路径若落入 ownership/output 即拒绝。
效果图 Evidence 还必须绑定 `scene_reconstruction_contract`：冻结 target 条件、完整 composition、逐区域视觉事实、runtime fidelity obligations、目标绑定 layout/responsive、默认可用性验证或明确选择的精确模式、预声明容差和完整实现计划。V4 fidelity case 按 `visual_validation.mode` 取证：默认 `usability` 关注布局关系和可用性；只有明确选择 `exact` 时才要求严格尺寸/像素差异、side-by-side/overlay/diff 和逐 region 测量证据。

共享核心只维护视觉合同的基础谓词、路径规范化、生产/交付/替换词汇表和处置映射；详细字段约束与结构仍以各领域 JSON Schema 为唯一准据。

生成式位图的源文件、运行时文件和实际输出 MIME 只能是 `image/png` 或 `image/jpeg`，路径扩展名只能是 `.png`、`.jpg`、`.jpeg`；通用 `authored-raster` 不受此专用格式限制。声明 `expected_assets.width/height` 的生成式位图还必须绑定 `normalization_record`（`schema=image-normalization/1`），由 Sharp 记录当前归一化输入/输出路径、尺寸、Alpha、工具版本和完成时间；`alpha=true` 只能交付 PNG 并保留真实 Alpha，`alpha=false` 可交付 JPEG。首次生成输出比例不符时最多再生成一次；第二次仍不符时，若已有冻结裁切焦点和安全事实，可使用 `operation=crop-and-resize-to-contract`，并在 `aspect_ratio_correction` 中记录 `schema=aspect-ratio-correction/1`、触发原因、策略、两条真实原始生成 attempt（`attempt_id`、`generation_record_id`、`generated_at`、文件、实际宽高）、焦点和最大目标比例整数 `crop_rect`；两条 attempt 的实际来源路径必须真实且互不相同；不比较摘要，旧的仅路径数组结构明确拒绝，不要求两次尺寸相同，但第二次实际宽高必须等于当前归一化输入。归一化保持画布比例、Alpha 和主体边界，禁止把棋盘格烘焙成背景，也禁止非等比拉伸、contain、padding、复制边缘和裁切冻结 `reference_target`。已有真实透明图按 provided/reuse 资源合同接入，不伪造生成或去背记录。

Evidence Manifest、Implementation Package 与 Work Item 三份 JSON Schema 共用 `transparentBackgroundProductionRecord`、`transparencyEdgeProfile`、`transparencyGenerationCapability`、`transparencyMaskRecord` 与 `transparencyPreview`。生成资产 `expected_assets.alpha=true` 必须冻结 `transparency_requirements.strategy`（`background-removal|direct-alpha|mask-composition`）和 `edge_profile`（`hard-edge|semi-transparent|glow|soft-shadow|hair|glass|mixed`），记录必须镜像两项并提供非空 `edge_evidence`。所有策略的 generation record 顶层只记录实际 `generator/generator_version`、`parameters`、`postprocess`、`raw_source_file/raw_source_sha256` 和最终归一化 `source_file/source_sha256`；不重复要求顶层 `tool/tool_version`。透明输出声明 PNG 且由验证器解码证明 Alpha。背景去除条件 Schema 仅允许 `edge_profile=hard-edge`，要求不透明源图、背景 HEX、`color_separation_verified=true` 和实际尝试记录；直接 Alpha 的 `capability.tool/tool_version` 必须与 `generator/generator_version` 一致，并要求 `supports_true_alpha=true`、PNG 输出格式、已验证边缘类型及证据；遮罩路线单独记录源、mask、输出各自路径/SHA、处理工具/版本、参数和证据。只有去背路线可以带 `source_background_color` 和 `background_removal_attempts`。`raw_source_has_alpha` 仅表示原始文件是否有 Alpha 通道：RGBA 不透明背景允许为 `true`，不能由 `source_background_mode=opaque` 推断为 `false`。三个策略都要求同一实际候选的浅底、深底预览；构建与 PNG SHA 仅作可选追踪；V3 可 `inspection.status=pending`，V4 必须 `passed` 并附视觉证据。模式、边缘类型、能力和实际文件的跨字段一致性由工作流验证器复核；Schema 不会把工具声明当作真实 Alpha 像素证据。

### 场景还原 schema 与验证命令

效果图 `scene_reconstruction_contract` 的 V1 最低字段包括 `reference_technical_conflicts`（允许空数组但不得省略）、`display_layer_planning`（无显示层也必须显式 `inventory=[]`）、scene master/reference target、宿主上下文图和初步还原草案；规划必须区分 scene master、宿主场景上下文层图和 V2 component×state 生产方案，并声明 `visual_validation.mode=usability|exact`（默认 `usability`，effect-image 不自动启用 `exact`）。V2 固定串行：先产出拆解标注图、技术拆解 JSON 和 `decomposition_elements`，人工修改并确认，proposal 此后作为历史确认输入；再由智能视觉判断基于原图构图、视觉重心与元素语义生成 `automatic-layout-decision/1.0`，逐元素声明水平 `left/center/right` 与垂直 `top/center/bottom`，不得从几何距离自动反推。布局生成器从确认 proposal 与 Stage B decision 生成唯一 `layout-nodes.json`，承载分组、父子、定位参照与布局策略；scene contract 的 `layout_decomposition.layout_source.nodes_file` 和 annotation/confirmation 的 `layout_nodes_file` 必须指向同一文件。schema 2.0.0 UI 合同只引用公共策略与场景合同，不内联 `regions`、`layout_nodes`、`scope.ui_ids`、`fidelity` 或运行快照。PNG、`review.html` 和运行快照只读展示，不成为第二份手工事实或回写 proposal。布局图随后由用户独立确认；布局确认绑定 decision 文件/ID、最终图、唯一布局源路径、上游拆解、scene/state/target 和用户 receipt，任一上游身份变化都必须重新确认。父子/分组变化按原 Stage A 规则更新并重确认。V2→V3 必须绑定拆解图、技术 JSON、唯一布局源、视觉布局决策、布局图、coverage、生产合同、`visualProductionUnits` 及两次人工确认。结构化 fidelity case 不要求候选 SHA 或差异指纹，须记录实际运行结果并提供 `normalization_equivalence.viewport`、`dpr`、`logical_coordinates` 三项等价证明。`usability` 默认记录关键关系和可用性事实，允许合理位置/尺寸差异；仅 `exact` 模式要求严格 `difference_evidence`、target/candidate measurement、delta、预声明 `tolerance_reference`、result、evidence 和（可为空的）`exception_ids`。V4 在正式场景提供同屏组合及瞬态层打开→交互→关闭→底层状态/焦点恢复轨迹。

Evidence Manifest 的 `current_stage` 为 V2 或 V3 时，场景合同和组合验收字段按当前硬门校验，但允许尚未产生 V4 `fidelity_cases`；只有显式 `current_stage=V4` 才要求非空 fidelity cases，并仍由 V4 runtime validator 执行真实文件、F2/F3 和正式 Scene 消费门。

V4 的合同还必须声明 `combination_preacceptance`，固定视觉实施单元必须提供完整 `scene_asset_usage`；F2 只接受带 `validationMode=MACHINE`、当前 baseline/diff 身份和机器 evidence 的确定性验证事实，不再产生 `visual_fidelity_review`、`production_contract_review` 或 `component_reviews`。默认 `visual_validation.mode=usability` 时，机器事实验证关键关系、可读性、边界和交互，不强制像素级差异或全视口/全状态矩阵；`exact` 仅在明确精确需求时启用。旧的独立资源或缺任一新增 effect-image 字段的工件不兼容当前 schema。

验证器命令示例：

```text
失败：node skills/cocos-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4
典型输出：current_stage=V4 必须显式 checkFiles=true；未执行真实文件门，V4 FAIL

失败：node skills/cocos-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V2 --check-files --project-root .
典型输出：[V2] ... 根因=方案缺失 ... 缺失视觉事实=visualDecompositionConfirmation ... 处置=repair ... 当前门阻断

成功：node skills/cocos-game-asset-integration/scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .
典型输出：结构合同、F2 `validationMode=MACHINE` 确定性机器检查、逐区域 fidelity、runtime replay 和文件门均通过；返回码 0。
```

根因只使用 `方案缺失`、`执行问题`、`验收问题`。缺字段或记录问题先 `repair`，上游事实未变的机器验证问题用 `revalidate`；只有 `upstream-fact-invalidated`、`scope-changed` 或 `hard-gate-would-be-bypassed` 时才给出 `returnStage`，并取最早受影响阶段。普通候选身份变化不触发回退。

场景 V2 不再保留旧式 `visual_human_approval`。还原方案确认使用 `visual-decomposition-confirmation/1.0`，绑定拆解图、技术 JSON、生产方案、target、baseline、candidate/diff、全部编号和用户原文。`v2Artifact.human_review`、`v2StructuredReview`、`combinationPreacceptance`、`structuredFidelityCase.human_review`、逐 `fidelityRegionResult.human_review`、F2 review 和 `component_reviews[].human_review` 均不是人工审阅要求；这些工件必须改用当前身份绑定的确定性机器 evidence 和 status，hash 可选且不参与验收。V4 COMPLETE 的 `all_visual_artifacts_human_reviewed` 不能单独满足 schema/运行时硬门。

上述限制针对机器工件中的重复审阅字段，不取消现有选图、拆解、布局和运行验收中的实际人工视觉确认。观看舒适、主题/受众适配与美术完成度意见保存在现有任务验收材料，机器 F2 的 `validationMode=MACHINE` 只表示事实核对；不能将其单独表述为美术或持续游玩已通过。

V4 实际运行候选的 `artExperienceAcceptance` 使用 `cocos-art-experience-acceptance/1.0`，引用[运行美术验收 Schema](art-experience-acceptance.schema.json)。它绑定 work item、candidate 与场景上下文，保存五项 checks、实际用户原文和确认时间，以及观看情境和四类 scenarios：`normal-play`、`repeated-feedback`、`event-peak`、`overlap-peak`。正常使用必须 required；其他情境允许有理由的 not-applicable。required 记录真实 `recordingFile`、有效起止秒数、非负整数触发次数/并发和人工观察；not-applicable 的文件、时段和计数为空，不伪造检查。整体与五项 checks 全 passed、文件可读取且身份正确后才满足 V4 完成门。机器只校验人工结果与录屏文件绑定，不分析视频、不自动生成通过结果；该对象属于现有运行验收，不恢复旧复核字段或新增审批阶段。

效果图相关 Schema 统一使用 `origin=provided|generated`。generated 的 `reference_target`、上下文效果图、V2 artifact 或原子 expected asset 必须带 `generation_record`；provided 禁止带生成记录。generation record 的身份字段、完整 `style_reference_inputs`、canonical 全局视觉一致性提示词、`style_drift_policy=forbid`、实际 `full_prompt`、输出文件、`consistency_status=passed` 与 `consistency_evidence` 由共享合同进一步校验，Schema 不承担项目具体美术风格解释。
