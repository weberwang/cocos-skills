# 视觉与功能还原

缺少瞬态弹窗宿主图时，为弹窗建立独立 DISPLAY_LAYER Work Item 并停留在其自身前置门；宿主场景继续自己的 V1、V2、V3、V4。弹窗的完整上下文要求和运行证据只约束弹窗工作项，不进入宿主场景完成条件。

参考截图、效果图、录屏、运行项目和源码是输入，不是通过结论。参考还原属于 V0 的完整路径并执行 V1、V2、V3、V4；功能契约仍优先定义玩法行为，但当 Work Item 明确以指定效果图或参考截图为还原目标时，必须启用“忠实还原模式”。该模式默认使用 `visual_validation.mode=usability`，不因 effect-image 自动启用 `exact`；只有用户明确要求像素级还原时才选择 `exact`。

effect-image 生成式位图的 canonical 提示词模板、asset_prompt 事实继承和生成记录绑定见[《Effect-image 生成式位图忠实还原提示词合同》](effect-image-prompt-contract.md)；本文只规定场景还原路由与视觉事实门。

## 忠实还原模式

指定参考在已登记的目标视口、设备像素比、语言、状态、随机种子和动画时间点下构成冻结视觉目标。参考中可观察的构图、层级、相对位置与尺寸、比例、色彩、材质、光影、字体、图标和装饰密度是设计事实；不得在没有用户明确要求时改成另一种产品方向或玩法语义。默认可用性验证允许小幅位置、尺寸、边距和换行偏差，明显越界、裁切、关键遮挡、不可读或交互失效仍必须修复。`usability` 只放宽像素级几何测量，不放宽资源形态和画面构图的忠实度；角色姿态、主要轮廓、符号语义、色彩材质或视觉重心出现明显偏离时，仍按还原失败处理。

V1 内生成或接收并冻结参考身份、版本、权属、原始文件指纹、适用状态、scene master/reference target、宿主上下文效果图、布局合同、视觉事实、验证模式和项目容差。需求或基线已明确且不存在产品方向、玩法语义或上游结构取舍时记录 `AUTO`，直接提供场景目标/宿主上下文预览；不先要求确认文字方案。只有会改变产品方向、玩法语义、上游结构或视觉目标的实质歧义才请求一次 `USER_DECISION`，优先用图像示例呈现选项。默认 `usability` 不把细节几何偏差升级为决定门。

## V2 拆解确认与生产方案

V2 直接基于 V1 冻结图做完整拆解，并按两个串行图像确认阶段推进：阶段 A 由用户确认拆解 PNG，阶段 B 由用户确认布局 PNG/审阅页。拆解分析、技术 JSON 和布局决策由代理内部维护；用户不需要先阅读或确认文字提案，也不跳过任一真实图片确认。

V2 布局标注在拆解图确认之后串行产出：阶段 A 先从冻结事实生成按确认顺序排列的拆解 PNG、技术 JSON 和 `decomposition_elements`，用户直接看图确认；若需修改，可指出编号/区域，代理更新事实并重出图。阶段 B 由智能视觉判断结合原图构图、视觉重心与元素语义，按同一顺序为每个确认元素生成唯一的 `left/center/right × top/center/bottom` 决策。布局生成器只读取确认 proposal 中的元素和该决策，按原顺序推导后置布局节点并生成独立布局标注 PNG 与 `review.html`，不能读取预存 `layout_nodes`、按距离猜测对齐、生成新的视觉参考图或提供多个布局候选。布局决策由代理内部维护；用户直接检查最终布局图/审阅页并确认，只有图中关系需要修改时再按图上反馈返修。最终确认仍绑定决策文件、布局图及上游拆解身份。

