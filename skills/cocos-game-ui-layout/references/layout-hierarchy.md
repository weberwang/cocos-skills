# Cocos UI 节点组织

本参考把屏幕 UI 的节点职责、父子关系和阶段检查接入 Cocos 布局流程。它补充[功能语义分组约束](functional-semantic-grouping.md)：语义分组说明元素共同表达什么，父子关系说明真实功能或布局归属，`ui_layout.position_reference_id` 说明位置计算参照；布局、溢出、安全区和输入职责另行记录。定位依赖不自动成为直接父子关系，三类事实必须分别检查。底板 Sprite 可以同时承担渲染和容器职责；简单组件优先用底板节点作为根，不为满足节点分类再造空根。

## 节点树与父容器职责

每个父容器都必须至少承担一种可说明的职责：

| 职责 | 适用情况 | Cocos 中的组织方式 |
| --- | --- | --- |
| `POSITION` | 节点有明确的位置参照关系，或父级实际负责子项定位 | 父级实际管理布局时用父 Node 和 `UITransform`；若定位参照独立于功能父级，则在 `position_reference_id` 记录它，不把依赖方强行改成参照方的子项。 |
| `LAYOUT` | 父级决定子项尺寸、顺序、间距或重排 | 由一个布局所有者计算子节点，避免布局计算与手写位置互相覆盖。 |
| `INTERACTION` | 父级是一个完整命中目标并处理子项输入 | 将输入绑定到组件根；纯视觉子节点不重复接收同一次操作。 |
| `STATE` | 子项共享显隐、动画状态或生命周期 | 将共同状态的拥有者与受控子项放在同一组件根下。 |
| `CLIP` | 父级定义需要裁切的边界 | 只将需裁切的内容放入裁切区；须保持完整的文字、预览和提示作为同级内容。 |
| `REUSE` | 子树作为整体重复实例化或复用 | 将稳定的可复用 UI 单元封装为组件；仅仅使用相同资源不构成复用关系。 |

同一功能组件中的图标、文字等可以作为同级节点；位置依赖通过定位参照表达，不要求互相成为父子。父级必须来自人工确认的功能、共同状态/交互/生命周期或真实布局管理职责，不能仅凭位置依赖、几何包含、视觉距离、显示层次或元素类型决定。一个节点可以有多个真实职责；不能用笼统的“分组”代替职责说明。对于简单展示组件，使用 `element_type: container`、`render_kind: sprite` 和 `semantic_grouping.kind: component` 表达底板 Sprite 兼任功能根；该节点仍保留自己的 `component_id`、`placement_id` 和图片身份。普通纯结构容器不声明 `render_kind`，也不伪造 Sprite 尺寸计划。

空布局 Node 只有在占位用途明确时才能保留，例如确认过的动态列表槽位、后续状态内容的装配边界或具有布局/裁切职责的空内容框。标注其用途、预期内容或空置条件及负责人；单纯留白、图层整理或猜测未来需求都不足以建立容器。若额外纯结构层包裹可用底板及其内容，还必须填写 `ui_layout.independent_container_reason`，说明皮肤独立动画、与皮肤不同的稳定交互/布局尺寸、独立裁切或动态内容排布等真实职责；“分组”“包含”不能作为理由。布局标注中的 `empty_container` 必须与拆解确认中的空节点状态一致。无底板或组织多个独立功能的实际容器仍按其真实职责保留。

## 场景与弹窗尺寸参照

在确定内部功能分组前，先明确页面或弹窗的布局边界；以下规则同时适用于 V2 拆解与布局、V4 正式实现：

| UI 类型 | 布局父级与尺寸参照 | 节点表达 |
| --- | --- | --- |
| 全屏 UI | 场景；按场景的当前逻辑宽高相对布局 | 根参照使用 `viewport`；存在负责布局的页面根容器时，其 bounds 与场景逻辑视口一致。 |
| 有底板的弹窗 | 底板对应的功能容器；按底板的逻辑宽高相对布局 | 优先让底板图片节点本身兼任 `PopupPanel` 等 `component` 容器，bounds 与底板布局矩形一致，内容直接成为它的子项；只有容器另有独立职责时才增加纯结构根。底板节点本身相对场景定位。 |
| 无底板的弹窗 | 宿主场景；按场景的当前逻辑宽高相对布局 | 使用 `viewport`，或与场景逻辑视口一致且承担真实布局/状态职责的弹窗根容器；不能用内容包围盒代替场景尺寸。 |

