# Widget 定位策略

本参考规定何时将 `Widget` 作为节点定位器，以及如何从已确认的布局事实生成 Cocos Widget 配置。`position_driver` 与 `size_driver` 分别决定位置和尺寸的唯一写入者，两者可以不同；Widget 负责定位时，共享布局仍可先计算尺寸，再调用 Widget 对齐。不改变功能父子归属、SpriteFrame 原尺寸、九宫格确认或视觉意图。

## 决策顺序

对每个节点先按以下顺序确定事实，再选择驱动器：

1. **先定功能父级**：`parent_element_id` 记录真实的功能、状态、交互、生命周期或布局管理归属。简单按钮优先让底板 Sprite 兼任组件根；只有独立裁切、独立动画、稳定交互/布局尺寸或动态子项排布等真实职责需要时才增加纯结构容器。不能为符合 Widget 的 target 限制改变父子树或增加包装层。
2. **再定位置参照与意图**：`ui_layout.position_reference_id` 省略时等于真实父级；显式值可指向允许的兄弟、祖先或逻辑根，并保持与父级不同的事实。`viewport` 和 `safe-area` 是合成布局根，不是实际 Node，不能作为 Widget target；`viewport` 使用完整逻辑视口，`safe-area` 使用整批节点共享的实际安全区快照。两者作为直接参照时都交给共享布局。记录九点停靠和中心策略；截图位置用于测量 bounds，不能单独证明要吸附哪条边、是否居中或是否跟随。
3. **选唯一位置驱动器**：位置只能由一种运行时机制写入。需要实际父/祖先 Node 边缘、中心或明确伸缩约束时可用 Widget。V2 自动选型不读取尚不存在的运行时矩阵，默认计划假设节点与 target 路径 `scale=1`、`rotation=0`、`skew=0`；项目已知路径为非单位变换时显式选择 `SHARED` 并使用既有坐标适配换算。若 V4 实际逻辑变换与 WIDGET 计划不符，应阻断并回到 V2 调整，不增加容器规避。逻辑 `viewport`/`safe-area`、兄弟参照、整体组合计算或 reflow/scroll 排布使用共享布局入口或明确的原生 Layout；自定义项目布局器使用 `SHARED` 并可保留 `layout_owner: PARENT`；动画控制位置时显式登记动画驱动；固定且不需重算的位置才使用静态驱动。
4. **独立授予尺寸权限**：位置和尺寸分开选择写入者，不能因为选择 Widget 定位就让 Widget 改尺寸。普通 Sprite（包含兼任父容器的底板）由 Sprite 的 `RAW` 模式控制原尺寸；Widget 双边对齐会改变对应轴尺寸，只有明确冻结的 `SLICED + CUSTOM` 九宫格图片或 `size_policy: STRETCH` 的非 Sprite 容器可使用。文本等内容尺寸由 `CONTENT` 管理，或由明确的共享/父级布局约束计算。`size_driver` 的推导、Creator Layout 与 Widget 的顺序协作及 V4 实际组件快照见[运行快照合同](widget-runtime-evidence.md)。

## 选择 `position_driver`

`ui_layout.position_driver` 是可选字段，可显式填写 `WIDGET`、`SHARED`、`LAYOUT`、`STATIC` 或 `ANIMATION`。省略时由布局生成器按下列自动规则选择：只有 `layout_owner: SELF`、有效位置参照是已存在的实际父节点或祖先节点、当前九点对齐可由 Widget 表达、默认计划的节点与 target 路径为 `scale=1`、`rotation=0`、`skew=0`、节点不是背景、不是图文组合整体居中的成员，且 `overflow_policy` 不是 `REFLOW`/`SCROLL` 时才选 `WIDGET`；项目已知路径为非单位变换、逻辑根 `viewport`/`safe-area` 和其余情况选 `SHARED`。V2 不宣称读取运行时矩阵，也不新增 transform 计划字段；V4 以实际矩阵核验 Widget 的单位变换约束，观测不符即阻断并回到上游调整。父级或外部布局责任本身不会自动推断出 Creator `Layout` 组件或动画控制器。

