# UI 布局合同

布局合同是可验证关系的入口，不是流程状态机，也不能自动批准、自动合并或替代 F0–F4。effect-image 使用 schema 2.0.0 引用合同；普通 UI 使用 schema 1.2.0 普通合同。两者模板分别为 [`ui-layout-contract-template.yaml`](../assets/ui-layout-contract-template.yaml) 与 [`ordinary-ui-layout-contract-template.yaml`](../assets/ordinary-ui-layout-contract-template.yaml)，schema 2.0.0 的精确字段见[JSON Schema](ui-layout-contract.schema.json)。模板采用 JSON-compatible YAML，验证器使用 Node.js `JSON.parse` 解析。

合同的 `origin`、`layout_anchor`、`self_anchor` 和 `reference_anchor` 是布局语义字段，不是 Creator API。屏幕布局标注使用左上原点、Y 向下；Creator `UITransform.anchorPoint` 为归一化坐标且 Y 从底边向上，写入 Node 前必须调用[Cocos 坐标适配](../scripts/cocos-coordinate-adapter.mjs)完成显式转换。Scene/Node/Component、Prefab、AssetDB 和构建操作遵循[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)。

## 合同身份与唯一事实来源

effect-image 的独立 UI 合同根对象仅有五个字段：`schema_version`、`contract_id`、`contract_version`、`project_policy_file`、`scene_contract_file`。schema 2.0.0 合同只引用项目公共布局策略与场景重建合同；不得内联 `regions`、`layout_nodes`/`layoutNodes`、`scope.ui_ids`、`fidelity`、目标布局或运行快照等布局事实副本。普通 UI 继续使用 schema 1.2.0，但只允许使用独立的 [`ordinary-ui-layout-contract-template.yaml`](../assets/ordinary-ui-layout-contract-template.yaml)；本文件后续 schema 1.2.0 字段说明仅适用于该普通 UI 合同。

V2 effect-image 的分组、父子关系、定位参照、`ui_layout`、尺寸与 RAW/九宫格计划、双轴停靠、严格/参考居中、组合成员及 `layout_execution` 统一保存在同批 `layout-nodes.json`。场景合同的 `layout_decomposition.layout_source` 仅写 `nodes_file` 引用，例如 `{"nodes_file":"docs/v2/layout-nodes.json"}`；该路径是后续还原直接消费的唯一布局事实源。`layout_binding`、`layout_annotation` 与 `layout_annotation_confirmation` 只记录业务身份和确认/展示证据；`layout_source.nodes_file` 必须逐字匹配 annotation 与 confirmation 的 `layout_nodes_file`，并与所读文件一致。

Stage A proposal 是已经确认的历史输入；Stage B 的 `automatic-layout-decision/1.0` 是布局生成输入。生成器依据二者生成唯一 `layout-nodes.json`，后续 V3/V4 直接读取它，不再复制节点树到 UI 合同或 scene contract。分组或父子关系确需改变时，按原 Stage A 修改、重生成并重新确认；不在 PNG、review、运行快照或布局摘要中另造事实，也不把 Stage B 布局修订回写 proposal。PNG、`review.html` 和派生展示/运行快照都是只读投影，不是第二份手工事实。

以上引用链不改变已有布局要求：简单底板可同时作为图片和父容器；仅有独立职责时才增加纯结构容器。九点停靠与九宫格拉伸分开，center 默认严格居中，参考中心偏移须说明理由，图文组合按 union bounds 布局；普通图片 `UITransform.contentSize` 保持 SpriteFrame RAW 原尺寸，仅冻结九宫格可使用 CUSTOM 目标尺寸。具体节点规则见[节点组织规则](layout-hierarchy.md)、[居中策略与组合定位](center-alignment.md)和[Widget 定位策略](widget-layout.md)。

## 全局响应式视口合同

项目公共布局策略（`schema_version=1.0.0`）统一声明所有 Scene、HUD、弹窗和 `DISPLAY_LAYER` 共用的 `logicalViewportSpace`、`designResolutionPolicy`、`canvasBackingPolicy`、`runtimeDprPolicy`、`maxRuntimeDpr`、`scaleMode`、Camera、输入、安全区、resize、方向、文字/资源分辨率、`performanceBudget`、`representativeViewports`、`requiredRuntimeEvidence`、`targets` 与 `coordinate_spaces`。effect-image 的 schema 2.0.0 UI 合同只引用该策略文件，不复制这些字段；普通 UI schema 1.2.0 可依其既有根结构填写相同策略事实。

`logicalViewportSpace` 的单位固定为 CSS 逻辑像素（`css-px`/`css-logical-px`）。布局、safe area、断点、点击区域、设计视口、Camera viewport、Camera zoom 和程序化文字排版都在该空间计算。`canvasBackingPolicy` 必须明确 `backingWidth = ceil(cssWidth × effectiveDPR)`、`backingHeight = ceil(cssHeight × effectiveDPR)`，并声明 backing 是物理像素；物理 backing 像素不得直接作为布局坐标或命中坐标。CSS display 尺寸、逻辑尺寸和 backing 尺寸必须分别记录，不能把一个数值重复贴到三种空间。