这里的场景尺寸是已转换到 UI 布局坐标空间的实际可见逻辑视口，不是 Canvas backing 像素，也不能直接沿用固定设计基准的另一轴尺寸。底板尺寸使用其逻辑布局矩形，不使用纹理像素尺寸、透明留白或全屏遮罩尺寸。弹窗底板表示功能面板，不标记为全屏 `background`，也不应用满屏 cover。

相对位置锚点与偏移以有效定位参照的宽高计算。`parent_element_id`/`parent_layout_node_id` 记录实际功能或布局父级；可选的 `ui_layout.position_reference_id` 记录位置参照，省略时默认为父级。它可指向同 scene/state、同坐标空间的兄弟节点（可为叶子）、祖先节点或稳定根 `viewport`/`safe-area`，不允许引用任意跨分支叶子节点，也不能指向全屏装饰背景。布局快照的 `reference_id` 保存有效定位参照，`parent_target_bounds` 记录真实父框，生成快照总包含 `reference_target_bounds`。底层合同在同父参照时可省略冗余的 `reference_target_bounds` 并从父框推导；独立参照时必须显式声明且与参照目标 bounds 一致。禁止缺失、自指和把父边、参照边合并后成环。已声明独立参照时，`grouping_basis` 包含 `POSITION`。内部已有功能组件仍按职责保留父级，不将所有后代平铺到场景或底板下。底板节点自身声明其实际承担的 `POSITION`、`LAYOUT`、`INTERACTION` 或 `STATE` 职责；它可以同时是 Sprite 和组件根，不必另设纯容器。

虽然 `viewport`/`safe-area` 可作为布局几何的稳定根参照，当前合同没有定义它们到实际场景 Node 的映射，故始终由 `SHARED` 处理；直接引用它们却显式选择 `WIDGET` 时应在校验阶段阻断。合成 `root_nodes` 仍是布局数据，不能作为 Widget target。只有已经存在于实际节点树中的父级/祖先 Node（例如真实 Canvas 节点）才可由 Widget 定位。不要为映射逻辑根或满足 Widget 限制创建 Canvas 包装/空容器。

`axis_alignment.horizontal=left|center|right` 与 `vertical=top|center|bottom` 组成九点停靠语义，并通过 `self_anchor`、`reference_anchor` 和 `offset` 确定对齐关系。它表示相对参照的停靠意图，不是图片纹理的九宫格拉伸，也不按当前画面几何九等分格自动决定。调整视口或父级尺寸时，按预期关系（例如按钮保持右边距、标题保持居中）选择停靠；严格居中、明确偏移和图文整体居中按[居中策略与组合定位](center-alignment.md)表达，`UITransform.anchorPoint` 的中心默认值另行映射，不与九点停靠混为一谈。

关闭按钮等部件突出底板时，可在真实父子归属不变的前提下用独立定位参照定位，并为子项声明 `ui_layout.visual_overflow: {reason: "..."}`。它允许子项超出非根父框，但不扩大父框；只有确有布局、状态、交互、生命周期或裁切职责时才增加容器。viewport、safe-area 和目标画布边界、安全区、裁切与交互检查仍须满足。

安全区通过 `safe_area_policy` 等合同约束关键内容，不能把有底板弹窗的内容改为相对全屏安全区定位。场景尺寸或底板尺寸变化时，由同一幂等重排入口重新计算相对布局。底板有无、参照容器或其职责改变时，须更新 V2 拆解与布局确认；V4 不得在实现中静默改写冻结父级。

## 推荐根节点

以下结构是屏幕 UI 的常用 Cocos 组织起点，实际 scene 可按职责裁剪；不得为了匹配示意图而增加无职责层：

