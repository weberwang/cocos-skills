---
name: cocos-define-technical-design
description: Use when approved Cocos Creator 2D Web Mobile requirements and game systems need a reviewable architecture decision set, performance budget, accessibility constraints, and implementation control manifest before visual direction and planning.
---

# Cocos 定义技术设计

为已批准的 Cocos 2D Web Mobile 需求和系统设计建立技术蓝图。此阶段只定义可实施边界与决策记录，不写代码、资源、场景或总控状态。

## 输入与边界

只可写入任务分配的 `.cocos-workflow/artifacts/technical-design.yaml`、报告和结果路径。读取总控契约、冻结项目配置、已批准需求、已批准 `systems-design.yaml` 及 [技术设计契约](references/technical-design-contract.md)。

## 流程

1. 验证项目配置、需求和系统设计的批准记录与哈希；任一不一致即返回 `blocked` 或 `stale`。
2. 记录 Cocos Creator 版本约束、场景/模块边界、数据流、事件边界和资源加载策略；边界必须能支撑 MVP 系统，不能以未验证 API 作为前提。
3. 为高风险决策创建 ADR：问题、备选项、选择理由、后果、验证方式和对应系统。记录移动 Web 性能预算、离线/失败恢复、触控与无障碍约束。
4. 形成 `control_manifest`，列出必须遵守与禁止的实现模式，供计划与代码阶段复核。
5. 等待人工明确批准。需求、系统设计或项目配置变化时请求总控使本工件及下游失效。

## 硬门禁

- 未批准的技术设计不得生成视觉方向或实施计划。
- 至少一个 ADR 必须覆盖每个标记为 `high` 的技术风险；未知 Creator API 只能作为待验证风险，不能伪装为已确认能力。
- 不调用 Cocos MCP，不修改运行时代码或 `.cocos-workflow/workflow.yaml`。
