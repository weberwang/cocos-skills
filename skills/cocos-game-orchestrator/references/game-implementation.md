# 游戏实现规则

Creator 编辑器、AssetDB、Scene/Node/Component、Prefab、构建和预览操作统一经[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)路由，并以实时 `tools/list` 参数 schema 为准；不手写 `.scene`、`.prefab` 或 `.meta` 绑定。刷新等待 `.meta` 不证明导入/编译完成，需查询真实资源和 UUID、核验子资源、保存后读回。当前 MCP 仅打开构建面板或报告 worker ready 时，实际运行/构建保持 pending/blocked。

瞬态弹窗建立独立 DISPLAY_LAYER Work Item；缺参考上下文时停留在弹窗自身前置门，不写入宿主场景 `deferred_layers`。场景只完成自身画面和常驻 HUD，弹窗未完成不影响场景 V4。弹窗正式代码仍需自己的 V2/V3、冻结宿主公开接口和互斥所有权。

实现按可验收场景闭环。玩法独占规则、状态、碰撞和交互代码；美术可维护纯表现层资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则、碰撞语义或状态所有权。G1 内部顺序不构成第二套全局状态机。

## 默认实施闭环

在当前用户任务、适用的 A0-A6/F0-F4 与 V0、V1、V2、V3、V4 阶段硬门允许的边界内，执行/实施使用最小充分事实而不是穷尽式研究：入口、关键调用链或契约、范围、主要风险和验收目标明确且无直接冲突后，立即停止探索；A1/A2 冻结当前候选的范围、假设与验收边界，直接进入适用执行/验证；A3 冻结 `Implementation Package` 后进入实施。可逆、本地的 A1/A2 可记录合理假设后落地，A3 可记录合理假设后实施但必须先冻结包；缺少完全证明不单独阻塞。任务内方案、路径和资源清单可随实施更新计划并重验受影响部分。

仅 A3 包冻结后，implementer 只按包执行，不重新开展开放式方案探索；遇到需求/范围变化、实质冲突或无法实施才返回。默认顺序为：`最小必要事实确认 → 冻结候选边界（A3 冻结 Implementation Package）→ 执行/实施 → diff-audit → 推荐并自动执行适用等级的定向验证 → 仅按失败证据修正 → 完成`。已确认事实不重复读取/搜索/复核；每轮返工必须由测试/类型/构建失败、运行异常、需求不满足、安全或越界问题、可复现缺陷或硬门明确失败驱动；用户明确改变需求/范围时，按真实受影响门重跑。普通候选身份变化按当前门重验，不触发 `RETURN`；另一种可行方案或非阻塞发现不能单独推翻满足需求的实现，记录为未覆盖项/后续事项即可。上述闭环不放宽用户决定、带副作用的 A4-A6 精确批准、视觉硬门、证据来源与真实性或共享工作区安全约束。

## G1 强制实施序列

基础实施先按[游戏项目目录规范](../../cocos-game-architecture/references/project-structure.md)冻结入口、基础模块、场景、显示层、平台适配、资源、测试和产物的路径与所有权；产物分别按[产物存放与证据边界](../../cocos-game-architecture/references/artifact-storage.md)写入临时、候选、确认、源素材、正式资源和人工作业审阅/验证目录。根级 `evidence/` 不作为机器 `evidenceRoot`；工作流机器记录和受限证据字段按控制工具真实布局执行。按实际需要创建目录，后续实施沿同一映射落盘。

