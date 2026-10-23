---
name: cocos-game-qa-performance
description: Cocos Creator 3.x 移动端游戏的测试与性能角色。用于功能、参考还原、动态玩法视觉、3D 模型、UI/场景、设备兼容、资源预算、性能、稳定性和发布候选验证，并产出可复现证据。
---

# Cocos Creator 3.x 测试与性能

## 全局控制接入

控制面边界：可提议、可审查、可在当前用户任务的 Work Item 范围内修改，且必须回到 `$cocos-game-workflow-control` 风险门。

本领域可提议验证计划并审查候选，可在当前用户任务、A 等级和路径范围内写测试或证据；结果回到 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 审计和状态迁移。测试通过不能覆盖任务范围、路径、基线或 A4-A6 操作批准失败。

证据优先于主观结论。项目未定义量化指标时只报告实测与决策缺口，不自造通用阈值。

涉及 3D 模型时，按[建模工作流接入](../cocos-game-3d-modeling/references/workflow-integration.md)核对 Blender 几何/拓扑/UV 报告、导出回读、Creator 实际模型与子资源、比例/轴向/Pivot、材质槽、LOD/碰撞、资源级 Prefab 和正式场景消费。以当前项目的预算和实际能力为准；通用资源清单 PASS、导出文件存在或 `.meta` 出现不能代替这些技术验证。转台、线框、UV、LOD 切换与碰撞边界截图供用户人工检查，技术结果和显示确认分别记录；不自动启动真机验收。

