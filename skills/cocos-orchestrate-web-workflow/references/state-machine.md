# 状态机

## 允许迁移

```text
bootstrap → requirements → visual-direction → scene-concepts → planning
planning → production → integration → verification → building → delivery → completed
pending → running | blocked
running → passed | failed | blocked
failed → retrying | blocked
retrying → running | failed | blocked
passed → stale
stale → pending
blocked → pending | running
```

除上述边外不得迁移。`run_status` 的故障、阻塞与失效迁移附着于当前主状态；恢复后继续原主状态。人工门禁的批准必须绑定对应工件版本与哈希。

## 主状态规则

| 状态 | 进入条件 | 退出证据 | 人工门禁 | 下游失效范围 |
| --- | --- | --- | --- | --- |
| `bootstrap` | 总控获得人工确认的方向、分辨率、Creator 版本和批准者；原子初始化或恢复状态目录 | `project-profile.yaml` 内容哈希有效、项目配置门禁绑定相同哈希、Cocos Creator 正式三段版本 `>= 3.8.6`、MCP 能力快照 | 项目配置（初始化 CLI 调用即表示已批准） | `requirements` 至 `completed` |
| `requirements` | 项目配置门禁已批准 | 需求工件、验收检查、批准记录 | 需求 | `visual-direction` 至 `completed` |
| `visual-direction` | 需求已冻结 | 带 `version` 与 `content_hash` 的冻结视觉方向 | 视觉方向 | `scene-concepts` 至 `completed` |
| `scene-concepts` | 视觉版本与哈希匹配 | 场景效果图、生成记录、匹配的输入哈希 | 场景效果图 | `planning` 至 `completed` |
| `planning` | 场景效果图已批准 | 实施计划、任务依赖、路径所有权和验收检查 | 实施计划 | `production` 至 `completed` |
| `production` | 计划已批准且任务路径无冲突 | 资源/代码产物、检查、变更清单 | 无 | `integration` 至 `completed` |
| `integration` | 生产产物通过，已取得唯一编辑器写入权 | 场景读回、资源绑定证据、保存后的检查 | 无 | `verification` 至 `completed` |
| `verification` | 集成证据有效且 Chrome 验证环境可用 | 视觉与交互检查、截图/日志、缺陷结论 | 视觉验证 | `building` 至 `completed` |
| `building` | 视觉验证已批准，构建配置有效 | 成功构建日志、产物清单及哈希 | 无 | `delivery` 至 `completed` |
| `delivery` | 构建产物通过且未失效 | 本地交付包、运行说明、最终检查 | 交付 | `completed` |
| `completed` | 交付门禁已批准，所有必需证据有效 | 最终审计记录 | 无 | 无；任一上游变化时退回相应 `pending` |

## 硬规则

- `project-profile.yaml` 的 `status` 不是 `frozen`、批准者或冻结时间为空、内容哈希错误，或项目配置门禁未绑定相同哈希时，不能离开 `bootstrap`；修改配置后必须同步重算哈希并更新门禁绑定。
- `bootstrap` 的 `pending | running | blocked` 阶段允许 `initial_scene: null`；`bootstrap/passed` 或离开 `bootstrap` 后必须提供安全的项目相对 `.scene` 路径，禁止绝对路径与 `..`。
- 离开 `bootstrap` 或将其标为 `passed` 前，必须保存根为映射且含非空 `tools` 或 `capabilities` 的 `reports/mcp-capabilities.json`。
- 每条迁移必须使用 canonical 七字段、与前条连续，并回放到当前 `state/run_status`；主状态只能按表中顺序前进一步。
- Cocos Creator 版本必须按语义版本比较满足 `>= 3.8.6` 才能离开 `bootstrap`；检测到更低版本时必须将当前运行标记为 `blocked`，记录升级到 3.8.6 或更高版本这一解除条件，且不得继续下游动作。
- 视觉版本或哈希不匹配时拒绝汇合，将结果由 `passed` 标记为 `stale`，再置相关任务为 `pending`；不得向下游迁移。
- 代码、资源、场景或构建配置变化后，旧验证或交付产物不能继续保持 `passed`。至少将 `verification`、`building`、`delivery` 和 `completed` 相关结果标记为 `stale`，再置待重跑项为 `pending`。
- 配置、需求或视觉方向变化时，按表中范围递归失效所有下游工件、批准和结果。
- 每次 Cocos Editor 写入批次后，必须读取验证完成，才能释放唯一写入权或启动下一批。