- 左原图、右说明栏的 PNG 标注图，覆盖全部 scene/state、区域编号和生产标签。
- 技术拆解 JSON，记录每个元素的 bounds、尺寸、位置、父子关系、停靠关系、对齐关系、坐标空间、层级、显示层、状态、文本字形事实和响应式关系。
- coverage 审计，要求每个 scene/state `coverage_ratio=1`、无 uncovered、区域不越界且编号唯一。
- `component_inventory` 与 `state_analysis`，先状态、后组件，每个 component × required state 都有生产要求。
- `visual_route_analysis` 与 `visualProductionContract`，明确 runtime-data、runtime-rendered、fixed-production-visual、reuse-existing、runtime-program 或 generate-now 的边界。
- `visualProductionUnits` 生产计划，逐 annotation number / region ID 绑定 owner、路径、格式、资源、组件状态、交互热区和输出。
- `visual-decomposition-confirmation/1.0`，由用户确认实际展示的拆解 PNG，关联实际 annotation/proposal/decision 文件、work item、scene/state、全部编号和用户原文；技术 JSON 仅供后台校验与追溯，不另设文字确认。布局另以 `layout-annotation-confirmation/1.0` 绑定用户检查的最终布局 PNG/审阅页、决策文件及上游身份。

确认只冻结还原方案与生产边界，不改变玩法、布局或视觉事实的责任归属。提案、目标、区域定义、用户原文、候选身份或布局字段漂移时，确认失效并回到当前 Work Item 的 V2 重做拆解确认；普通运行候选演进只重验受影响证据。

### 来源路线、渲染合同与行为装配

