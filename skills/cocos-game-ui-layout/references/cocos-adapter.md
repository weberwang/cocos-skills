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

## 视口、设计分辨率与重排

Creator `scaleMode` 使用合同中经目标版本验证的 `FIXED_WIDTH`、`FIXED_HEIGHT` 或 `custom`。竖屏固定设计基准按宽适配，横屏按高适配；具体模式及设计尺寸以 `designResolutionPolicy` 与模板为准。不能仅凭声明模式认定满屏、响应式或输入映射通过。

创建、Scene 恢复、resize、方向/安全区/DPR/键盘变化、动态文字与状态切换共用一个幂等布局入口。入口每次从合同与当前有效测量重算视口、父节点几何、UITransform/Widget 属性、Camera 映射和输入目标；不在旧坐标上累计偏移或缩放。弹窗和独立 `DISPLAY_LAYER` 继承宿主视口、DPR、安全区和输入合同，若使用独立 Camera 则单独声明和验证。

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
