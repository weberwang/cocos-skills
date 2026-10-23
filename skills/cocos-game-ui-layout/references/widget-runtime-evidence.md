# Widget 与布局组件运行快照

本合同规定 V4 如何证明 Creator 中实际安装的 Widget、Layout、Sprite 和 UITransform 与 V2 布局计划一致。它补充[Widget 定位策略](widget-layout.md)，不以静态计划、组件截图或自报 `passed` 代替运行时读取。

## 稳定根与安全区几何

`viewport` 和 `safe-area` 是合成布局根，不是实际 Node，也不能成为 Widget target。跳过节点执行计划的合成根只能满足 `layout_node_id` 为 `viewport` 或 `safe-area`、`is_root_container: true` 且显式 `parent_layout_node_id: null`；业务节点不得标记 `is_root_container: true`，也不得占用这两个保留 ID（快照可以明确记录 `false`）。`root_nodes` 中的记录只表达根几何，不证明存在同名 Creator 节点。

`viewport` 始终使用当前批次的完整逻辑视口矩形。`safe-area` 使用同一运行批次实际读取的安全区矩形，必须完全落在 viewport 内。凡是父级或位置参照为 `safe-area` 的节点，其全部 `parent_target_bounds`、`reference_target_bounds` 和合成根 `target_bounds` 必须逐字段相同；生成、中心计算、审阅和 V4 校验都消费这份矩形。不得因某个节点没有重复快照而将安全区扩大为全屏。直接相对这两个合成根布局时使用 `SHARED`；已存在的 Canvas 等真实父/祖先 Node 才可作为 Widget target。

```json
{
  "root_nodes": [
    {
      "layout_node_id": "viewport",
      "is_root_container": true,
      "parent_layout_node_id": null,
      "target_bounds": { "x": 0, "y": 0, "width": 390, "height": 844 }
    },
    {
      "layout_node_id": "safe-area",
      "is_root_container": true,
      "parent_layout_node_id": null,
      "target_bounds": { "x": 0, "y": 47, "width": 390, "height": 763 }
    }
  ]
}
```

## 位置与尺寸控制权

`ui_layout.position_driver` 与可选的 `ui_layout.size_driver` 是两项独立决定。V2 自动选型不读取尚未采集的运行时矩阵；默认计划假设节点与 Widget target 路径为 `scale=1`、`rotation=0`、`skew=0`。已知项目路径存在非单位变换时，显式选择 `SHARED` 并由共享布局换算。若 V4 实际逻辑变换与 WIDGET 计划不符，阻断并回到上游调整位置驱动器，不通过增加容器规避。满足其他条件时，只有节点由自身管理位置、参照是已存在父/祖先 Node、九点停靠可由 Widget 表达，且不是背景、组合居中成员、`REFLOW` 或 `SCROLL` 时才自动选 `WIDGET`；逻辑根与其他情况使用 `SHARED`。Creator 原生父 Layout 若负责排列子节点，子节点必须使用 `position_driver: LAYOUT`，不能另用 Widget 写同一位置；自定义项目布局器使用 `SHARED` 驱动并保留 `layout_owner: PARENT`。

`size_driver` 可取 `SPRITE_RAW`、`FIXED`、`WIDGET`、`LAYOUT`、`SHARED`、`CONTENT`，并按以下规则约束：

- `SIMPLE + RAW` Sprite（包括兼任容器根的底板）始终由 `SPRITE_RAW` 控制尺寸。实际 `UITransform.contentSize` 必须等于正式 SpriteFrame 的完整未裁切 `original_size`，且不得被 Widget 或 Layout 改写；这不禁止 Node `scale`、缩放动画或其他已由几何合同覆盖的变换。`target_bounds` 的视觉几何另按既有测量合同验收，不能据其宽高反向改写 RAW 内容尺寸。
- 声明 `widget_stretch_axes` 时，尺寸只能由 `WIDGET` 控制。只有冻结的 `SLICED + CUSTOM` 九宫格 Sprite，或 `size_policy: STRETCH` 的非 Sprite 结构容器可以获得该授权。
- 其他显式 `size_driver: FIXED` 只能配 `size_policy: FIXED`；`CONTENT` 只能配 `CONTENT`；`LAYOUT` 和 `SHARED` 只能配 `STRETCH` 或 `FLEX`。其中 `LAYOUT` 专指 Creator 原生 Layout 组件实际计算尺寸，自定义项目布局器使用 `SHARED`，但仍可保留 `layout_owner: PARENT`。`SPRITE_RAW` 只对 RAW Sprite 有效，`WIDGET` 只对有拉伸轴的节点有效。未满足这些条件时阻断，不静默改写尺寸意图。
- 当当前节点的 Creator 原生 `Layout` 以 `CONTAINER` 模式计算自己的尺寸时，可使用 `layout_owner: SELF`、`position_driver: WIDGET`、`size_policy: FLEX`、`size_driver: LAYOUT`。执行顺序是先由当前节点 Layout 更新自身尺寸，再由 Widget 相对父级/祖先定位。
- Creator 原生 Layout 的 `type: NONE` 不排布节点也不改尺寸。启用水平、垂直或网格排布时，所有被排布的活动子节点必须由该父 Layout 控制位置，即使用 `position_driver: LAYOUT`。`resize_mode: CHILDREN` 的 HORIZONTAL 写子节点宽度、VERTICAL 写高度、GRID 写宽高；RAW Sprite 只要被改写任一轴就阻断，受影响的非 RAW 子项尺寸必须由原生 `LAYOUT` 控制。节点自身 `resize_mode: CONTAINER` 时，HORIZONTAL 写自身宽度、VERTICAL 写自身高度；GRID 的写入轴由 `start_axis` 决定：HORIZONTAL 只写高度，VERTICAL 只写宽度；GRID 快照必须提供 `start_axis`。只有父子 Layout 的尺寸轴发生重叠才判为所有权冲突；例如父 HORIZONTAL/CHILDREN 写子宽度，可与当前节点 GRID/HORIZONTAL/CONTAINER 写自身高度并存。