`runtimeDprPolicy` 必须从设备动态读取，非法、零、负数、非有限或字符串值回退为 1，有效值严格位于 `(0, 2]`，原始值大于 2 时有效值封顶为 2。DPR 不是启动常量：resize 和显示密度变化都要重新读取；若 `orientationPolicy.allowed` 同时包含 `portrait` 与 `landscape`，方向切换也要重新读取并清理监听器。`maxRuntimeDpr` 固定为数字 `2`。资源生产基线另由 `assetResolutionPolicy.productionDpr=1` 声明，和运行时 DPR 分离；1 表示图片生产倍率，不限制运行时 DPR；运行时仍动态封顶为 2。运行时代表性矩阵仍必须覆盖 DPR `1.25/1.5`。

`orientationPolicy.allowed` 必须是非空且无重复的 `portrait`/`landscape` 数组，不从缺省值推断双方向支持。`designResolutionPolicy` 只要求声明 `allowed` 中方向的分支：竖屏基准为 1080×1920、按宽度适配；横屏基准为 1920×1080、按高度适配。实际 CSS 视口为 `W×H` 时，竖屏比例 `s=W/1080`、可见逻辑区域为 `1080×(H/s)`；横屏比例 `s=H/1080`、可见逻辑区域为 `(W/s)×1080`。设计区域在可见区域中居中，另一轴可以展开或裁切；安全区、UI 锚点和输入命中必须使用实际可见区域。横竖屏以运行时视口宽高判断，宽高相等时按横屏处理。

Canvas 必须填满实际可用视口；Creator `scaleMode` 按冻结的设计分辨率策略选择 `FIXED_WIDTH`、`FIXED_HEIGHT` 或有项目实现与实测支撑的 `custom`。逻辑视口、CSS 显示尺寸（适用于 Web 目标）、Canvas backing、Camera viewport/zoom 与输入映射之间的关系仍需实证；单独声明模式或构建面板打开都不是高分屏兼容证明。

Camera 合同必须说明逻辑 viewport 如何映射到物理 backing，zoom 不得偷换 DPR，origin 必须显式声明；输入合同必须说明 CSS client 坐标如何经过逻辑 viewport、Camera 再到世界/命中空间。弹窗和 `DISPLAY_LAYER` 默认继承宿主的 CSS 逻辑视口、有效 DPR、Camera/输入合同和 safe area；若使用独立 Camera，必须在自身合同声明并单独验证。

`resizePolicy` 必须在同一页面完成，不得用刷新页面掩盖重排；resize、safe area 和 DPR 变化后至少重新计算逻辑视口、Canvas backing、safe area、Camera viewport、输入映射和文字排版。仅当 `orientationPolicy.allowed` 同时包含两种方向时，事件数组才必须包含 `orientation-change`，并验证方向切换后的同页重排；所有项目都必须覆盖连续 resize 与 DPR 变化。监听器必须可清理且重复计算幂等。允许在超预算时显式减少滤镜、RenderTexture 或透明全屏层，但不得静默降低 DPR、资源质量或文字清晰度。

`performanceBudget` 至少记录最大 Canvas backing、最大像素总量、RenderTexture、全屏滤镜、透明全屏层、代表性设备和真实测量结果。`representativeViewports` 按 `orientationPolicy.allowed` 覆盖类别：支持竖屏时要求窄/标准竖屏，支持横屏时要求横屏/桌面宽屏；单方向项目用该方向的窄宽尺寸覆盖，并仍包含 DPR 1、1.25/1.5、2 和原始 DPR 大于 2 的封顶样本。`requiredRuntimeEvidence` 必须要求 `viewportRect`、`canvasRect`、`designTransform`、`logicalSize`、`backingSize`、`cssDisplaySize`、原始/有效 DPR、两段缩放、Camera、safe area、边距、背景覆盖、关键 UI、输入命中、resize 轨迹、`pageReloaded`、截图及 scene/state、候选标识、合同/基线版本；`designTransform` 记录实际方向、设计宽高、适配轴、比例、可见逻辑区域及居中偏移，必须与当前 CSS 视口一致。缺少真实运行测量只能标记 `unverified`。

## V2 串行拆解与布局标注

本节定义的是 `layout_source.nodes_file` 指向的唯一 `layout-nodes.json` 内容及其生成/确认过程，不是要求在 schema 2.0.0 UI 合同或 scene contract 中再手填一棵节点树。

