# 居中策略与组合定位

本参考约束 effect-image V2 自动布局决策及其布局节点投影。`axis_alignment` 继续表示九点停靠语义；当某轴选择 `center` 时，`center_alignment` 决定中心对齐是否严格，或是否带有经说明的设计偏移。它不改变节点身份、顺序或尺寸，也不改变普通图片的 RAW 原尺寸。

## 单个元素的严格居中与中心参照

每个 `automatic-layout-decision/1.0` 的 `elements[]` 项保留 `horizontal_alignment` 和 `vertical_alignment`，并可声明同级的 `center_alignment`。只有选择 `horizontal_alignment=center` 或 `vertical_alignment=center` 的轴才可以有对应策略。普通 center 轴省略策略时按 `strict` 解释，并将规范化结果写入生成节点；决策文件保持输入原字节，不为补默认值而改写。若该轴由 leader 的 `member_ids` 控制，则组员继承组策略，省略策略不会再产生独立 strict。非中心轴不得声明中心策略。

```json
{
  "element_id": "main-icon",
  "horizontal_alignment": "center",
  "vertical_alignment": "center",
  "center_alignment": {
    "horizontal": { "mode": "strict" },
    "vertical": { "mode": "strict" }
  }
}
```

- `strict` 将元素 bounds 的中心放到有效 `reference_id` 的中心，输出该轴 `offset=0`。生成器只平移 `target_bounds`，保留 `width`、`height` 和图片原尺寸；同时重算依赖最终位置的 `relative_position` 和节点偏移。
- `reference` 明确允许元素中心偏离参照中心。必须提供有限数值 `offset` 和非空 `reason`；目标中心按既有布局坐标与偏移符号约定，相对参照中心移动该偏移。理由描述经确认的设计意图或人工检查后的光学补偿，不得用测量所得的中心差自动填充。
- 中心参照不是“把当前测量偏差保存下来”的默认行为。没有显式 `reference` 决策时，即使原始 bounds 未居中，也按 `strict` 调整布局节点位置。

普通按钮只有一个主图标时，广告角标独立贴边，不参与主图标居中框：

