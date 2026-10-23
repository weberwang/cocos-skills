# 视觉生产管线

玩家可见内容沿用[游戏内文案](../../cocos-game-ui-layout/references/game-copy.md#工作流接入)：V0/V1 分开内部功能说明与可见表达；全局候选、场景主图和显示层上下文图发送明确的可见文字范围与生成约束；V2 只拆解冻结目标中的文字；V3 不给图标/皮肤附加说明；V4 绑定同一可见表达与真实数值。普通资产、程序界面与 effect-image 均适用；图像显示结论仍由用户人工确认。

场景 Work Item 只生产自身画面和常驻 HUD；modal/popup 等弹窗建立独立 DISPLAY_LAYER Work Item。弹窗 required state 仍需完整宿主上下文、拆解、布局和资源前置，但其未完成不阻断场景 V4。字段和调度边界见[控制模型](../../cocos-game-workflow-control/references/control-model.md#弹窗工作项与场景解耦)。

effect-image 生成式位图的完整提示词与实际参考输入合同统一见[Effect-image 生成式位图忠实还原提示词合同](effect-image-prompt-contract.md)；管线只引用该合同，不重复维护模板正文。透明工具声明与实际输出证据的边界见[生成式透明能力审计](transparency-capability-audit.md)。

## V0 分流

先记录范围、视觉方向是否冻结、结构/交互/布局是否变化、正式资源数量与跨域风险，再选择且只选择一条路径；资源数量和生产方式只服务后续路径、预算与执行规划，不参与效果图适用性判断。Work Item 指定效果图或参考截图为还原目标时启用[忠实还原模式](visual-reconstruction.md)，指定参考是冻结视觉目标而非可自由优化的灵感输入。

效果图/参考图是否适用只看当前场景 Work Item 是否把它指定为正式运行画面的视觉目标，与是否生成、制作或新增资源无关。适用时，参考还原是同一场景实现生命周期内的视觉模式与合同叠加，即使所有覆盖区域均为 `reuse-existing`/`runtime-program`、零新资源且零生成式位图，也必须走 `effect-image` 的 V1→V2→V3→V4 还原合同，并完成布局绑定、coverage、宿主场景同屏组合和 fidelity 验收；不创建第二个场景 Work Item 或第二条阶段链。仅仅生成新资源，或仅把图片作为灵感、说明或临时参考，不足以触发 `effect-image`，仍按普通资产、组件或场景路径分类。`image_generation_required`、`generate-now`、资源数量和 `production_method` 只能在触发后于 V2 决定生产路线，不能参与 V0 applicability 判定。

| 类型 | 判定 | 阶段 | 审核 |
| --- | --- | --- | --- |
| 原子资源 | 视觉方向已冻结，结构、交互、布局不变，并有适用、有效、绑定当前范围的玩法视觉契约、V1/V2 决策记录、视觉可交付结论与预算基线；缺少任一项时升级路径 | V2 → V3 → V4 | F0 范围与流程；F1 规格一致；V3 确定性机器 F2；V4 生成 F3 动态集成工程证据；F4 仅处理有副作用的精确操作批准 |
| 组件/资源集 | 同一组件、角色状态组、图标集或可复用资源集，需要局部探索与一致性控制 | V1 → V2 → V3 → V4 | 普通候选执行 F0-F3；V3 做确定性机器 F2，V4 形成 F3 工程证据；仅有外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作执行 F4 |
| 场景/视觉系统/重做类任务 | 场景、整套 UI、世界环境、跨场景视觉系统或重做；参考还原作为可选视觉模式 | V1 → V2 → V3 → V4 正式还原与验收 | V1/V2 确定性机器检查强制；实质取舍按条件记录一次 `USER_DECISION` |

局部修复仍执行 F0 范围与流程、F1 规格、适用 F2 与 F3 工程证据；只有涉及外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作执行 F4 批准门。记录缺失优先原地补齐；任务目标范围真实变化才重新分流，普通路径、方案和资源清单调整直接更新计划并重验受影响部分。

所有任务执行适用 V1/V2 确定性机器检查。已有明确需求或冻结基线时可记录 `AUTO`；修复、提升游戏感或工程适配只要改变产品方向、玩法语义或上游视觉事实，才按差异列出影响和候选方案，请求一次 `USER_DECISION`。普通位置、尺寸、边距和换行差异按 `visual_validation.mode=usability` 处理，不升级为精确选择；后续绑定当前决策记录。

全局基线、foundation-only 边界、场景阶段顺序和集成入口以[控制模型](../../cocos-game-workflow-control/references/control-model.md)与[状态、阶段与停止门](../../cocos-game-workflow-control/references/state-gates.md)为准。本管线只补充资源领域的 V0 分流、V2 生产合同、V3 资源验收和 V4 正式场景运行证据；参考还原仍属于当前场景 Work Item。

F2 的机器出口必须由确定性验证执行，并绑定当前 baseline/diff 身份；只说明文件、结构、实际参数和证据绑定的检查结果。美术质量与观看舒适依[游戏美术体验与质量契约](art-quality-contract.md)由用户人工检查，意见沿用现有选图、方向、V2 布局确认与 V4 运行验收材料，不新增旧 `human_review` 字段。V1/V2 使用 `AUTO` 或 `USER_DECISION` 记录，只覆盖所列对象；方向决定不写操作审批账本。F4 只处理外部写入、付费、真机、破坏性或外部删除、发布等带副作用的 A4-A6 操作。

美术 brief 必须包含主题、受众、核心循环、体验目标、观看情境、视觉层级和三层刺激预算，并进入实际生成输入。全局三候选逐项人工评估，所选候选任一失败或未验证都不能冻结；场景目标也在冻结前检查。正式生产遵守已通过的方向与目标，不能依靠拆件时暗改画面修复不合格参考。

## V1 玩法视觉契约与必要灰盒

1. 逐状态定义第一视觉目标，以及玩家、目标、危险、交互、装饰的优先顺序。
2. 定义明度、色彩、轮廓和运动区分，可供性（affordance），前摇、命中、受击、奖励反馈时序，遮挡预算及小屏、高速、灰阶、色觉差异阈值。
3. 只有结构、交互或节奏尚不能被运行证据证明时制作必要灰盒；不得为了流程完整重复已冻结灰盒。
4. 在生产前定义每场景纹理、图集、帧数、动画采样、纹理内存、过绘、Draw Call 和最大纹理预算。未能量化的阈值标为项目待定义，不能推迟到 V3。
5. 保留已批准的功能语义、业务状态、交互语义和状态所有权，同时检查构图、信息层级、资源槽、页面模板和布局几何是否足以承载核心玩具、专属场景对象、关键反馈与奖励表达。必要灰盒是功能与结构证据，不是必须原样换皮的最终视觉模板。
6. 建立全局视觉基线候选，记录基线 ID/版本、风格指纹、主锚点与分系统锚点、世界幻想及形状、比例、镜头、色彩、材质、光源、描边、密度、字体、图标、面板、动画和 VFX 规则，并明确允许变量与禁止项。未冻结内容不得作为批量生产依据。

7. 场景、整套 UI、视觉系统和可选参考模式必须同时读取并冻结 [`cocos-game-ui-layout` 的布局合同](../../cocos-game-ui-layout/references/layout-contract.md)：浏览器 viewport、Canvas、逻辑坐标、safe area 四层关系，Creator 固定宽/固定高/项目 `custom` 设计分辨率策略、响应式锚点/断点重排，背景覆盖目标，留白/裁切/拉伸许可，代表性视口与关键状态，以及动态文本、显隐、滚动、触控、resize 和项目支持方向策略，并声明 `visual_validation.mode=usability|exact`（默认 `usability`）。方向覆盖遵循 `orientationPolicy.allowed`：单方向项目在同方向覆盖窄宽尺寸与连续 resize，双方向项目才验证方向切换；`exact` 方向轴只覆盖声明的方向。只有 `exact` 或明确全覆盖需求时才冻结完整视口/状态矩阵。缺少影响可用性的核心关系标记“响应式契约缺失”，阻断当前场景 Work Item 的 V2。
8. 参考模式在当前场景 Work Item 的 V1 内生成或接收并冻结参考身份、版本、权属、文件指纹、目标视口/状态、对比条件、scene master/reference target 与宿主上下文效果图；V2 前基于 V1 拆解草案建立区域关系和必要状态证据，字段、容差、冲突处理和失败条件以[视觉还原](visual-reconstruction.md)为准。默认允许合理几何偏差，只有明确 `exact` 需求时才定义严格像素容差和全覆盖矩阵。

功能与场景划分阶段已形成的[共享资源规划](asset-production-routes.md#功能与场景阶段的共享规划)在 V1 回对消费位置、状态、尺寸、共同视觉要求和差异，在 V2 落到实际 component/placements 与生产清单；确定同一部件可规划一次生产，未确定者保持候选。V3 用真实正式图片复核，不能因早期功能归类而强行统一场景美术。

玩法拥有规则、状态、交互和功能灰盒。美术拥有视觉契约中的表现目标，不得通过视觉实现改写玩法规则。

### V1 条件门：低保真机器验证与决策记录

顺序为契约/灰盒、证据关闭、条件分类和决策记录。自动路径写 `AUTO`、依据与适用范围后进入 V2；实质取舍路径记录一次用户结论。

需求、玩法视觉契约和冻结基线已足以确定目标时，直接记录 `AUTO` 并生成/展示场景目标及宿主上下文预览，不先要求用户确认文字版判断或计划。只有产品方向、玩法语义、结构或目标内容存在会改变实现的实质歧义时，才提出具体问题；能用预览表达的差异优先用图片并列说明。

决策记录包含候选、范围、契约、灰盒、结构/交互/布局证据和返工影响。自动路径记录 `AUTO` 及依据；需要人工时结论只允许“通过”“修改后重提”或“拒绝”。

“修改后重提”产生新候选并重跑受影响 F0-F3；只有带副作用的 A4-A6 操作重跑 F4 批准门。拒绝按根因留 V1 或退制作契约/GDD；模块边界变化仅有实质取舍时进入 grilling。

## V2 拆解确认与生产方案

UI 底板、按钮皮肤和框体在当前拆解里完成[九宫格适用决策](nine-slice-ui.md)。采用时把 `nine_slice` 的小图源尺寸与切片边宽保留到拆解元素、布局节点、对应组件/expected asset 及正式场景呈现配置；已有人工确认同时冻结这些事实。普通位图生产尺寸规则不用于把九宫格皮肤扩大到整块显示框。

功能分组遵守[功能语义分组约束](../../cocos-game-ui-layout/references/functional-semantic-grouping.md)。阶段 A 为每个元素明确 `parent_element_id` 和 `semantic_grouping.kind/rationale`：父子树表达功能归属、共同状态、交互或真实布局管理；单纯跟随另一元素定位时，通过 `ui_layout.position_reference_id` 声明参照，不强制增加父容器。简单“底板+图标+文本”优先让底板 Sprite 节点兼任组件根，声明 `element_type=container`、`render_kind=sprite` 和 `kind=component|region`，保留自己的 `component_id`/`placement_id` 图片身份；不要拆成空根和底板叶子。普通纯结构容器不声明 `render_kind` 或 Sprite 尺寸计划。若额外纯结构容器包裹可用底板和内容，`ui_layout.independent_container_reason` 必须写明皮肤独立动画、稳定交互/布局尺寸、独立裁切或动态排布等职责；只写“分组/包含”不成立。机器只校验字段结构和理由非空，不证明语义职责真实，也不自动删除或改写已有确认。文字独立登记但归属对应信息组，不按元素类型集中归组。子项突出非根父框时用 `ui_layout.visual_overflow.reason` 说明，保留父框布局尺寸，不制造联合包围容器。语义歧义留在拆解审阅，机器不根据距离、显示层序或最小包含矩形补父级。阶段 B 继承已确认归属与参照，派生独立参照边界、偏移及图片尺寸计划；普通图片（含兼任容器的底板）保持 RAW 且无 contentSize 写入，只有九宫格图片设置自身目标宽高。九点停靠使用水平/垂直轴对齐、锚点与偏移表示位置关系，不按视觉落入九等分格来推断；它与九宫格纹理切片完全分离。实际归属或参照变更时更新受影响确认及工件，不能复用已失效的布局身份。

当前场景 Work Item 的 V1 冻结目标和初步还原草案有效后进入 V2。V2 把 V1 的视觉事实细化为可确认、可执行的还原方案，并按两个串行视觉硬门完成：阶段 A 在内部维护拆解图对应的技术 JSON、按序 `decomposition_elements`、功能归属与理由、component×state 和资源生产事实，向用户展示编号 PNG 供视觉确认；阶段 B 仅在拆解图确认后自动继承功能父子归属，补充停靠/对齐关系、布局测量、显示层关系和布局容差，生成布局标注 PNG 与审阅页供视觉确认。无需在任一图片确认前单独提交或等待文字提案、对齐决策或技术记录的确认。

V2 布局必须后置于拆解图确认：阶段 A 先由冻结原图、区域和组件事实生成拆解图及技术 JSON，并明确按确认顺序排列的 `decomposition_elements`；只有图中内容或分组需要更正时，用户才通过指出具体图号提出修改，代理更新 Stage A proposal、重出图片并重新确认。默认不先给文字提案，也不要求用户查看技术 JSON。只有 `visual-decomposition-confirmation/1.0` 通过后，智能布局才结合原图构图、视觉重心和元素语义，为每个确认元素按原顺序生成唯一的 `left/center/right × top/center/bottom` 对齐决策，并为 center 轴解释规范化 `center_alignment`；普通中心轴默认 strict，受 leader 的 `member_ids` 控制时组员继承组策略。Stage A proposal 是历史确认输入，Stage B `automatic-layout-decision/1.0` 是布局生成输入；decision 文件保留原字节，规范化结果写入唯一的同批 `layout-nodes.json`。显式 reference 偏移必须带理由。图文整体居中由 leader 指定 `member_ids`，单图标居中不包含独立广告角标。中心策略可平移节点或整组；父级或定位参照的整体位移也沿关系传播到依赖节点，非 center 轴同样保持原有相对间距。所有位置均在 layout-nodes 中派生，proposal 原 bounds、元素尺寸、身份和顺序保持不变；细则见[居中策略与组合定位](../../cocos-game-ui-layout/references/center-alignment.md)。几何测量不得替代该视觉判断。scene contract 的 `layout_decomposition.layout_source.nodes_file` 直接引用此唯一节点文件，`layout_binding`、annotation 与 confirmation 只保存身份/证据，annotation/confirmation 的 `layout_nodes_file` 必须与 source 路径一致。布局生成器只消费确认 proposal 和 Stage B decision，按原顺序推导节点，不能读取另一份预存 `layout_nodes` 或生成新的视觉参考图、多个布局候选。PNG、`review.html` 和派生快照只读展示，不是第二份手工事实且不得回写 proposal；用户要求布局关系变化时更新 Stage B decision 并重新生成，父子/分组变化则按原 Stage A 规则重新确认。两次确认仍分别是人工确认，且不得合并或跳过。

布局图的每个框必须与右栏共用唯一短编号，并注明父编号，保持确认元素原序；编号避让只能调整标注，不得改变元素布局。右栏逐节点说明自身相对上级的双轴停靠、中心策略、组合成员、锚点与偏移，父容器、空容器同样必填，根明确无上级。底板 Sprite 兼任组件根时显示为一个节点并保留图片身份；额外纯结构容器显示 `independent_container_reason`。九点停靠表示水平/垂直位置关系，不等同于图片九宫格切片。技术 ID 和四边距离仅辅助追溯；长说明必须换行且完整可见，不能用被裁切的文本或元数据完整标记代替可读图。详细规则见 [UI 布局合同](../../cocos-game-ui-layout/references/layout-contract.md#v2-串行拆解与布局标注)。

`docs/visual-assets.json` 使用 schema 1.5。普通资产声明 `not-applicable`；效果图还原进入正式生产前声明 `effect-image/v2-ready`，此时冻结目标、合同回对、coverage、拆解图确认和生产方案必需，而 fidelity case 可为空。coverage 必须逐冻结 scene/state 声明目标画布、画布内 region 和完整性摘要，覆盖率为 1、未覆盖列表为空、状态通过且绑定证据；不能用单个微小区域冒充全覆盖。每个固定视觉 region 还要有稳定编号、实现分类和七个生产合同字段；`production_method` 使用 `image-generation`、`authored-raster`、`authored-svg`、`cocos-graphics`、`runtime-program`、`reuse`，`delivery_kind` 使用 `raster-image`、`vector-image`、`runtime-drawing`、`runtime-program`、`existing-asset`。实现分类为 `generate-now`、`reuse-existing`、`runtime-program`，并在冻结效果图标注图中同时呈现。

拆解提案固定按“冻结视觉事实 → 选择视觉来源路线 → 独立验证场景装配”执行。`visual_route_analysis` 只决定图片资产或 Cocos 原生路线；`assembly_analysis` 只声明原子 Scene 装配、禁止整屏捕获并明确允许独立图片资产。路线判定先把文本委托给 `text_decomposition`，其余区域依据冻结图中的可观察外观事实和 Cocos 实际渲染能力决定。静态纯色矩形、基础几何、规则边框、简单规则渐变、遮罩和进度填充，在 Cocos 能确定性表达冻结外观时可选择 `cocos-native`；特色插画、复杂纹饰、不规则轮廓、复杂材质及明显具有美术特征的装饰继续选择独立图片路线。元素语义名称及 `dynamic_requirements.is_dynamic` 单独都不能决定路线；非文本原生资格须有可审计事实和完整 `render_contract`。任何生成步骤都不得从“不能整屏贴图”推导“所有视觉必须程序绘制”。若同一按钮等组件含多种视觉来源，分别建立区域：例如原生框体、独立图标图片和 Creator `Label` 文字各自登记 owner、生产合同及布局/资源节点绑定；交互行为用明确组件/节点引用装配，不以 `composite` 汇总。禁止单一 `composite` region 或 `composite_parts` 闭环生产/验收；检测到职责或来源混合时必须回 V1/PROPOSAL 按可观察边界重拆。如果全部 coverage 都选择 `cocos-native`，必须附带绑定当前目标文件、完整 region 集合和独立 JSON 工件 的 `all_native_justification`；文件门会读取实际文件并逐区核对资格事实，否则停在 V1/PROPOSAL。

拆解先按[完整拆解与视觉显著性](asset-production-routes.md#完整拆解与视觉显著性)完整登记可独立部件并保持功能归属：明显美术外观保留位图，低显著性操作文字可用系统文本，简单填充可用原生绘制，不能遗漏改用程序的拆解项。程序标签再满足[程序还原资格与位图回退](asset-production-routes.md#程序还原资格与位图回退)，只有当前 renderer 能完整实现方案要求保留的外观与状态时才成立；文字所需效果不能完整还原时，按[文字路线判定](../../cocos-game-ui-layout/references/layout-contract.md#文字路线判定)将固定外观拆为位图，不能在实现时静默用普通文本近似通过。

原生路线在 `native_suitability.render_contract` 冻结 `renderer`、`dimensions.width/height`、`colors`、`line_width`、`corner_radius`、`gradient`、`opacity`、`applicable_states` 和 `unsupported_features`。颜色以及渐变 stop 颜色使用 `#RRGGBB`；`gradient.type=none` 的 `stops` 是空数组，线性渐变必须冻结 0–360 的 `angle` 和有序 `stops`。合同按参考测量记录精确参数。`runtime_implementation.render_contract` 必须逐值镜像原生资格合同，并进入已确认区域定义记录；参数变更会使拆解确认失效，不能在行为装配时静默修改。`unsupported_features` 中任何尚需保真的特征都会阻断原生路线，不得以近似替代后放行。特色美术选择原生路线还必须提供等价性证据，并绑定预先声明的容差或精确例外。冻结的 `image_generation_required=true` 不得自动替换为原生路线；方法变更只能走明确接受的 Change Request。

固定视觉区域区分 `bitmap-decomposition` 与 `independent-production`；代理内部按 ownership/实现分类 → 状态分析 → 唯一原子 component/placements → proposal 技术 JSON 与编号 PNG 的顺序维护事实。用户直接检查 PNG 的编号、视觉框、中文摘要和“新建图片资产 / 复用现有图片 / 程序绘制或动态逻辑”标签，并确认图像；坐标、状态、组件/placement、生产合同、atomic requirements 和资源映射留在 JSON，供代理和机器门使用。拆位图仍须通过 `node scripts/generate_effect_image_annotation.mjs ... --output ...png --proposal ...json` 生成绑定实际目标、region ID 与区域定义的提案；confirmation 仍记录实际 proposal/decision、PNG 身份和用户原文，但不要求用户另行确认这些文字或技术字段。开始裁切、抠图、分层、AI 分割/补全或派生位图前，必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V2 --check-files --project-root .`，结构和文件证据均通过才可执行；PNG 必须由共享无依赖确定性栅格渲染器产出，文件检查会校验 PNG 魔数/MIME/尺寸/用户说明元数据与区域覆盖，同时读取 proposal 与实际区域定义复核技术合同，不校验摘要；正式流程不生成或接受 SVG 标注。`reuse-existing` 的 `source_manifest` 必须是不可变 `asset-reuse-snapshot/1.0`，并用 `source_file` 完成精确身份复核；bitmap 路线资产使用 `ai-composite-raster`。只有 V4 完成后声明 `v4-complete`，case 必须全部满足当前验证模式，并在 `exact` 或明确全覆盖需求时逐一覆盖冻结目标的每个 scene/state 组合。其余条件确认按既有规则触发，`AUTO` 绑定判定证据；owner_type 属于合同/F2 专业事实，不能由验证器从像素推断。

1. 按资产类型选择源文件、运行时输出、生产工具、命名、切片、锚点、图集、帧和压缩策略；保留可编辑源文件或完整生成记录，并继承当前全局基线与适用分系统锚点。
2. 将资源写入 `docs/visual-assets.json`，声明唯一资源 ID、纹理键、输出路径、路线、状态、证据、项目已定义预算，以及与根节点完全一致的基线 ID、版本；风格指纹仅作可选追踪。每个资源无论处于 `planned`、`producing`、`review`、`accepted`、`rejected` 还是 `replaced`，都必须二选一声明具体 `scene_id`，或 `shared: true` 及至少两个 `shared_scene_ids`；仅运行必需资源可用 `shared_reason: runtime-required` 免除两个场景条件。拒绝或替换资源仍保留原场景归属，确保审计链可追溯。
3. UI、像素美术、逐帧/骨骼动画、Tilemap、VFX、背景和玩法环境走各自路线。框选效果图拆单图只属于 AI 合成栅格路线，不是默认管线。
4. 场景/系统/参考还原在 V2 做确定性机器 F2；原子资源和组件集不重复设置 V2 审核。
5. AI 生成包固定使用“全局提示前缀 + 资产特定段 + 状态段 + 负向段”，并记录模型/版本、种子、参考输入、控制参数和后处理。相同关键词、模型或调色板不得单独证明一致。

V2 使用仍适用的 V1 `AUTO` 或 `USER_DECISION` 记录、视觉可交付与全局基线；还原任务必须绑定冻结视觉目标、必要的区域关系证据和 `visual_validation.mode`。`exact` 才要求严格忠实度矩阵与精确例外；默认 `usability` 允许小幅位置、尺寸、边距和换行差异。

V2 的生产合同字段必须逐 `annotation_number/region_id` 显式记录 `production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`。原生区域还要冻结上述 `native_suitability.render_contract`，并由实现单元的 `runtime_implementation.render_contract` 精确镜像；它与目标、基线、候选和区域定义共同受确认身份约束。拆解顺序固定为“先 `state_analysis`，再 `component_inventory`”：所有普通、selected/active、disabled、pressed/hover、victory/defeat/paused 状态必须写 `required` 或 `not-applicable+reason`；`annotation_number` 不是资产数量单位。`component_inventory.component_count` 必须对应可复用部件清单，生成式位图的 `expected_assets` 必须按 `component_id × required state_id` 一一对应。生成式位图使用 individual 位图并声明 `atlas_allowed=false`，一张横向组图或图集均不能满足多个部件；验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max)` 自动计算 `width/height`，只能使用精确最小尺寸；`scene_asset_usage.max_dpr` 必须严格为数字 `1`，`padding_policy` 必须为 `none`，这部分机器合同不要求 human_review。这里的 1 表示图片按最大约定逻辑显示尺寸 1:1 生产；运行时实际 DPR 按设备动态取值并封顶为 2，不改变资产尺寸合同。历史 1.5/2 倍生产证据须重生成或标记 `stale`。其他生产方法只有在显式 `atlas_allowed=true` 且每个部件×状态登记完整 `atlas_slice` 时使用图集。交互热区单独登记，不计入视觉资产数量。`independent-production` 与 `generate-now` 不推断具体生成器；独立生产不等于图片生成，视觉相似不等于生产合同完成。若 `image_generation_required=true`，必须是 `image-generation+raster-image`，并交付独立源/运行时位图、实际生成器及版本、完整提示词与生成记录、MIME/宽高/alpha及实际文件、运行时消费证据；工具版本未暴露时记录 `not-provided`，不可自动替换为原生实现。实施包的 `visualProductionUnits` 必须与 coverage 一一映射；编号、部件/状态、输出共享、路径、所有权和格式冲突先在 V2 `repair`，只有冻结生产规格真实变化时才进入必要回退。

生成式位图的源文件、运行时文件和实际输出仅允许 `image/png` 或 `image/jpeg` 以及 `.png`、`.jpg`、`.jpeg` 后缀；通用 authored-raster 可使用其他位图格式。生成资产 `expected_assets.alpha=true` 时，Schema 必须冻结 `transparency_requirements.strategy` 与 `edge_profile`，并在记录中绑定 `edge_evidence`。`background-removal` 只允许用于 `hard-edge` 且主体与指定纯色背景明显区分的输入，调用公共 `remove-background-local.mjs` 时必须启用纯色校验、`--edge-profile hard-edge` 和 `--color-separation-verified`。半透明、辉光、柔和阴影、毛发、玻璃和混合边缘不得用颜色阈值去背。`direct-alpha` 只有在工具与对应边缘类型的能力已验证时才可选；必须记录实际工具、版本、支持的边缘类型及能力证据，解码输出 PNG 证明真实透明像素。`mask-composition` 记录原始输入、独立遮罩和输出的路径、SHA、工具、版本、参数及证据。能力不足时报告缺口，再使用独立遮罩/人工创作、重新生成或经明确路线变更批准的 Cocos 特效；不得提高容差、硬抠轮廓、删除光效或伪造透明。

每条生成路线按真实生产活动记录工具/版本、参数、后处理、原始输入路径与 SHA，以及最终归一化 PNG 路径与 SHA。只有背景去除路线记录背景颜色、`color_separation_verified` 和 `background_removal_attempts`；`provided`/`reuse` 已有透明图保持资源来源记录，不补造生成或去背记录。透明输出须由 V3/V4 解码检查真实像素 Alpha；声明、扩展名、提示词或工具参数均不足以证明透明。

生成式位图单图按“保留原始输出 → 执行冻结的透明路线（如适用） → Sharp 尺寸归一化 → V3/final/runtime”执行。`normalization_record.source_file` 绑定当前处理输入；最终 `actual_output`、`runtime_file` 和 `normalization_record.output_file` 指向归一化后的 PNG/JPEG（`alpha=true` 只允许 PNG，`alpha=false` 可用 JPEG）。归一化保留透明 Alpha、画布比例和主体边界，禁止把棋盘格预览烘焙为背景。首次输出比例不符时最多重生一次；第二次仍不符时，若已冻结裁切焦点和安全事实，使用 `crop-and-resize-to-contract` 并记录两次真实原始生成 attempt、SHA、尺寸、focus 和最大目标比例 `crop_rect`；若裁切会损伤主体、文字、透明轮廓或关键构图，则报告能力缺口并重新制定输入/路线，不执行有损处理。该分流适用于所有生成式位图，`expected_assets.width/height` 最终必须精确匹配，`padding_policy=none`，禁止非等比拉伸、裁剪冻结 `reference_target`、补边、contain、复制边缘或静默变形。尺寸已满足时也要记录 `operation=not-required`；透明素材归一化前后均须解码验证真实 Alpha。归一化记录缺失、失败、实际尺寸或路径不满足要求时阻断 V3，SHA 不参与验收。

每条透明路线都为同一候选生成浅底（`#F2E9DF`）和深底（`#16202E`）预览，并记录实际候选和最终归一化 PNG 路径，SHA 可省略。V3 允许视觉检查保持 pending；检查入口直接并排展示浅底、深底和可放大的独立资源，V4 须检查主体缺损、残留背景、色边和半透明区域，并记录通过状态与人工检查证据。

V2 阶段 B 的唯一生成入口还必须在 PNG 输出目录同步写入唯一 `layout-nodes.json`、`layout-decision.json`、自包含 `review.html` 和 `generation-result.json`。scene contract 的 `layout_decomposition.layout_source.nodes_file` 必须指向这份同批 `layout-nodes.json`；annotation 和 confirmation 的 `layout_nodes_file` 必须与之匹配。审阅页直接消费同批参考图/唯一节点数据，使用同一坐标映射展示当前与父节点关系；其余候选状态、离线约束、名称回退及实际文件规则见[离线布局审阅产物](../../cocos-game-ui-layout/references/layout-review-artifacts.md)。这些 PNG/review/派生展示快照只服务于可读审阅，不能成为第二份布局事实或回写 proposal，也不能替代标准 PNG、F2 机器门或 V4 证据。

## V3 正式资源生产与资源级验收

V3 只完成正式资源生产和资源级验收，不要求正式 Scene 功能代码或组合运行轨迹。验收通过后，V4 直接读取 V2 已确认的布局和 V3 已验收资源，在正式 Cocos Scene 中实现、校准和验收画面。离线 `review.html` 与 V2 目标节点保持只读。

1. 按冻结场景顺序和 V2 清单生产运行时文件；当前 V3 范围内相互独立的静态 component × required state 待生成图片统一按下述批量规则提交，不逐张创建或串行等待生成任务。有父图依赖的图片帧动画遵守自身制作与逐张确认合同。不静默覆盖已验收版本；同步登记来源、生成记录和适用的版权/许可信息。
2. 每项图片必须记录 CSS 逻辑显示范围、最大 intended scale、生产分辨率、source/runtime 文件尺寸，以及在代表性视口中是否会被放大；分辨率不足时阻断 V3，简单插值放大不得作为清晰度修复。生成式图片仍使用固定 1:1 生产基线，不能用运行时动态 DPR 或其上限 2 替代；历史 1.5/2 倍生产证据须重生成或标记 `stale`。
3. 逐资源验证透明边缘、尺寸、采样、锚点、九宫格、帧序、缩放、压缩、Cocos 加载、目标视口和预算；F2 还要分别验证满幅背景资源能力与响应式绑定。
4. `accepted` 资源必须有可编辑来源或生成记录、正式输出文件和资源级加载/视觉证据；涉及外部素材时保留版权/许可记录。无 `source_file/source_files` 时，生成记录必须带公共 record ID、生成器/版本、时间、可执行命令或配方、输入来源和参数；AI 路线在此基础上保留专用提示词、模型、种子、参考输入和后处理字段。正式 Scene 消费与玩法运行轨迹在 V4 验证。启用 `--check-files` 时所有声明文件必须存在。
5. V3 只验证 V1 已定义或原子资源已引用且在 V2 写入的预算；超预算先阻断并重验当前门，只有预算基线或冻结生产计划必须实质修改时才 `return` 到 V2，不能在验收时临时放宽。
6. 所有标准路径都在 V3 做确定性机器 F2。资源问题留在 V3；跨域集成风险不在资源层提前做 F3。普通本地集成不因 A4 等级标签额外等待审批，外部写入、付费、真机、破坏性或外部删除和发布才进入精确操作批准。
7. 每个生产包直接提供图片画廊或联系表，并保留每项原尺寸放大查看入口；画廊中并排呈现逐资源对照，引用具体区域和可观察事实，方便检查形状、比例、材质、光源、描边、色彩和渲染密度。场景同屏组合由用户在 V4 实际运行验收中检查。随附文字只列失败、缺失和待处理差异，不先要求确认文字报告。
8. 忠实还原逐资源和同屏核对其是否支持冻结视觉事实；逐资源检查须在画廊中把冻结 region、原始生成图、最终运行图并排按实际显示尺寸查看，并允许放大，再在正式布局中复核。轮廓、比例、姿态、符号语义、主色分布、材质、光源和装饰密度任一出现可辨认偏离时，该项标为失败并进入修复批次，不能只凭提示词合规、文件齐全或 `usability` 可用性通过。返修直接展示参考/修前/修后三图供用户确认修复效果，并按图像反馈继续返修，不另等文字修复方案确认。技术 ID、文件路径或普通生产方案调整由代理更新内部计划、身份绑定并重验；若已确认的拆解标签或生产边界改变，重出受影响拆解图并由用户看图确认；只有冻结视觉目标、玩法语义、任务范围或授权发生实质变化时才询问具体取舍。不得用整屏铺图、隐藏层或不可交互栅格绕过结构化实现及差异审计。
9. 运行 `production_contract_audit`，逐区域比较 V2 预期方法/交付类型与实际输出、生成记录和运行时消费；缺文件、缺记录、格式不符或实际方法漂移必须带阶段、编号、区域、expected/observed method 返回失败。原生路线对照实现中的冻结 `render_contract`，图片路线对照实际独立输出和消费记录。

10. 正式图片生成、透明处理与尺寸归一化后，按[正式图片生成后的共享与复用](asset-production-routes.md#正式图片生成后的共享与复用)核实实际共用需求与各消费位置的适用性，记录共享候选、已确认复用关系或保持独立的原因。已通过者登记权威资源身份、全部消费位置、使用限制和证据；待人工视觉检查者保持候选。后续任务先查此记录，但不因功能相同或视觉相似直接换源，也不改写本轮真实生成记录或已冻结的独立生产合同。

V3 以文件、性能、加载、响应式、`production_contract_audit` 和一致性证据判断工程可交付。工程结论不能覆盖 V2 拆解方案、当前 `AUTO`/`USER_DECISION` 记录、视觉可交付或全局一致性失效。

### 图片批量生成

本节适用于相互独立的静态 component × required state 图片。存在父图依赖的图片帧动画按[帧动画合同](../../cocos-frame-animation/SKILL.md)及[图片递归补帧规则](../../cocos-frame-animation/references/image-inbetween.md)逐张确认后推进；只有已满足父图与确认前置且相互独立的区间可按动画合同并行，不能套用本节跳过确认。

开始生成前，从当前已完成 V2 确认的生产范围收齐上述静态待生成图片，按唯一 component × required state 去重，形成一个批量生成任务。每项携带资源身份、完整提示词、实际参考输入、尺寸/背景合同和独立输出路径；共享 placements 复用同一项。复用资源、程序实现和尚未满足 V2 前置的显示层待办不计入本批。

一次提交整批任务，不采用“生成一张 → 等待完成或验收 → 再提交下一张”的调度。工具支持批量请求时一次传入全部条目；只支持单图调用时，在同一批任务内一次编排所有条目并按工具允许的并发执行，不能退回逐图工作项。工具的容量限制只影响批内执行，不改变完整批次范围。

批量是任务提交粒度，每项仍交付独立位图并保留各自生成记录；`individual + atlas_allowed=false` 不变，禁止把整批合成一张图再裁切。每项沿用原图、透明路线去背、尺寸归一化的依赖顺序；批次完成后汇总成功、失败和缺失项，直接提供可逐张放大的画廊/联系表供视觉验收；文字只汇报失败、缺失和待处理差异。同屏组合在 V4 正式运行验收中检查。效果图中的小部件按[提示词合同](effect-image-prompt-contract.md)同时发送完整冻结图与同源局部细节参考。每项先由代理记录具体偏差及对应冻结事实，再只把生成失败、缺失或视觉偏离项汇总为修复批次；直接展示参考图、修前图、修后图并排供用户确认修复效果，并按图像反馈继续返修，不等待文字方案确认。技术 ID、文件路径或普通生产方案调整由代理更新内部计划、身份绑定并重验；若已确认拆解标签或生产边界改变，重出受影响拆解图供用户确认；只有冻结目标、玩法语义、任务范围或授权发生实质变化时才询问具体取舍。已通过项不重复生成。沿用每项既有重试上限；到达上限仍无法忠实还原时报告阻塞和差异，不能把偏离项标为成功或用同屏可用性结论掩盖。

## V4 正式还原与动态玩法视觉验收

1. 直接消费 V2 确认的节点关系、初始布局和锚点，以及当前场景或合规 shared 的 V3 `accepted` 资源；通过 Creator MCP 在正式 Cocos Scene 中装配 Node、Component、Prefab、命名父节点、显示层和布局/表现配置。不得手写 `.scene`、`.prefab` 或 `.meta` 绑定，不另写一套定位，也不用整张效果图替代可交互结构。详细边界见[美术生产与接入 Skill](../SKILL.md#creator-编辑器与-assetdb-边界)。
2. 玩法独占规则、状态、碰撞和交互代码；美术可以调整不改变玩法的布局与表现集成。视觉接入只改变表现，不得改变玩法规则、碰撞语义或状态所有权；跨边界改动停止并交回所有者。
3. 提供动态可玩片段、同屏截图或可复现交互轨迹，对照主锚点和分系统锚点验证跨场景/状态的视觉质量；响应式路径提供完整 viewport、resize 前后测量、安全区和多比例证据，并作为 V4 候选的 F2/F3 证据。
4. 清除低保真纹理、占位纹理键、临时路径、fallback、代码分支和运行时引用；保留调试工具必须与正式运行隔离。
5. 所有路径在 V4 后由 F3 绑定当前候选工程证据；只有外部写入、付费、真机、破坏性或外部删除和发布等具有副作用的 A4-A6 操作在 F4 请求精确操作批准。资源执行和上游事实未变的机器证据偏差在当前门 `repair`/`revalidate`；只有生产设计、冻结基线、拆解方案或结构真实变化时才 `return` 到 V1/V2/V3 中最早受影响阶段，并使对应下游证据失效。
6. 忠实还原默认使用 `visual_validation.mode=usability`，在代表性视口/状态以完整可读画面为主证据，检查关系、可读性、边界、遮挡和交互；位置、尺寸、边距和换行的小幅差异不单独阻断。只有 `exact` 或明确精确需求时才逐项验证完整忠实度矩阵、严格容差、ROI/叠加/像素差和全视口/全状态覆盖，动画/VFX 仍不得只看像素差。
7. V4 硬门必须同时绑定 V2、`visualProductionUnits` 实施包、V3 production contract audit、F2 `validationMode=MACHINE` 事实、F3 runtime replay、fidelity cases、正式场景实际消费和无未批准替换；任一关键项缺失或身份漂移都不得声明完成。V4 的实际运行验收沿用 V1 冻结的视觉方向和 V2 确认的布局目标。
8. 每个 `cocos-native` region 必须提供 `native_runtime_evidence`：实际 `observed_method`、`observed_delivery_kind`、与冻结参数逐值相同的 `render_contract`、`status=passed`、指向消费报告 JSON 的 `evidence` 和本次实际运行标识。`projectRoot` 可用时须读取该文件并要求 JSON 声明 `report_schema='native-render-consumption/1.0'`、`consumed=true`，且 `region_id/scene_id/state_id` 与当前区域身份一致；`observed_method`、`observed_delivery_kind`、`render_contract` 须与 `native_runtime_evidence` 逐值一致；candidate/target/baseline/diff 摘要不参与验收。文件缺失、不可读、JSON 错误或内容/任务归属不匹配均阻断；SHA 对应的无关 JSON 不能作为消费证明。只提交规划中的原生参数、未证明实际渲染和运行消费，不能通过 V4。

## 完成条件

当前场景只有在功能代码、V2 规划、全部正式资源 V3 `accepted`、V4 正式接入、占位清理，以及功能、视觉、响应式和性能联合证据全部有效后才能报告完成。任务范围内场景和功能关闭前不得据此宣称 G1 完成。

### 拆解图确认（视觉硬门）

V2 完成拆解图、技术 JSON、component×state、生产合同和合同回对后，通过 `visual-decomposition-confirmation/1.0` 冻结 Stage A proposal；该确认以 `confirmation_mode=manual`、`status=accepted` 绑定实际拆解 annotation/proposal、用户决定记录与 receipt、当前工作项/场景/版本、全部编号和用户原文。随后由 Stage B decision 生成唯一 `layout-nodes.json`，再通过独立 `layout-annotation-confirmation/1.0` 以 `confirmation_mode=manual`、`status=accepted` 绑定最终布局图、review、Stage B decision、唯一 `layout_nodes_file` 和上游身份。scene contract 的 `layout_source.nodes_file` 必须与布局 annotation/confirmation 的 `layout_nodes_file` 完全一致；这些 V2 方案身份变化才需要重新确认。V3 的 fixed asset、component×state 与资源 F2 检查，以及 V4 正式场景的同屏组合、适用逐区域 fidelity 与运行 F2 检查，由当前身份的机器证据核对可确定性事实；overlay/diff 仅在 exact 或明确需求时强制。机器不推导视觉舒适、质感或主题结论；V4 按观看情境交付正式运行画面和持续游玩片段供用户检查。后续候选的正常演进不重开无关方向决定，但实际变化的画面仍按当前阶段复验，机器或人工证据缺失时不得宣称整体视觉通过。

### 原子视觉拆解补充

拆解顺序固定为“先状态分析，再按可复用部件拆解”：`component_count` 只计算唯一原子视觉部件，`visible_instance_count` 通过多个 `placements` 表达重复实例。② 的六个顶部按钮分别登记六个 component；⑧ 的三个相同表面可登记一个 component 加三个 placements，⑨ 的三个动作图标按实际复用关系登记。生成式位图每个唯一 `component×required state` 必须独立位图，强制 `individual + atlas_allowed=false`，不能以编号级组合图或图集替代；atlas 仅适用于其他生产方法的显式切片合同。交互热区绑定 placement 且不计入视觉资产。实际状态证据、目标文件、分析 ID 和完成时间必须先于 component inventory。
# 场景级效果图还原门

效果图路线在 foundation-only 基础实施完成后进入场景 V1，并在 V1 内建立并冻结 `scene_reconstruction_contract`、scene master、显示层 inventory、宿主场景上下文效果图和初步还原草案。V1 负责冻结视觉事实、整屏构图、目标绑定布局、响应式关系、项目容差、`visual_validation.mode`（默认 `usability`）和可供确认的初步拆解；V2 直接输出拆解图和技术 JSON，用同一套拆解事实确认 component×state、尺寸、停靠/父子/对齐关系、显示层、资源生产路线和容差。V3 完成正式资源验收，V4 在宿主场景上组合并重放打开→交互→关闭/恢复轨迹。

V4 直接在正式场景中实现并校准 V2 布局和 V3 正式资源。V4 要求重建合同、layout、V2/V3、适用功能与可用性验证、真实运行及正式 Scene 消费证据通过；完整逐区域精确 fidelity 仅在 exact 模式要求。资源 loaded/used 或 `missing=0` 只能构成工程子门。

### 场景还原硬门与 CLI 回执

效果图路线按 `V1 → V2 → V3 → V4` 单向推进：V1 生成或接收并冻结 reference target、scene master、宿主上下文图、`reference_technical_conflicts`、整屏构图、布局/响应式关系、逐区域事实、项目 tolerance 和初步还原草案；V2 绑定拆解图、proposal 技术 JSON、合同回对、coverage、component×state、当前候选版本和拆解方案确认；V2→V3 缺字段直接以 `方案缺失` 回 `V1/PROPOSAL`。V3 绑定资源生产实施包与资源合同，完成资源级验收；V4 绑定正式 Scene 结构、运行时组合与 `scene_asset_usage`，执行真实文件门、F2 两类机器证据、F3 runtime replay 和正式 Scene consumption。

默认 `visual_validation.mode=usability` 记录实际 viewport/DPR、可读完整画面、关键关系、可见性和交互证据，允许合理位置/尺寸差异以及已声明的背景出血、滚动裁切。只有 `exact` 才要求 `normalization_equivalence`、非空 `difference_evidence`、完整逐 region 的 target/candidate、delta、预声明 `tolerance_reference`、result、evidence 和 `exception_ids`，并按严格容差判定。局部临时 tolerance 不具备精确合同效力。普通问题先原地修复和定向重验；仅上游目标、设计或任务范围真实变化才回退。

门禁回执示例：

```text
失败：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4
典型输出：V4 必须显式 checkFiles=true；未执行真实文件门，V4 FAIL。
成功：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .
典型输出：结构合同、正式场景运行组合、F2、fidelity、runtime 和文件证据全部通过，退出码 0。
```

### 全局视觉一致性输入

在任何场景效果图或正式资源生成调用前，必须引用已冻结的全局 `visual_baseline`；全局候选、人工选择、冻结状态及跨 Work Item 文件门以[全局视觉控制](global-visual-control.md)和控制面 Schema 为准。该基线同时作用于 scene master/reference target、显示层上下文图和原子生成式位图资产；原子资产必须保留完整冻结效果图主参考，再把全局锚点作为额外 style references。generated 记录必须留下实际完整提示词、实际生成器/版本、canonical 一致性段、禁止风格迁移策略、实际输出和一致性证据；provided 只登记外部来源。文件门读取这些实际文件；基线或锚点的实际事实不再满足当前要求时，重新判断受影响证据，不因摘要变化使证据失效。