拆解先按[功能语义分组约束](functional-semantic-grouping.md)确认区域、功能组件、部件和独立元素。最终元素必须包含显式 `parent_element_id` 与 `semantic_grouping.kind/rationale`；父级表达真实功能、共同状态/交互/生命周期或布局管理归属。一个简单底板组件可由同一元素/节点兼任容器与图片：`element_type: container`、`render_kind: sprite`、`semantic_grouping.kind: component` 或 `region`，并保留自身 `component_id`、`placement_id` 和图片资产身份；不得复制成“空根 + 底板叶子”。位置依赖独立记录在可选 `ui_layout.position_reference_id`，省略时使用实际父级；不得为了满足位置关系或几何包含而增设包装容器。同一功能的图标、文字等可作为同级项，分别指定定位参照。`region`/`component` 为容器，`part`/`standalone` 为叶子；类别不限制父级容器类型。纯结构容器不声明 `render_kind`，也不声明 Sprite 尺寸计划。额外纯结构层若包裹可用底板与其内容，必须在 `ui_layout.independent_container_reason` 说明其独立职责（如皮肤独立动画、独立稳定交互/布局尺寸、裁切或动态排布）；只写“分组”或“包含”不成立。无底板或组织多个独立功能的真实容器仍按职责声明。几何更大、层级更低或完整包含都不能自动确定父级；全屏背景、阴影和光晕不能作为内容的功能父框。文字保持独立节点并归属对应功能，不按类型集中归组。真实需求和结构变化按既有确认流程更新受影响产物，不虚构用户决定。

V2 严格串行：阶段 A 从冻结事实生成拆解 PNG 与技术 JSON，按确认顺序记录 `decomposition_elements`；用户按图确认后，`visual-decomposition-confirmation/1.0` 将 proposal 冻结为历史输入。若用户要求更改分组或父子关系，修改 proposal、重出拆解图并重新确认，然后从新确认重新生成布局。阶段 B 只消费已确认 proposal 与本次 `automatic-layout-decision/1.0`，生成唯一的 `layout-nodes.json`。不能从未确认草案或原图重新识别元素，也不能用 V4 补丁代替重新确认。

阶段 B 生成独立 `layout-annotation/png/1` PNG：原图作为左侧底图，所有已确认并实际承担容器职责的节点均需框出；若确认结构中确有无直接子项的容器，也需标记 `empty_container=true`。`empty_container` 只表示该节点没有直接子项，纯结构容器有子项时为 `false`，兼任容器的底板 Sprite 有子项时也为 `false`；此字段不会要求创建空节点。底板容器与其 Sprite 视觉是同一元素时只画一个框，不得仅为类型或框选越界项增加容器。额外纯结构层的 `independent_container_reason` 应进入节点数据与审阅详情，便于人工检查职责；机器只校验字段结构与理由非空，不据此断言语义真实。相同层级使用相同确定性颜色，不同层级使用不同确定性颜色。PNG 元数据绑定 `layout_node_id`/`element_id`、`parent_layout_node_id`、有效 `reference_id`、`depth`、`color`、`bounds`、`empty_container`、父框相对位置、独立定位参照边、显式溢出、容器职责说明及布局决策文件和上游拆解确认身份。

图上每个框与右栏说明必须使用同一个唯一短编号，并显式列出实际父编号与有效定位参照编号；编号按确认元素原序分配，只有确认结构中确有合成根时才为其使用独立编号，不能为展示而新增根、重排元素或改变 bounds。技术 ID 仅作为追溯信息，不能代替图上可见编号。密集小框的编号需避让，必要时用引线明确指向所属框。右栏为每个节点提供完整说明：类型、渲染方式/自身图片身份、功能父级、定位参照、水平左/中/右与垂直上/中/下停靠、自身/参照锚点、双轴偏移、明确溢出原因，以及适用时的 `independent_container_reason`；父容器和确有的空容器同样说明其布局参照。根明确“无上级”，不伪造停靠关系。长说明按实际文字宽度换行并扩展画布高度，不得截断；机器校验同时检查编号映射、父子/参照关系、方案内容与可见区域，元数据自报完整不能代替实际可读内容。

布局图也允许按图上反馈人工修改；修改后必须重新生成最终布局图，并以独立 `layout-annotation-confirmation/1.0` 确认。用户直接检查布局 PNG 与 `review.html`，不需要先确认文字对齐方案或阅读技术决策。该确认同时绑定实际布局图文件、尺寸、schema/layout、metadata identity、`visual-decomposition-confirmation` 的 ID、proposal 文件、scene/state/target、用户原文和 receipt。任一图、元数据、布局关系或上游拆解身份变化都使旧确认失效；V2 最终完成门必须同时看到拆解图和布局图的两次人工确认。

布局 PNG 生成时必须在 `--output` 所在的同一候选目录同步产出唯一的 `layout-nodes.json`、`layout-decision.json`、自包含 `review.html` 和 `generation-result.json`。该同批节点文件被场景合同的 `layout_source.nodes_file` 直接引用；`layout_binding`、`layout_annotation`、确认记录只保存文件/业务身份和人工确认依据，且它们的 `layout_nodes_file` 必须与 `layout_source.nodes_file` 一致。PNG、`review.html` 和从节点文件派生的快照只读展示，不可另行编辑事实或回写 Stage A proposal；用户提出布局修订时更新 Stage B decision 并重生成全套输出。审阅页不能建立第二套坐标或关系规则；详情见[离线布局审阅产物](layout-review-artifacts.md)。

