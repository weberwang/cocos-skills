# Widget 定位策略

本参考规定何时将 `Widget` 作为节点定位器，以及如何从已确认的布局事实生成 Cocos Widget 配置。`position_driver` 与 `size_driver` 分别决定位置和尺寸的唯一写入者，两者可以不同；Widget 负责定位时，共享布局仍可先计算尺寸，再调用 Widget 对齐。不改变功能父子归属、SpriteFrame 原尺寸、九宫格确认或视觉意图。

## 决策顺序

对每个节点先按以下顺序确定事实，再选择驱动器：

1. **先定功能父级**：`parent_element_id` 记录真实的功能、状态、交互、生命周期或布局管理归属。简单按钮优先让底板 Sprite 兼任组件根；只有独立裁切、独立动画、稳定交互/布局尺寸或动态子项排布等真实职责需要时才增加纯结构容器。不能为符合 Widget 的 target 限制改变父子树或增加包装层。
2. **再定位置参照与意图**：`ui_layout.position_reference_id` 省略时等于真实父级；显式值可指向允许的兄弟、祖先或逻辑根，并保持与父级不同的事实。`viewport` 与 `safe-area` 是逻辑参照，当前合同没有定义到实体 Node 的映射；它们一律使用共享布局，显式选择 `WIDGET` 必须在校验阶段拒绝，不能作为 Widget target。记录九点停靠和中心策略；截图位置用于测量 bounds，不能单独证明要吸附哪条边、是否居中或是否跟随。
3. **选唯一位置驱动器**：位置只能由一种运行时机制写入。需要实际父/祖先 Node 边缘、中心或明确伸缩约束时可用 Widget；逻辑 `viewport`/`safe-area`、兄弟参照、整体组合计算或 reflow/scroll 排布使用共享布局入口或明确的 Layout；动画控制位置时显式登记动画驱动；固定且不需重算的位置才使用静态驱动。
4. **独立授予尺寸权限**：位置和尺寸分开选择写入者，不能因为选择 Widget 定位就让 Widget 改尺寸。普通 Sprite（包含兼任父容器的底板）由 Sprite 的 `RAW` 模式控制原尺寸；Widget 双边对齐会改变对应轴尺寸，只有明确冻结的 `SLICED + CUSTOM` 九宫格图片或 `size_policy: STRETCH` 的非 Sprite 容器可使用。文本等内容尺寸由 `CONTENT` 管理，或由明确的共享/父级布局约束计算。

## 选择 `position_driver`

`ui_layout.position_driver` 是可选字段，可显式填写 `WIDGET`、`SHARED`、`LAYOUT`、`STATIC` 或 `ANIMATION`。省略时由布局生成器按下列自动规则选择：只有 `layout_owner: SELF`、有效位置参照是已存在的实际父节点或祖先节点、当前九点对齐可由 Widget 表达、节点不是背景、不是图文组合整体居中的成员，且 `overflow_policy` 不是 `REFLOW`/`SCROLL` 时才选 `WIDGET`；逻辑根 `viewport`/`safe-area` 和其余情况选 `SHARED`。父级或外部布局责任本身不会自动推断出 Creator `Layout` 组件或动画控制器。

| 驱动器 | 适用情况 | `layout_owner` 要求 | 运行时唯一位置写入者 |
| --- | --- | --- | --- |
| `WIDGET` | 参照是已存在的实际父级/祖先 Node；位置意图可表示为每轴一个边缘、中心或显式拉伸约束；不属于背景、整体居中组或 REFLOW/SCROLL 节点 | `SELF` | 当前节点 Widget，由统一布局入口配置并调用 `updateAlignment()` |
| `SHARED` | 逻辑 `viewport`/`safe-area`、兄弟参照、图文组合按 bounds 联合居中、布局不能映射为 Widget、或自动规则的其他情况 | 任意 | 项目共享布局入口 |
| `LAYOUT` | 明确存在一个 Cocos `Layout` 或项目布局器，负责该节点的位置/排布 | `PARENT` | 被确认的父级布局器 |
| `STATIC` | 目标位置冻结且无需随状态、文本、父尺寸、视口或安全区变化重算 | `SELF` | 冻结节点配置；事件处理器不得另写位置 |
| `ANIMATION` | 明确的动画/外部系统在其活动期间拥有节点位置 | `EXTERNAL` | 已登记的动画/外部驱动 |

若显式选择的驱动器与这些要求冲突，应在布局确认/校验阶段阻断，不能靠添加父容器来规避。`WIDGET` 的有效参照必须解析为该节点已存在的真实父级或祖先 Node；Widget `target` 精确绑定该 `position_reference_id`，不能指向兄弟节点。当前合同没有规定逻辑 `viewport`/`safe-area` 到实体 Node 的映射，因此直接参照这两个稳定根时必须使用 `SHARED`，显式声明 `WIDGET` 应被拒绝；合成的 `root_nodes` 也只是合同数据，不证明场景里存在对应 Node。已有真实 Canvas 等父/祖先节点可直接作为 Widget target。不能为让 Widget 可用而添加 Canvas 包装或空容器。

