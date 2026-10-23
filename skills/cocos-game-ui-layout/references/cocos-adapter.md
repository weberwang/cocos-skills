# Cocos Creator 坐标与布局适配

本参考把已确认的 V2 布局合同与 V3 资源接入 V4 正式 Cocos Scene。Scene、Node、Component、Prefab、AssetDB 和构建相关操作都通过[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)执行；先读取 `tools/list` 提供的实时 schema，不手写 `.scene`、`.prefab` 或 `.meta` 绑定。编辑器写入的单写者和保存读回边界见[协议及集成流程](../../cocos-game-asset-integration/SKILL.md)。

## 坐标空间

所有合同中的布局标注使用左上原点、X 向右、Y 向下的逻辑坐标。Creator Node 的局部坐标为 X 向右、Y 向上；`UITransform.anchorPoint` 以归一化值表达 Node 矩形的锚点，Y 从底边计。合同的布局锚点字段是工作流数据，写入 Creator 属性前必须显式转换。

换算分两步完成：先把 CSS viewport 和 DPR 变换为合同的逻辑/设计空间；再把父节点左上原点的布局位置转成 Creator Node 锚点局部坐标。项目提供 [`cocos-coordinate-adapter.mjs`](../scripts/cocos-coordinate-adapter.mjs) 供纯几何计算使用：

- `layoutPointToNodeLocal({x,y}, frame)` 将父矩形内的左上布局坐标换成局部坐标；公式是 `xLocal = x - width × anchorX`、`yLocal = height × (1 - anchorY) - y`。
- `nodeLocalToLayoutPoint({x,y}, frame)` 做对应的逆变换，使输入/测量与布局使用同一坐标合同。
- `coverTransformToCocos(cover, parentFrame, spriteAnchor)` 把左上布局空间的 cover 结果换成 Sprite 锚点位置并保留明确的比例。

适配器校验父尺寸为正有限数、锚点和坐标为有限数。它不计算 Camera 投影、节点旋转、祖先缩放或屏幕坐标；这些属于项目的 Camera/设计视口合同，不能重复应用缩放或偏移。

## Creator 节点职责

- UI 根挂载到 `Canvas`，几何和归一化锚点由 `UITransform` 管理；使用 `Widget` 时将相对边界/尺寸约束声明在节点组件上，并按目标 Creator 版本确认其生效时机。`UITransform` 的 anchor point 默认值或 Widget 对齐结果不能替代 V2 中冻结的布局事实。
- 2D 世界对象使用 Scene 节点树和目标 Camera。屏幕 UI 与世界 Camera 的逻辑坐标、渲染顺序和输入转换分开记录；不要将物理 backing 像素直接写成 Node.position。
- Node 的同父级显示顺序由节点树 sibling 顺序管理；在同一父节点内确需改序时，Creator API 为 `Node.setSiblingIndex(index)`。跨 Camera/层级顺序应使用项目已配置的 Camera/排序方案并以实际画面验证，不凭局部 `z_index` 推断。
- 可复用结构以 Prefab 表达。资源绑定使用 AssetDB 已导入并核验的 UUID/子资源身份；不要在序列化文件中自行拼 UUID。
- 背景图片的可见 bounds 与 Node 锚点分开计算。先按合同得到 cover/contain 和裁切结果，再通过 helper 转换到 Node 局部位置；不通过编辑器拖动补偿布局，也不在 resize 时累计旧偏移。

## 图片原尺寸与九宫格尺寸

图片还原时必须区分 `Sprite.sizeMode`（尺寸来源）与 `Sprite.type`（渲染方式）：

- 普通固定视觉图片派生 `sprite_geometry={type:'SIMPLE',size_mode:'RAW',content_size:null}`，使用 `Sprite.Type.SIMPLE` 与 `Sprite.SizeMode.RAW`。绑定正式 SpriteFrame 后，由 Sprite 使用该帧完整未裁切原尺寸；这里的原尺寸是正式运行时 SpriteFrame 尺寸，既不是父框尺寸，也不是生成器尚未归一化的 `raw_source_file` 尺寸。计划字段 `content_size` 固定为 `null`，不携带宽高，运行时不对该图片执行 `UITransform.contentSize` 写入；也不得通过 `setContentSize(...)`、双边拉伸 Widget 或 Layout 自动调整子项尺寸把图片改为自定义尺寸。该图片即使同时是底板容器、拥有图标和文字子项，也保留 RAW 图片身份与原尺寸计划。
- 只有 V2/V3 已冻结采用九宫格的图片派生 `sprite_geometry={type:'SLICED',size_mode:'CUSTOM',content_size:{width:目标宽,height:目标高}}`，使用 `Sprite.Type.SLICED` 与 `Sprite.SizeMode.CUSTOM`，按冻结目标显示框设置 `UITransform.contentSize`，并使用已确认的 SpriteFrame 切片边界。局部 scale 保持 1，完整规则见[九宫格 UI](../../cocos-game-asset-integration/references/nine-slice-ui.md)。
- 纯结构容器、文字和命中区域没有 Sprite 尺寸计划；`element_type=container` 且 `render_kind=sprite` 的底板节点仍按自己的 RAW 或已冻结九宫格图片身份声明计划。父布局容器、裁切框和交互命中区域仍按各自合同设置尺寸。普通图片不接受 `STRETCH`/`FLEX` 尺寸策略。需要更大命中区域时调整交互父节点，不放大普通图片。布局 bounds、父级 bounds 和定位参照 bounds 只表达几何关系，不构成改写图片原尺寸的指令。

