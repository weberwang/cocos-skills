---
name: cocos-game-asset-integration
description: 为 Cocos Creator 3.x 游戏规划、生产、登记、验证并集成 UI、角色、3D 模型、场景、动画、VFX、背景和参考还原资源。用于正式视觉资源、视觉系统、资源接入、视觉重构、运行时视觉验收和来源/许可登记；不用于纯玩法规则修改。
---

# Cocos Creator 3.x 游戏美术生产与接入

## 全局控制接入

控制面边界：可提议、可审查、可在当前用户任务的 Work Item 范围内修改，且必须回到 `$cocos-game-workflow-control` 风险门。

本领域可提议、审查，并在当前用户任务、Implementation Package、A 等级和路径范围内生产或接入资源；任务内方案、路径和资源清单变化时同步更新计划并重验受影响部分。所有结论回到 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 审计和状态迁移。V0、V1、V2、V3、V4 是 `stageId`，不得旁路全局状态、带副作用的 A4-A6 精确操作批准、diff 审计和证据门。

## Creator 编辑器与 AssetDB 边界

Scene、Node、Component、Prefab、AssetDB、构建等 Creator 操作必须通过[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)；每次以实时 `tools/list` schema 为准。不得手写 `.scene`、`.prefab` 或 `.meta`，也不得直接伪造 UUID/子资源绑定。对同一编辑器项目保持唯一活动写入者，禁止多个代理并行写编辑器状态。