| 驱动器 | 适用情况 | `layout_owner` 要求 | 运行时唯一位置写入者 |
| --- | --- | --- | --- |
| `WIDGET` | 参照是已存在的实际父级/祖先 Node；计划按单位变换路径（`scale=1`、`rotation=0`、`skew=0`）处理，且由 V4 核对实际路径；位置意图可表示为每轴一个边缘、中心或显式拉伸约束；不属于背景、整体居中组或 REFLOW/SCROLL 节点 | `SELF` | 当前节点 Widget，由统一布局入口配置并调用 `updateAlignment()` |
| `SHARED` | 逻辑 `viewport`/`safe-area`、兄弟参照、图文组合按 bounds 联合居中、布局不能映射为 Widget、或自动规则的其他情况 | 任意 | 项目共享布局入口 |
| `LAYOUT` | Creator 原生 `Layout` 组件负责节点位置或尺寸 | `PARENT` | 经快照核对的原生 Layout 组件 |
| `STATIC` | 目标位置冻结且无需随状态、文本、父尺寸、视口或安全区变化重算 | `SELF` | 冻结节点配置；事件处理器不得另写位置 |
| `ANIMATION` | 明确的动画/外部系统在其活动期间拥有节点位置 | `EXTERNAL` | 已登记的动画/外部驱动 |

若显式选择的驱动器与这些要求冲突，应在布局确认/校验阶段阻断，不能靠添加父容器来规避。`WIDGET` 的有效参照必须解析为该节点已存在的真实父级或祖先 Node；Widget `target` 精确绑定该 `position_reference_id`，不能指向兄弟节点。逻辑 `viewport`/`safe-area` 是合成根，直接参照时使用 `SHARED`，显式声明 `WIDGET` 应被拒绝；合成的 `root_nodes` 也只是合同数据，不证明场景里存在对应 Node。`viewport` 使用完整逻辑视口；`safe-area` 使用本批唯一实际安全区矩形，生成、中心计算和审阅中的所有对应快照须逐字段一致。已有真实 Canvas 等父/祖先节点可直接作为 Widget target。不能为让 Widget 可用而添加 Canvas 包装或空容器。根跳过规则只认保留 ID `viewport`/`safe-area`、`is_root_container: true` 和显式 `parent_layout_node_id: null` 同时成立；业务节点不得标记 `is_root_container: true` 或占用保留 ID，输出快照中的 `false` 不构成根声明。

`layout_owner` 表达布局责任归属，`position_driver` 表达唯一运行时位置写入者；它不自动创建或配置 Creator `Layout` 组件。显式 `position_driver: LAYOUT` 仅指 Creator 原生 Layout 控制位置，且须由实际组件快照核验；自定义项目布局器使用 `position_driver: SHARED`，但真实布局职责仍可声明 `layout_owner: PARENT`。`layout_owner: PARENT` 本身不是 Creator `Layout` 组件存在的证据。父级原生 Layout 启用 `HORIZONTAL`、`VERTICAL` 或 `GRID` 排布时，受排布的活动子节点必须由父 Layout 控制位置；不能让 Widget 同时改写子节点位置。`ANIMATION` 活跃时，共享入口与 Widget 不得同时改写动画持有的位置，交接/恢复事件必须有明确所有权规则。

## 尺寸权限

`ui_layout.widget_stretch_axes` 是可选、非空、无重复的数组，元素只能是 `horizontal`、`vertical`，且仅在 `position_driver: WIDGET` 时可用。它是唯一允许 Widget 双边对齐的授权：生成后对应轴必须是 `alignment: stretch`，并用起止边距计算目标尺寸。没有列入的轴不能推导成拉伸。Widget 有拉伸轴时，该轴尺寸驱动器为 `WIDGET`；没有拉伸轴时，Widget 只控制位置，尺寸驱动器按独立尺寸合同决定。

