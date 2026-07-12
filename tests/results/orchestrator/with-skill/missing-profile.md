## 决策

不继续生成横屏或竖屏效果图。缺少 `project-profile.yaml` 时不能离开 `bootstrap`，现有需求文档不能替代项目配置门禁。`orientation` 只能冻结为 `portrait` 或 `landscape`，必须先明确主方向及另一方向的用途。

## 状态迁移

- 当前保持 `bootstrap`。
- `bootstrap/pending → bootstrap/blocked`；若已运行，则 `bootstrap/running → bootstrap/blocked`。
- 配置补齐并批准后：`bootstrap/blocked → bootstrap/pending | running`。
- 引导证据完整后才可依次推进：`bootstrap → requirements → visual-direction → scene-concepts`，不得跨级。

## 门禁与动作

- 项目配置门禁：阻塞。补齐并冻结项目配置，绑定相同内容哈希的人工批准。
- 需求门禁：未验证。验收现有需求文档并记录人工批准。
- 视觉方向门禁：未满足。冻结带版本和哈希的视觉方向并批准。
- 场景效果图门禁：未满足。进入 `scene-concepts` 后才能派发生成任务。
- 当前不创建任务、不并行派发、不调用 Cocos 工具。

## 证据要求

离开 `bootstrap` 前必须具备：

- 完整且 `status: frozen` 的 `project-profile.yaml`；
- 有效内容哈希及绑定相同哈希的项目配置批准记录；
- Cocos Creator 正式三段版本 `>= 3.8.6`；
- 安全、非空、项目相对、无 `..` 且以 `.scene` 结尾的初始场景；
- 含非空 `tools` 或 `capabilities` 的 MCP 能力快照；
- 可从 `bootstrap/pending` 连续回放到当前状态的 canonical 迁移记录。

生成效果图前还必须具备：

- 已验收、获批的需求工件；
- 已冻结、获批的视觉方向版本及 `sha256:` 内容哈希；
- 与活动工作流一致的任务输入版本和哈希；
- 无冲突的路径所有权、明确依赖和验收检查；
- 工件路径、版本、哈希、生成记录、检查结果及非空证据。