阶段 B 先由智能视觉判断读取原图与确认后的 `proposal.decomposition_elements`，按该列表逐项产出唯一的 `automatic-layout-decision/1.0` JSON：每个元素必须显式给出 `horizontal_alignment=left|center|right` 和 `vertical_alignment=top|center|bottom`。选为 center 的轴可声明同级 `center_alignment`；普通 center 轴缺省按 `strict` 解释，组员受 leader 的 `member_ids` 控制时继承组策略。输入 decision 字节保持原样，规范化策略写入生成节点；允许偏移必须显式选择 `reference` 并填写理由。图标与文字需作为整体居中时，在 leader 的 `center_alignment.member_ids` 声明成员，按[居中策略与组合定位](center-alignment.md)派生目标位置。随后使用 `scripts/generate_layout_annotation.mjs` 生成布局 PNG；命令必须显式传入 manifest、project root、scene/state、输出路径、拆解确认 ID 和 `--layout-decision-file`；摘要参数不再必填。生成器拒绝缺失决策、非法枚举、元素漏绑、新增伪造、调序、越界或跨场景输入，不会按测量结果兜底猜测对齐，也不会生成多个布局候选或新的视觉参考图。

同批节点文件的 `doc.viewport` 定义唯一逻辑坐标空间；节点不再重复声明 `coordinate_space`。V2 布局生成与校验依据此源文件中的确认身份、覆盖关联、父/定位参照关系、目标几何，以及 `ui_layout`、`axis_alignment`、适用时的 `center_alignment`、`sprite_geometry` 和派生 `layout_execution`。不要把旧版节点字段清单复制成 V2 必填项：尺寸、溢出、显示层级、响应式与执行策略由确认的布局事实及共享策略派生；`region_id` 与 coverage 中的 `layout_node_ids` 仅用于区域消费映射，不构成第二棵节点树。

节点顺序与已确认 `decomposition_elements` 一致。目标矩形使用 `doc.viewport` 的逻辑坐标，四边均须为有限数值、宽高为正数，并完全落在冻结 viewport 内。相对已确认 proposal 的位置可由明确的中心策略直接平移，也会沿父级或定位参照依赖传播整体位移；传播保持原有相对间距，且不要求每个依赖节点自身有中心策略，详见[居中策略与组合定位](center-alignment.md)。宽高、身份和顺序保持不变。偏移由 Stage B 的明确决策在同一节点源中保存和校验，不得复制到 UI 引用合同。

效果图还原节点需分别校验父边和定位参照边：父节点只能指向已确认节点或稳定根 `viewport`/`safe-area`；有效定位参照来自上游 `ui_layout.position_reference_id`，省略时使用实际父节点。独立定位参照只能是同 scene/state 的兄弟节点（兄弟可以是叶子）、祖先节点或稳定根 `viewport`/`safe-area`；本批所有节点共用 `doc.viewport` 定义的逻辑坐标空间，不用节点级 `coordinate_space` 字段复述。全屏装饰背景不能作为定位参照。所有引用必须存在、不得自指，并且父边与定位参照边合并后不得成环。父框、参照框及目标几何均以同一节点源为准；`viewport` 根使用冻结视口，`safe-area` 根使用当前批次实测的小矩形，不得以首项任意快照替代实际安全区。所有节点均须位于目标 viewport 内；子项超出非根父框时，只有上游 `ui_layout.visual_overflow.reason` 为非空中文说明才允许；不扩大父框，仍须满足 viewport、safe-area、裁切和交互约束。

`relative_position` 始终按子 bounds 相对实际父框测量：`left=child.x-parent.x`、`right=parent.x+parent.width-child.x-child.width`、`top=child.y-parent.y`、`bottom=parent.y+parent.height-child.y-child.height`。所有值必须由 bounds 计算，不能手填近似；仅当 `visual_overflow` 已声明时允许相应边距为负。允许的浮点误差不超过 `1e-6`。位置锚点、`offset` 与对齐方案基于有效 `reference_id` 的目标 bounds 计算：同父参照可直接使用 `parent_target_bounds`，独立参照使用显式 `reference_target_bounds`。