- `SIMPLE + RAW` 图片和作为父容器的 RAW 底板禁止声明 `widget_stretch_axes`；尺寸驱动器固定为 `SPRITE_RAW`，来自绑定的正式 SpriteFrame，实际 `UITransform.contentSize` 等于该帧完整未裁切原尺寸。即使 `size_policy` 写了 `CONTENT`，图片 RAW 内容尺寸仍由 Sprite 控制。该限制不禁止节点缩放或缩放动画；其视觉 bounds 按既有几何合同另验。V2 默认计划假设 WIDGET 路径单位；已知路径需缩放/旋转时选择 `SHARED`，V4 仅核对实际 WIDGET 变换，不符合即拒绝该计划。无论位置由谁驱动，RAW 内容尺寸仍保持 SpriteFrame 原尺寸。
- Sprite 只有 V2/V3 已冻结 `SLICED + CUSTOM` 九宫格时才允许按轴拉伸。对应资产身份、切片边、尺寸意图必须已确认；只有使用 Widget 控制目标尺寸时输出 `size_driver: WIDGET`。
- 非 Sprite 节点只有 `element_type: container` 且声明 `size_policy: STRETCH` 时才允许 Widget 拉伸。文字等非容器内容不得声明 `widget_stretch_axes`；内容固有尺寸使用 `CONTENT`，由共享或明确父级布局计算的文字/内容尺寸使用 `SHARED`/`LAYOUT`。
- 尺寸驱动器允许 `SPRITE_RAW`、`FIXED`、`WIDGET`、`LAYOUT`、`SHARED`、`CONTENT`：RAW 图片始终用 `SPRITE_RAW`；真正冻结的目标尺寸用 `FIXED`；已授权 Widget 双边拉伸用 `WIDGET`；`CONTENT` 表示内容自身决定尺寸；其他 `STRETCH`/`FLEX` 尺寸仅由 Creator 原生 Layout 计算时用 `LAYOUT`，自定义项目布局器用 `SHARED`（即使布局责任归属为 `PARENT`）。不能把 STRETCH/FLEX 静默归为 `FIXED`。
- 显式 `ui_layout.size_driver` 只能与相应 `size_policy` 匹配：`FIXED` 对应 `FIXED`，`CONTENT` 对应 `CONTENT`，`LAYOUT`/`SHARED` 对应 `STRETCH` 或 `FLEX`。`SPRITE_RAW` 只适用于 RAW Sprite；`WIDGET` 必须同时声明 `widget_stretch_axes`。
- Creator 原生 Layout `type: NONE` 不排布节点也不改尺寸。`Layout.CONTAINER` 可以计算当前节点自身尺寸；该节点仍需相对真实祖先定位时，可声明 `layout_owner: SELF`、`position_driver: WIDGET`、`size_policy: FLEX`、`size_driver: LAYOUT`，先由当前节点 Layout 更新自身尺寸，再执行 Widget 定位。`resize_mode: CHILDREN` 时，HORIZONTAL 写子节点宽度、VERTICAL 写高度、GRID 写宽高；`resize_mode: CONTAINER` 时，HORIZONTAL 写自身宽度、VERTICAL 写自身高度，GRID 由 `start_axis` 决定：HORIZONTAL 只写高度，VERTICAL 只写宽度，且 GRID 快照必须提供该字段。尺寸所有权只在轴重叠时冲突；父 HORIZONTAL/CHILDREN 写子宽度可与该子节点 GRID/HORIZONTAL/CONTAINER 写自身高度并存。父级 `CHILDREN` 或自身 `CONTAINER` 若会改 RAW Sprite 任一尺寸轴就必须阻断；受影响的非 RAW 节点须由 `LAYOUT` 控制尺寸。自定义项目布局器若计算尺寸，使用 `size_driver: SHARED` 并保留实际 `layout_owner`。
- 九点停靠和九宫格纹理拉伸是不同意图。水平/垂直九点对齐本身绝不授予尺寸权限，不能为了“容器适配”把普通图片改成 CUSTOM/FLEX/STRETCH。

生成器输出的 `layout_execution` 是 V2 已确认 `ui_layout`、位置参照、bounds、`axis_alignment`、中心策略与 Sprite 身份的派生执行计划，不能手工维护第二套 Widget 参数：

```json
{
  "position_driver": "WIDGET",
  "size_driver": "SPRITE_RAW",
  "reason": "定位参照是实际父级或祖先，节点拥有位置控制权，使用 Widget 保持九点关系。",
  "widget": {
    "target_id": "button-bg",
    "align_mode": "ON_WINDOW_RESIZE",
    "is_absolute": true,
    "horizontal": { "alignment": "center", "value": 0 },
    "vertical": { "alignment": "center", "value": 0 }
  }
}
```

位置和尺寸由不同驱动器负责时，`layout_execution` 分别记录二者。例如 Widget 只做居中/停靠而尺寸策略是 `STRETCH`、且没有 `widget_stretch_axes` 时，可输出 `position_driver: WIDGET`、`size_driver: SHARED`；共享入口先写入目标 `contentSize`，再让 Widget 按该尺寸执行定位。文本的固有内容尺寸使用 `CONTENT`；RAW 图片无论其布局尺寸标签如何，仍使用 `SPRITE_RAW`。

`widget` 在驱动器不是 `WIDGET` 时必须为 `null`。`target_id` 必须是确认参照的实际祖先 Node；`align_mode` 固定为 `ON_WINDOW_RESIZE`；水平/垂直 alignment 只能从各自轴的 `left|center|right|stretch` 或 `top|center|bottom|stretch` 中选择。边缘 `value` 表示相对该边的有符号内边距，`stretch` 使用 `{start, end}` 两个边距。所有数值均为逻辑像素，输出绝对模式；不自动转为百分比。

