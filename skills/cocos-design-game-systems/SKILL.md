---
name: cocos-design-game-systems
description: Use when an approved Cocos Creator 2D Web Mobile game brief must be decomposed into reviewable, dependency-aware MVP game systems before visual direction, architecture, or implementation planning.
---

# Cocos 设计游戏系统

将已批准需求拆分为可审阅的设计支柱与 MVP 游戏系统。只产出设计证据，不编写 Cocos 场景、资源、脚本或总控状态。

## 输入与边界

只可写入任务分配的 `.cocos-workflow/artifacts/systems-design.yaml`、报告和结果路径。先读取总控的 `workflow-contracts.md`、`state-machine.md`、冻结 `project-profile.yaml`、已批准 `requirements.yaml` 及 [系统设计契约](references/systems-design-contract.md)。

## 流程

1. 校验项目配置与需求的批准状态及内容哈希；缺失、过期或不匹配时返回 `blocked` 或 `stale`。
2. 提炼 3 至 5 条可证伪的 `design_pillars`，每条都必须提供可用于取舍的 `decision_test`，不得以空泛形容词替代。
3. 把可玩核心循环拆为最小 MVP 系统。每个系统说明玩家输入、状态变化、反馈、失败/恢复边界、依赖和可验证验收项；禁止把未确认玩法补成实现细节。
4. 对系统依赖排序，拒绝循环依赖；将 Alpha 或完整愿景内容明确放入 `out_of_scope`，避免混入 MVP。
5. 展示完整提案并等待人工明确批准。批准仅绑定当前 `content_hash`；需求或项目配置变化后必须请求总控使本工件及下游失效。

## 硬门禁

- 未获得人工批准的系统设计，不得进入技术设计或视觉方向阶段。
- 每个 MVP 系统都必须映射至少一个需求验收项，核心循环不得存在未归属步骤。
- 不调用 Cocos MCP，不创建运行时文件，也不改写 `workflow.yaml`。