`axis_alignment.horizontal` 由智能视觉判断显式选择 `left/center/right`，`vertical` 显式选择 `top/center/bottom`。两轴组合表示九点停靠语义；它依据预期尺寸变化后的停靠意图选择，例如保持右边距或维持中心，不按当前 bounds 落入图像几何九等分的哪个格子来强推。该停靠关系与纹理 `nine_slice` 切片合同完全独立，九点停靠不触发 Sprite 切片或 `CUSTOM` 尺寸。判断主要依据原图构图、视觉重心、元素语义与 resize 意图，不按最近边或测量阈值自动推断。`relative_position` 只记录相对实际父框的几何事实；中心轴策略、位置平移、`offset` 与图文组合居中的计算统一按[居中策略与组合定位](center-alignment.md)执行。`self_anchor` 与 `reference_anchor` 必须是 `${vertical}-${horizontal}`（例如 `top-center` 或 `center-center`）。这两个布局锚点也不等同于 Creator Node `UITransform.anchorPoint` 的默认中心点。`ui_layout.position_driver`、`ui_layout.size_driver` 与 `widget_stretch_axes` 属于布局身份；驱动器选择、执行计划和 RAW/九宫格尺寸权限按 [Widget 定位策略](widget-layout.md)校验。V4 的组件配置必须从真实 Creator Scene 采集，不能由计划或几何结果自证，完整字段见 [Widget 运行快照](widget-runtime-evidence.md)。视觉决策文件、规范化的 `center_alignment`、父子关系、定位参照、父框相对距离、对齐、偏移、锚点和显式溢出都属于布局身份，任一变化都使旧确认失效。

schema 2.0.0 UI 合同模板只提供场景合同与公共策略的引用示例，不含 `layout_node_example`。节点示例应维护在生成器/审阅输入示例中，并从已确认 proposal 与 Stage B decision 重新生成，不可复制进另一份手写布局树。

布局节点的有效定位参照取自 `ui_layout.position_reference_id`，省略时使用实际父节点；独立参照只能是同 scene/state 的兄弟节点（可为叶子）、祖先节点或稳定根 `viewport`/`safe-area`，不允许引用任意跨分支叶子，且全屏装饰背景除外。全批节点的坐标空间由 `doc.viewport` 唯一定义。实际父关系与定位参照关系须共同无环；父框和参照框依同一节点源的目标几何推导。`viewport`/`safe-area` 是合成几何根，直接参照时只允许 `SHARED`；`viewport` 使用完整逻辑视口，`safe-area` 使用整批一致的实际安全区小矩形。合成根不对应实体 Node，不能作为 Widget target。Widget target 必须是当前实际父/祖先 Node。运行时配置读取见 [Widget 运行快照](widget-runtime-evidence.md)。

## 普通 UI schema 1.2.0 的合同字段

以下声明式区域、`scope`、`fidelity`、不变量与 parity 字段只适用于普通 UI 的 schema 1.2.0 合同；effect-image 的引用式 UI 合同不含这些字段副本。项目共享的视口策略改由独立 project policy 文件维护。

`regions` 是普通 UI 的声明式布局区域，每个区域至少包含：

- `id`、`semantic_role`、`parent_space`、`reference_id`、`positioning`。
- `anchors.horizontal` 与 `anchors.vertical`，各自声明 `self`、`reference` 和 `offset`；两者必须有语义参照边界。
- `size.min`、`size.preferred`、`size.max` 和 `size.strategy`。
- `layout_group`、`z_index`、`layout_participation`、`scroll`、`input`、`clip`。
- `origin`、`layout_anchor`、`animation_offset`，三者不可互相代替。

`regions.origin_applicability` 必须区分 `display-object` 与 `layout-only`：可设置锚点的渲染 Node 默认将合同字段 `origin` 写为 `center`，运行时对应 `UITransform.anchorPoint=(0.5, 0.5)`；非中心值须在该稳定 ID 的区域中填写 `origin_exception.reason` 与 `origin_exception.coordinate_conversion`，并把 top-left/Y-down 布局坐标转换为 Creator 锚点局部坐标。纯布局节点使用 `layout-only` 和 `origin=not-applicable`，只表达布局参照，不把它误认为纹理原点或引擎属性。跨层的背景、世界、特效、HUD 和瞬态层顺序按[显示节点锚点与层级](display-object-layering.md)规划；同父节点的顺序可映射到 sibling order，跨层合成不能由局部 `z_index`/`z_order` 推断。

`regions[].reference_id` 只能指向已声明区域，或保留边界 `viewport`；若使用 `safe-area`，必须先声明同名安全区区域。区域引用形成有向图；不得自引用或形成环。`parent_space` 必须存在于 `coordinate_spaces`，坐标空间 parent 也不得自引用或成环。所有 UI ID 必须唯一，稳定 ID 不使用随机值或运行时显示文本。

## 目标与尺寸

