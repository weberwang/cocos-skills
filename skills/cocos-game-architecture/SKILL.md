---
name: cocos-game-architecture
description: Cocos Creator 3.x 游戏的技术架构角色。需要划分或评审模块职责、公开契约、状态所有权和依赖方向，建立 Creator 工程结构、场景与组件边界、资源引用或原生平台适配基线时使用。
---

# Cocos Creator 3.x 技术架构

## 全局控制接入

本领域在当前 Work Item、Implementation Package、A 等级和允许路径内提议、审查或修改；结果回到 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 审计和状态迁移。遵循 V0-V4、A0-A6、F0-F4 与 Work Item 的当前控制模型。任务内方案和路径变化同步更新计划并重验受影响部分；只有实质架构取舍才停止并进入 grilling。涉及外部写入、付费、真机、破坏性操作或发布的 A4-A6 行为仍须逐项审批。

## 工程边界

- 以目标项目实际安装的 Cocos Creator 3.x 版本为准，先读取项目 `package.json`、Creator 编辑器版本、`settings/` 和 `profiles/`。目录约定见[游戏项目目录规范](references/project-structure.md)，按 Creator 项目实际结构确定工程入口和依赖。
- Creator 项目运行时资产通常位于 `assets/`：场景、预制体、脚本、纹理、音频和数据配置由项目约定分层。Creator 导入的资源由 AssetDB 管理，并通过 `.meta` 中的 UUID 建立稳定引用；引用前核验导入结果和所需子资源。不要手工伪造 UUID 或只凭文件路径存在判断资源已就绪。
- 运行时结构由 `Scene`、`Node`、`Component`、`Prefab` 和资源引用组成。职责放在组件和模块中，场景保留清晰节点树；复用时使用预制体或共享服务。
- 维护模块职责与依赖方向：玩法规则和状态、表现配置、资源加载、音频、平台适配和第三方服务分别有明确所有者。Scene 之间通过已声明的服务或数据契约协作，不直接依赖其他 Scene 的私有节点和状态。
- 实际采用的第三方 SDK 初始化统一遵循[SDK 统一初始化](references/sdk-initialization.md)：唯一应用装配入口调用 `assets/scripts/platform/initialize-sdks.ts` 独立投递任务；启动场景/最小 Boot 组件只做应用装配，不承载场景玩法初始化，也不等待 SDK 完成。Creator 引擎和 AssetDB 保持自身生命周期，不放进第三方 SDK 初始化模块。
- 资源候选、确认成果、Creator 正式资源、审阅证据和机器记录按[产物存放与证据边界](references/artifact-storage.md)归档。新建或调整发布构建、准备发布候选时按[生产构建与发布检查](references/production-build.md)核对 Creator 版本对应的有效配置与最终包。
- 用 Creator 编辑器、AssetDB、构建配置和目标平台验证工程行为。Web、小游戏和原生平台的能力分别按项目实际构建目标核对。

## 场景、资源与编辑器写入边界

- Scene、Node、Component、Prefab、AssetDB 和构建相关操作必须遵循[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)，按当次 `tools/list` 的 schema 调用；不得手写 `.scene`、`.prefab` 或 UUID 绑定。对同一编辑器项目保持唯一活动写入者。
- 对一批写入 `assets/` 的原始资源，先完成整批文件写入，再调用 AssetDB refresh 并等待 `.meta` 就绪。refresh 成功只证明 sidecar 文件已出现，不代表导入有效、资源未 invalid、子资源可用或脚本已编译。
- 继续用协议列出的 `project_get_asset_info({assetPath})` 和 `project_query_asset_uuid({url})` 核验资源类型、状态及 UUID；子资源通过只读 sidecar 查询，找不到可用查询工具时停止绑定并报告缺口。含脚本时等待 Creator 正常编译，再从控制台/项目日志核验相关错误；`component_attach_script` 不是编译器。
- 保存 Scene 或 Prefab 后立即读回目标节点、组件、属性和资源引用，并对照实施包断言。MCP 工具成功返回、文件存在或日志为空都不足以单独证明持久化、编译或运行完成。