Android/iOS 原生平台功能按[原生平台插件选型](../../cocos-game-architecture/SKILL.md#原生平台插件选型)优先复用现有插件，再选择适用的官方或社区插件；仅在明确能力缺口下补充自建原生实现。实施包记录插件选型与平台适配边界，必要宿主配置和冷启动/恢复验收仍按对应约束执行。

1. 全局基线、foundation-only 边界和项目状态顺序按[控制模型](../../cocos-game-workflow-control/references/control-model.md)与[状态、阶段与停止门](../../cocos-game-workflow-control/references/state-gates.md)执行；编排层只建立“需求 → 功能 → 模块 → 场景 → 正式资源 → 测试证据”的追踪。
2. foundation-only 仅承载 `SHARED` 最小骨架和 `MODULE` 场景无关基础能力；在此阶段完成游戏全屏显示和 Android 启动、运行无标题栏，按下述基础显示约束实施，并按[后台暂停与恢复约束](../../cocos-game-audio/SKILL.md#后台暂停与恢复约束)实现音频进入后台暂停、返回前台从原位置继续播放；具体场景玩法、UI/布局、正式可见资产消费、Boot→正式可见 Scene 接入和删除旧视觉实现留在场景或集成范围。
3. 每个场景 Work Item 先在 V1 冻结功能规格、scene master/reference target、宿主上下文和视觉合同；V2 先完成拆解确认，再完成布局确认；V3 完成正式资源验收。
4. V4 直接消费 V2 已确认的布局目标和 V3 已验收资源，按冻结 `executionUnits` 实现场景与紧邻从属显示层，并完成运行态视觉接入、功能/视觉联合验收和清理；任务范围内场景闭环后才进入跨场景 `INTEGRATION`，无副作用本地集成可按任务执行，外部写入、付费、真机、破坏性或外部删除和发布仍按控制面精确批准规则执行。

场景 V1 同时冻结[显示节点锚点与层级](../../cocos-game-ui-layout/references/display-object-layering.md)方案：具有 `UITransform` 的渲染 Node 默认锚点为中心 `(0.5, 0.5)`，例外逐对象说明；背景、世界、特效、HUD 和瞬态层按实际职责划分有名根层并明确前后、输入与生命周期。V2 将 Node 锚点和层序映射到布局/显示层合同，V4 在正式场景中检查资源组合、遮挡、最上层命中及关闭/resize 后恢复。这里的渲染分层不把世界对象或特效变成独立 `DISPLAY_LAYER` Work Item。

通用帧动画是场景路线中的动态资源子路线，按[分类入口](../../cocos-frame-animation/SKILL.md#分类入口)选择用途，再按[来源路线](../../cocos-frame-animation/SKILL.md#来源路线)默认视频抽帧；图片递归补帧须用户明确选用。主代理按[执行代理约定](../../cocos-frame-animation/SKILL.md#执行代理)先按观看体验与表演协调难度安排动画导演／动作指导：简单任务由对应专业设计师兼任，复杂任务独立委派导演统一构思，再按用途类型委派设计师细化；混合任务明确表演、事件与空间交接，固定画布/区域不锁死角色朝向、姿态或画内位移，实际图片生成/编辑交图片代理。V2 内部维护行为、阶段、事件、衔接、尺寸、FPS 和批次计划，方案完成后先按[设计理念说明](../../cocos-frame-animation/references/intent-driven-design.md#方案完成后阐述设计理念)向用户阐述目标感受与动作依据，等待用户明确确认当前动作方案后，才在已有授权内写提示词、制作真实候选和推进具体实现；只有关键玩法事实存在决定性歧义时询问。视频分辨率与条数按[区域规划](../../cocos-frame-animation/references/region-planning.md)选择并遵守预算；图片默认 768p，确需 2K 时在已有工具与预算授权内直接选择，新增费用或超出授权才询问。V3 验收实际最终抽帧视频后才抽帧，图片首尾、关键帧与递归父图逐张确认后推进，最终验收完整真实序列。只确认文字方案不能代替真实候选验收。保留独立图集、报告、预览、来源与修图成果，V4 完成正式 Cocos 消费和事件验证；完整证据与 schema 分派见[接入合同](../../cocos-frame-animation/references/workflow-integration.md)。

## 基础显示约束

- 在实现基础模块时，将游戏容器和 Cocos 画布设为填满实际可用视口；视口、方向或窗口尺寸变化后同步重算画布和输入映射。该能力归属场景无关的平台/显示适配模块，不等待正式场景或视觉资源完成。
- 项目目标包含 Android 时，必须同步修改原生宿主：启动主题、启动画面切换后的 Activity 主题及运行窗口均不显示 Android 窗口标题栏或 ActionBar；从冷启动首帧开始到游戏运行全程不得出现应用标题或标题栏占位，不能仅在 Web 页面或首场景加载后隐藏。
- Android 游戏采用沉浸式全屏，隐藏系统状态栏和导航栏；进入前台、窗口重新获得焦点及原生界面返回后恢复全屏。系统手势临时唤出的系统栏按平台行为自动收起，不得因此改变无标题栏要求。全屏后仍按实际安全区处理刘海、挖孔和手势区域，保持画布尺寸、布局与触控坐标一致。
- 在基础实施包和 TDD 中记录显示模块所有权、Android 启动/运行主题与窗口配置、全屏生命周期以及验收项。Web 目标完成视口铺满；只有实际采用 Android 宿主时才实施原生配置，不因本约束额外引入 Android 平台。
- 基础工程验证检查启动与运行主题、Activity 配置、全屏恢复路径和视口适配，并执行适用的定向测试或构建。运行验收覆盖冷启动、启动画面切换、后台返回、窗口焦点恢复和方向变化；没有实际运行证据时明确记录未验证项，不得用源码检查或构建成功宣称启动/运行显示已验收，也不得自动发起真机验收。

## 单场景完成闭环

每个场景以 `SCENE` 聚合自身完成事实：依次完成 V1 scene master/reference target、视觉合同与初步还原草案，V2 拆解/布局确认与生产方案，V3 正式资源验收，V4 正式功能实现与运行态验收。modal/popup 等 `DISPLAY_LAYER` 建立独立 Work Item 和实施包，复核自己的上下文图及 scene/layer/host、V2/V3 身份；其缺图或未完成不扩散为宿主前置失败。

场景和显示层分别记录 `functional_status`、`resource_status`、`integration_status`、`lifecycle_cleanup_status` 和 `verification_status`。这些字段是领域完成事实，不得冒充或驱动全局状态。显示层仍复用同一 V0、V1、V2、V3、V4 阶段及 A0-A6、F0-F4，不建立第二套全局状态机；只有功能、资源、宿主集成、生命周期清理和验证五项均关闭、所有资源归属明确且证据绑定当前候选时，显示层或场景整体才完成。

### 场景与显示层效果图产物

- `scene master`：基础场景、常驻 HUD/导航/状态栏和默认状态；互斥 modal、popup、drawer、toast 不得同时塞入主图。
- `contextual layer images`：每个瞬态层的 required state 都单独出图，但必须包含宿主场景、遮罩/层级、显示层和当前状态，并绑定实际宿主目标、显示层目标和 viewport；孤立组件图只能作为 V3 生产参考。
- `V2 component × state plan`：在拆解确认阶段独立拆解组件和状态；V4 在正式场景组合并验证，重放打开→交互→关闭→底层状态/焦点恢复轨迹。

### V4 正式场景实现与验收

V4 直接消费 V2 确认的节点关系、初始布局和锚点，以及 V3 `accepted` 的正式资源；在项目正式 Cocos Scene 和布局合同中实现可交互结构。实现前后按[正式场景视觉还原与校准](../../cocos-game-asset-integration/references/visual-alignment-authoring.md)及[Cocos 布局实现参考](../../cocos-game-ui-layout/references/cocos-adapter.md)处理坐标空间、父子偏移、资源 origin、背景覆盖和 resize。运行时资源、字体、布局或渲染错误必须令实际运行验收失败；V4 仍需提供正式场景运行证据，并由用户检查画面。

## 增量流程

1. 冻结玩家行为、模块契约、所有权、验收、服务复用和 V0 类型。模块边界变化先查事实，仅实质取舍触发模块门和 grilling。F4 只处理带副作用的 A4-A6 决定。
2. 场景 V1 时定义状态、输入、规则、反馈和必要低保真草图/灰盒；正式场景功能代码不得在 V1/V2 前写入。指定效果图还原时，V1 生成或接收并冻结 scene master/reference target、宿主上下文图、参考身份、目标视口/状态、对比条件、可观察视觉事实和初步还原草案，并声明 `visual_validation.mode=usability|exact`（默认 `usability`）。默认允许小幅位置、尺寸、边距和换行差异；改变产品方向、玩法语义或上游结构，或明确要求 `exact` 时才请求一次 `USER_DECISION`。
3. 场景 V2 基于冻结效果图输出拆解图、技术 JSON、coverage、布局/placement 三方绑定、component×state、显示层规划、文本拆解和生产方案；经用户确认的 `visual-decomposition-confirmation/1.0` 是包含场景/集成单元的正式视觉生产边界。基础阶段的 foundation-only 包不属于场景 V2；纯工程包无需等待全局静态基线，具有视觉依赖的基础包仍须先完成全局静态基线冻结。`usability` 仍需拆解图确认和关系证据；只有 `exact` 或明确全覆盖需求时才要求逐状态/逐区域完整矩阵。
5. 普通资产和效果图还原的清单字段、状态分析、component×state、生产合同与文件校验以[视觉生产管线](../../cocos-game-asset-integration/references/visual-production-pipeline.md)及对应 Schema 为准；编排层只确认当前场景的 V2 两次确认、V3 资源验收、V4 实施包和运行证据引用完整。

效果图的 coverage、layout/placement 双向绑定和父子/双轴关系以[UI 布局合同](../../cocos-game-ui-layout/references/layout-contract.md)为准。编排层只确保这些产物属于当前场景 Work Item，`DISPLAY_LAYER` 紧邻宿主 `SCENE`，V4 正式场景实现和运行态证据均引用同一份 V2/V3 场景事实。

高保真布局节点的父子几何、双轴对齐和身份投影按[UI 布局合同](../../cocos-game-ui-layout/references/layout-contract.md)执行；运行时只能消费校验通过且已完成 V2 布局确认的结果。
6. V3 生产并验证资源；只有机器清单状态为 `accepted` 且来源或生成记录、适用的版权/许可信息、正式布局、运行时输出、Cocos 和玩法视觉证据完整时，V4 才能消费这些资源实施正式场景。效果图区域还必须逐 `annotation_number/region_id` 显式声明七个生产合同字段以及状态/部件映射；不得在 V3 之前以占位资源启动正式功能代码。

原子部件补充：`component_count` 只计唯一 `atomic_visual_key`，重复可见实例必须用多个 `placements` 和 `visible_instance_count` 表达。② 六按钮逐部件登记；⑧ 三个相同表面可为一个 component 加三个 placements；⑨ 按实际复用关系登记。生成式位图每个唯一 component×required state 只允许独立位图，强制 individual 且禁止 atlas；说明、图例和 atomic image requirements 放在标注图右侧栏，左侧原图只保留框和编号/placement 标记；热区逐 placement 绑定，不计入资产。
7. V1 灰盒只用于隔离验证结构与交互，不注册正式入口或承载正式业务逻辑。V4 按 V2 拆解与布局、V3 正式资源实现正式 Scene，由玩法和美术协作完成结构化接入、动态验收和低保真清理；正式资源绑定场景/覆盖区域，效果图模式以不可变 fidelity case 绑定双方 SHA 与同条件证据。
8. F0 校验任务范围与流程，F1 校验当前候选与既定规格一致，F2 由独立 QA、玩法、技术或视觉角色检查领域质量，F3 只验证当前候选的工程证据，F4 只做带副作用的 A4-A6 精确集成/发布操作批准。V1/V2 的 `USER_DECISION` 不能替代专业缺陷修复。

## 受控并行实现

实施并行边界和 READY/委派校验以[模块划分](module-decomposition.md)及控制面 Schema 为准：`SHARED`/`INTEGRATION` 强制串行，`MODULE`/`SCENE`/`DISPLAY_LAYER` 仅在依赖满足且文件与状态所有权互斥时并行；`DISPLAY_LAYER` 必须紧邻宿主 `SCENE`。

## UI 与背景

玩家可见内容从 V1 的反馈定义起沿用[游戏内文案](../../cocos-game-ui-layout/references/game-copy.md)：图像、图标、数字与符号优先，文字只补充必要语义；V2 效果图、文本拆解与后续实现保持同一表达，不把内部规格说明直接放进画面。

UI 必须使用 [`cocos-game-ui-layout`](../../cocos-game-ui-layout/SKILL.md) 的版本化合同和唯一布局入口，从显式坐标空间、父 Node、双方停靠点、四边相对距离、尺寸、安全区与断点计算；纹理可见边界、UITransform 锚点、布局停靠点和动画偏移分离。视口、安全区、方向、内容尺寸、运行时有效 DPR（动态封顶 2）和状态是入口输入，重排必须幂等，不能在多个生命周期回调散布无参照坐标。固定尺寸、绝对定位、悬浮 HUD、Camera/父节点层级和单行省略触发布局专项审核，不凭模式本身判错；合同缺依据或证据时才退回。默认 `usability` 测试关系不变量、可读性、边界、遮挡和交互，允许合理位置/尺寸偏差；`exact` 或明确需求时才启用严格 Golden。装饰屏幕空间背景使用统一适配器；世界空间 Tilemap、碰撞和玩法环境使用独立结构，不能扁平化为背景。

## 视觉证据

参考与运行图在相同视口、运行时动态设备像素比（封顶 2）、状态、轨迹、语言、随机种子和时间点采集，并记录实际有效 DPR、ROI、验证模式、稳定帧和遮罩。默认 `usability` 使用代表性视口和关键状态，完整 viewport、ROI/叠加/像素差及全矩阵仅在 `exact` 或明确需求时作为严格证据；生成式、动画与 VFX 不能只用像素差判断。明显越界、裁切、关键遮挡、不可读或交互失效不得通过；静态高保真、资源齐全、源码检查和构建成功不能单独证明游戏性。

## 回退

玩法契约或结构问题退 V1，并让旧决定失效；模块边界变化仅在实质取舍时进入 grilling。修订候选重跑受影响的 F0-F3；只有带副作用的 A4-A6 操作重跑 F4 批准门。
视觉拆解确认属于控制面工件：收到用户确认后由编排层写入受保护 ledger/receipt，随后冻结新的 Git 基线；实施代理只能消费确认，不能创建、修改或把 ledger 路径纳入 owned/output 委派范围。

场景与显示层实现消费同一场景 Work Item 的视觉真值。基础实施完成后进入场景 V1，在 V1 内生成或接收并冻结 scene master/reference target、宿主上下文图、对应视觉合同和初步还原草案；V2 随后完成当前场景的拆解图确认、技术 JSON、coverage 和生产方案。场景 V2 前仅允许隔离灰盒或无正式业务逻辑样片。V3 验收正式资源与宿主组合，之后才开始正式场景功能代码；V4 完成运行态视觉接入与功能/视觉联合复验。scene master/reference target、modal/popup/drawer/toast 上下文图和原子资产的 generated 记录都必须绑定当前场景身份与全部锚点。provided 文件只记录来源。全局基线只负责静态视觉一致性，不能替代逐场景 V2；任何基线、锚点、目标或提示词身份变化都要使旧生成证据失效。