拆解中的程序元素须满足[程序还原资格与位图回退](asset-production-routes.md#程序还原资格与位图回退)，不能仅凭元素名称、可交互或能显示相同文案就选择程序路线。文字的渐变及其它效果无法完整复现时，按[文字路线判定](../../cocos-game-ui-layout/references/layout-contract.md#文字路线判定)拆为位图或合规混合方案，不删减冻结视觉事实。

`visual_route_analysis` 必须依据冻结图中可观察的外观事实，以及当前 Cocos 原生能力能否精确表达这些事实。按钮、面板等语义名称不能决定图片或原生路线；静态/动态属性也不能单独作为原生资格。文本、纯色矩形、基础几何、规则边框、简单规则渐变、遮罩和进度填充，在 Cocos 可确定性表达时可以走原生路线。特色插画、复杂纹饰、不规则轮廓、复杂材质和明显具有美术特征的装饰继续使用独立图片路线。特色视觉拟走原生路线时，必须另有等价性证据并绑定预先声明的容差或精确例外。

每个 `cocos-native` 区域必须冻结 `native_suitability.render_contract`：`renderer`、逻辑像素 `dimensions.width/height`、`colors`、`line_width`、`corner_radius`、`gradient`、`opacity`、`applicable_states` 和 `unsupported_features`。颜色和渐变 stop 的 `color` 均为 `#RRGGBB`；无渐变写 `gradient.type=none` 且 `stops=[]`；线性渐变须冻结 0–360 的 `angle` 及按绘制顺序排列的 stops。参数按冻结参考精确登记。`runtime_implementation.render_contract` 必须镜像原生资格合同并纳入区域定义记录；修改参数会使已有拆解确认失效，不得在行为装配时悄悄更改。Cocos 原生能力不能确定性表达的视觉特征列入 `unsupported_features` 并阻断该路线，禁止以近似绘制代替。

视觉外观来源与行为装配分别记录。一个按钮可由原生框体、独立图标 image-asset 和 Creator `Label` 文字组成；每部分单独记录 owner、状态、生产合同和布局/资源绑定，交互行为再使用显式组件/节点引用接线。不能把不同来源或职责合并成 `composite` region / `composite_parts`，也不能用覆盖整按钮的大区域模糊归属。已冻结 `image_generation_required=true` 的区域必须继续执行图片合同，不得自动换成原生路线；路线变化遵循明确接受的 Change Request。

## 布局与文本拆解

按[游戏内文案](../../cocos-game-ui-layout/references/game-copy.md#资源拆解与界面实现)只登记冻结目标中实际可见的文字/数值及其显示来源，不能从 GDD 的业务说明补出文本节点。目标文案需要调整时先修订受影响的上游目标，再拆解，不在还原时静默删改。

效果图拆解必须先看整屏构图，再冻结 `decomposition_elements`、视觉元素/组件、状态事实和 `display_layer_planning`；不能先拆资产、最后凭感觉补坐标。`target_bounds` 是参考图测量事实，不是运行时硬编码；布局节点在拆解确认后由元素 bounds/role 自动推导，布局合同负责运行时计算和响应式变换；runtime measurement 只是候选证据，不能回写或替代参考事实。

每个区域必须登记唯一 `annotation_number`、`region_id`、`layout_node_ids`、owner、实现计划和精确 `bounds`。每个 placement 必须有唯一 `layout_node_id`，只能引用本区域节点；没有 placement 的运行时区域必须由 `runtime_implementation.layout_node_ids` 消费。节点不得孤立、跨区域、被多个 placement 重复消费或同时被 placement 与 runtime 重复消费，除非另有显式复用合同和 placement 级证据。

文本节点必须作为独立拆解对象登记 `text_node_id`、content/source、semantic role、动态/本地化标记、目标 bounds、字体身份与置信状态、字号/字重/样式、行高、字距、对齐、baseline、fill/stroke/shadow、wrap、planned test ID 和实现路线。动态或本地化文本禁止 `image-text`；固定品牌字标可用图片，但必须保留可访问语义。

父子几何必须可复核：先确定 `parent_layout_node_id`，再冻结 `parent_target_bounds`，测量 child 到父内容框四边的 `relative_position.left/right/top/bottom`。水平 `left/center/right` 与垂直 `top/center/bottom` 由智能布局结合原图构图、视觉重心和元素语义写入显式 `axis_alignment`，不能由距离自动反推；测量只用于包含校验、偏移计算和漂移检测。`offset`、`self_anchor`、`reference_anchor` 必须与该视觉决策一致。

## V3 正式资源验收

V3 消费 V2 已确认的拆解图、技术 JSON、coverage、布局合同和生产计划，生产并验收图片资源或原生实现单元。图片资源保留真实来源、许可信息、生成记录、独立输出文件、组件状态和冻结目标绑定；原生实现保留与冻结合同一致的运行实现来源，不能伪造图片输出。静态资源按已冻结的 component × required state 批量生产，完成后直接提供可逐张放大的图片画廊/联系表；对照说明留在图片旁，正文只列失败、缺失和待处理差异。此阶段不依赖正式 Scene 功能运行，但后续 V4 必须验证实际原生渲染和运行消费。

V4 直接消费 V2 确认的布局目标与 V3 验收的正式资源，在项目正式 Cocos Scene 中实现并校准真实画面；V2 的目标节点和离线审阅页保持只读。具体还原与偏差处置按[正式场景视觉还原与校准](visual-alignment-authoring.md)执行。

生成式位图区域按 V2 `component_inventory` 收齐全部待生成 component × required state，作为[一个批量生成任务](visual-production-pipeline.md#图片批量生成)一次提交；每项交付 individual 位图，`atlas_allowed=false`，不能将独立文件要求解释为逐张调度。宽高由逻辑像素 `ceil(max placement width/height × intended_scale_range.max)` 决定，`max_dpr=1`，`padding_policy=none`。这里的 1 表示图片按最大约定逻辑显示尺寸 1:1 生产；运行时实际 DPR 由设备动态读取并封顶为 2，不改变已冻结的资产尺寸；历史 1.5/2 倍生产证据须重生成或标记 `stale`。系统根据提示词、参考输入、主体材质、透明需求和已验证能力选择实际生成工具，并在记录中写入实际工具、版本、输入/输出 SHA、参数和后处理。生成资产的 `expected_assets.alpha=true` 必须冻结透明策略与边缘类型：只对明确硬边且颜色分离通过的素材使用公共纯色去背；直接 Alpha 必须对工具和对应边缘类型完成能力验证，并解码 PNG 证明真实 Alpha；复杂边缘可用独立遮罩/人工创作、重新生成，或按明确变更合同转为 Cocos 特效。半透明、辉光、柔和阴影、毛发、玻璃和混合边缘禁止阈值去背；工具无法可靠交付时报告能力缺口，不提高容差、硬抠轮廓、删除光效或伪造透明。归一化保持 Alpha、比例和主体边界，不能把棋盘格烘焙背景。每条透明路线生成浅底与深底预览，V4 记录主体完整、背景残留、色边和半透明区域的视觉检查。已有真实透明图按资源复用合同接入，不伪造生成或去背记录；`image_generation_required=true` 的冻结合同不能由路线判断或提示词生成器自动替换。

## V4 运行态与动态验收

V4 按 `visual_validation.mode` 运行证据验证视觉与功能联合结果。默认 `usability` 在目标及代表性视口/状态提供可读画面，检查布局关系、边界、遮挡、交互和恢复，并与冻结效果图并排核对主要构图及高显著性资源的可观察视觉事实；参考与候选记录视口、实际有效 DPR（动态封顶 2）、语言、操作轨迹、随机种子和动画时间点。只有 `exact` 或明确精确需求时才要求完整 viewport、逐状态/逐区域忠实度矩阵、严格容差、ROI、叠加和像素差证据。默认模式下并排核对不等于逐像素验收，但明显视觉漂移仍须修复。

每个 fidelity/parity case 不可变记录冻结目标文件、当前实际代码或构建、scene/state、viewport、实际有效 DPR、语言、随机种子、输入轨迹、动画采样/稳定帧、布局合同版本、视觉基线版本、双方证据、预定义容差、例外 ID 和结论。上游事实或当前受影响候选身份变化才令对应旧案例失效并重新采集；其他单元路径级结果继续有效。默认 `usability` 保留代表性案例，`exact` 或明确全覆盖需求才要求全部视口/状态组合。

每个原生区域还须提交 `native_runtime_evidence`，其 `observed_method`、`observed_delivery_kind`、`render_contract`、`status=passed`、指向消费报告 JSON 的 `evidence` 必须对应本次实际运行对象和结果。`projectRoot` 可用时必须读取 JSON 工件，校验 `report_schema='native-render-consumption/1.0'`、`consumed=true`，以及与当前区域一致的 `region_id`、`scene_id`、`state_id`；实际 method、delivery kind 和 render contract 必须与 `native_runtime_evidence` 逐值一致；candidate/target/baseline/diff 摘要不参与验收。无关 JSON 不能代替实际消费报告。规划参数本身不足以证明运行输出和消费一致。

机器清单生命周期固定为：非效果图 `not-applicable`；效果图完成 V2 拆解确认后为 `v2-ready`，此时允许 fidelity case 为空；只有 V4 已验证才为 `v4-complete`，此时当前验证模式要求的关键 case 必须通过。默认 `usability` 保留代表性场景/状态案例；`exact` 或明确全覆盖需求才要求冻结目标的每个 scene/state 组合至少有一个 passed case。

## 失败条件

出现下列任一情况，V2、V3、V4 或完成报告不得通过：

- `exact` 模式下存在未解释差异或超出预定义容差的差异；`usability` 下存在明显越界、裁切、关键遮挡、不可读或交互失效。
- 缺少当前验证模式所需的同条件参考证据、候选证据或适用的响应式证据；完整 viewport 只在 `exact` 或明确要求时必需。
- 缺少 V2 拆解图确认、技术 JSON、coverage、生产计划或任一编号绑定。
- 改变产品方向、玩法语义或上游结构却没有对应的 `USER_DECISION` 记录。
- 原生路线缺少可观察资格事实、冻结参数或真实运行证据；不支持的视觉特征被近似绘制后放行；冻结 `image_generation_required=true` 被未经批准改成原生实现。
- 只有“很像”“更美观”“已专业修复”等主观结论。
- 使用整屏截图、隐藏覆盖层或绝对叠层冒充还原结果。

## 常用命令

```text
失败：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4
输出：current_stage=V4 未执行真实文件门，V4 FAIL。

成功：node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .
输出：scene contract、与 `visual_validation.mode` 匹配的 F2 机器证据、runtime replay 和文件门通过（exit 0）。
```

## 全局基线引用

场景效果图和生成式位图资源必须引用已冻结的全局视觉基线；候选生成、人工选择、冻结状态、锚点继承和文件门以[全局视觉控制](global-visual-control.md)及控制面 Schema 为准。场景自身从 V1 开始，按本文件的 V2 两次确认、V3 资源验收和 V4 正式场景运行态联合验收推进。

生成记录必须明确 `origin=generated|provided`；只有 generated 强制绑定基线四元组、全部 `style_reference_inputs`、canonical 全局一致性段、`style_drift_policy=forbid`、实际完整提示词、实际输出与一致性证据。provided 图不得伪造生成记录。记录或路径问题先原地修复，候选未变的提示词/输出证据更新重验当前门；基线、锚点、目标实际内容或冻结生成合同真实变化时才令旧记录失效，并按合同返回最早受影响阶段。
