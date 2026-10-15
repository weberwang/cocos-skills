# 显示节点锚点与层级

本规则适用于正式 Cocos Scene、世界对象、Canvas UI、常驻 HUD 和独立 `DISPLAY_LAYER`。V1 冻结分层和布局锚点语义，V2 将它们写入合同，V3 按合同验收资源，V4 在正式场景验证遮挡与输入。Scene/Node/Component/Prefab 操作遵循[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)。

## 布局锚点与 Creator 锚点

布局合同中的 `origin`、`layout_anchor`、`self_anchor`、`reference_anchor` 是工作流字段，不是 Creator API。对具有 `UITransform` 的渲染 Node，实际锚点由 `UITransform.anchorPoint` 或 `setAnchorPoint(...)` 表达；其 X/Y 是归一化值，Y 从底边向上计。左上原点布局坐标先经过[Cocos 坐标与布局适配](cocos-adapter.md)转换，再写入 Node 局部位置。

- 当合同声明中心锚点时，渲染 Node 使用 `anchorPoint=(0.5, 0.5)`；其他锚点逐对象记录原因，并经 [`cocos-coordinate-adapter.mjs`](../scripts/cocos-coordinate-adapter.mjs) 将左上原点、Y 向下的逻辑布局坐标转换为父节点局部坐标。不得让引擎默认锚点替代已冻结合同。
- 满幅背景、Tilemap 基准或脚底接触点等需要非中心布局时，布局锚点仍与资源/图像内容分开；使用明确的父节点 bounds、UITransform 尺寸/锚点与转换，不逐帧改锚点制造反馈。
- 对纯布局 Node，`origin_applicability=layout-only` 表示没有纹理原点；仍可使用 `UITransform` 表达父矩形与锚点，但不能把布局语义称为资源原点。
- `animation_offset` 是独立表现位移，不覆盖基础布局位置和锚点。帧序列图像须保持统一画布与动作接触点；原生帧动画接入规则见 `cocos-frame-animation`。

## 显示层分层合同

每个场景在 V1 列出实际需要的层和稳定层 ID，按后到前声明可见顺序；无职责的层可以省略。每层的根 Node、Camera/Canvas、坐标空间、滚动、裁切、输入、生命周期和所有者必须明确，不能仅靠创建顺序决定跨父节点或跨 Camera 的最终合成结果。

| 层级职责 | 典型内容 | 关键边界 |
| --- | --- | --- |
| 背景 | 装饰性满幅背景、远景 | 通过已冻结 cover 规则覆盖可见 viewport，不接管世界输入。 |
| 世界后景 | 地图、地面、场景后部遮挡 | 使用世界节点树，与世界 Camera 和滚动一致。 |
| 世界主体 | 玩家、敌人、道具、交互对象 | 玩法对象和命中归属清晰。 |
| 世界前景与特效 | 前景遮挡、粒子、伤害反馈 | 声明与世界主体的前后关系；特效不抢交互。 |
| 场景 UI 与常驻 HUD | 页面、导航、常驻信息和操作 | 放在 Canvas/UI 根下并遵循安全区，不随世界 Camera 意外移动。 |
| 瞬态层 | 遮罩、弹窗、抽屉、Toast | 建立独立 `DISPLAY_LAYER` Work Item；记录输入阻断、焦点恢复和宿主关系。 |

Canvas UI 的同级节点顺序属于同一父节点的 sibling order；确需调整时可使用 Creator `Node.setSiblingIndex(index)`。Camera、父节点或不同渲染根之间的最终合成关系必须由项目配置并通过实际运行核验；同级顺序不能推断跨 Camera 的绘制层级，也不能把布局合同中的局部层级字段当作全局层序。

V2 的 `regions.z_index`、`layout_nodes.z_order` 和 `display_layer_planning.inventory[].z_order` 是合同中的逻辑层序字段，必须映射到已说明的节点/Camera 组织方案。V4 在正式场景检查背景、世界、HUD、遮罩、弹窗和特效的组合，禁止用整屏图片代替结构化节点；验证代表性状态的遮挡、最上层输入、关闭后宿主恢复及 resize 后层序/锚点稳定，并记录候选与合同身份。

官方参考：[Cocos 3.8 2D 渲染对象](https://docs.cocos.com/creator/3.8/manual/en/2d-object/2d-render/index.html)、[UITransform](https://docs.cocos.com/creator/3.8/api/en/class/UITransform)、[Node](https://docs.cocos.com/creator/3.8/api/en/class/Node)。