## Cocos 表现与平台边界

- 2D 渲染对象使用 Creator 的 `Node` 与相应渲染组件；需要 UI 几何时通过 `UITransform` 管理尺寸和锚点。`Canvas` 是 UI 根，`Widget` 表达相对父节点或 Canvas 边界的对齐约束；世界空间由场景节点和 `Camera` 组织。具体组件、坐标空间和序列化字段以项目锁定版本的 Creator 文档为准。
- UI 同级顺序应通过节点树顺序和项目明确采用的排序配置实现；跨 Camera 或世界/UI 层的合成必须在 TDD 中说明。

## 原生平台插件选型

- 按顺序复用项目现有原生实现、Creator 或提供方官方方案，再评估维护状态、Creator/Android/iOS 版本支持及许可证适用的社区方案；只有确认存在明确能力缺口时才自建或扩展插件。
- 选型和实现前锁定 Creator 与 Android/iOS 工具链版本，并核验所需权限、宿主生命周期、线程约束、构建方式和失败语义。平台接口必须明确报告 Web/小游戏不支持，不得伪造或模拟原生能力。
- 新增原生能力时先检查项目已有 Creator 原生插件和适配层。Creator 的 JSB `native.bridge` 在官方支持的环境中可用作 JS/native 消息桥；桥接负载按目标版本的官方接口约束编码，原生侧 SDK 调用、线程与生命周期责任由插件适配层承担。它不是 AppLovin 或其他 SDK 的通用 JS API，也不应绕过业务契约。
- 仅在明确能力缺口时实现或扩展原生插件，并记录目标平台、Creator 版本、权限、生命周期、失败语义和验证范围。广告、Spine 等领域按各自 Skill 合同管理，不在架构 Skill 中虚构第三方插件 API。

## 执行与交接

Creator 编辑器写入、AssetDB、场景、节点、组件、Prefab、构建和预览都经[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)路由；MCP 当前只能打开构建面板或报告 worker ready 时，实际构建/预览保持 pending/blocked，不得记录为成功。

1. 读取 Work Item、用户明确要求、项目版本、目录规范、模块审计、依赖能力档和服务边界。按 F0-F4 提交范围、规格映射、架构结论、工程验证和集成/发布决策；不自行改变全局状态。
2. 实现前为每个模块记录职责与非目标、公开输入/输出、状态所有权、生命周期、允许/禁止依赖、失败边界、测试和所有者。新模块先确认目标边界和项目事实，只有实质取舍才进入 grilling。
3. 在技术设计中标出共享模块、场景模块、Scene/Prefab/Component 所有权和跨场景依赖。基础包只提供启动、生命周期和公开契约；具体场景玩法、UI 和正式可见资产在其对应场景任务内完成。
4. UI 采用 [`cocos-game-ui-layout`](../cocos-game-ui-layout/SKILL.md) 的布局合同。分别记录 UI 的 Canvas/`UITransform`/`Widget` 关系、世界空间 `Camera`、输入坐标、安全区、设计分辨率策略、方向和运行证据。布局锚点、节点锚点和动画表现偏移分开维护。
5. 先复用项目依赖与 Creator 能力。新增依赖需记录启用原因、版本、维护/许可、性能和平台风险、验证命令及所有者；未被需求触发的能力不预装。
6. 定义本地验证进程的项目身份、模式、主机/端口和健康检查。启动 Creator 预览或其他长驻验证进程前，先查找并复用同项目健康实例；身份不明的进程不停止。
7. 基础模块完成后验证 Creator 预览或构建、Boot/首场景、AssetDB 资源就绪及适用平台插件；局部证据不宣称全平台通过，也不自动发起真机验收。

向玩法和 UI 交接组件/服务入口、资源引用方式、所有权与测试范围；向 QA 交接 Creator 版本、目标构建平台、复现步骤、日志位置和未覆盖项。新增或修改的类、函数和实体定义须添加简体中文注释，说明不直观的边界或设计原因。
