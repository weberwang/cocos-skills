---
name: cocos-verify-game
description: Use when a Cocos Creator 2D Web Mobile project requires a completely human-run verification, including manual editor-preview playthrough, human judgement, and reviewable evidence.
---

# Cocos 验证游戏

验证已集成的 Cocos Web Mobile 游戏，并向 `$cocos-orchestrate-web-workflow` 返回可审计结果。不得修改 `.cocos-workflow/workflow.yaml`、场景、资源、脚本、构建配置或人工门禁；发现缺陷只报告，不自行修复。

## 输入与写入边界

只写入编排任务分配的 `.cocos-workflow/reports/human-review/`、`.cocos-workflow/reports/`、`.cocos-workflow/artifacts/` 和结果路径。先读取总控的 `workflow-contracts.md`、`state-machine.md`、`mcp-safety-policy.md`，再读取 [verification-contract.md](references/verification-contract.md)。当任务指定 `verification_mode: vertical-slice` 时，还必须读取 [垂直切片验证契约](references/vertical-slice-contract.md)。

开始前必须读取并校验：

1. `.cocos-workflow/project-profile.yaml` 的冻结哈希、方向、设计分辨率、`initial_scene` 与全部 `capture_profiles`，以及当前 `scene_loop_id`。验证只消费该场景小循环声明的路径、交互和 `exit_checks`；未通过前不得启动下一场景循环。
2. `.cocos-workflow/artifacts/visual-direction.md` 的冻结版本与 SHA-256 哈希。
3. `.cocos-workflow/artifacts/capture-manifest.yaml` 的 `status: approved`、批准主体哈希、基线修订和全 profile 覆盖，以及每个正式场景已批准的 `artifacts/scene-boundaries/<scene_id>.md`。
4. 编排任务的 `baseline_revision`、允许路径、集成结果、需求验收项及视觉依赖。

任一输入缺失、哈希不一致、审批不完整或基线已过期时返回 `blocked` 或 `stale`，不得开始正式验证。

## 人工验证

1. 读取 capture manifest 的 `review` 字段，为人工审核者生成逐 profile、逐路径的审核清单；清单必须完整保留人工操作、预期观察、截图/日志、基线和像素差要求，但不得自行执行其中任何操作。
2. 人工审核者在 Cocos Creator 编辑器中手动启动预览，并逐项完成 `mobile-small`、`mobile-standard`、`mobile-large` 的操作、截图、日志导出、像素比较和可玩性判断。审核清单必须覆盖每个场景边界工件的 `acceptance_ids`、玩家动作、边界条件和明确非范围；审核者必须记录实际使用的初始场景、时间、设备/视口、操作步骤、观察结论、问题等级和项目内证据路径。
3. 本 Skill 只校验人工审核记录的完整性、路径安全性、冻结输入哈希和批准主题哈希；不得启动编辑器预览、调用 Cocos MCP、调用 Chrome、截图、执行交互、比较像素、判断视觉质量或代替人工签署结论。
4. 人工审核者明确确认全部必经项目通过后，才可将验证工件设为 `passed` 并写入其身份、时间和与 `content_hash` 相等的 `approval.subject_hash`。任一缺失、失败、未决问题或未签署结论保持 `pending` 或 `blocked`。

## 垂直切片子门禁（核心玩法优先）

当 `verification_mode: vertical-slice` 时，仅由人工审核实施计划 `vertical_slice.scene_ids` 中的最小核心玩法路径，并确认玩家可完成 `start → challenge → resolution`。此审核针对**原型可玩确认**，不要求 Pencil/高保真正式设计证据。人工必须在编辑器预览中试玩，记录全部冻结手机 profile 的操作、三段截图、像素差、运行日志和签署结论；本 Skill 仅核验记录完整性并写入 `artifacts/vertical-slice.md`。

工件在未获得明确人工批准前保持 `pending`。只有 P0/P1、三档 profile、核心循环和试玩证据全部通过，且 `approval.subject_hash` 绑定当前 `content_hash` 时，才可设为 `passed`。总控在接收该工件前不得调度模块拆分、全局骨架或正式场景循环；核心玩法场景在后续 `is_core_gameplay` 正式循环中仍须按正式版本重新实现与验证。最终验证仍需覆盖整个游戏，不能由切片替代。

## 结果与阻塞

报告和结果必须绑定全部冻结输入版本/哈希、capture manifest 哈希、基线修订、人工审核记录、人工提供的截图/日志/像素比较、质量汇总、问题和可验证的解除条件。只有人工审核者签署每项 profile、必经路径、P0/P1 门禁和证据均通过时才返回 `passed`；总控负责接收结果并推进到 `building`。

审核者缺失、人工预览/操作记录缺失、视口不匹配、截图/基线/遮罩/像素差结果缺失、P0 失败、未批准 P1、关键路径失败、控制台新增未批准错误、必需资源请求失败或人工结论未签署，均为阻塞。垂直切片还会在缺少核心循环三段证据、试玩证据、计划哈希匹配或人工批准时阻塞。
