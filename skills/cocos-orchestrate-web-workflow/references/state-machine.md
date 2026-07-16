# 状态机

## 常规迁移

```text
bootstrap → requirements → systems-design → technical-design → visual-direction → scene-concepts → planning → production → integration → verification → building → delivery → completed
pending → running | blocked
running → passed | failed | blocked
failed → retrying | blocked
retrying → running | failed | blocked
passed → stale
stale → pending
blocked → pending | running
```

正常主状态只前进一个阶段；同一主状态使用运行状态迁移。每条迁移必须包含 `from_state`、`to_state`、`from_run_status`、`to_run_status`、`timestamp`、`reason`、`evidence`，与上一条连续，最后一条等于当前状态。

## 决策变更拷问门禁

`grilling` 不是主状态。仅在已批准的 `requirements`、`systems-design`、`technical-design` 或 `planning` 发生决策性返工时，总控将该阶段置为 `blocked` 并派发只读 `$grilling` 任务。事实勘误、文案、资产、实现、验证与交付不适用。

`$grilling` 返回与 `decision_change` 同阶段、同 `subject_hash` 的明确用户确认后，总控才可写入 `approval_gates.grilling-<stage>`，并按 `blocked → pending` 重派发目标阶段。门禁缺失、未确认或哈希不匹配时，不得进入 `running`，也不得接受目标阶段工件。该门禁不替代阶段工件的哈希绑定人工审批。

## 上游失效回退

非 `completed` 阶段发现上游变化时，总控必须调用 `invalidate_artifacts.py`，不得把旧结果继续标为 `passed`：

1. 计算变化工件及所有依赖它的下游工件；保留元数据并将其 `status` 设为 `stale`。
2. 写入项目内 `.cocos-workflow/reports/invalidation-<id>.yaml`，其中包含变化/失效工件、最早回退阶段、清除的任务和门禁；两条迁移都必须以该安全相对路径作为 `evidence`。
3. 若当前运行状态不是 `stale`，先以 `reason: upstream-change` 迁移到当前主状态的 `stale`。随后以 canonical 回退 `reason: upstream-change` 从当前主状态/`stale` 迁移到最早受影响主状态/`pending`。
4. 将失效任务重置为 `pending`，从活动/已完成索引移除，删除这些任务的 `results/<task_id>.yaml`，并移除对应产物批准门禁；`project-configuration` 根门禁不得删除。
5. 在 `workflow.invalidated` 追加同一审计事实。新任务只能在回退阶段重新执行并获得新的工件哈希和人工批准后再前进。

回退阶段按以下顺序取最早值：`requirements`、`systems-design`、`technical-design`、`visual-direction`、`scene-concepts`、`planning`、`production`、`integration`、`verification`、`building`、`delivery`。Pencil 草图和场景效果图属于对应 `scene_loop` 的 production 工件。工件必须显式声明 `stage`；未声明且不能从规范别名解析的工件会阻塞回退。

## 阶段门禁

| 主状态 | 进入条件 | 退出工件与门禁 |
| --- | --- | --- |
| `bootstrap` | 方向、分辨率、Creator 版本和批准者已冻结 | `project-profile.yaml` 哈希与项目配置门禁一致，且 MCP 能力快照可用 |
| `requirements` | 项目配置门禁通过 | 需求工件、验收项和人工批准 |
| `systems-design` | 需求已批准 | `artifacts/systems-design.md` 的 MVP 系统、设计支柱、哈希和人工批准 |
| `technical-design` | 系统设计已批准 | `artifacts/technical-design.md` 的 ADR、性能/无障碍约束、哈希和人工批准 |
| `visual-direction` | 需求、系统设计与技术设计已冻结 | `artifacts/visual-direction.md` 的版本、哈希、两张参考效果图和人工批准 |
| `scene-concepts` | 视觉方向版本/哈希匹配 | 场景效果图、生成记录和人工批准 |
| `planning` | 场景概念已批准 | `implementation-plan.md`、`capture-manifest.yaml`、每场景 Pencil/高保真任务、单编辑器写者和人工批准 |
| `production` | 计划已批准且任务路径不冲突 | 先完成核心玩法原型并获垂直切片人工批准，随后才允许模块拆分/全局骨架与正式 scene loops；每个正式 scene loop 的已批准 Pencil 草图与高保真效果图、代码产物和 `game-assets.yaml`；核心玩法场景推进到正式循环时必须按正式版本实现；资源清单必须获人工批准才能进入绑定/导入 |
| `integration` | 生产汇合门禁通过 | 唯一 Cocos 写者的导入、绑定和读回证据 |
| `verification` | 集成结果有效 | Chrome 对全部冻结 mobile profiles 的截图、交互、基线和像素差证据 |
| `building` | 验证门禁已批准 | 成功构建日志、产物清单和哈希 |
| `delivery` | 构建产物未失效 | 本地交付包、运行说明和人工批准 |

`bootstrap` 的 `pending | running | blocked` 可使用 `initial_scene: null`；`bootstrap/passed` 或任何后续阶段必须使用安全的项目相对 `.scene` 路径。Cocos Creator 必须为正式三段版本且不低于 `3.8.6`。每批 Cocos Editor 写入后必须读回验证，才可释放唯一写入权。