正式资源的目录位置遵循[项目目录规范中的资源与引用规则](../cocos-game-architecture/references/project-structure.md#资源与引用)：普通 UUID 引用资源放入按类型或功能域规划的目录；只有明确通过 `resources.load/loadDir` 按路径加载时才放入 `assets/resources/`。Asset Bundle 按自身目录与加载机制管理，不因运行时加载而迁入 `resources/`。

批量资源按以下边界处理：

1. 一次性完成本批次原始文件导入/写入，再调用 MCP AssetDB refresh 并等待批次完成。`assetAdvanced_refresh_assets_and_wait` 只等待 `.meta` 文件出现；它不证明资源已成功导入、没有 invalid 状态、子资源正确或脚本编译通过。`assetAdvanced_query_asset_db_ready` 是执行 AssetDB 操作前的就绪检查。
2. 对每个必需资源做有界核验：用 `project_get_asset_info({assetPath})` 检查导入状态/类型，用 `project_query_asset_uuid({url})` 核对 UUID；SpriteFrame 等子资源身份通过协议提供的只读 sidecar 查询。必须满足资源已导入、未 invalid，类型和 UUID 与合同一致，所需子资源存在；未就绪前不得绑定或保存。
3. 本批次含脚本时，等待 Creator 正常编译，再用 `debug_get_console_logs({limit, filter:'error'})` 检查实际编译/加载错误。没有独立脚本编译 MCP 工具；`attach_script` 只负责挂脚本，不能当作编译证据。
4. 批次全部就绪后才将已核验的 UUID/子资源绑定到 Scene/Prefab。按实施包最小范围保存，并立即读回节点、组件、属性和引用，逐项断言持久化内容正确；读回不符则不能进入下一批。

MCP 若提供的 Build/Preview 操作只打开构建面板或报告 worker ready，应按协议记为面板已打开/worker 就绪，不能报告实际构建或预览通过。真实运行/构建结果拿不到时，只把受影响验收标记为 pending/blocked。

## 工作流

生成全局候选、场景效果图或宿主上下文图前必须按[游戏内文案](../cocos-game-ui-layout/references/game-copy.md#效果图生成)将内部规格与玩家可见表达分开，并把可见文字范围和禁止绘制内部说明的约束发给生成器。拆解与正式界面只沿用当前可见表达；冻结后的原子资源仍忠实还原目标，不从 GDD 添加文字或自行删除冻结文字。

涉及美术方向、效果图、正式资源或动态视觉时，先读取[游戏美术体验与质量契约](references/art-quality-contract.md)。生产输入必须携带适用的主题、受众、体验目标、视觉层级与常态/操作/峰值预算；全局三候选逐项人工评估，所选候选任一质量项失败或未验证都不得冻结。正式资源在 V3 验收，V4 验收实际场景组合与动态表现；持续游玩片段由用户检查，不增设逐资产确认链。

### 场景还原合同（effect-image 强制）

V2 拆解先遵守[功能语义分组约束](../cocos-game-ui-layout/references/functional-semantic-grouping.md)：确认区域、功能组件、部件和独立元素的功能归属及理由，再分别记录真实父级与位置参照。位置依赖方不必成为被参照元素的直接子项；`parent_element_id` 表达功能/状态/交互/生命周期或真实布局管理归属，可选 `ui_layout.position_reference_id` 表达定位依据，省略时默认实际父级。共同表达同一信息的元素可同属组件并保持同级。简单“底板+图标+文本”优先由底板 Sprite 节点兼任容器根，使用 `element_type=container`、`render_kind=sprite`、`kind=component|region` 并保留自身 `component_id`/`placement_id` 图片身份；不拆成空根和底板叶子。只有确有独立职责时才新增纯结构容器；若它包裹可用底板和内容，必须填写 `ui_layout.independent_container_reason`。布局不得按文字类型、元素类别、显示层序或几何包含重新分组，也不得为满足校验增加包装容器；归属不明留在拆解确认，不自动生成可放行布局。中心轴严格居中、显式中心偏移、图文组合整体居中及位置确认规则按[居中策略与组合定位](../cocos-game-ui-layout/references/center-alignment.md)执行。Widget 适用条件、参照、唯一位置驱动器及尺寸授权按[Widget 定位策略](../cocos-game-ui-layout/references/widget-layout.md)执行；拆解图的位置只提供测量，不能替代停靠意图确认。明确视觉溢出、RAW 原尺寸及九宫格尺寸规则按 UI 布局参考执行。

`effect-image` 表示正式 Scene 的视觉事实与结构关系还原，不是独立 PNG 生产。场景 Work Item 只记录自身常驻 HUD；modal/popup 等弹窗按[独立工作项规则](../cocos-game-workflow-control/references/control-model.md#弹窗工作项与场景解耦)建立 DISPLAY_LAYER Work Item，并在 required state 冻结宿主同屏图。弹窗未完成不阻断场景 V4；弹窗自身仍须完成 V2/V3 和打开→交互→关闭/恢复的 V4 轨迹。运行态默认使用 `visual_validation.mode=usability`，只有明确精确需求时才启用严格像素/全矩阵验证。

效果图/参考图是否适用只看当前场景 Work Item 是否把它指定为正式运行画面的视觉目标，与是否生成、制作或新增资源无关。适用时，参考还原是同一场景实现生命周期内的视觉模式与合同叠加，必须进入 `effect-image` 的 V1→V2→V3→V4 还原链，包含 `scene_reconstruction_contract`、布局绑定、coverage、宿主场景同屏组合和 fidelity 验收；即使所有区域都用 `reuse-existing`/`runtime-program` 实现、零新资源且零生成式位图也不例外。不创建第二个场景 Work Item 或第二条生命周期。仅仅生成新资源，或仅把图片作为灵感、说明或临时参考，不足以触发 `effect-image`，仍按普通资产、组件或场景路径分类。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在已经触发后由 V2 决定生产路线，不能参与 V0 applicability 判定。

effect-image 生成式位图的完整提示词模板、asset_prompt 事实继承规则、透明生产要求和 generation_record 结构化字段统一见[《Effect-image 生成式位图忠实还原提示词合同》](references/effect-image-prompt-contract.md)。生产分类统一使用 `production_method=image-generation`，具体 `generator`/`generator_version` 由系统根据提示词、参考输入、主体材质、透明需求和已验证能力选择并如实记录；工具版本未暴露时记录 `not-provided`，不得编造。透明路线按冻结边缘事实选择受控纯色去背、已验证的真实 Alpha 或独立遮罩/人工创作；提示词或工具参数声明不能代替 PNG 像素解码验证。已有真实透明图按资源复用合同接入；本 Skill 只保留路由和硬不变量，不在此复制模板。

V3 将当前已确认生产范围内相互独立的静态 component × required state 待生成图片汇总为一个批量任务，一次编排提交，禁止逐张创建任务或等待上一张验收后才生成下一张；每项仍输出独立位图，详见[图片批量生成](references/visual-production-pipeline.md#图片批量生成)。批次完成后直接提供图片画廊或联系表，每项可单独放大查看；文字只汇报失败、缺失和仍需处理的差异，不先发文字方案等待确认。存在父图依赖的图片帧动画按[帧动画合同](../cocos-frame-animation/SKILL.md)逐张确认后推进，不能用静态图片批量规则跳过确认；已满足父图与确认前置的独立区间可按该合同并行。V4 直接在正式场景中实现并验收资源组合，默认验证代表性完整画面、关键内容可用性、实际交互和正式 Scene 消费证据，仅 exact 模式要求完整逐区域精确测量和差异材料。资源 loaded/used、missing=0、resize 稳定只属于工程子门，不能单独驱动 COMPLETE。

确定功能和拆分场景时，先按[功能与场景阶段的共享规划](references/asset-production-routes.md#功能与场景阶段的共享规划)总结共用资源与局部部件、消费位置、共同规格和需保留的差异；已明确同一部件可提前规划一次生产、多处引用，依据不足者保持候选。正式图片生成并完成透明处理与尺寸归一化后，再按[正式图片生成后的共享与复用](references/asset-production-routes.md#正式图片生成后的共享与复用)复核早期规划及新发现的需求，记录权威资源身份、消费位置、使用限制与依据，供后续任务先查再复用。功能相同或视觉相似不能单独决定共享；待人工视觉检查者保持候选，不改写既有独立生产合同与真实生成记录。

1. 读取项目配置、GDD、visual-design、TDD、控制面和资源登记；执行[视觉生产管线](references/visual-production-pipeline.md)。
2. V0 先判断任务属于原子资源、组件/资源集，还是场景/整套 UI/视觉系统/重做；参考还原是否适用只由当前场景 Work Item 的正式运行视觉目标声明决定，不由新资源或图像生成需求决定。原子资源只有在结构、布局、交互和视口行为不变，且已有适用视觉契约、视觉可交付结论与预算基线时才能跳过 V1/V2；任务内小幅适配可更新计划并重验，不必重新授权。
3. foundation-only 基础实施完成后，V1 建立功能规格、玩法视觉契约、必要低保真/灰盒与预算，只定义契约，不写正式场景功能代码；Work Item 指定效果图为还原目标时，V1 同时按[视觉还原](references/visual-reconstruction.md)生成或接收并冻结 scene master/reference target、宿主上下文效果图、参考身份、对比条件、可观察视觉事实和初步还原草案。需求或基线已明确时，V1 记录 `AUTO` 并直接提供场景目标/宿主上下文预览；只有产品方向、玩法语义或结构存在实质歧义时才询问。V2 保持“拆解图确认 → 布局图确认”的串行硬门：阶段 A 在内部完成状态分析、组件/placement、生产路线、技术 JSON 与 `decomposition_elements`，直接展示按确认顺序编号的拆解 PNG，只请用户看图确认；技术记录供代理和机器门使用，不另行要求阅读或确认。阶段 B 在拆解图确认后自动生成逐元素对齐决策、布局 PNG 和 `review.html`，直接请用户检查最终布局图/预览并确认；无需先提交文字布局方案。用户发现图中真实歧义时再澄清。布局只在冻结原图上叠加父子框与说明，不重新生成或替换视觉参考图，也不提供多个布局方案。
4. schema 1.5 `visual-assets.json` 先声明 `effect_image_reconstruction`：普通资产为 `not-applicable`，不要求还原工件；效果图还原为 `effect-image`。后者冻结目标后、进入 V3 前以 `v2-ready` 完成合同回对和 coverage，V2/V3 可暂无 fidelity case；只有 V4 验证完成才为 `v4-complete` 并要求全部 case 通过。效果图 coverage 逐区登记 `annotation_number` 与 `implementation_plan`，先完成 ownership/实现分类，再做带实际证据文件、冻结目标文件、分析 ID 和完成时间的 `state_analysis`，严格在 component inventory 之前完成，最后按唯一原子部件填写 `component_inventory`、placements 与 `expected_assets`；编号不是资产数量单位。视觉来源与装配方式必须分开：`visual_route_analysis` 只能在独立 coverage region 上选择 `image-asset` 或 `cocos-native`，`assembly_analysis` 再独立声明原子 Scene 装配、禁止整屏捕获并允许独立图片资产；不得从“不能整屏贴图”推导 `runtime-program`。如果同一视觉事实同时包含程序逻辑与独立视觉资产，必须回到 V1/PROPOSAL 重新划分 coverage/annotation：图片外观进入独立 image-asset region，程序行为进入独立 cocos-native/runtime region，分别进入各自生产与运行逻辑合同。禁止使用单一 `composite` region 或 `composite_parts` 在一个区域内闭环生产、验收。全部区域均为 `cocos-native` 时必须提供绑定目标文件、完整 region 集合和独立 JSON 工件 的 `all_native_justification`，文件门会读取实际文件并逐区核对资格事实。状态分析必须覆盖普通、selected/active、disabled、pressed/hover、victory/defeat/paused，实际适用写 `required`，不适用写 `not-applicable+reason`。② 顶部 6 个按钮必须 6 个 component；⑧ 的 3 个相同底部表面可登记 1 个 component+3 个 placements，⑨ 的动作图标按实际复用关系登记；③、④、⑦ 只有在明确单部件且其余状态不适用时才保持单图。默认 individual 模式禁止横向组图；`image_generation_required=true` 的生成式位图使用 `individual + atlas_allowed=false`，其 `expected_assets.width/height` 由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max)` 自动计算，必须精确为最小尺寸；`scene_asset_usage.max_dpr` 必须严格为数字 `1`，`padding_policy` 必须为 `none`，尺寸合同本身不需要 human_review。这里的 1 表示图片按最大约定逻辑显示尺寸 1:1 生产；运行时实际 DPR 按设备动态读取并封顶为 2。历史 1.5/2 倍生产证据须重生成或标记 `stale`。其他生产方法只有在显式合同下才能使用完整 `atlas_slice` 图集。每个 placement 必须声明 `interaction_required`，真实 `interaction_hotspots` 只能按 placement 一一绑定且不计入视觉资产。确认图仍同时呈现 `generate-now`、`reuse-existing` 和 `runtime-program`，但 PNG 仅绘制用户摘要与“新建图片资产 / 复用现有图片 / 程序绘制或动态逻辑”标签；placement ID、坐标尺寸、组件/状态/资产技术字段不进入可见行。运行 `--proposal` 时，这些技术字段完整写入拆解分析技术 JSON，并与 PNG 元数据、实际区域定义及现有 confirmation 业务字段绑定。系统按提示词、参考输入、材质、透明需求和可用能力决定是否使用图像生成；`independent-production` 与 `generate-now` 不作任何生成器推断。V2 再按 [资产生产路线](references/asset-production-routes.md) 选择路线。
   路线按可观察视觉事实和 Cocos 实际渲染能力判断，不按“按钮”“面板”等语义，也不以静态/动态作为唯一条件。文本、纯色矩形、基础几何、规则边框、可确定性表达的简单规则渐变、遮罩和进度填充，在 Cocos 原生能力可精确表达冻结外观时可选 `cocos-native`；特色插画、复杂纹饰、不规则轮廓、复杂材质及明显具有美术特征的装饰使用独立图片路线。原生路线冻结 `native_suitability.render_contract` 的 renderer、尺寸、颜色、线宽、圆角、渐变、透明度、适用状态和不支持特征；无法支持的视觉特征必须阻断，不能近似替代后通过。
   图片、图片局部和文字先按[完整拆解与视觉显著性](references/asset-production-routes.md#完整拆解与视觉显著性)登记可独立部件，保持功能、交互与状态联动；明显美术外观优先位图，低显著性操作文字考虑系统文本，简单填充考虑原生绘制。再核对[完整程序还原资格](references/asset-production-routes.md#程序还原资格与位图回退)：程序必须完整实现方案要求保留的外观；主体与效果无法可靠分离时保留完整原子视觉部件。动态/本地化文字按[文字路线判定](../cocos-game-ui-layout/references/layout-contract.md#文字路线判定)保留可变能力，不在实现时静默简化已确认的美术效果。
   色彩填充同样按[色彩填充路线判定](references/asset-production-routes.md#色彩填充路线判定)拆分：明显材质和光影保留独立位图，有风格的重复表面优先复用贴图，低显著性基础填充考虑原生绘制；动态比例和状态仍保持可变，不能把填充与边框、辉光或纹饰混作纯色区域。
   外观来源与行为装配分别记录和绑定；例如按钮可由原生框体、独立图标图片和 Creator `Label` 文字组成，并通过明确组件/节点引用接入交互，不合并为 `composite` 区域。`image_generation_required=true` 一经冻结不得自动换成原生路线，只能遵循明确接受的 Change Request 变更。
5. V2 可运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V2`；V3 正式验收运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3 --check-files --project-root .`，V4 正式验收运行同命令但使用 `--stage V4`。独立弹窗工作项必须额外传入 `--work-item-type DISPLAY_LAYER`，场景工作项默认按 `SCENE` 校验；该参数只改变显示层作用域，不把弹窗纳入宿主场景验收。V3 逐项验证真实资源文件、来源/许可信息（如适用）、预算、冻结基线、coverage 和 `production_contract_audit`；V4 验证正式 Scene 消费、运行组合、F2 两类机器证据、F3 runtime replay 与适用 fidelity cases。
6. 当前场景 Work Item 按控制面定义的 V1→V2→V3→V4 阶段推进；本领域负责在 V2 依次完成拆解 PNG 和布局 PNG 两次独立人工确认后生产正式资源，在 V3 完成资源级验收，V4 直接在正式场景实现、校准并验收运行态画面。正式代码只消费当前场景或合规 `shared` 且 V3 `accepted` 的资源；公共正式资源只允许至少两个场景稳定复用或属于运行必需。场景联合验收前必须清除灰盒、占位和 fallback。

透明路线由 `expected_assets.transparency_requirements` 冻结策略与 `edge_profile`。只有 `hard-edge` 且主体与纯色背景明显区分时才可走 `background-removal`；复杂边缘禁止阈值去背。`direct-alpha` 必须匹配已验证的工具、版本和边缘类型，并用 PNG 解码证明真实透明像素；generation record 顶层 `generator/generator_version` 是实际身份，`capability.tool/tool_version` 必须与之相同。`mask-composition` 必须绑定独立遮罩或人工创作的实际输入和工具参数。能力不足时报告缺口，不提高容差、硬抠轮廓、删除光效或伪造结果。生成记录按实际路线登记生成器身份、参数、输入/输出 SHA 和后处理；归一化保持比例、Alpha 和主体边界，并禁止把棋盘格预览烘焙进素材。每个候选都生成浅底与深底预览，V4 完成主体缺损、残留背景、色边和半透明区域的视觉检查。已有真实透明图按资源复用合同接入，不伪造生成或去背记录。`image_generation_required=true` 的冻结合同不能由透明路线判断或提示词生成器自动替换。
7. V2 前的灰盒或视觉样片必须与正式运行链隔离，不得注册正式入口或实现正式业务逻辑；V2 确认后生产 V3 正式资源；V4 在正式 Cocos Scene 中实现功能并消费已验收资源，禁止一次性截图 Scene、整屏铺图、隐藏覆盖层和绝对叠层凑像素。V4 在正式功能实现之后与玩法协作完成结构化集成、动态验收和低保真清理；上游事实或当前受影响候选身份变化时才使对应 fidelity case 失效重采，其他单元证据继续有效。

正式效果图标注命令必须带 `--proposal <file>.json`；省略该参数直接失败，不生成只有用户图示的成功产物。

效果图生产必须先引用已冻结的全局视觉基线；全局候选选择、冻结状态和跨 Work Item 引用规则以[控制模型](../cocos-game-workflow-control/references/control-model.md)及[全局视觉控制](references/global-visual-control.md)为准。本领域只补充生成记录、锚点继承和资源合同要求；场景仍在同一 Work Item 内按 V1→V2→V3→V4 完成。

布局生成的标准交付除 PNG 外必须包含同一候选目录的 `layout-nodes.json`、`layout-decision.json`、自包含 `review.html` 和 `generation-result.json`。布局审阅页只用于可读的人工作业，不能替代拆解确认、独立布局确认或 PNG/F2 机器门；其模板、真实文件与业务绑定、候选状态和离线边界见 [`离线布局审阅产物`](../cocos-game-ui-layout/references/layout-review-artifacts.md)。

V2 拆解 UI 底板、按钮皮肤和框体时，必须按可观察固定角边与可伸展区域评估九宫格，记录适用/不适用原因及源图尺寸、四边切片值；采用九宫格时，选择随已有拆解确认冻结并贯穿 V3 小图生产与 V4 正式场景实现。具体合同读取[九宫格 UI](references/nine-slice-ui.md)，V3 生产按冻结切片参数执行。普通固定视觉图片派生 `sprite_geometry={type:'SIMPLE',size_mode:'RAW',content_size:null}`，使用正式 SpriteFrame 的完整未裁切原尺寸；即使底板兼任容器根并有子项，也保留 RAW 原尺寸计划。运行时 RAW 只要求 `UITransform.contentSize` 等于正式 SpriteFrame 原尺寸，不禁止 Node 缩放/动画或 SHARED 坐标变换；视觉 bounds 另行验收。只有冻结九宫格图片派生 `SLICED + CUSTOM` 与目标宽高。九点停靠（水平/垂直对齐、锚点和偏移）表示位置意图，与九宫格纹理切片独立，不触发 CUSTOM。普通图片不得使用 `STRETCH`/`FLEX` 尺寸策略，父级 Creator Layout、Widget 或其他尺寸驱动器不得改写其 `UITransform.contentSize`；其 `size_driver` 固定为 `SPRITE_RAW`。`widget_stretch_axes` 使尺寸由 `WIDGET` 控制，其他显式 `size_driver` 必须与 `size_policy` 匹配。父级 Creator Layout 排布活动子节点位置时，子节点必须由原生 Layout 控制位置；自定义项目布局器用 `SHARED` 驱动并保留 `PARENT` 职责；当前节点原生 Layout 以 `CONTAINER` 计算自身尺寸时，可在先计算尺寸后使用 Widget 定位。纯结构容器、文字与命中区域的尺寸独立管理。具体边界见[图片原尺寸与九宫格尺寸](../cocos-game-ui-layout/references/cocos-adapter.md#图片原尺寸与九宫格尺寸)、[Widget 定位策略](../cocos-game-ui-layout/references/widget-layout.md)及[Widget 运行快照](../cocos-game-ui-layout/references/widget-runtime-evidence.md)。

## 条件参考

- 正式 3D 模型制作或修整：交给 [`cocos-game-3d-modeling`](../cocos-game-3d-modeling/SKILL.md) 在 Blender MCP 中生产；本领域按[工作流接入](../cocos-game-3d-modeling/references/workflow-integration.md)登记模型来源与输出，通过 Creator MCP 核验真实模型、网格/材质子资源和资源级 Prefab。几何技术报告与实际场景消费证据独立于图片尺寸、Alpha 和 SpriteFrame 检查。
- 参考截图、录屏、运行项目或源码还原：读取 [视觉还原](references/visual-reconstruction.md)。
- 装饰性屏幕空间满幅背景：读取 [满幅背景](references/full-bleed-background.md)；世界空间关卡、Tilemap 或玩法环境改读资产生产路线。
- UI：同时读取 [`cocos-game-ui-layout`](../cocos-game-ui-layout/SKILL.md) 的布局合同、Cocos 适配器、Widget 定位策略和证据矩阵；资源 origin、布局锚点与动画偏移按合同分离，资产接入不得重新发明布局规则。
- QA 测量、动态 resize、完整 viewport 截图和只读 Hook：读取 [响应式视觉验证](../cocos-game-qa-performance/references/responsive-visual-validation.md)，不得在资产文档复制其字段或阈值；观看舒适和持续游玩验收使用共享美术契约。

## 审核与交付

所有候选先通过 F0-F3；F4 只处理带外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作。无副作用本地 A4 集成不因等级标签额外等待批准。V1/V2 确定性机器检查必须执行；需求明确时自动采用 `AUTO` 并直接出预览，仅真实方向/玩法/结构取舍才记录一次 `USER_DECISION`。用户在 V2 只需分别确认拆解 PNG 与布局 PNG；静态资源批次和范围内返修通过画廊/前后对照图审阅。技术 JSON、状态分析、coverage、合同和证据由代理持续维护，不额外发起文本确认。每个交付包记录当前任务范围、候选身份、基线、来源/许可（如适用）、预算和证据；普通任务不要求独立授权记录。

### 视觉确认边界

同一场景 Work Item 的 V0→V1→V2→V3→V4 链在 V2 依次完成拆解图确认和布局图确认，冻结还原方案。用户面对的是编号拆解 PNG 与布局 PNG/`review.html`；技术 JSON、提案和决策文件在后台用于机器校验和身份绑定，不构成额外文字确认门。`visual-decomposition-confirmation/1.0` 绑定 annotation/proposal/decision SHA、target、V2 candidate、diff、baseline、全部编号和用户原文；已确认的目标或方案发生实质变化时重新确认受影响部分，普通运行态布局微调不重开 V2。V2 拆解图、技术 JSON、合同回对、coverage 和结构化机器检查必须齐全，布局确认另行绑定最终布局图与决策文件。V3 资源验收和 V4 正式场景的代表性完整画面及关键可用性证据绑定当前身份；overlay、diff 和完整逐区域精确 fidelity 仅在 exact 模式强制。根节点 PASS、布尔值、AI reviewer 字段或旧 `human_review` 均不能代替两次 V2 图像确认。

F2 机器证据核对文件、结构、绑定和实际参数，不能单独给出美术通过结论。代理可提供截图、录屏和检查要点；未明确授权自动视觉验证时，不自动分析画面。用户对主题、完成度与舒适度的实际评价纳入现有选图、V2 布局确认和 V4 运行验收材料，不能代填或用旧确认覆盖已变化的画面。