```text
UIRoot
├── BackgroundRoot       # 可全屏延伸，装饰边缘可裁切
├── SafeAreaRoot         # 关键操作和信息的安全区参照
│   ├── HUDRoot          # 场景常驻信息和操作
│   └── PageRoot         # 当前页面内容；空间不足时重排或滚动
└── DisplayLayerRoot     # 宿主规划槽位，不代表把瞬态 UI 并入 HUD
```

`BackgroundRoot` 可超出安全区以覆盖可见 viewport；按钮、关键文字和玩法信息应遵循运行时 `safe_area_policy`。常驻 HUD 与当前页面分别归属明确根节点。`DisplayLayerRoot` 表示宿主场景预留的显示层位置；modal、popup、drawer、toast 等瞬态层仍按现有独立 `DISPLAY_LAYER` Work Item 规则建立，并记录宿主、生命周期、输入阻断和关闭后的恢复。Creator 的设计分辨率、Camera、Canvas、UITransform 和输入坐标细节按[适配器参考](cocos-adapter.md)确定。

上述节点树表达 UI 父子职责，不代替整个场景的绘制前后顺序。背景、世界主体/特效、常驻 HUD 与瞬态层分别建立有名根层，按[显示层分层合同](display-object-layering.md#显示层分层合同)声明合成顺序；各层内部才使用局部 `z_index`/`z_order`。布局停靠在左上角也不改变显示对象默认中心锚点。

## V2 组织事实

V2 继续严格按现有串行确认顺序执行：先生成人工可修改的拆解图与技术 JSON，人工确认最终 `decomposition_elements`；再由已确认元素生成显式布局决策与布局产物，人工独立确认布局图。未确认的拆解不得进入布局生成，父级不得由几何关系反推。只有拆解确认中确有无直接子项的容器节点，才在布局标注中记录为 `empty_container=true`；该标记只表示没有直接子项，不表示节点是纯结构容器，也不要求新增空节点。

每个屏幕 UI 节点在确认的 `decomposition_elements` 中使用 snake_case 的 `ui_layout` 字段，至少记录：

| 字段 | 记录内容 |
| --- | --- |
| `grouping_basis` | 父级/布局归属职责数组，只使用 `POSITION`、`LAYOUT`、`INTERACTION`、`STATE`、`CLIP`、`REUSE`。只有直接挂在 `viewport`/`safe-area` 且无额外职责时才用 `[]`；其他关系说明真实职责。显式 `position_reference_id` 与实际父级不同时必须包含 `POSITION`。 |
| `layout_owner` | V2 布局责任归属：`PARENT`、`SELF` 或 `EXTERNAL`；它不是运行时组件或属性写入者，位置与尺寸驱动器分别由 `layout_execution` 记录。 |
| `position_reference_id` | 可选的位置参照 ID；省略时为 `parent_element_id`。显式值可为同 scene/state、同坐标空间的兄弟节点（可为叶子）、祖先节点或稳定根 `viewport`/`safe-area`；不允许任意跨分支叶子；父边与参照边合并后必须无环。 |
| `position_driver` | 可选的唯一运行时位置驱动器：`WIDGET`、`SHARED`、`LAYOUT`、`STATIC`、`ANIMATION`。省略时按参照可达性、职责、组合中心和布局策略自动选择；target、所有权约束与转换计划见 [Widget 定位策略](widget-layout.md)。 |
| `widget_stretch_axes` | 可选的 Widget 双边拉伸轴，非空且无重复，只能含 `horizontal`/`vertical`，且仅允许在 `position_driver: WIDGET`。RAW Sprite/底板禁止；九宫格 Sprite 和 `element_type: container` 的非 Sprite 容器尺寸授权见 [Widget 定位策略](widget-layout.md#尺寸权限)。 |
| `size_policy` | 尺寸意图：`FIXED`、`STRETCH`、`CONTENT` 或 `FLEX`；布局节点原有尺寸字段仍须填写并与它一致。普通固定视觉图片必须使用 RAW 原尺寸，不能使用 `STRETCH`/`FLEX`。 |
| `overflow_policy` | 空间不足时处理：`KEEP_VISIBLE`、`CLIP_DECORATION`、`REFLOW` 或 `SCROLL`。 |
| `visual_overflow` | 可选对象 `{reason: 非空中文说明}`，声明子项可超出非根实际父框；不改变父框尺寸。viewport/safe-area/目标画布边界、安全区、裁切和交互要求仍须满足。 |
| `safe_area_policy` | `FULL_BLEED` 或 `INSIDE_SAFE_AREA`。 |
| `interaction_policy` | `HIT_TARGET`、`DELEGATE_TO_PARENT` 或 `NONE`。 |
| `minimum_size` | 可选的最小可读/可点击尺寸，宽高须为正数逻辑像素；声明后任何视口下都不得低于该值。 |
| `independent_container_reason` | 可选的中文职责说明；额外纯结构容器包裹可用底板和内容时必填，须说明独立动画、稳定交互/布局尺寸、独立裁切、动态排布等职责，不能只写“分组”或“包含”。 |

`semantic_grouping.kind/rationale` 只描述元素自身类别与归属理由：`region`/`component` 是容器，`part`/`standalone` 是叶子；kind 不限制可挂载的真实容器类型，也不产生包装容器要求。`element_type: container` 与 `render_kind: sprite` 可同时出现在底板元素上；该节点按自己图片身份声明 `sprite_geometry`，其子项不取消 RAW 计划。纯结构容器不声明 `render_kind` 或 `sprite_geometry`。`ui_layout.grouping_basis` 描述实际布局/功能职责；独立文字、图标和同一组件内其他互不依赖的内容继续列为同级，不按“同为文字”等类型合并。`position_reference_id` 与实际父级不同的独立定位关系必须记录 `POSITION`。显式越界使用 `visual_overflow` 并由机器独立校验父框、viewport、安全区和裁切边界。父子节点的几何字段、裁切字段和现有 `layout_nodes.size_policy` 等机器合同字段也必须按现有合同填写；`ui_layout` 不能替代它们。

`DELEGATE_TO_PARENT` 必须沿父链找到唯一的 `HIT_TARGET`，命中目标不得嵌套另一命中目标。`SCROLL` 只能由承担 `LAYOUT` 职责的容器管理。`minimum_size` 在 V2 校验声明值，在 V4 以真实视口测量确认可读和可点击尺寸。

示例字段与当前 `ui_layout` 合同使用 snake_case，枚举值使用大写。字段兼容与驱动选择的完整策略见 [Widget 定位策略](widget-layout.md)：

```yaml
semantic_grouping:
  kind: part
  rationale: "该图标是购买按钮的视觉内容，与文字共同表达购买操作"
ui_layout:
  grouping_basis: [INTERACTION, POSITION]
  layout_owner: PARENT
  size_policy: FIXED
  overflow_policy: KEEP_VISIBLE
  safe_area_policy: INSIDE_SAFE_AREA
  interaction_policy: DELEGATE_TO_PARENT
  minimum_size: {width: 48, height: 48}
```

这些字段作为 V2 人工确认事实，必须在拆解、生成布局节点及离线审阅资料中保持一致。布局节点原有几何、裁切和响应式字段仍按机器合同独立填写，`ui_layout` 不能替代它们。`position_driver` 和 `widget_stretch_axes` 同样属于布局身份；生成的 `layout_execution` 从这些事实派生，不能人工另写一组相互竞争的 Widget 属性。该计划将 `position_driver` 与 `size_driver` 分开记录；不同驱动器可以分别写位置和尺寸，但每个实际属性在同一时段只能有一个写入者。Widget 负责定位、共享布局负责尺寸时，须先计算尺寸，再调用 `updateAlignment()`。

## Cocos 组件例子

### 按钮

```text
PurchaseButton [底板 Sprite 同节点兼任 component 根；INTERACTION/STATE]
├── Icon
├── Label                   # 可相对底板或 Icon 停靠
└── DisabledOverlay         # 随按钮状态显隐，不接收输入
```

`PurchaseButton` 同时保存自身图片资产身份并管理命中、状态与生命周期；普通底板保持 RAW，只有冻结九宫格底板使用 SLICED + CUSTOM。`Icon` 和 `Label` 同属购买信息并保持同级；`VisualRoot` 或额外空根只在承担独立动画/布局等职责并写明 `independent_container_reason` 时存在。子视觉节点标记 `DELEGATE_TO_PARENT` 或 `NONE`，避免多个重叠目标竞争点击。

### 背包格

```text
InventoryGrid              # LAYOUT：列数、间距、滚动内容
└── InventorySlot           # INTERACTION、REUSE：固定点击单位
    ├── ItemIcon
    ├── CountBadge           # POSITION：依赖格子角落定位
    │   └── CountText
    └── SelectionOutline    # STATE：随选中状态显隐
```

网格控制格子的尺寸与顺序，格子是单一命中目标和复用单元。角标依赖格子定位，数量文字属于角标；图标和选中框保持格子下的同级节点。内容超出可见高度时由网格/滚动视口处理，不把单格标成可溢出。

### 血条

```text
HealthBar
├── Track
│   └── FillClip             # CLIP：只裁切填充表现
│       └── Fill
├── DamagePreview            # 与 FillClip 同级，完整显示
└── ValueText                # 与填充宽度解耦
```

`FillClip` 的边界由血条内轨道确定，只有 `Fill` 需要裁切。受伤预览和数值文字保持在裁切区外，防止血量变化时被一并裁掉或挤压。需要展示的父子关系必须由拆解确认，不可仅以视觉覆盖或矩形相交决定。

## V1、V2、V3、V4 阶段接入

| 阶段 | 节点组织工作 | 确认与证据边界 |
| --- | --- | --- |
| V1 | 定义 `UIRoot`、背景/安全区/HUD/页面/显示层职责，声明坐标空间、安全区、视口和响应式计划。 | 记录节点树提案与溢出/输入基本策略；竖屏以 1080×1920 为设计基准按宽度适配，横屏以 1920×1080 为设计基准按高度适配，另一轴随视口变化。 |
| V2 | 先确认语义分组、直接父级和职责，再完成布局决策、节点几何和独立布局图确认。 | 拆解确认与布局确认仍是两个串行人工门；节点职责或父级变更需更新上游确认和受影响下游身份。 |
| V3 | 生产并验收节点所需正式资源。 | 绑定资源身份、来源和状态。 |
| V4 | 直接消费 V2 节点树与 V3 正式资源，在正式 Scene 中实现和校准 UI。 | 在代表性逻辑视口、安全区、resize 和状态下记录真实可见性、滚动/重排、裁切和命中结果；静态布局图不能代替运行证据。 |

V2 中只改变停靠或偏移、未改变父级与职责时，沿现有布局确认规则重新生成并确认布局产物；改变节点、父子归属、语义分组或容器职责时，必须回到拆解确认。V3/V4 的失败按[布局阶段门](workflow-gates.md)处理，不新建第二套状态机。

## Cocos 适配边界

父级职责、同级分组、空槽标注、安全区和组合验收均按 Cocos Creator 的 `Node`、`Component`、`Prefab` 和 `UITransform` 语义实现。布局合同使用左上原点/Y 向下的工作流坐标；适配器把它转换为 Creator 的锚点局部坐标。固定设计基准按 Creator `FIXED_WIDTH`、`FIXED_HEIGHT` 或项目验证过的 `custom` 设计分辨率策略实现，不套用其他引擎的缩放组件。


## 背景与布局参照分离

全屏装饰背景是视口中的独立显示层，只负责自身的铺底、缩放与覆盖。背景图片不得成为其他元素的功能父容器、锚点或相对测量参照；前景节点显式使用 `viewport`、`safe-area` 或有功能职责的容器。背景节点独立归属 `viewport`，不放入可移动的功能容器；绘制顺序使用层级与 z-order 表达，不用背景父子关系表达。阴影、光晕等纯装饰也不能仅因更大或层级更低而充当内容父框。有底板的弹窗按上述尺寸参照规则建立底板功能容器，底板 Sprite 可直接兼任该容器，不必另加空根。

V2 拆解与布局确认时校验这项规则，V4 正式场景实现时再次复核资源与节点的绑定。已有冻结节点错误绑定背景时，回到 V2 修正并重新确认节点来源，不在正式实现中偷偷改写冻结显示树。
