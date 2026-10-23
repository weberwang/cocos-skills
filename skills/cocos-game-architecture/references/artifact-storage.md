# 产物存放与证据边界

在生成、导出、确认、接入或清理游戏产物前读取本文件。路径均相对目标 Cocos Creator 游戏项目根目录；按需创建目录，不预建空目录，不为本规范批量搬迁或改写既有记录。

## 存放位置

`<owner>` 与项目代码、正式资源清单使用同一归属：`global/<projectId>`、`modules/<moduleId>`、`scenes/<sceneId>` 或 `display-layers/<displayLayerId>`。`<workItemId>`、阶段、候选、运行和版本标识使用当前控制工具和工作项的真实 ID，不另造工作流状态。

| 类别 | 默认目录 | 内容与边界 |
| --- | --- | --- |
| 临时中间文件 | `output/intermediate/<workItemId>/<stageId>/<candidateId>/` | 下载暂存、转换缓存、抽帧工作文件、失败导出和调试日志；仅放未被正式清单或有效证据引用且可再生成的文件。 |
| 尚未送审的候选 | `output/candidates/<workItemId>/<stageId>/<candidateId>/` | 本地探索图、草稿、动画或音频候选；展示给用户、写入合同/清单或作为下游输入前，保存到对应审阅/保留目录并绑定实际路径。 |
| 已确认的非运行成果 | `docs/confirmed/<owner>/<artifact-id>/<version>/` | 已确认效果图、参考目标、拆解图、布局包和设计预览；不随游戏发布，不存运行资源副本或第二套确认状态。 |
| 生产源文件 | `assets-source/<owner>/<asset-id>/<version>/` | 用户原始输入、可编辑模型/分层图、原始音频、动画源视频和重做所需的必要输入。 |
| 正式游戏资源 | `assets/shared/`、`assets/scenes/<sceneId>/`、`assets/display-layers/<displayLayerId>/` | 按需存放当前资源清单采用的图片、Spine运行文件、3D 运行时模型、材质、资源级 Prefab、纹理、音频、字体和图集；实际导入、引用和构建状态必须通过 Creator AssetDB/构建结果核验。 |
| 项目权威文档与清单 | `docs/` | GDD、TDD、视觉基线、资源清单、来源/许可登记和测试策略；权威正文沿用既定文件名，不在确认目录复制第二份。 |
| 人工审阅与验证产物 | `evidence/<workItemId>/reviews/<stageId>/<candidateId>/`、`evidence/<workItemId>/validation/<stageId>/<candidateId>/` | 供人检查的候选、审阅页、截图、录屏、对照图、测试日志和报告；记录实际状态，未通过证据也按有效记录保留。 |
| 工作流机器记录 | `.workflow-control/` 与 `.workflow-control/user-resolutions/` | Work Item、实施包、状态、结果、机器证据、受保护视觉确认账本和回执遵循控制工具真实路径；不得另造 `.cocos-workflow/`。 |
| 可再生成构建输出 | Creator 当前配置指向的 `build/` 子目录 | 构建生成目录不手工维护；平台、Creator 版本和构建模板的实际产物路径以工程配置为准。 |

根级 `evidence/<workItemId>/` 是人工审阅/验证目录，**不是**机器控制面的 `evidenceRoot`。Work Item、审批、委派、执行状态、Result、Evidence Manifest 与附件继续写入控制工具为当前任务确定的实际路径；视觉确认账本和回执只写入 `.workflow-control/user-resolutions/` 的真实位置。不得根据本文件重排机器目录。

Evidence Manifest、自身文件列表、命令 `outputFile` 及任何明确受 `evidenceRoot` 约束的字段，只能使用该 Work Item `evidenceRoot` 内路径。根级 `evidence/`、`docs/confirmed/`、`assets-source/` 或其他外部位置不得填入受限字段；仅在对应业务 Schema/控制命令明确允许外部引用时才通过该类字段关联产物。不为满足字段约束复制或改写已冻结记录，也不把根级审阅目录伪装成机器证据根。