因此，Widget 与 Layout 可以在不同阶段管理不同属性，但不能争写同一属性。Widget 定位与当前节点 `Layout.CONTAINER` 计算自身尺寸是合法的顺序协作；父级 Layout 排布子项位置与子项 Widget 定位则是位置所有权冲突。

## V4 组件快照

唯一规范证据写在 `scene_reconstruction_contract.combination_preacceptance.layout_geometry.component_snapshots`。每个业务 `layout_node_id` 恰有一项：

```json
{
  "layout_node_id": "button.icon",
  "component_snapshot": {
    "active": true,
    "parent_layout_node_id": "button.bg",
    "position_writers": ["WIDGET"],
    "size_writers": ["SPRITE_RAW"],
    "widget": {
      "enabled": true,
      "target_id": "button.bg",
      "align_mode": "ON_WINDOW_RESIZE",
      "is_align_left": false,
      "is_align_right": false,
      "is_align_top": false,
      "is_align_bottom": false,
      "is_align_horizontal_center": true,
      "is_align_vertical_center": true,
      "horizontal_center": 0,
      "vertical_center": 0,
      "is_absolute_left": false,
      "is_absolute_right": false,
      "is_absolute_top": false,
      "is_absolute_bottom": false,
      "is_absolute_horizontal_center": true,
      "is_absolute_vertical_center": true
    },
    "layout": null,
    "parent_layout": null,
    "ui_transform": { "width": 24, "height": 24 },
    "layout_bounds": { "x": 138, "y": 113, "width": 24, "height": 24 },
    "reference_bounds": { "x": 100, "y": 100, "width": 100, "height": 50 },
    "sprite": {
      "type": "SIMPLE",
      "size_mode": "RAW",
      "original_size": { "width": 24, "height": 24 }
    },
    "node_to_layout": { "a": 1, "b": 0, "c": 0, "d": 1 },
    "reference_to_layout": { "a": 1, "b": 0, "c": 0, "d": 1 }
  }
}
```

快照必须从当前正式 Creator Scene 的实际节点与组件读取，绑定当前 scene/state、目标视口、候选和运行批次；不能从 `layout_execution` 复制、按预期值伪造、仅提交组件截图或用几何 `result: passed` 替代。测试 fixtures 仅供校验器测试，不能复用为正式运行采集或复制计划值伪证。快照至少包含：