实际 Widget 开关、target、值与绝对模式必须在 V4 从 Creator 组件读取并与执行计划核对。严格居中的 Widget 中心约束值必须为零，但 flags/value 本身不能证明实际居中；V4 还要从实际 `layout_bounds`、`reference_bounds` 核对 strict/reference 和组合 union，原生 Layout 对齐效果也通过这些实际矩形检查。RAW 只核验 `UITransform.contentSize` 等于正式 SpriteFrame 原尺寸，不因 Node 缩放或非单位 SHARED 变换误报。V4 快照字段、唯一写入者、原生 Layout 冲突和 RAW 原尺寸检查见[运行快照合同](widget-runtime-evidence.md)。

布局坐标原点在左上且 Y 向下，Creator Widget 局部 Y 轴向上。因此水平中心 `value` 等于合同中心偏移 `offset.x`，垂直中心 `value` 等于 `-offset.y`；严格中心两轴均为 `0`。生成器必须从冻结 bounds 与目标 bounds 计算边缘/拉伸边距，不能仅凭截图边距猜测中心偏移。任何非零中心参照偏移沿用 [严格居中与中心参照合同](center-alignment.md)，必须有具体理由。

适配器设置 target 和 alignment 前，先关闭同轴旧有对齐开关，再设置本次计划中的唯一对齐项；只有已确认的 `stretch` 可以同时开启该轴两侧边缘。随后将相关 `isAbsoluteLeft/Right/Top/Bottom/HorizontalCenter/VerticalCenter` 设为 `true`，写入计划值并调用 `updateAlignment()`。这避免旧 Widget 标志残留造成双重约束。

## 布局生命周期与冲突门禁

`ON_WINDOW_RESIZE` 只覆盖窗口尺寸变化，不能替代本项目的布局生命周期。Scene 创建/恢复、资源绑定完成、父节点尺寸变化、动态文字或状态/成员变化、方向/DPR/安全区/键盘变化都必须进入同一个幂等布局入口；每次从当前测量和已确认合同重建 Widget 参数，再调用 `updateAlignment()`。不累计旧偏移、不每帧重排。

同一时段内，`position` 只能由一个位置驱动器写入，`UITransform.contentSize` 只能由一个尺寸驱动器写入；位置与尺寸可由不同驱动器分别管理。Widget 负责位置而共享布局负责尺寸时，共享入口先按合同设置尺寸，再配置 Widget 并调用 `updateAlignment()`；当前节点的 `Layout.CONTAINER` 负责自身尺寸时也按先 Layout、后 Widget 定位执行。只要两者没有同时写相同属性就合法。`ALWAYS` 会每帧重对齐，本流程使用 `ON_WINDOW_RESIZE` 与幂等入口，不让它覆盖脚本或动画对位置/尺寸的更新。Widget 负责位置时，事件入口更新 Widget 参数而不再 `setPosition`；共享布局负责位置时，不启用会写位置的 Widget；父级 Layout 排布子项时，子项位置必须归 Layout；Layout/动画交接时按已冻结的状态边界切换所有权。不能以“双重写入后看起来正确”通过校验。

## 场景示例

以下示例分别给出 Stage A `decomposition_elements` 的最小字段增量和 Stage B `automatic-layout-decision/1.0` 的对齐决策；`layout_execution` 由生成器从确认事实派生。

### 按钮底板、严格居中主图标与广告角标

底板节点是功能根和普通 RAW Sprite；图标与角标各自是它的真实子节点。主图标的中心参照只看底板，角标独立停靠，不参与图标中心的几何计算，也不需要空包装根。下面把 Stage A 的元素事实与 Stage B 的自动布局决策分开列出；`center_alignment` 只属于 Stage B 决策，不写进 Stage A 的 `ui_layout`。

```yaml
decomposition_elements:
  - element_id: button-bg
    element_type: container
    render_kind: sprite
    # 普通底板保持正式 SpriteFrame RAW 原尺寸
  - element_id: button-icon
    parent_element_id: button-bg
    ui_layout:
      layout_owner: SELF
      position_reference_id: button-bg
      position_driver: WIDGET
  - element_id: ad-badge
    parent_element_id: button-bg
    ui_layout:
      layout_owner: SELF
      position_reference_id: button-bg
      position_driver: WIDGET
```

Stage B 的 `automatic-layout-decision/1.0` 决策单独表达对齐和中心意图：

