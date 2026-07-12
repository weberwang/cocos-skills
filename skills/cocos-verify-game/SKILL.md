---
name: cocos-verify-game
description: Use when a Cocos Creator 2D Web Mobile project needs Chrome-based release verification after integration, including every frozen mobile profile, replayable interaction, pixel comparison, and reviewable evidence.
---

# Cocos 验证游戏

验证已集成的 Cocos Web Mobile 游戏，并向 `$cocos-orchestrate-web-workflow` 返回可审计结果。不得修改 `.cocos-workflow/workflow.yaml`、场景、资源、脚本、构建配置或人工门禁；发现缺陷只报告，不自行修复。

## 输入与写入边界

只写入编排任务分配的 `.cocos-workflow/reports/chrome/`、`.cocos-workflow/reports/`、`.cocos-workflow/artifacts/` 和结果路径。先读取总控的 `workflow-contracts.md`、`state-machine.md`、`mcp-safety-policy.md`，再读取 [verification-contract.md](references/verification-contract.md)。

开始前必须读取并校验：

1. `.cocos-workflow/project-profile.yaml` 的冻结哈希、方向、设计分辨率与全部 `capture_profiles`，以及当前 `scene_loop_id`。验证只消费该场景小循环声明的路径、交互和 `exit_checks`；未通过前不得启动下一场景循环。
2. `.cocos-workflow/artifacts/visual-direction.yaml` 的冻结版本与 SHA-256 哈希。
3. `.cocos-workflow/artifacts/capture-manifest.yaml` 的 `status: approved`、批准主体哈希、基线修订和全 profile 覆盖。
4. 编排任务的 `baseline_revision`、允许路径、集成结果、需求验收项及视觉依赖。

任一输入缺失、哈希不一致、审批不完整或基线已过期时返回 `blocked` 或 `stale`，不得开始正式验证。

## Chrome 验证

1. 使用 `chrome:control-chrome` 打开本地预览地址。不得以静态检查、代码推断、桌面截图或其他浏览器替代。
2. 严格逐项执行 capture manifest 的全部 `mobile-small`、`mobile-standard`、`mobile-large` 档位；视口与 `project-profile.capture_profiles` 完全相同。纵屏为 `375x667`、`390x844`、`430x932`，横屏为 `667x375`、`844x390`、`932x430`。
3. 对每个必经场景与核心路径执行可重放的 `open`、触控、导航、重试或返回操作。每次通过、失败或阻塞均记录截图、URL、动作序列、时间戳、控制台日志与网络日志。
4. 用 manifest 指定的批准基线、遮罩和阈值执行像素差比较。记录 changed ratio、pixel threshold、遮罩路径和比较结论；缺少任一项时不得返回 `passed`。
5. 检查方向、裁切、比例、安全区、核心 UI 可读性、视觉方向一致性和需求验收项。将发现分为 P0、P1、P2；P0 立即阻塞，未获批准的 P1 默认阻塞，P2 默认仅报告。不得自行降级 P1 或创建批准。

## 结果与阻塞

报告和结果必须绑定全部冻结输入版本/哈希、capture manifest 哈希、基线修订、所有 Chrome 证据、像素比较、质量汇总、问题和可验证的解除条件。只有每项 profile、必经路径、P0/P1 门禁和证据均通过时才返回 `passed`；总控负责接收结果并推进到 `building`。

Chrome 插件不可用、本地预览不可访问、视口不匹配、截图/基线/遮罩/像素差结果缺失、P0 失败、未批准 P1、关键路径失败、控制台新增未批准错误或必需资源请求失败，均为阻塞。
