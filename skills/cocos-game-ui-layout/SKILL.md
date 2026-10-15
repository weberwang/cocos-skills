---
name: cocos-game-ui-layout
description: 为 Cocos Creator 3.x 游戏建立可验证的 UI 布局合同、坐标空间、响应式重排与证据门禁；当实现或审查游戏 UI、HUD、弹层、滚动区域、安全区、断点、动态文案或视口适配时使用。
---

# Cocos Creator 3.x 游戏 UI 布局

正式渲染 Node、Canvas UI 与独立显示层统一遵守[显示节点锚点与层级](references/display-object-layering.md)：具有 `UITransform` 的节点默认使用中心 `anchorPoint=(0.5, 0.5)`；例外逐对象记录原因并换算。场景须声明背景、世界、特效、HUD、瞬态层的实际层序、输入和生命周期归属，并在 V4 正式 Scene 中验证运行遮挡。

UI 布局参照按[场景与弹窗尺寸参照](references/layout-hierarchy.md#场景与弹窗尺寸参照)统一确定：全屏 UI 的父级是场景，按场景逻辑尺寸相对布局；弹窗有底板时，内容按底板对应功能容器的宽高相对布局；弹窗没有底板时，按宿主场景逻辑尺寸相对布局。弹窗底板容器本身相对场景定位，底板位图与内容一起归属该容器；全屏装饰背景仍是独立显示层。安全区约束关键内容的可见范围，不替换这三种尺寸参照。

效果图 V2 拆解与布局遵守[功能语义分组约束](references/functional-semantic-grouping.md)和[Cocos UI 节点组织](references/layout-hierarchy.md)：先在编号拆解图上确认位置依赖与信息分组，再由代理自动整理停靠方案并展示布局图/预览确认；不先发文字方案要求确认。位置依赖方必须成为被依赖元素所对应布局容器的子元素，共同表达同一信息且彼此无位置依赖的元素列为同组同级项。父容器职责、布局所有者、尺寸、溢出、安全区和输入归属仍在技术合同中维护；禁止按文字类型或几何最小包含关系自动归父级。

## 全局控制接入

控制面边界：可提议、可审查、可在当前用户任务的 Work Item 范围内修改，且必须回到 `$cocos-game-workflow-control` 审计和状态迁移；仅涉及外部写入、付费、真机、破坏性或发布副作用的 A4-A6 操作请求批准，普通可恢复的本地文件清理沿任务执行。

本领域可提议、审查，并在当前用户任务、Implementation Package、A 等级与路径范围内修改布局；所有动作与证据回到 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 审计和状态迁移。布局合同和 V 阶段不能旁路带副作用的 A4-A6 操作批准或全局状态。

Creator 编辑器、AssetDB、Scene/Node/Component、Prefab 和构建操作按[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)执行，并先读取实时工具 schema；不得手写 `.scene`、`.prefab` 或 `.meta` 绑定。AssetDB refresh/等待 `.meta` 不证明导入、子资源或脚本编译完成；构建面板打开和 worker ready 也不证明构建/预览成功。缺少真实结果时记录 pending/blocked。

将 UI 布局从页面坐标修补转换为可追踪的布局合同，并把合同、实现、运行时证据接入全局控制面。仅负责布局关系、坐标空间、尺寸策略、响应式重排和布局证据；不拥有全局状态、审批、玩法规则、资源生产、视觉方向或发布放行。

## 全局视口与高分屏合同

所有可见 Scene、HUD、弹窗和 `DISPLAY_LAYER` 都必须在布局合同中填写 `logicalViewportSpace`、`designResolutionPolicy`、`canvasBackingPolicy`、`runtimeDprPolicy`、`maxRuntimeDpr`、`scaleMode`、`cameraViewportPolicy`、`cameraZoomPolicy`、`cameraOriginPolicy`、`inputCoordinatePolicy`、`safeAreaPolicy`、`resizePolicy`、`orientationPolicy`、`textResolutionPolicy`、`assetResolutionPolicy`、`performanceBudget`、`representativeViewports` 和 `requiredRuntimeEvidence`。`orientationPolicy.allowed` 声明项目支持的方向；`designResolutionPolicy` 只需提供这些方向的分支，`targets.orientations` 与其一致。竖屏以 1080×1920 为设计基准并按宽度适配，横屏以 1920×1080 为设计基准并按高度适配；另一轴随视口展开或裁切。Canvas 填满 CSS 视口，装饰性背景等比 cover，禁止黑边。Canvas backing 由 CSS 尺寸乘有效 DPR（向上取整）得到，物理像素不得直接用于布局或命中。

运行时 DPR 从设备动态读取，非法输入回退 1，正有限值封顶 2，且必须覆盖 resize、显示密度变化以及双方向项目的方向切换并清理监听器。资源生产 DPR 固定基线为 1（逻辑尺寸 1:1），必须与运行时 DPR 分离。Creator `scaleMode` 按冻结设计分辨率选择 `FIXED_WIDTH`、`FIXED_HEIGHT` 或有实测证据的 `custom`；实施包必须证明实际设计视口、Camera 映射、Canvas/backing 尺寸、输入变换和 DPR 的关系，不能只靠声明模式或构建面板状态认定高分屏适配通过。弹窗默认继承宿主逻辑视口、DPR、安全区、Camera 和输入合同，V4 必须独立记录其运行轨迹。

## 视觉语言默认原则

玩家可见内容按[游戏内文案](references/game-copy.md)优先用图片、图标、数字、符号和视觉状态表达；如金币图标 `+100` 已表达奖励，不再写「获得 100 金币」。必须有文字时只保留必要的短名称、短动作或短状态。图标有歧义、首次必要引导或操作后果无法直接看懂时，补充最少说明；精确数值本身不要求解释句。无障碍名称保留但不必成为可见标签。F2 检查重复说明、数值归属、通用图标堆叠和功能自解释性。

程序化文本必须同时交付英语、简体中文、日语、俄语和西班牙语，并逐语言验证字形宽度、字体回退、基线与容器适配。每种语言独立声明 `single-line` 或 `wrap`，允许部分语言单行、部分语言换行，但均不得截断；空间不足时按该语言策略精简必要文案、调整字距/字号、扩展容器或合理换行，不得降到不可读字号。倍率使用 `x{value}`，数值变化使用对应图标与 `+10` 等表达；本地化不应把图标与数值重新扩写成解释句。

布局验收默认使用 `visual_validation.mode=usability`：位置、尺寸、边距、换行和少量对齐差异只要保持清晰、可读、可操作且不越界、裁切或关键遮挡即可通过；effect-image 也不自动启用 `exact`。只有用户明确要求像素级还原或项目合同明确指定时才选择 `exact`，启用严格容差、逐项 delta 和全视口/全状态矩阵。V2 仍必须保留拆解顺序、父子归属、锚点语义和内部几何一致性。

用户明确要求参考布局一致时，在已有关键项中声明适用视口和几何容差；已声明的关键矩形约束即使在 usability 模式也必须满足。这只收紧所声明的项目要求，不自动启用整屏像素差或全矩阵。实际可见主体、字形与布局矩形的差别按校准参考由用户检查。

九宫格 UI 的源图生产尺寸、切片边宽和目标显示框分别声明，读取[拆解时确定九宫格](../cocos-game-asset-integration/references/nine-slice-ui.md)。V2 节点和 V3 expected asset 使用同一合同，V4 直接按此合同装配；文字默认禁止实际内容超出目标框，显式允许溢出时仍需人工检查邻项与留白。

## 核心流程

正式场景的布局校准与关键几何验收读取[布局校准与参考还原](references/layout-calibration.md)。V4 直接消费冻结 V2 布局与 V3 正式资源，在实际 Cocos Scene 中调整并复验受影响范围；布局矩形与素材可见边界分别检查，不能用可用性通过代替参考还原。

1. 读取项目的 GDD/TDD、当前候选、总控审核漏斗和适用视觉阶段；确定稳定 UI ID、坐标空间、参照物、状态与平台输入。
2. 复制 schema 1.2.0 [合同模板](assets/ui-layout-contract-template.yaml)。普通布局使用 `not-applicable` 并保持 `layout_nodes: []`；冻结视觉目标先用 `frozen-target/specified`。同时冻结上述根级视口/DPR/Camera/Input/性能字段，禁止使用旧 `targets.scale` 字段绕过新门禁。V2 先按位置依赖建立父子、按共同信息建立同级分组，代理内部维护完整技术 JSON 和 `decomposition_elements`，直接展示编号拆解图供人工确认；屏幕 UI 的 `ui_layout` 职责字段也保留在技术合同中。拆解图确认后由智能视觉判断生成逐元素 `left/center/right × top/center/bottom` 决策，再由同一入口同步生成布局 PNG、`layout-nodes.json`、`layout-decision.json`、离线 `review.html` 和 `generation-result.json`，用户直接检查最终布局图/审阅页并独立确认。无需先后确认文字提案或技术记录。随后登记由已确认元素和视觉决策共同推导的非空 `layout_nodes` 与关键对齐合同。
3. V3 正式资源验收后直接进入 V4：按[正式场景视觉还原与校准](../cocos-game-asset-integration/references/visual-alignment-authoring.md)在正式 Scene 中消费 V2 节点与布局合同、V3 验收资源，接入实际交互、动态数据和 required state。坐标、尺寸和响应式调整写入正式布局配置；冻结的 V2 节点结构仍按上游合同管理。具体 Cocos 视口、Camera、输入与幂等重排规则见[Cocos 适配参考](references/cocos-adapter.md)。
4. specified 阶段运行结构检查 `node scripts/validate_ui_layout_contract.mjs <contract>`；verified 正式验收必须运行 `node scripts/validate_ui_layout_contract.mjs <contract> --check-files --project-root .`，读取冻结原图并检查目标/运行/parity 证据文件。
5. 按 [证据矩阵](references/evidence-matrix.md) 生成 `orientationPolicy.allowed` 对应的代表性视口、关键状态和窄/宽尺寸证据；只支持单一方向时不验证另一方向，但仍覆盖同方向尺寸、DPR 和同页连续 resize。关键 UI/HUD 记录稳定 element/reference ID、双轴关系、目标/运行测量、实际测试 ID/状态、视觉证据和项目定义容差。V4 还必须记录 CSS/backing 尺寸、raw/effective DPR、Camera、输入命中、同页 resize 和独立 DISPLAY_LAYER 轨迹。`exact` 或明确的全覆盖需求才扩展到完整矩阵和严格 delta，方向轴仅覆盖项目支持方向。
6. 按 [工作流门禁](references/workflow-gates.md) 接入 V0、V1、V2、V3、V4、F0–F4 和 G0–G3；只有布局结构、父子归属或参照关系真实变化才退回最早受影响的 V1/V2，普通位置/尺寸调整更新正式布局配置并重验受影响区域，F3 只接受绑定当前候选的工程证据。

正式场景依据项目现有 Cocos Scene 结构和布局合同实现。V2 锚点、父子 bounds、资源 origin 与 Cocos 父级局部坐标分别处理，祖先偏移只累计一次。V4 直接加载已验收资源并在真实 Cocos Scene 中组合；背景覆盖按实际可见视口计算，图片按冻结 fit/裁切规则呈现，不能缩进安全区、留边或平移露出空隙。图片 fit 和 Cocos 文字字段按适配参考执行；资源/字体未就绪、布局或渲染异常必须令运行验收失败。Scene 创建、唤醒和 resize 使用同一幂等布局入口；发布画面不含编辑辅助内容。运行证据来自正式场景的实际消费与画面。

正式场景的设计画布尺寸、主轴与另一轴的展开或裁切规则由项目布局合同定义；合同采用固定设计视口时，可使用 `assets/fixed-design-viewport.mjs`。设备 CSS 像素只决定显示尺寸。背景必须覆盖完整可见场景，位置由合同与实际视口共同决定，不能用编辑器中的拖动或临时偏移改变冻结目标。

## effect-image 场景绑定

当 Work Item 的 `effect_image_reconstruction.applicability=effect-image` 时，布局合同必须携带 `scene_reconstruction_binding`：记录冻结目标文件、scene/state、visual baseline、reconstruction contract 版本、`layout_decomposition_version` 和目标 viewport。`layout_nodes` 中每个节点必须同时绑定一个 `regions`/`scope.ui_ids` 区域和已声明坐标空间，记录参照、双轴锚点、目标 bounds、尺寸策略、层级、裁切、响应式规则与计划测试 ID；同一 coverage region 可以承载多个 layout nodes，但节点间必须使用唯一 `layout_node_id`，多节点区域不能用 region ID 作为有歧义的参照；关键对齐通过 `layout_node_id` 复用这些几何事实。该绑定描述正式 Scene 的目标关系，不能用旧通用布局合同、整屏截图、隐藏覆盖层或绝对叠图代替；只有实际目标内容、父子归属、构图关系或响应式不变量真实变化时，V2→V3 才退回 V1/PROPOSAL。其他 viewport 默认验证合同声明的不变量和可用性；只有 `visual_validation.mode=exact` 或明确精确需求时才要求目标 viewport 的严格还原。

V2 的布局决策顺序固定为“代理内部生成拆解事实和技术 JSON → 展示编号拆解图并人工确认 → 代理自动生成双轴对齐决策及独立布局图/审阅页 → 展示布局图并独立确认 → 冻结 V2”。用户可直接按图号指出拆解或布局需要调整，代理更新技术事实并重出相应图片；不另行等待文字方案确认。布局生成入口仍拒绝未确认拆解、缺失决策、元素漏绑或未绑定当前 scene/state/target 的输入；两次图像确认分别绑定上游拆解、视觉决策文件和最终布局图身份。

效果图节点还必须声明 `parent_layout_node_id`、`parent_target_bounds`、`relative_position` 和 `axis_alignment`。拆解确认后，智能布局结合原图构图、视觉重心和元素语义，为每个元素显式判断水平 `left/center/right` 与垂直 `top/center/bottom`；该判断不能由四边距离自动反推。`relative_position` 仍由父子 bounds 测量，用于复核包含关系和几何漂移；`offset`、`self_anchor`、`reference_anchor` 则按已选 `axis_alignment` 计算。`reference_id` 必须等于父 ID，父级仅可为具体节点或 `viewport`/`safe-area`，不得循环。视觉决策文件及其 ID 会进入布局图和确认记录，缺失决策必须阻断布局生成。

## 资源导航

场景 `display_layer_planning` 只记录 scene master 与常驻 HUD。modal/popup 等瞬态弹窗建立独立 DISPLAY_LAYER Work Item，在自身合同中记录宿主场景、生命周期、输入阻断、层级、遮罩、焦点恢复和响应式事实，并于自身 V4 同屏验证打开→交互→关闭后的底层布局恢复。弹窗证据仍绑定 scene/layer/host，但不进入宿主场景验收。

- 需要字段、关系表达或不变量写法时，读取 [references/layout-contract.md](references/layout-contract.md)。
- 需要 Creator `Canvas`、`UITransform`、`Widget`、`Camera`、坐标转换、resize 或重排边界时，读取 [references/cocos-adapter.md](references/cocos-adapter.md)。
- 需要对象默认锚点、例外或跨层合成顺序时，读取 [references/display-object-layering.md](references/display-object-layering.md)。
- 需要 UI 根节点、父容器职责、`ui_layout` 字段或 V1/V2/V3/V4 节点组织规则时，读取 [references/layout-hierarchy.md](references/layout-hierarchy.md)。
- 需要 V/F/G 门禁、退回和候选绑定规则时，读取 [references/workflow-gates.md](references/workflow-gates.md)。
- 需要组合测试、等价类削减或冻结 Golden 条件时，读取 [references/evidence-matrix.md](references/evidence-matrix.md)。
- 需要布局审阅页、同批产物、坐标映射、摘要追踪或离线安全边界时，读取 [references/layout-review-artifacts.md](references/layout-review-artifacts.md)。
- 需要在正式场景中批量校准、检查对齐/间距或判断还原偏差来源时，读取 [references/layout-calibration.md](references/layout-calibration.md)。
- 合同验证器只接受 JSON-compatible YAML（合法 YAML 1.2 的 JSON 子集），详见合同参考；直接使用 Node.js `JSON.parse`。

## 所有权与输出

布局技能输出合同版本、布局计算输入/输出、不变量和证据索引。玩法继续独占规则、状态和交互；架构维护坐标空间与模块边界；美术维护纯表现资源和预制数据；QA 只读验证可达、截断、遮挡、触控、滚动和证据。布局计算与 Node/UITransform 运行测试验证关系不变量，不把孤立绝对坐标当作通用验收标准。汁水感任务可按需参考[动态反馈设计指南](../cocos-game-juice/references/design-guide.md)；反馈对象的视觉偏移应使用独立表现偏移，不覆盖布局合同中的基础位置、焦点和坐标所有权。