Cocos Creator 正式运行资源必须安装到最终计划的 `assets/` 路径，源文件及 Creator 生成的 `.meta` 一并维护。遵循[交付资源流程](../../cocos-game-orchestrator/references/delivery-artifacts.md)：候选安装到计划路径后，先核验 AssetDB 导入、类型、UUID/子资源、脚本编译及隔离验证结果，再记录 V3 accepted；未 accepted 时不得绑定到正式场景或进入正式场景构建/发布候选的有效资源引用。正式场景消费在 accepted 后进入相应 V4 集成与重验。通过后不搬迁正式资源。Creator 构建可能收集的资源也要检查最终包，不能只靠目录名假定排除。目录、`.meta` 或导入成功都不替代人工确认与控制面记录。

## 从生产到确认

1. 开始生产前，在 TDD 与当前实施包中确定临时、源文件、审阅、确认成果、正式资源和机器记录的位置及所有者。工具支持输出参数时传入明确目录；工具固定输出先按原接口生成。`output/` 不是所有任务的统一根目录，按上述用途选择子目录。
2. 未送审探索使用 `output/candidates/`，可再生成中间文件使用 `output/intermediate/`。向用户展示或写入合同、清单、生成记录、确认回执前，将候选及其实际依赖保存至 `evidence/.../reviews/` 或对应保留目录；用户原始输入和不可重建生成原件不能只存在临时路径。布局图、节点 JSON、决策 JSON、审阅页与生成记录等同批依赖保持完整。
3. 用户确认且工程检查满足后，非运行设计成果归档到 `docs/confirmed/`。运行资源按资源清单提前安装到最终计划的 `assets/` 路径，Creator AssetDB 就绪并完成不进入正式场景/发布候选的隔离验证后才记录 V3 accepted；正式场景消费在 accepted 后按 V4 验证，通过后不移动。可编辑源文件与再生产输入归档至 `assets-source/`。
4. 归档使用独立版本目录，不覆盖已有确认成果。已被冻结的证据、账本/回执、执行状态绑定的路径和文件保持原样；新产物使用本规范路径。旧路径仍被有效记录引用时继续保留，不批量搬迁文件，不自动改写引用或确认记录。
5. 运行代码只从 Creator 工程已导入并由资源清单登记的正式 `assets/` 资源加载，不从 `output/`、`docs/confirmed/`、`assets-source/` 或根级审阅/验证目录加载。候选不得因复制到 `assets/` 就成为通过；加工、压缩、切片、改尺寸或 Creator 导入转换后须复核受影响的文件和人工验收。
6. 工作流记录只引用真实文件路径。领域文档与清单按其 Schema 关联审阅成果和正式资源；机器 Evidence Manifest 及受 `evidenceRoot` 约束的文件字段仍只绑定机器证据根内实际文件。收尾检查资源清单无临时路径、同批依赖可读、发布包不含审阅产物；清理仅处理当前任务中无引用且可再生成的临时文件，并遵守[产物清理规则](../../cocos-game-artifact-cleanup/SKILL.md)。

## Git 与本地保留

Git 纳入当前运行/构建所需文件，以及恢复当前工作项必须读取的规格、记录和逐层引用文件。精确忽略、放行、暂存和复核规则以[最小 Git 提交集](../../cocos-game-workflow-control/references/minimal-git.md)为准：当前有效依赖引用的图片、视频、Spine 文件、审阅页、截图、日志、必要源输入和其他实际媒体必须与引用它们的记录一同入库，不能只提交路径字符串或仅按扩展名/目录名排除必需媒体。

新产物目录默认忽略其中的文件，再按有效引用逐文件放行；被忽略不代表可删除。未被有效引用的历史版本、试验和本地源素材可按保留策略留在本地或现有受控存储。冻结记录仍指向旧路径时，按实际引用保护文件；不得为适配新目录批量移动既有证据或自动改写记录。