```json
{
  "elements": [
    {
      "element_id": "main-icon",
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

`main-icon` 以按钮底板为 `reference_id`，严格对齐底板矩形中心。`ad-badge` 独立参照同一底板并停靠右上角；不要把角标列入主图标的居中成员。比如按钮为 `160×64`、主图标为 `24×24`，按钮矩形中心为 `(80,32)` 时，输出主图标位置为 `(68,20)`，尺寸仍为 `24×24`。角标位置不会改变这组居中计算。

## 图标与文字作为整体居中

同一图文组合无需增加空容器。把组合的全部成员 ID 写在其中一个 leader 决策的 `center_alignment.member_ids` 中；成员至少两个、ID 唯一且包含 leader。组内成员须处于同一 scene/state、坐标空间和直接父级。leader 的 `reference_id` 必须在组外；其他成员可参照同一外部底板或组内节点，但合并父子边及参照边后不得成环。同一成员不得出现在重叠的居中组中。

每个声明的居中轴都对成员 `target_bounds` 的联合包围框执行同一次平移：`strict` 令联合框中心等于参照中心；`reference` 令联合框中心等于参照中心加显式偏移。所有成员沿该轴移动相同距离，保留彼此间距、尺寸和层级顺序。广告角标、阴影或其他不属于图文表达的节点不得加入 `member_ids`，所以它们不会扩大居中范围。

```json
{
  "elements": [
    {
      "element_id": "main-icon",
      "horizontal_alignment": "center",
      "vertical_alignment": "center",
      "center_alignment": {
        "horizontal": { "mode": "strict" },
        "vertical": { "mode": "strict" },
        "member_ids": ["main-icon", "label"]
      }
    },
    {
      "element_id": "label",
      "horizontal_alignment": "left",
      "vertical_alignment": "top"
    }
  ]
}
```

在这个例子中，`label` 以 `main-icon` 作为位置参照并保持既定间距；它用 left/top 锚点表达组内关系，不声明自己的 `center_alignment`，也不在组控制轴上另行决定整组位置。比如按钮为 `160×64`，图标为 `24×24`、文字为 `48×20`，原间距为 `4`，联合宽度为 `76`。联合框原中心若在 x=78，严格居中会把图标和文字一起向右平移 2；平移后联合中心为 x=80，两个节点的宽高与间距不变。节点输出中的 `offset` 仍按各自最终 bounds、锚点和定位参照分别计算，因此组员的节点偏移可以非零；严格约束的零偏移是整组中心相对外部参照的对齐结果，不能将每个组员的 `offset` 强行清零。

组 leader 以外的成员在组控制轴上不能声明独立 `center_alignment` 策略。由于每项仍需提供两个轴的 `*_alignment`，可优先使用组内定位所需的非 center 锚点（如相对图标的 left/top）表达间距；若成员在受控轴仍选择 `center`，则继承 leader 的组策略，不产生独立中心策略。leader 决定整组相对外部参照的位置，成员已有的轴对齐与参照关系用于表达组内关系；投影完成后，所有节点的 bounds、相对父级距离和偏移都必须根据最终位置复算。

## 有理由的中心补偿

先确认节点矩形、参考框和参照选择，再检查素材自身的透明留白、可见主体和 RAW 原尺寸。素材透明留白不对称导致可见内容看起来偏时，优先确认素材构图及生产画布；不得改 RAW 宽高来掩盖位置问题。经过人工确认确需光学补偿时，以 `reference` 显式记录偏移和原因：

```json
{
  "element_id": "main-icon",
  "horizontal_alignment": "center",
  "vertical_alignment": "center",
  "center_alignment": {
    "horizontal": {
      "mode": "reference",
      "offset": 2,
      "reason": "人工检查透明边缘后，为匹配按钮视觉重心向右补偿 2 logical-px"
    },
    "vertical": { "mode": "strict" }
  }
}
```

此时按钮中心为 `(80,32)`、图标为 `24×24`，输出图标 x 为 `70`，节点宽高仍为 `24×24`，RAW 图片仍使用完整 SpriteFrame 原尺寸。若调整的是多个成员的整体光学重心，把相同策略放在组 leader 并声明全部组成员；不要分别给成员加补偿。

## 位置派生与确认

`proposal.decomposition_elements[].bounds` 是拆解确认中的原始测量事实，布局阶段不得回写它。自动布局决策必须绑定当前拆解确认；布局生成器从确认 proposal 与决策重新计算布局节点的 `target_bounds`。strict/reference 中心策略可在声明轴上平移单个节点或整组。父级或定位参照发生整体平移时，依赖它们的节点也沿相应轴跟随同一位移，以保持原有相对间距；这项传播不要求依赖节点自身声明中心策略，非 center 轴也会传播。组合居中的成员随 leader 等量移动。按依赖关系计算时，同一祖先或参照位移只累计一次；所有受影响节点的 `target_bounds`、`relative_position` 和 `offset` 都按最终位置复算。上述位置变化保持 `width`、`height`、元素顺序、身份、父级和组内间距不变。

有独立中心约束的布局节点保留规范化 `center_alignment`；整体居中 leader 节点同时保留 `member_ids`。组员受控轴继承 leader 策略，不复制为独立策略。布局确认从绑定的 proposal 和原 decision 字节复算中心位移、父/参照位移传播及每个最终 bounds 与 `offset`，逐项比较生成节点；不能把生成结果静默写回 proposal 或改写 decision 字节，也不能在 V4 通过补丁改写已确认的 V2 位置。调整策略、依赖关系或成员关系时，重新生成并确认受影响的 V2 布局图。

生成与确认校验还必须拒绝：非 center 轴声明中心策略；非法 `mode`；reference 偏移非有限或理由为空；成员数少于两个、成员 ID 重复/不存在/不含 leader、成员跨父级或布局上下文；成员出现在重叠居中组；leader 将组内成员作为外部定位参照；组员在组控制轴重复声明独立中心策略；或父子与参照边形成环。确认校验须从绑定的 proposal 与 decision 重新计算布局结果，不能仅检查 PNG、decision 和 nodes 三份产物彼此一致。

整套位移仅影响布局位置，不缩放父节点或 Sprite。普通底板和图标继续使用 `SIMPLE + RAW`、`content_size=null`；只有冻结的九宫格资源使用 `SLICED + CUSTOM`。相关图片尺寸边界见[Cocos 适配器](cocos-adapter.md#图片原尺寸与九宫格尺寸)。