全屏 UI、带底板弹窗和无底板弹窗分别使用场景、底板功能容器和宿主场景逻辑尺寸作为默认定位参照，详见[场景与弹窗尺寸参照](layout-hierarchy.md#场景与弹窗尺寸参照)。场景参照对应 `viewport` 或与其同尺寸且承担真实职责的根；底板参照对应显式功能容器，其 `target_bounds` 与底板布局矩形一致。简单弹窗可由底板图片节点本身兼任功能容器和参照，底板节点保留自己的图片身份；若额外纯结构层包住底板和内容，必须登记 `ui_layout.independent_container_reason`。元素可依职责保留真实父级，同时显式参照另一个同空间节点；`parent_target_bounds` 用于真实父子关系，锚点与偏移使用有效参照的目标 bounds（同父参照可由 `parent_target_bounds` 推导，独立参照使用 `reference_target_bounds`）。不能让有底板弹窗内容默认使用全屏尺寸，也不能让无底板弹窗默认使用内容包围盒尺寸。安全区作为可见性约束保留，独立全屏背景仍不参与前景布局参照。

`targets` 只定义代表性设备视口的最小、首选和最大逻辑宽高、方向和宽高比，不能覆盖固定设计基准；`targets.orientations` 必须与 `orientationPolicy.allowed` 一致，三个示例目标也只能使用支持方向。`scale` 旧嵌套字段不再承担 DPR 或 backing 合同，相关事实统一写在根级响应式字段。`aspect_ratio.min/max` 必须是正数且顺序合理。`content` 定义 `max_width`、`columns`、`gaps` 和 `margins`；断点和布局关系仍必须使用逻辑像素，不能使用参考截图的物理像素直接硬编码。

尺寸策略可以是 `fixed`、`content`、`proportional`、`stretch`、`contain`、`cover` 或 `nine_slice`，但必须同时给出最小、首选和最大值；三档宽高须为正数或非空表达式，数值最小值不能大于最大值。固定尺寸、绝对定位和悬浮元素是可审查模式，不是格式错误；缺少参照、策略或证据才退回。

普通固定视觉图片派生 `sprite_geometry={type:'SIMPLE',size_mode:'RAW',content_size:null}`，其 RAW 尺寸以 V3 已验收正式 SpriteFrame 的完整未裁切原尺寸为准，不取父框、定位参照或生成器原始文件尺寸。即使底板节点兼任功能容器且拥有图标/文字子项，仍按其图片身份保留 RAW 计划；运行时 `UITransform.contentSize` 必须等于帧原尺寸，但不因此限制合规的 Node 变换或反馈缩放动画。普通图片不能使用 `STRETCH`/`FLEX`，父布局、Widget 和 Layout 不得写入其 `UITransform.contentSize`；实际显示 bounds 按几何与动画合同另验。只有冻结九宫格的图片使用 `SLICED + CUSTOM` 和目标显示宽高。纯结构容器、文字与命中区域没有 Sprite 尺寸计划，见[Cocos 适配器](cocos-adapter.md#图片原尺寸与九宫格尺寸)及[Widget 尺寸权限](widget-layout.md#尺寸权限)。

装饰性满幅背景的 `cover` 必须在 `designResolutionPolicy.backgroundFit` 中冻结 `mode=cover-v1`、
`sourceFocalPoint` 和 `targetPoint`，并将同一组事实传给 QA 的 `viewport.backgroundFit`。算法与运行时证据遵循
[`装饰性满幅背景`](../../cocos-game-asset-integration/references/full-bleed-background.md)。
这里的背景 cover 与根级 `scaleMode` 的 Canvas 缩放是两层独立职责。

## 断点与结构

普通静态布局允许 `breakpoints: []`；一旦声明断点，每个断点必须有非空 `when` 触发条件和 `structure_changes`。条件键和值、结构变化项必须是非空字符串或有效数值。条件可以基于宽度、高度、宽高比、方向、安全区或内容容量。必须明确变化的区域/列/导航/操作区，以及仍保持的关系。默认 `usability` 验证基准和代表性断点；只有 `exact` 或项目明确要求时才为每个断点执行临界三点 `breakpoint - 1`、`breakpoint`、`breakpoint + 1`。

## 安全区、滚动与覆盖

`platform_insets` 记录系统栏、圆角、刘海、Home Indicator、键盘、折叠和分屏输入，并覆盖零安全区与非零安全区。固定、悬浮或停靠元素在 `overlay_rules` 中记录遮挡检测、回退和输入优先级；区域的 `layout_participation` 为 `fixed-overlay`、`floating-overlay` 或 `docked-overlay` 时，必须存在相同元素和模式的覆盖规则。弹窗、抽屉和 Toast 的宿主关系、生命周期、遮罩、焦点恢复与上下文效果图不写成另一套布局状态机，而是在场景 `display_layer_planning` 中绑定对应 `layer_id`；V4 必须把这些 overlay 放回宿主场景同屏验证。

无滚动的静态 HUD 允许 `scrolling.axes: []`；一旦声明滚动轴，每个轴必须有唯一且非空的 `axis`、`owner_id`、内容区域、边界和手势优先级，禁止多个所有者争抢同一轴。`narrow_height_degradation` 必须声明 `trigger`、`strategy` 和 `fallback`，说明窄高度时折叠、重排或滚动的条件及关键动作可达性。

## 动态内容与文字

`dynamic_content.localization` 记录默认语言、最长文案、程序化文本开关、必需语言、增长、换行与截断策略。`programmatic_text=true` 时，`required_languages` 必须包含英语 `en`、简体中文 `zh-CN`、日语 `ja`、俄语 `ru`、西班牙语 `es`；`wrap` 必须为每种必需语言独立声明 `single-line` 或 `wrap`，允许部分语言单行、部分语言换行；`truncate_policy=forbid`、`growth=locale-adaptive`，并通过 `display_fit_evidence` 绑定五语种真实字形宽度、字体回退、基线、断行和容器适配证据。`copy_style=concise-gameplay` 要求文案在语义准确、玩家可理解的前提下保持短促、游戏化；倍率使用 `multiplier_format=x{value}`，如三倍奖励直接显示 `x3`，数值变化优先使用 `+10`、图标+数值等熟悉表达，不使用可由符号代替的解释性长句。空间不足时应遵守该语言的行布局策略，改短文案、调整字距/字号、扩展容器或合理换行，不能靠截断通过。`text_scaling` 记录默认和最大字号及 `strategy`。无关键动作的静态 HUD 允许 `key_actions: []`；一旦声明关键动作，其 ID 必须引用区域，状态至少包含 `default`、`disabled`、`submitting` 和 `completed`，并声明 `text_truncation`。关键动作不能使用不可恢复的单行省略。`reflow_events` 至少覆盖 `text-change`、`state-change`、`resize` 和 `safe-area-change`；合同还应覆盖动态数字、成员数量、创建/隐藏/销毁后的重排，以及按下、错误等扩展状态。

`copy_style=concise-gameplay` 按[游戏内文案](game-copy.md)执行：图片、图标、数字、符号和视觉状态优先，可见文字仅补充必要语义，不把可直接表达的奖励、消耗或进度写成解释句。精确数值通过对应图标、正负号和上下文表达，不以「需要精确」为由追加重复说明。图标歧义、首次必要引导或操作后果仍需最少说明；仅图标控件保留无障碍名称，可不进入可见布局。证据覆盖重复说明、数值归属、必要信息完整性、通用图标堆叠和功能自解释性。

效果图还原的可见文字由场景合同中的 `text_decomposition` 独立管理：有文本时使用 `applicability=has-text` 并逐项登记稳定 `text_node_id`、`region_id`、`layout_node_id`、文案来源、语义角色、动态/本地化标记、目标 bounds 和完整 typography facts；确实没有文本时使用 `not-applicable` 并填写 reason。V3 必须为每个文本节点选择 `cocos-text`、`bitmap-text`、`image-text` 或 `hybrid`，说明路线理由、所有权和实际资源依赖。动态或本地化文字不能烘焙为 `image-text`；图片字标仍要保留可访问语义。原字体未知时保留 `observable_facts`，不能猜填 family，并明确替代字体或位图方案。V4 逐节点记录实际 renderer、字体加载与 fallback、actual/glyph bounds、baseline、测试 ID 和证据，并把 target/candidate 差异绑定预声明 tolerance 或精确例外。

### 文字路线判定

先按[完整拆解与视觉显著性](../../cocos-game-asset-integration/references/asset-production-routes.md#完整拆解与视觉显著性)判断文字承担的视觉作用、内容变化与复用需求，而不是把所有文字统一指定为系统文本或位图。明显美术标题优先使用独立字图；带统一字形风格的提示根据文案是否固定选择字图或位图字体；视觉特征不明显的操作标签优先考虑 `cocos-text`。字体替代及低显著性差异只在适用的 `usability` 拆解方案中明确说明，原字体未知仍保留观察事实，不能把所选替代字体冒充原字体。

选择 `cocos-text` 后，当前字体和文字 renderer 必须实现方案要求保留的字形、排版、填色/渐变、描边、阴影、发光及其它效果，并说明可核验实现依据；能够显示相同文案不足以证明美术文字还原。不能把非文本区域的“简单规则渐变可实现”直接套到文字，也不能在实现时静默删去已确认效果、猜用默认字体或提高容差使该路线通过。`exact` 或明确指定字体/效果时遵守精确要求。视觉来源与拆解标签遵循[程序还原资格与位图回退](../../cocos-game-asset-integration/references/asset-production-routes.md#程序还原资格与位图回退)。

- 固定美术文字优先以完整原子字标选择 `image-text` 或独立位图资源，保留整体字形、构图和跨字效果，不机械逐字拆分；即使程序能绘制其中部分效果，也不因此自动改用普通文本。效果可可靠分离且实际需要独立变化时，可用 `hybrid`，分别登记程序文字与位图效果，并保留可访问语义。
- 动态数值或本地化文字禁止烘焙为固定 `image-text`。可使用满足字形覆盖、字距、换行及效果要求的 `bitmap-text`，或确实能完整还原的混合方案；位图字形/效果依赖按图片合同登记，程序负责更新与排版，不把图片外观声明为纯程序绘制。
- 位图字体或混合方案也不能完整表达要求时，报告当前能力缺口并修订方案；不能仅因文案需要动态变化就改用缺少渐变或其它效果的普通文本。

例如战斗失败弹窗：顶部「战斗失败」的金属立体字、破损裂纹、厚描边与跨字火光共同构成情绪字标，整段拆为一个独立位图，与边框、徽章分开；下方失败提示的倾斜字形、粗字重、描边/阴影形成统一提示风格，固定文案可整段用图片，需更换文案或复用风格时用覆盖所需字符的位图字体；按钮「返回」主要表达操作，字形没有同等显著的定制材质，可用系统文本，并把蓝色发光按钮底板作为独立图片部件。三类文字分别登记节点、语义与资源依赖，按钮文字和底板仍由同一功能组件统一处理交互与状态，不能把按钮或整屏烘焙为不可交互的图片。

文本字号必须区分参考图物理像素与 Cocos 逻辑坐标：同时冻结 `reference_pixel_bounds`、逻辑 `target_bounds`、`font_size_unit=logical-px`、参考 DPR、glyph bounds 和 baseline。参考图中量到的 48px 不是可以直接写入 Cocos 的 `fontSize: 48px`；最终字号需结合逻辑 viewport、DPR、字体 ascent/descent、字距和实际 glyph bounds 验证。文字框尺寸通过布局节点统一计算，字形测量只作为运行时证据，不能用整体区域 bounds 掩盖字体 fallback、基线或断行偏差。

## 不变量与证据

普通 UI schema 1.2.0 的 `invariants` 的每一项都包含稳定 ID、非空描述/表达式、非空且全部有效的适用区域、非负容差和 `evidence.automation`/`evidence.visual` 字符串项。关系表达优先描述相对中心、边界距离、间距、遮挡和断点结构，而非一个孤立屏幕坐标。`evidence_matrix` 必须绑定同一候选、合同版本、动态封顶 2 的 DPR 策略和已执行的视口条件；默认 `usability` 覆盖基准及代表性窄/宽、项目支持方向和关键状态，验证关系不变量与可用性。只有 `exact` 或项目明确要求时才覆盖断点邻值、宽高、字号、本地化、安全区、动作态、DPR、动态值、Scene 生命周期和覆盖层/键盘/滚动的完整组合；`orientation` 轴只在项目同时支持两种方向时强制，并只覆盖 `orientationPolicy.allowed` 声明的方向。精确矩阵启用 Golden 精确视觉。

effect-image 的关键对齐意图直接取自唯一布局源的 `axis_alignment`、`center_alignment` 与 `ui_layout`，不另填 `critical_alignments`。V4 在 scene contract 的 `combination_preacceptance.layout_geometry` 保存实际 `node_measurements` 与 `component_snapshots`；严格居中以实际参照和组合边界核验，尺寸与 RAW 内容尺寸分别验收。已声明的容差使用场景合同的 `predeclared_tolerances`，不靠手写 delta 或 passed 放行。正式场景的边距、素材可见边界口径见[布局校准](layout-calibration.md)。

完整视觉比较案例统一记录在视觉清单的 `fidelity_cases`，绑定 scene/state、执行视口、有效 DPR、语言、输入轨迹、稳定帧、场景布局与视觉基线版本及真实证据；不再复制为 UI 合同的 `parity_cases`。默认 `usability` 使用代表性案例，`exact` 或明确全覆盖需求才扩展到完整矩阵。

引用式 UI 合同默认按 `--stage V2` 检查公共策略、场景合同及唯一布局源；正式 UI 子门使用 `--stage V4 --check-files --project-root .`，读取真实确认工件及场景组合、节点测量证据。该子门不替代外层视觉清单的完整 V4 资源、候选、运行与保真验收。
## effect-image 场景引用

effect-image 的 UI 合同只引用 `scene_reconstruction_contract` 与 project policy。场景合同中的 `layout_decomposition.layout_source.nodes_file` 指向唯一 V2 节点文件；`layout_binding`、`layout_annotation` 与 `layout_annotation_confirmation` 只保留 identity/evidence，并须引用同一路径。正式还原、审阅、V4 实现和验证均直接消费该节点文件中的已确认父子、定位参照、布局策略、RAW/九宫格尺寸计划、中心策略与派生执行计划。V2 变更后按受影响的原确认流程重新生成与确认，不从 UI 合同、PNG 或运行快照反向生成第二份树。

目标 viewport 在 `usability` 下用于确认整体关系、可读性和可操作性，其他代表性 viewport 验证关系不变量；只有 `exact` 或明确精确需求时才要求目标 viewport 的严格还原。正式 Scene 仍需结构化实现；整屏截图、隐藏覆盖层或绝对叠图不能代替布局实现。
