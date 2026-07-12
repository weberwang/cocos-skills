---
name: cocos-verify-game
description: Use when a Cocos Creator 2D Web Mobile project needs browser-based release verification after integration, including Chrome mobile screenshots, interaction checks, frozen orientation checks, P0-P2 quality findings, and reviewable evidence.
---

# Cocos 验证游戏

验证已集成的 Cocos Web Mobile 游戏，并向 `cocos-orchestrate-web-workflow` 返回可审计的结果。不得修改 `.cocos-workflow/workflow.yaml`、场景、资源、脚本、构建配置或任何人工门禁。

## 写入边界

只写入编排任务明确分配的 `.cocos-workflow/reports/chrome/`、`.cocos-workflow/reports/`、`.cocos-workflow/artifacts/` 和结果路径。`workflow.yaml` 只能由总控写入。只读检查 Cocos 项目；发现缺陷时报告，不自行修复。

不得自行批准视觉验证、P1 豁免或交付。不得把截图基线、验收条件、冻结方向、设计分辨率或视觉方向替换为新值。

## 验证流程

1. 读取总控的 `workflow-contracts.md`、`state-machine.md`、`mcp-safety-policy.md`，再读取 [verification-contract.md](references/verification-contract.md)。确认任务的 `baseline_revision`、`allowed_paths`、依赖、验收项和结果写入路径。
2. 读取 `project-profile.yaml`、`workflow.yaml`、集成结果、需求验收项和冻结的 `art/visual-direction.yaml`。核对项目配置哈希、视觉方向 `version` 和 `sha256:` 内容哈希；任一项缺失或不匹配即返回 `blocked` 或 `stale`，不得启动正式验证。
3. 使用 `chrome:control-chrome` 打开本地预览地址。按冻结 `orientation` 选择对应手机 CSS 视口：纵屏 `375x667`、`390x844`、`430x932`；横屏 `667x375`、`844x390`、`932x430`。记录所用档位与实际视口，不得用桌面截图替代。
4. 在每个必经页面和核心路径执行可重放交互：首场景加载、开始/重试/返回等需求定义的动作、页面转换、触控目标和安全区。每个通过或失败结论都保存 Chrome 截图、页面地址、动作序列、控制台/网络观察和时间戳。
5. 对截图依次检查冻结方向、画面裁切、比例/安全区、核心 UI 可读性、视觉方向一致性及需求验收项。将问题分为 P0、P1、P2；P0 立即阻断，P1 默认阻断，P2 默认仅报告。不要自行把 P1 降级或标记为已接受。
6. 写入报告和任务结果：绑定所有输入版本与哈希、列出检查、截图和日志证据、未解决问题及解除条件。只有结论、证据和输入完全匹配时才返回 `passed`；总控负责接收结果和推进状态。

## 阻断规则

- Chrome 插件不可用、无法连接本地预览、截图缺失、手机视口与冻结方向不一致，均为阻断。
- P0 失败、未获批准的 P1、关键路径无法完成、控制台新增未批准错误或必需资源请求失败，均不得通过。
- 代码、资源、场景、需求、项目配置或视觉方向较任务基线发生变化时，旧报告为 `stale`；重新验证前不得复用。
- 未经明确人工批准，不得创建或更新视觉验证门禁，更不得把流程推进到 `building`。

## 交接

结果必须满足总控结果契约：携带 `task_id`、`baseline_revision`、冻结输入版本/哈希、`changed_paths`、产物、检查、证据、问题及 `handoff_notes`。`passed` 必须有非空 Chrome 证据；有任何 P0 或未批准 P1 时返回失败或阻断结果。