父子分组尺寸不得传递成普通图片尺寸。`parent_target_bounds` 记录实际父框，`reference_target_bounds` 记录用于锚点/偏移的位置参照框；两者都不能覆盖 RAW SpriteFrame 原尺寸。显式定位参照可以是兄弟或祖先节点，但只影响定位计算，不改变图片 `sprite_geometry`。父 Node 的 `scale` 会作用于所有子项，所以不要通过缩放底板根来单独改底板尺寸；普通底板继续 RAW，布局父级与子项尺寸独立管理。九宫格底板通过自身 `UITransform.contentSize` 更新 CUSTOM 显示框，改变该尺寸本身不会按比例缩放其图标或文字子项，子项位置/间距由布局入口重新计算。

`axis_alignment` 的水平 `left/center/right` 与垂直 `top/center/bottom` 组合是九点停靠合同；`self_anchor`、`reference_anchor` 和 `offset` 进一步确定对齐。中心轴如何区分严格居中、显式偏移与组合整体居中，按[居中策略与组合定位](center-alignment.md)计算。它与 `nine_slice` 纹理切片合同无关，不修改 Sprite 类型或 RAW 尺寸。Node `UITransform.anchorPoint` 是 Creator 的节点矩形锚点，默认中心点不代表九点停靠结果。

Widget 的 `target` 只支持当前节点的父级或祖先节点，不能直接引用兄弟节点；遵循 [Cocos Creator 3.8 Widget 说明](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/widget.html)。需要相对兄弟定位时，项目共享布局入口读取兄弟 bounds，以该兄弟作为 `reference_id` 计算九点停靠和偏移，再换算到节点真实父级的局部坐标；不为 Widget 限制而增加包装层，也不改变已确认的兄弟参照语义。

创建、资源绑定、状态换图、Scene 恢复和 resize 共用这项区分：普通图片保持 RAW，九宫格重放冻结目标尺寸。普通图片与目标尺寸不符时先核对绑定资源与 V3 生产规格，修复错误来源，不在 V4 改用 CUSTOM 或临时缩放凑框。已声明的背景 cover/contain 与设计空间到设备的整体缩放继续通过共享变换实现，不改写普通 Sprite 的原始内容尺寸。

依据 [Cocos Creator 3.8 Sprite 组件参考](https://docs.cocos.com/creator/3.8/manual/en/ui-system/components/editor/sprite.html)：Raw 使用未裁切原图尺寸，Custom 使用自定义尺寸，Sliced 是独立的渲染类型。RAW 是本工作流要求，不能依赖编辑器或已有 Prefab 的当前默认值。

## 视口、设计分辨率与重排

Creator `scaleMode` 使用合同中经目标版本验证的 `FIXED_WIDTH`、`FIXED_HEIGHT` 或 `custom`。竖屏固定设计基准按宽适配，横屏按高适配；具体模式及设计尺寸以 `designResolutionPolicy` 与模板为准。不能仅凭声明模式认定满屏、响应式或输入映射通过。

创建、Scene 恢复、resize、方向/安全区/DPR/键盘变化、动态文字与状态切换共用一个幂等布局入口。入口每次从合同与当前有效测量重算视口、父节点几何、UITransform/Widget 属性、Camera 映射和输入目标；图片尺寸写入遵守上述 RAW/九宫格边界，不对所有渲染节点统一设置宽高，不在旧坐标上累计偏移或缩放。弹窗和独立 `DISPLAY_LAYER` 继承宿主视口、DPR、安全区和输入合同，若使用独立 Camera 则单独声明和验证。

构建面板打开、worker ready、AssetDB refresh 或单次 Node 查询均不是运行验证成功。只有实际 Creator Preview/目标运行结果与实测证据可证明运行行为；若 MCP 当前能力只打开构建面板或不支持启动 Preview，按[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)将结果记录为 pending/blocked，不虚报通过。

## 官方参考

- [Cocos Creator 3.8 2D 渲染对象](https://docs.cocos.com/creator/3.8/manual/en/2d-object/2d-render/index.html)
- [UITransform API](https://docs.cocos.com/creator/3.8/api/en/class/UITransform)
- [Widget API](https://docs.cocos.com/creator/3.8/api/en/class/Widget)
- [Canvas API](https://docs.cocos.com/creator/3.8/api/en/class/Canvas)
- [Camera API](https://docs.cocos.com/creator/3.8/api/en/class/Camera)
- [Node API](https://docs.cocos.com/creator/3.8/api/en/class/Node)
- [动画剪辑编辑文档](https://docs.cocos.com/creator/3.8/manual/en/animation/edit-animation-clip.html)

上述链接指向 Creator 3.8。其他 3.x 项目应先阅读其锁定小版本文档，再使用相应 API。
