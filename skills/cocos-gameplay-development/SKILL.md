---
name: cocos-gameplay-development
description: Cocos Creator 3.x 移动端 2D 游戏的玩法开发角色。用于依据 GDD、TDD、数值设计、参考输入实现、还原、重构或验收核心循环、场景、交互、状态与可测试功能，并与美术协作完成正式视觉集成。
---

# Cocos Creator 3.x 玩法开发

全局阶段、视觉硬门和场景前置以[控制模型](../cocos-game-workflow-control/references/control-model.md)、[状态、阶段与停止门](../cocos-game-workflow-control/references/state-gates.md)及对应 Schema 为准。本领域只负责玩法规则、状态、交互和动态验收；场景使用同一 Work Item 的 V1→V2→V3→V4 链，V2 的拆解与布局确认分别执行。

## 全局控制接入

控制面边界：可提议、可审查、可在当前用户任务的 Work Item 范围内修改，且必须回到 `$cocos-game-workflow-control` 审计和状态迁移；仅涉及外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作请求批准。

本领域可提议、审查，并在当前用户任务、冻结 Implementation Package、A 等级与路径范围内修改；任何实现前运行 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) preflight，实施后执行 diff-audit 与 evidence-check，再回总控审计和状态迁移；仅涉及外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作请求批准。

## 所有权

玩法独占玩法规则、状态、碰撞、交互代码、功能灰盒和低保真清理。美术可以拥有纯表现层资源配置、布局/表现预制数据和视觉集成调整，但不得改变玩法规则、碰撞语义或状态所有权；V4 由玩法与美术协作完成运行态联合验收。发现职责、公开契约、状态所有权或依赖方向变化时停止受影响实现，返回模块审计和风险触发的专业审核；只有仍存在受保护取舍时 grilling。

涉及汁水感或动态反馈时按需参考[汁水感设计指南](../cocos-game-juice/references/design-guide.md)。玩法继续拥有规则结果、碰撞、状态及反馈触发条件；击退、顿帧或输入窗口等会改变实际玩法的行为仍由玩法定义和验收，纯表现偏移不覆盖玩法状态。

## 实现

玩家可见内容遵守[游戏内文案](../cocos-game-ui-layout/references/game-copy.md#资源拆解与界面实现)：正式界面只绑定当前场景/状态的可见表达、短标签/本地化键与动态数值，不直接显示 GDD/brief 的规则段落、功能描述或验收字段。此规则覆盖无效果图路径、HUD、按钮、弹窗、Toast 和奖励浮字；必要引导与操作后果按已定义条件保留。

1. 读取 GDD、TDD、控制面、总控的审核漏斗和游戏实现规则。视觉任务同时读取视觉质量门、玩法视觉契约；UI 读取 [`cocos-game-ui-layout`](../cocos-game-ui-layout/SKILL.md)；参考还原读取视觉还原规则。
2. 按当前场景 Work Item 的阶段门推进玩法交付：V1 冻结功能规格与必要灰盒，V2 冻结拆解和布局事实，V3 验收正式资源，V4 直接消费 V2/V3 产物实现正式 `SCENE`/`DISPLAY_LAYER`，并完成功能与视觉联合验收。foundation-only 的基础能力和跨场景 `INTEGRATION` 由控制面计划调度；本领域不得把玩法实现提前放入基础包或另建场景生命周期。
3. 对当前场景明确可观察玩家行为、状态迁移、时序、反馈、成功/失败和异常恢复。截图无法证明的行为标为待定义，不自行推断。
4. 只在 V1 需要证明结构、交互或节奏时建立隔离的可运行灰盒，记录稳定 ID、层级、交互区和资源依赖。已冻结结构不为形式重复灰盒；灰盒不得作为场景完成证据。
5. foundation-only 阶段先完成场景无关的 `SHARED`/`MODULE`；V2 布局确认与 V3 资源验收通过后，直接在 V4 启动正式 SCENE 代码。场景实现只闭环玩法、正式资源、场景自有 UI/常驻 HUD、清理和场景证据。modal/popup 等弹窗必须拆为独立 DISPLAY_LAYER Work Item，读取自己的 V2/V3 证据并在自身 V4 验收；弹窗不属于大厅或其他宿主场景实现，也不阻断其验收。`hostSceneId` 仅用于公开接口和运行上下文接线。
6. 只使用绑定当前 `scene_id` 或合规 `shared` 且 V3 `accepted` 的资源进入正式功能实现。用独立 Node、Component、Prefab 和命名节点层组织场景，按[显示节点锚点与层级](../cocos-game-ui-layout/references/display-object-layering.md)显式设置渲染节点的 `UITransform.anchorPoint`，逐对象记录非中心例外及坐标转换，并声明背景、世界、特效、HUD 与瞬态层的合成顺序和输入归属；UI 从 [`cocos-game-ui-layout`](../cocos-game-ui-layout/SKILL.md) 布局合同计算，区分左上布局坐标、Creator 锚点局部坐标、父子停靠与动画偏移，并在视口、安全区、方向、状态和内容变化后通过唯一入口幂等重排。普通测试验证关系不变量，不把绝对屏幕坐标当作通用验收标准。
7. 在 V4 与美术重放动态可玩轨迹，检查识别、预警、命中/受击/奖励反馈、遮挡、响应式、性能和功能契约。忠实还原在冻结目标视口/状态提供同条件完整 viewport 并更新逐状态、逐区域忠实度矩阵，其他视口验证布局关系不变量；玩法处理规则/交互失败，美术处理纯表现失败，跨域问题进入 F3。
8. 正式结构通过后，玩法清除低保真代码、纹理键、资源、fallback 和运行时引用，重新执行测试与生产构建。场景功能、资源、接入、场景自有显示层、占位清理和验证关闭后即可标记当前场景完成；独立弹窗另行验收。

## 证据

截图对比记录相同视口、设备像素比、状态、操作轨迹、语言、时间点、ROI、预先定义的项目容差、稳定帧和遮罩说明。完整 viewport 为主证据，ROI、叠加和像素差仅作补充；生成式内容、动画和 VFX 不得只靠像素差判断。未解释或超容差差异、缺同条件双方证据、缺已批准例外或仅凭主观结论不得报告完成；源码、固定坐标、类型检查、构建成功和元素存在只能证明结构或工程状态。

F0 只校验任务范围与流程，F1 核对既定规格，F2 由非作者验证玩法领域质量，F3 绑定当前候选工程证据，F4 只做带副作用的 A4-A6 集成/发布操作批准。行为或验收变化建立 Change Request 并记录用户决定。新增或修改的类、函数、实体及复杂逻辑使用简体中文注释。

Creator 编辑器、AssetDB、Scene/Node/Component、Prefab 和构建操作必须遵循[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)，并先读取 `tools/list` 返回的实时 schema；不得手写 `.scene`、`.prefab` 或 `.meta` 绑定。资源刷新完成、脚本挂载或构建面板打开都不能单独证明资源导入、编译或构建成功；按协议做有界 UUID/子资源查询、读回检查和控制台错误核验。工具没有实际构建/预览能力时，相关运行结论保持 pending/blocked。