- `active` 读取 Creator 的 `Node.activeInHierarchy`，不能用本地 `node.active` 或计划声明值代替；父节点不活动时，后代的层级活动状态也必须为 false。另记录真实 `parent_layout_node_id`；`position_writers`、`size_writers` 分别列出实际写入机制，且各属性只有计划指定的唯一写入者。
- `widget` 为实际 Widget 快照或 `null`，读取 `enabled`、`target_id`、`align_mode`、六个 `is_align_*` 开关、对应活动对齐值，以及六个 `is_absolute_*` 开关。启用的对齐值必须是有限逻辑像素；活动约束必须使用绝对模式。停用的非 Widget 驱动组件可如实记录 `ONCE`；活动的 `ALWAYS` 不符合本工作流，执行计划为 Widget 时使用 `ON_WINDOW_RESIZE` 并由统一布局入口显式调用 `updateAlignment()`。
- `layout` 与 `parent_layout` 分别读取节点自身和真实父节点上的 Layout；存在组件时记录 `enabled`、`type`、`resize_mode`、`align_horizontal`、`align_vertical`。`GRID` 必须记录 `start_axis`，可附正数 `cell_size`。无组件时为 `null`。这些 `align_*` 值用于描述实际组件状态，不存在另一个冻结的 Layout 参数合同要求它们逐项等于计划。
- `ui_transform.width/height`；存在 Sprite 时记录实际 `type`、`size_mode` 与正式帧 `original_size`，无 Sprite 时 `sprite: null`。
- `layout_bounds` 与 `reference_bounds` 是实际 UITransform 完整矩形经既有坐标合同换算到冻结布局逻辑坐标空间后的几何；它们用于校验严格中心、中心参照和组合 union。业务节点的 `reference_bounds` 必须等于其实际参照节点快照的 `layout_bounds`；引用逻辑根时，使用同一批次唯一的根矩形。
- `node_to_layout` 与 `reference_to_layout` 是从节点和 Widget 参照路径映射到冻结布局逻辑坐标空间的线性部分；先按现有 `designTransform`、Camera 和逻辑视口合同换算，不得直接把含屏幕适配缩放或 DPR 的 `worldMatrix` 当成逻辑矩阵。只有 `position_driver: WIDGET` 的节点及其 Widget target 参照路径必须为单位变换，使布局逻辑像素与 Widget 局部像素一致；若 V4 观测到非单位变换则拒绝该 WIDGET 计划，回到 V2 改用 `SHARED`，不能添加容器绕过。`SHARED` 可负责把非单位变换的节点位置换算到 Creator 坐标。RAW 只约束实际 `contentSize` 等于 SpriteFrame `original_size`，不要求单位矩阵，也不禁止 Node 缩放动画。不能把全局 bounds 差值直接写入 Widget 局部值。

实际 Widget 对齐开关和值还须与已确认执行计划逐项匹配。若某严格居中轴由 Widget 控制，该轴必须启用对应的 `horizontal_center`/`vertical_center`，活动值为 `0`；但正确的开关和值本身不证明实际居中。V4 使用实际 `layout_bounds`、`reference_bounds` 校验严格中心、中心参照偏移及组 union，所有位置驱动器均适用。原生 Layout 也按其实际几何效果验证，不要求 align flag 单独证明对齐。允许中心参照偏移时，实际中心关系按坐标转换后的已确认 `offset` 匹配，且理由沿用[严格居中与中心参照合同](center-alignment.md)。

活动业务节点的 `position_writers` 和 `size_writers` 各恰有一个对应计划的唯一驱动器；非活动节点两者都为空。Widget/Layout 的 `enabled` 记录实际组件开关，并与 `activeInHierarchy` 一起判断有效写入者；非活动节点仍需如实记录实际组件快照，但不能将禁用组件报告成有效写入者。`component_snapshots` 的业务节点覆盖不受 `visual_validation.mode` 的几何容差矩阵影响：`usability` 与 `exact` 都必须覆盖全部业务布局节点。该覆盖要求不等于要求每个 `layout_bounds` 都与目标框相等；它用于实际中心关系与组件几何规则，不把 `usability` 升级成完整 exact 测量。`node_measurements` 仍独立负责既有几何验收：`usability` 可按关键节点和可用性规则验收，`exact` 要求完整节点测量与预声明容差。二者不是同一份矩阵，也不能以某种模式缺少完整几何测量为由减少组件快照覆盖。

结构化 UI 合同仅在 `effect-image` 且 `fidelity.status: verified` 时消费同一正式场景运行证据：其根级 `component_snapshots` 是 `combination_preacceptance.layout_geometry.component_snapshots` 这次采集的投影，不是第二份证据；`specified` 只检查计划，不要求运行时快照。不得另造全局根协议、重复一份手写快照，或让结构检查与几何检查读取互不一致的采集结果。当前修改仅更新工作流与校验规则，不代表已执行 Creator 运行或完成截图视觉验收；截图效果仍由用户人工检查。

## Creator 3.8.9 参考

- [Layout 组件手册](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/layout.html)
- [Creator 3.8.9 Layout 实现](https://github.com/cocos/cocos-engine/blob/v3.8.9/cocos/ui/layout.ts)：`CHILDREN` 会写入子节点尺寸；`CONTAINER` 会根据子内容更新当前布局节点尺寸。
- [Creator 3.8.9 Widget 对齐实现](https://github.com/cocos/cocos-engine/blob/v3.8.9/cocos/ui/widget-manager.ts)：Widget 对齐过程忽略节点旋转，因此只有 Widget 驱动的节点与 target 参照路径要求单位线性变换；SHARED 驱动可处理非单位变换。