`layout_owner` 表达布局责任归属，`position_driver` 表达唯一运行时位置写入者；它不自动创建或配置 Creator `Layout` 组件。显式 `position_driver: LAYOUT` 只登记由父级布局器控制，具体排布参数和实际布局器连接由项目合同提供；`layout_owner: PARENT` 本身不是 Creator `Layout` 组件存在的证据。`ANIMATION` 活跃时，共享入口与 Widget 不得同时改写动画持有的位置，交接/恢复事件必须有明确所有权规则。

## 尺寸权限

`ui_layout.widget_stretch_axes` 是可选、非空、无重复的数组，元素只能是 `horizontal`、`vertical`，且仅在 `position_driver: WIDGET` 时可用。它是唯一允许 Widget 双边对齐的授权：生成后对应轴必须是 `alignment: stretch`，并用起止边距计算目标尺寸。没有列入的轴不能推导成拉伸。Widget 有拉伸轴时，该轴尺寸驱动器为 `WIDGET`；没有拉伸轴时，Widget 只控制位置，尺寸驱动器按独立尺寸合同决定。

- `SIMPLE + RAW` 图片和作为父容器的 RAW 底板禁止声明 `widget_stretch_axes`；尺寸驱动器固定为 `SPRITE_RAW`，来自绑定的正式 SpriteFrame，不写 `UITransform.contentSize`。即使 `size_policy` 写了 `CONTENT`，图片 RAW 原尺寸仍由 Sprite 控制。Widget 可只负责 RAW 图片的位置。
- Sprite 只有 V2/V3 已冻结 `SLICED + CUSTOM` 九宫格时才允许按轴拉伸。对应资产身份、切片边、尺寸意图必须已确认；只有使用 Widget 控制目标尺寸时输出 `size_driver: WIDGET`。
- 非 Sprite 节点只有 `element_type: container` 且声明 `size_policy: STRETCH` 时才允许 Widget 拉伸。文字等非容器内容不得声明 `widget_stretch_axes`；内容固有尺寸使用 `CONTENT`，由共享或明确父级布局计算的文字/内容尺寸使用 `SHARED`/`LAYOUT`。
- 尺寸驱动器允许 `SPRITE_RAW`、`FIXED`、`WIDGET`、`LAYOUT`、`SHARED`、`CONTENT`：RAW 图片始终用 `SPRITE_RAW`；真正冻结的目标尺寸用 `FIXED`；已授权 Widget 双边拉伸用 `WIDGET`；`CONTENT` 表示内容自身决定尺寸；其他 `STRETCH`/`FLEX` 尺寸若位置驱动器是 `LAYOUT` 则用 `LAYOUT`，否则由共享布局计算并标为 `SHARED`。不能把 STRETCH/FLEX 静默归为 `FIXED`。
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

布局坐标原点在左上且 Y 向下，Creator Widget 局部 Y 轴向上。因此水平中心 `value` 等于合同中心偏移 `offset.x`，垂直中心 `value` 等于 `-offset.y`；严格中心两轴均为 `0`。生成器必须从冻结 bounds 与目标 bounds 计算边缘/拉伸边距，不能仅凭截图边距猜测中心偏移。任何非零中心参照偏移沿用 [严格居中与中心参照合同](center-alignment.md)，必须有具体理由。

适配器设置 target 和 alignment 前，先关闭同轴旧有对齐开关，再设置本次计划中的唯一对齐项；只有已确认的 `stretch` 可以同时开启该轴两侧边缘。随后将相关 `isAbsoluteLeft/Right/Top/Bottom/HorizontalCenter/VerticalCenter` 设为 `true`，写入计划值并调用 `updateAlignment()`。这避免旧 Widget 标志残留造成双重约束。

## 布局生命周期与冲突门禁

`ON_WINDOW_RESIZE` 只覆盖窗口尺寸变化，不能替代本项目的布局生命周期。Scene 创建/恢复、资源绑定完成、父节点尺寸变化、动态文字或状态/成员变化、方向/DPR/安全区/键盘变化都必须进入同一个幂等布局入口；每次从当前测量和已确认合同重建 Widget 参数，再调用 `updateAlignment()`。不累计旧偏移、不每帧重排。

同一时段内，`position` 只能由一个位置驱动器写入，`UITransform.contentSize` 只能由一个尺寸驱动器写入；位置与尺寸可由不同驱动器分别管理。Widget 负责位置而共享布局负责尺寸时，共享入口先按合同设置尺寸，再配置 Widget 并调用 `updateAlignment()`；只要两者没有同时写相同属性就合法。`ALWAYS` 会每帧重对齐，本流程使用 `ON_WINDOW_RESIZE` 与幂等入口，不让它覆盖脚本或动画对位置/尺寸的更新。Widget 负责位置时，事件入口更新 Widget 参数而不再 `setPosition`；共享布局负责位置时，不启用会写位置的 Widget；Layout/动画交接时按已冻结的状态边界切换所有权。不能以“双重写入后看起来正确”通过校验。

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

## 校验结果

V2 应从确认的拆解和布局输入复算 `position_driver` 自动选择、参照合法性、唯一位置所有权、中心零偏移、伸缩轴授权、`size_driver` 与 Sprite 原尺寸；比较生成节点的 `layout_execution` 与复算结果。缺失、矛盾或产物自报与输入不符都阻断布局确认。V4 再检查实际 Node/Widget/Layout 配置与计划一致，并覆盖资源完成后、动态内容与安全区/resize 后的幂等重算；运行画面仍由用户按既有规则人工检查。