游戏内文案按[检查与返修](../cocos-game-ui-layout/references/game-copy.md#检查与返修)核对：效果图生成记录的实际提示词须分开内部说明与可见内容；界面文本配置和绑定须沿用同一表达，涵盖本地化及奖励/消耗/错误等适用状态。效果图冻结前及 V4 正式场景运行中提供重复解释、规格说明、数值归属和必要信息的检查点，显示效果交由用户判断；`copy_style`、字数或构建成功不能代替这项人工结果。

1. 读取 Work Item、用户已明确的调整、质量门、TDD、qa-plan 和当前候选，对所有待验收任务逐一按[实际完成情况](../cocos-game-workflow-control/references/control-model.md#按实际完成情况验收)判断，记录当前要求、实际结果、差异影响和证据。F0 校验任务范围与流程，F1 核对实际功能、交互、公开接口和硬约束；非强制实现细节与早期合同描述不同只记录必要说明，不作为失败，也不要求先回改合同。F2 形成独立 QA 领域结论，F3 绑定实际命令、环境、数据源、文件、判定与未覆盖项；缺少独立审查时标记未验证。
2. 启动服务前检查同一项目、服务类型、模式、端口和健康状态；存在健康实例时复用，不终止归属不明的进程。
3. 视觉任务核对 V0 分流及 V1/V2 条件门。Work Item 指定效果图为还原目标时，QA 按[视觉还原](../cocos-game-asset-integration/references/visual-reconstruction.md)核对冻结视觉目标、对比条件和必要的区域关系；`visual_validation.mode` 默认是 `usability`，允许合理的位置、尺寸、边距和换行差异，重点检查越界、裁切、关键遮挡、不可读和交互失效。effect-image 不自动启用 `exact`；只有用户明确要求精确还原时才使用 `exact` 并核对严格容差与差异证据。
4. 适用 V1 时检查视觉目标、信息层级、草图/灰盒、交互、布局、失败恢复与预算。已有明确冻结事实时按当前模式验证；任务内专业修复、工程适配和资源更新可直接更新计划并重验受影响部分。只有改变产品方向、玩法语义或冻结上游事实时才请求一次 `USER_DECISION`，不把普通细节偏差升级为授权阻塞。
5. 普通资产/布局允许还原 `not-applicable`。效果图在 V2 `v2-ready` 后核对目标、合同回对、带 bounds 的 coverage 和条件编号证据；V3 还必须逐 `annotation_number/region_id` 记录显式 `production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 与 `expected_assets`。V3 实施包的 `visualProductionUnits` 必须与 coverage 一一映射，输出路径、所有权和格式不得冲突。
6. V3 必须提交 `production_contract_audit`，逐区域核对预期方法与实际方法、交付类型、输出文件、生成/提示词记录和运行时消费；F2 只接受 `validationMode=MACHINE` 的当前身份机器验证事实。V4 再要求运行测量、F3 runtime replay、freshness-bound fidelity cases、实际消费和无未批准替换；仅上游事实或当前受影响候选身份变化会使对应旧证据失效，其他单元的路径级结果继续有效，不重复请求无关拆解和布局确认。
   该机器出口仅验证可确定性核对的事实；主题、材质完成度、受众适配和观看舒适由用户按[游戏美术体验与质量契约](../cocos-game-asset-integration/references/art-quality-contract.md)人工确认。代理提供截图/录屏、实测与检查要点，不在未明确授权时自动分析视觉显示效果，也不把机器 PASS 表述为美术验收通过。
7. 同条件截图记录视口、设备像素比、状态、轨迹、语言、随机种子、ROI、验证模式、动态时间采样/稳定帧与遮罩理由。默认 `usability` 使用代表性视口和关键状态，检查可读性、边界、遮挡、交互和关系不变量；完整视口、严格容差、逐区域 delta、叠加/像素差及全视口/全状态矩阵仅在 `exact` 模式或项目明确要求时启用。生成式、动画和 VFX 不得只靠像素差判断。
8. UI 读取 [`cocos-game-ui-layout`](../cocos-game-ui-layout/SKILL.md) 合同，并按 [响应式视觉验证](references/responsive-visual-validation.md) 采集真实稳定帧。默认 `usability` 按 `orientationPolicy.allowed` 覆盖对应代表视口：支持竖屏时包含窄/标准竖屏，支持横屏时包含横屏/桌面宽屏；单方向项目只测该方向，但仍覆盖窄宽尺寸、DPR 1/1.25 或 1.5/2/>2 封顶、同页连续 resize、降至 DPR 1、DPR 不变 resize 和代表性弹窗轨迹。只有 `exact` 或项目明确要求时才扩展到完整断点和状态矩阵，方向轴不扩展到未声明方向。每个视口直接记录 CSS 矩形、Canvas backing、raw/effective DPR、逻辑↔CSS↔物理比例、Camera、输入命中、安全区、关键 UI、截图及 resize 轨迹，不能用推导值冒充实测。正式报告记录候选标识、scene/state、布局合同版本和视觉基线版本；缺测量为 `unverified`，宿主场景证据不能代替独立 DISPLAY_LAYER。
9. V4 检查结构化集成、玩法所有权、低保真零引用、性能峰值和功能契约，并提交动态证据供 F3。修订候选重跑受影响 F0-F3；只有带外部写入、付费、真机、破坏性或外部删除、发布副作用的 A4-A6 操作重跑 F4 批准门。模块边界变化仅有实质取舍时进入 grilling。
   具有动态美术范围时，按 brief 的典型单局/连续游玩情境采集正常操作、高频重复、关键事件和叠加峰值的适用片段，记录事件次数、并发、持续时间、混合与收尾参数，并交由用户检查焦点和舒适度。复用当前健康服务，不自动发起真机验收；静态通过不能推导持续游玩通过，缺少人工结果时记录未验证。
   涉及汁水感时按需参考[事件覆盖与反馈规则](../cocos-game-juice/references/design-guide.md)；QA 核对触发、结果、重复合并、中断、并发、资源生命周期和性能，动态显示、观看舒适度及实际手感继续由用户人工验收。
10. 共享基础完成后验证 Creator 项目启动、Boot/首场景、资源加载和适用插件；关键玩法流完成后在主目标平台验证核心循环与失败恢复；只有最终集成/G3/release 执行完整渠道/平台矩阵。G3/release 候选还按[Creator 生产构建与发布检查](../cocos-game-architecture/references/production-build.md)核验实际 release 构建配置、最终已解包包体中的 Source Map 文件/引用、压缩与注释处理、Feature Cropping 采用结果和构建资源路径；不将生产配置截图当作最终包检查。Creator 编辑器、AssetDB、Scene/Node/Component、Prefab、构建和预览操作按[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)执行。当前 MCP 的运行/构建工具只打开构建面板或报告 worker ready，不表示预览或构建完成；实际运行和构建没有证据时保持 pending/blocked。局部任务证据不得宣称全平台通过，不得自动发起真机验收。

没有可复现证据时标记“未验证”。V1/V2 条件门必须绑定当前候选；沉默、继续工作或旧决定不能替代真正需要的 `USER_DECISION`，用户决定也不能跳过 V2 拆解与布局确认所需的确定性机器 F2。固定宽/固定高模式的声明不证明满屏或响应式重排；禁止用构建面板打开、元素存在或无控制台错误假通过。

可复用自动化脚本位于 `scripts/responsive-visual-validation.mjs`，纯计算测试位于 `scripts/responsive-visual-validation.test.mjs`。脚本通过 Node ESM 动态导入 Playwright；运行时从设备读取 DPR 并按 `dynamic-capped-2` 封顶，在同一页面通过 `setViewportSize` 调整视口并保留 resize 语义；有效声明必须为 `(0,2]`，原始 `deviceScaleFactor` 允许大于 2，报告同时保留原始值与封顶为 2 的有效值，零、负数、非有限数和字符串在验证前失败。默认报告输出代表性视口与关键状态；`exact` 模式或明确的全覆盖需求再输出完整页面截图、实测矩阵和结构化 JSON。