```json
{
  "elements": [
    {
      "element_id": "button-icon",
      "horizontal_alignment": "center",
      "vertical_alignment": "center",
      "center_alignment": {
        "horizontal": { "mode": "strict" },
        "vertical": { "mode": "strict" }
      }
    },
    {
      "element_id": "ad-badge",
      "horizontal_alignment": "right",
      "vertical_alignment": "top"
    }
  ]
}
```

期望计划：图标两轴 Widget center `value: 0` 且 `size_driver: SPRITE_RAW`；角标按确认的右上角停靠边距生成 Widget 配置。改动角标 bounds 不能移动图标目标中心或改写底板/图标 RAW 尺寸。

### 图标与文字作为整体居中

整体居中需以图标和文字的 union bounds 求一个组位置，再保留成员间冻结间距。leader 的 `center_alignment.member_ids` 包含 leader 自身和全部组员；所有成员使用 `position_driver: SHARED`，Widget 个体居中会把两者分别放到容器中心，破坏组合。Stage A 的布局驱动与 Stage B 的组合决策分开表达，中心策略不写入 `ui_layout`。

```yaml
decomposition_elements:
  - element_id: icon
    ui_layout:
      position_driver: SHARED
  - element_id: text
    ui_layout:
      position_driver: SHARED
```

```json
{
  "elements": [
    {
      "element_id": "icon",
      "horizontal_alignment": "center",
      "vertical_alignment": "center",
      "center_alignment": {
        "horizontal": { "mode": "strict" },
        "vertical": { "mode": "strict" },
        "member_ids": ["icon", "text"]
      }
    },
    {
      "element_id": "text",
      "horizontal_alignment": "left",
      "vertical_alignment": "top"
    }
  ]
}
```

### 相对兄弟节点定位

兄弟参照不改变真实父级，也不作为 Widget target。共享入口读取参照节点 bounds 后，换算到实际父坐标系。

```yaml
# label 真实父级仍是 button-bg
parent_element_id: button-bg
ui_layout:
  position_reference_id: icon
  position_driver: SHARED
```

### 九宫格面板随祖先伸缩

只有冻结的九宫格 Sprite 可由 Widget 拉伸；普通 RAW 底板禁止此写法。目标 `panel-region` 必须是当前节点已存在的实际祖先。Stage A 输入通过 `nine_slice` 冻结源纹理切片决策；派生的 `sprite_geometry` 只出现在布局节点执行计划中，不作为拆解输入字段。

```yaml
decomposition_elements:
  - element_id: panel-skin
    element_type: container
    render_kind: sprite
    nine_slice:
      mode: stretch
      reason: 圆角和边厚固定，中心为可双轴伸展的平坦材质
      source_size: {width: 96, height: 64}
      borders: {left: 12, right: 12, top: 10, bottom: 10}
    ui_layout:
      layout_owner: SELF
      position_reference_id: panel-region
      position_driver: WIDGET
      size_policy: STRETCH
      widget_stretch_axes: [horizontal, vertical]
```

计划生成 `size_driver: WIDGET` 和双轴 `stretch` 边距。若 SpriteFrame 未冻结九宫格切片，或对应 stretch 与实际布局意图不一致，V2 应阻断而非补一层容器。

Stage B `automatic-layout-decision/1.0` 仍必须对该 `element_id` 提供完整水平和垂直停靠决策。拉伸轴的 Widget 起止边距接管对应轴的最终边界和尺寸，但不会省略决策项或元素身份：

```json
{
  "elements": [
    {
      "element_id": "panel-skin",
      "horizontal_alignment": "left",
      "vertical_alignment": "top"
    }
  ]
}
```

这里 `left/top` 保留明确的起始锚点语义；双轴伸缩范围和边距仍只来自已冻结的 `widget_stretch_axes` 与目标框，不新增包装容器。

## 校验结果

V2 应从确认的拆解和布局输入复算 `position_driver` 自动选择、参照合法性、唯一位置所有权、中心零偏移、伸缩轴授权、`size_driver` 与 Sprite 原尺寸；比较生成节点的 `layout_execution` 与复算结果。缺失、矛盾或产物自报与输入不符都阻断布局确认。V4 必须从实际 Creator Scene 采集[运行快照合同](widget-runtime-evidence.md)规定的全部业务节点组件配置，核对唯一写入者、实际父级、Widget 与原生 Layout 的实际行为、严格居中几何和 RAW 原尺寸；实际中心关系从 `layout_bounds`/`reference_bounds` 检查，不能仅凭对齐 flag。快照覆盖不随 `usability`/`exact` 几何测量矩阵缩减，且不要求所有快照 bounds 都等于目标 bounds。运行画面仍由用户按既有规则人工检查。
