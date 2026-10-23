# 正式场景视觉还原与校准

V4 在正式 Cocos Scene 中完成视觉还原、布局校准和运行验收，直接组合 V2 冻结的拆解结构与目标布局、V3 验收通过的正式资源。布局、资源和画面差异在正式运行场景中定位并修复，再对受影响范围复验。

效果图还原沿用 V1 冻结的 `scene_reconstruction_contract`、目标视口、视觉事实、响应式关系和项目容差。V2 负责确定显示节点、父子关系、目标 bounds、锚点、停靠/对齐和显示层合同；V3 负责交付与这些节点对应的正式资源和生产记录；V4 将这些输入装配成可交互、可响应状态变化的正式场景。

全屏 UI 按场景逻辑尺寸布局，有底板弹窗按底板功能容器尺寸布局，无底板弹窗按宿主场景尺寸布局。底板与其内容归属同一功能容器，底板不登记为全屏背景。背景独立覆盖实际可见视口，不应用前景布局偏移。参照选错或父子关系、职责、锚点和目标结构有误时，修正 V2；在既定合同内调整实际坐标和尺寸时，更新 V4 正式布局配置并复验受影响状态。

## 正式场景实现

1. 将 V2 的节点与布局关系映射到正式 Cocos Scene 的 Node、Component、Prefab、显示层和布局配置。Creator 编辑器操作经[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)执行；不手写 `.scene`、`.prefab` 或 `.meta` 绑定。保留结构化场景，不用整屏截图、隐藏覆盖层或绝对叠层伪造目标画面。
2. 每个视觉 placement 使用 V3 中当前场景或合规 shared 且 `accepted` 的资源。检查资源尺寸、透明边缘、裁切、缩放、锚点和九宫格参数；资源自身外观偏离冻结目标时回到 V3 修复对应资源。
3. 将视觉节点连接到正式功能、真实数据和 required state。静态素材与动态数值共用 V2 的可见表达和 V3 资源绑定；不得把示例文案、规则说明或临时占位内容作为正式显示内容。
4. 在真实 Cocos viewport 中实现安全区、缩放、方向和 resize 行为。布局重算应由明确的布局入口完成；Scene 创建、唤醒、resize 等生命周期不得累积重复偏移或重复注册监听器。
5. 实际场景中的偏差按成因处理：资产轮廓、姿态、语义、材质或色彩偏差回 V3；节点身份、父级、层序、目标关系或冻结结构错误回 V2；当前实现的坐标、尺寸、状态绑定或响应式行为问题留在 V4 修复。

布局几何遵守[UI 布局合同](../../cocos-game-ui-layout/references/layout-contract.md)、[Cocos 坐标与布局适配](../../cocos-game-ui-layout/references/cocos-adapter.md)、[Widget 定位策略](../../cocos-game-ui-layout/references/widget-layout.md)与[显示节点锚点及层级](../../cocos-game-ui-layout/references/display-object-layering.md)。V2 `anchor` 表达布局关系；资源透明留白与 Node 的 `UITransform.anchorPoint` 是不同事实，不能互相替代。左上原点布局坐标必须经坐标适配器转换为锚点局部 Y 向上坐标；子节点位置按其目标位置相对直接父节点计算，祖先偏移只累计一次。

V4 消费 V2 派生的 `layout_execution`，逐节点落实位置与尺寸驱动器。两者可以不同：Widget 只定位时，共享布局或当前节点 Creator 原生 `Layout.CONTAINER` 可先计算尺寸，再调用 `updateAlignment()`；自定义项目布局器由 `SHARED` 驱动且可保留 `layout_owner: PARENT`。禁止的是多个机制并行写同一属性。Widget target 必须对应已确认的真实父/祖先节点；合成逻辑 `viewport`/`safe-area` 及兄弟参照、图文整体居中由共享布局求解，合成 `root_nodes` 不是实体节点。`viewport` 使用完整逻辑视口，`safe-area` 使用本批实际安全区小矩形，生成、居中、审阅和正式实现须消费相同快照。父级原生 Layout 排布子节点时，子位置归该 Layout，不再由 Widget 写入。Scene 创建/恢复、资源绑定后、父尺寸、动态文本/状态、方向/DPR、安全区/键盘和 resize 共用幂等布局入口，入口更新 Widget 约束并调用 `updateAlignment()`；不要再用脚本 `setPosition`、Layout 或 `ALWAYS` Widget 同时控制同一位置。V2 默认按 `scale=1`、`rotation=0`、`skew=0` 规划 Widget 路径，选择器不读取尚未采集的运行矩阵；已知非单位路径时显式使用 `SHARED`，V4 实测不符则拒绝并回上游调整。普通图片和底板的 `UITransform.contentSize` 等于正式 SpriteFrame RAW 原尺寸；RAW 保护不禁止节点缩放/动画或 SHARED 坐标变换，非单位变换由 SHARED 换算位置并另验视觉 bounds。拉伸必须符合冻结九宫格或 `element_type: container` 的非 Sprite 容器授权。V4 在 `combination_preacceptance.layout_geometry.component_snapshots` 从 Creator 实际读取所有业务节点的父级、驱动器、Widget/Layout、UITransform、Sprite 和坐标变换；矩阵先换算到冻结布局逻辑坐标空间，不直接使用带屏幕适配缩放/DPR 的 worldMatrix。`layout_bounds`/`reference_bounds` 是实际矩形，独立核验严格中心、中心参照和组合 union；Widget flag 正确本身不能证明居中，快照覆盖全部节点也不要求每个矩形都等于目标 bounds。该组件快照与几何测量矩阵独立，`usability` 也覆盖全部业务节点。字段合同见[Widget 运行快照](../../cocos-game-ui-layout/references/widget-runtime-evidence.md)。

## 运行校准与验收

在正式 Scene 中提供代表性 viewport、required state 和必要交互轨迹，核对构图、资源对应、层级遮挡、边界、可读性、输入命中、弹窗开关后的宿主恢复及 resize 稳定性。参考与候选应尽量保持相同的视口、运行时有效 DPR、语言、状态、随机种子和时间点，并记录实际使用条件。

默认 `visual_validation.mode=usability` 关注关键关系和可用性，允许合理的位置、尺寸、边距与换行差异；越界、裁切、关键遮挡、不可读、明显构图偏离或交互失效仍须修复。只有用户或项目合同明确要求精确还原时才采用 `exact`，并提供合同要求的逐区域测量、容差和差异材料。

实际画面由用户人工检查。机器检查可以确认结构、资源、测量值和证据归属，不能代替用户判断画面质量、观看舒适、主题适配或持续游玩效果；不得自动分析验收截图或据此写入通过。后续修改后按实际受影响范围重新运行并复验，未受影响且仍绑定当前事实的证据继续有效。

V4 完成条件包括正式功能与资源接入、布局和响应式行为、低保真清理，以及适用的功能、视觉、性能和运行证据。正式 Scene 的实际消费、正式运行组合检查、F2 确定性检查、F3 runtime replay 和 fidelity case 按[视觉生产管线](visual-production-pipeline.md)及控制面 Schema 记录；V2 拆解和布局确认、V3 正式资源验收仍是上游硬门。
