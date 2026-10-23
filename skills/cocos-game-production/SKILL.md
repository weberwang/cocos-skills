---
name: cocos-game-production
description: Cocos Creator 3.x 移动端游戏制作与策划角色；将游戏构想、参考证据和运行观察转换为可实现、可验收的中文 GDD 与领域交接物。
---

# Cocos Creator 3.x 制作策划

本 Skill 只负责制作领域提议、需求边界、功能契约、验收条件和交接物。它在 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 的 Work Item、当前用户任务和 A 等级范围内工作，并把审查结论回到控制面；不替代人工决策，不拥有状态或审批账本。

## 最短流程

1. 读取 Work Item、当前任务说明、项目配置、GDD 和适用参考证据；以 F0-F4 质量门整理最小事实。
2. 把当前任务范围拆成玩法/支持场景、玩家行为、状态迁移、依赖、正式资源边界、异常恢复和可观察验收结果；资源目录与 `resources.load/loadDir` 动态加载边界遵循[项目目录规范](../cocos-game-architecture/references/project-structure.md#资源与引用)，无法从静态证据判断的行为明确标为待定义。
   确定功能和拆分场景时，按[功能与场景阶段的共享规划](../cocos-game-asset-integration/references/asset-production-routes.md#功能与场景阶段的共享规划)在现有 GDD/场景资源规划中总结共用资源或局部部件，记录消费场景/显示层、状态、尺寸、共同视觉要求、需保留的差异与理由。已明确同一部件时可提前规划共享；仅功能相同、视觉相似或外观未定时保持候选，交给后续视觉拆解与正式产物复核。
3. 在 GDD 保持核心循环、全量场景清单、功能契约、验收条件和“需求 → 功能 → 模块 → 场景 → 资源 → 测试证据”追踪；把渠道优先级和能力开关写入项目配置。
   具有视觉设计范围的任务同时按[游戏美术体验与质量契约](../cocos-game-asset-integration/references/art-quality-contract.md)交接项目主题、受众及依据、体验目标、观看情境、核心注视区域和三层反馈意图，写入结构化美术 brief。MDA 的体验目标用于关联玩法与美术，不以“高级、震撼”代替具体目标；未验证的玩家偏好如实标记，后续用目标玩家反馈复核。
   按[游戏内文案](../cocos-game-ui-layout/references/game-copy.md#工作流接入)在现有 GDD/场景规格中分开内部规则与玩家可见表达，交接图标/图片、数值格式与来源、允许的短标签（可为空）及显示条件；同一表达供美术 brief、效果图与实现复用，不把规格解释直接交给界面。
   只有任务明确涉及汁水感/动态反馈，或核心事件在现有规格中缺少清楚反馈语义时，才按需参考[汁水感设计指南](../cocos-game-juice/references/design-guide.md)；制作在既有 GDD/功能契约中确定表现意图与关键事件，不要求另建文档。
4. 尚未完成的需求、产品行为或范围发生真实变化时提交 Change Request，记录影响模块、风险、新验收和必要用户决定；用户已明确提出且实际已完成的调整在 Work Item 或决定记录中关联原文与结果，不追补合同修订作为验收前置。任务内方案和路径调整直接更新计划并重验受影响部分；仅真实改变后续依赖的范围、公开接口或硬约束时更新对应契约。

## 领域边界

- 涉及正式 3D 模型时，按[建模工作流接入](../cocos-game-3d-modeling/references/workflow-integration.md)在既有 GDD/场景资源规划中交接模型用途、机位与观看距离、参考尺寸、交互体积、视觉基线、面数/材质/LOD 预算和验收条件；交给建模领域形成可执行规格，不能把灰盒或材质效果当作正式模型完成。贴图、绑定和动画只有明确属于任务范围时才另行安排。
- 本领域可以提议和审查需求，也可以在当前任务路径内修改规格；A3 实施包由控制面冻结后再交给 implementer。
- 所有任务逐一按[实际完成情况](../cocos-game-workflow-control/references/control-model.md#按实际完成情况验收)验收；满足当前要求的任务不因中途实现调整而回改 GDD 或合同。未满足的要求应修复实际交付，不能修订合同降低验收标准。
- 无副作用本地 A4 集成可按当前任务执行；外部写入、付费、真机、发布、破坏性或外部删除等 A4-A6 操作只能由控制面建立精确 pending 并等待显式批准，本 Skill 不执行这些动作。
- 效果图或参考图只有在当前场景被指定为正式运行视觉目标时才进入视觉合同；适用时按同一场景 Work Item 的 V1→V2→V3→V4 证据链推进，不创建第二条生命周期。阶段与硬门以[控制模型](../cocos-game-workflow-control/references/control-model.md)和[状态、阶段与停止门](../cocos-game-workflow-control/references/state-gates.md)为准。
- 全局静态基线、场景方向和高保真证据由控制面统一校验；本领域只提供体验意图、功能事实和范围，不用文字或根摘要替代机器证据。

## 交接与收敛

制作输出只保留当前 Work Item 的状态包、GDD/契约路径、验收边界、风险、未覆盖项和下一门。事实足够且无实质取舍时停止探索；问题按 `repair`、`revalidate` 或必要的最小范围 `return` 处置，并回到控制面运行 `check`/`run`。
