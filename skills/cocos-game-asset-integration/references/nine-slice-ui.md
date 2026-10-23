# 九宫格 UI：拆解时确定，按小图生产

九宫格是图片皮肤的呈现方式，仍属于图片资产路线。V2 拆解时逐个评估 UI 底板、按钮皮肤和框体，把采用或不适用的原因写进对应 `decomposition_elements[].nine_slice`，随已有拆解及布局确认冻结；不增加一次人工审批，V3 生产按冻结参数执行。

## 适用判断

| 元素与可观察结构 | 判断 |
| --- | --- |
| 矩形/圆角底板、弹窗框、按钮皮肤；角边细节固定，中区平坦或低频，边条可沿单轴伸长 | 通常适合；切片线须避开圆角、端帽、描边转折及需要保留的阴影 |
| 可变宽高的卡片外框、输入框、列表选中底板、规则提示气泡主体 | 按实际结构选择；气泡箭头、角标和固定花纹应拆为独立节点 |
| 带固定 Logo、图标、数字或文字的按钮/面板 | 只对底板皮肤使用九宫格；文字及图标独立布局，不能一并拉伸 |
| 人物、道具、完整插画、图标、字标，以及中心有不可伸长图案的材质 | 不适用；保留完整图片或拆分底板和装饰层 |
| 不规则轮廓、透视边框、连续复杂纹饰、必须保持纹理周期的表面 | 不直接使用拉伸九宫格；需要另一种明确的呈现方案 |

不要仅凭“按钮”“底板”等名称选择。需从冻结参考图判断固定区域与可伸展区域，并保留原图外形、层次、边厚和留白。简单规则底板若已选择可完整还原的 Cocos 原生绘制，则沿用该路线，不为九宫格改成图片。

## 冻结合同

适用时使用同一份声明：

```json
{
  "mode": "stretch",
  "reason": "圆角和边厚固定，中心为可双轴伸展的平坦材质",
  "source_size": { "width": 96, "height": 64 },
  "borders": { "left": 12, "right": 12, "top": 10, "bottom": 10 }
}
```

不适用的 UI 皮肤使用 `{ "mode": "not-applicable", "reason": "中心图案必须保持完整比例" }`。普通非 UI 插画可不声明；九宫格不能用于纯结构容器或满幅背景。采用九宫格的底板图片可以兼任 `element_type: container` 的功能根，使用 `render_kind: sprite` 和 `semantic_grouping.kind: component` 或 `region`；保留它自己的 `component_id`、`placement_id` 和图片资产身份，不强制把 Sprite 变为叶子。负责交互/布局的容器按真实职责保留；不得仅为框住底板或满足分类校验新增包装容器。未采用九宫格的普通固定视觉底板派生尺寸计划为 `sprite_geometry={type:'SIMPLE',size_mode:'RAW',content_size:null}`，正式 SpriteFrame 保持完整未裁切原尺寸。

`axis_alignment.horizontal=left|center|right` 与 `vertical=top|center|bottom` 组合表示九点停靠：选择内容在底板或其他参照上的位置关系，并由锚点和偏移补全。九点停靠不表示图片九宫格拉伸，也不触发 `SLICED`、`CUSTOM` 或目标尺寸写入。`nine_slice` 只描述纹理固定边角/边条与可伸展区域；两者独立决策、分别冻结。

明确分类为固定图片 UI 皮肤的部件必须有上述正反决策，不能把字段缺失当作“不适用”。机器依据声明的 role/视觉路线类型判断，不根据名称或图片像素猜测。V2 可派生 `nine_slice_decision_required=true` 并保留到布局节点，防止后续投影丢失必评估要求；该标记不是手填豁免开关。

- `source_size` 是最终未裁切纹理的生产尺寸，不是场景显示框。例如源图 `96×64`，显示框可为 `300×180`。
- 四边值是最终源帧像素，图片生产 DPR 为 1，对应布局合同中的逻辑单位；尺寸和边值均为整数。源图及每个显示框都须为中心留下正宽高，不能通过整体缩放挤进过小框。
- 当前实现为真正的九块拉伸，`top+bottom>0`；不接受隐式三切片或重复平铺。原生三切片的固定高度语义需要独立合同，不能套用本合同。
- 内部文字/图标的安全边距继续在 V2 节点目标框、父子关系和布局不变量中冻结。切片边宽不自动等于内容 padding，不自动把空白填满。

## V2 到 V4 传递

1. **V2**：在拆解元素中记录决策，布局生成必须保留到对应节点。根据最小显示框检查边宽与中心；同一小图用于多个 placement 时，每个框都要满足限制。切片线应在当前拆解审阅材料中说明，用户确认与其它拆解事实一起生效。
2. **V3**：把同一合同复制到对应组件/`expected_assets[].nine_slice`，按 `source_size` 写 `width/height` 并生产小图。普通图片仍按原尺寸合同；多组件区域不能用一个区域级九宫格声明覆盖全部资产。真实生成提示词包含小图尺寸、切片边宽、固定角边和独立文字/装饰要求。保持整幅源纹理，禁止 trim、裁角、额外 padding 或按大显示框生产整块皮肤；尺寸归一化只能保持已确认的源帧比例与切片结构。
3. **V4**：正式场景按 V2/V3 已冻结的 `object_fit="nine-slice"` 与 `nine_slice` 实现，一个 Node 只引用一张皮肤纹理。源图实际尺寸不符、参数未冻结、目标过小均阻断，不能临时手填新的切片值。初始位置仍直接来自 V2，偏移默认空。
4. **V4**：在正式场景使用 `Sprite.Type.SLICED`、`Sprite.SizeMode.CUSTOM` 和 Sprite Editor 中冻结的边界实现；对应派生 `sprite_geometry={type:'SLICED',size_mode:'CUSTOM',content_size:{width:目标宽,height:目标高}}`。显示框尺寸由底板节点自身的 `UITransform` 内容尺寸控制；底板可以同时作为组件父节点，不要求增加结构根。局部 scale 保持 1，不通过缩放整张图片改变角边；父 Node scale 会一并作用于所有子节点。只有采用九宫格的图片设置目标宽高，`mode=not-applicable` 或普通非九宫格图片仍使用 `Sprite.SizeMode.RAW` 和 `sprite_geometry={type:'SIMPLE',size_mode:'RAW',content_size:null}`，保持正式 SpriteFrame 的完整未裁切原尺寸，不套用九宫格的尺寸写入逻辑。改变九宫格底板的 `contentSize` 不会按比例缩放其图标和文字子项，子项由布局入口按冻结参照与停靠关系重新计算。父容器 bounds、定位参照或布局尺寸策略不能改写普通图片的 `contentSize`；普通图片不得使用 `STRETCH`/`FLEX`，纯结构容器、文字和命中区域不声明 Sprite 尺寸计划。设计空间到设备的整体变换仍走共享视口入口。resize/wake 重放同一合同，不另写底板尺寸补丁。

Creator 的 Sprite `Sliced Mode` 将图像按九宫格规则适配目标尺寸；它不是独立 NineSlice 对象，也没有 WebGL 前置要求。资源切片边界需在 Sprite Editor 中与已冻结合同一致，并对目标 Creator 小版本及实际目标平台运行核验。依据 [Cocos Creator 3.8 Sprite 组件参考](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/sprite.html)。

机器验证合同传递、实际纹理尺寸、切片范围、局部几何和两阶段同路；角部画质、接缝、拉伸后的材质与留白由用户人工检查。九宫格参数合法不能代替视觉验收。
