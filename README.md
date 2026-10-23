# Cocos Creator 3.x 游戏协作 Skills

本工作流源自 [phaser-skills](https://github.com/weberwang/phaser-skills)，通用工作流约束已同步至其版本 `fc44d251ac2f634c399b0455b66867571e9ffb6f`，并保留 Cocos Creator 3.x 的引擎适配。它以 Creator 项目的 `assets/`、`settings/`、`profiles/` 和 `package.json` 为工程边界，并由全局控制面统一管理任务范围、风险门、实施证据和状态迁移。Creator 编辑器、场景、节点、组件、Prefab、AssetDB 与构建操作按[Creator MCP 协议](skills/cocos-game-workflow-control/references/cocos-mcp-protocol.md)执行。

Android/iOS 原生平台功能优先复用项目现有 Cocos 原生插件；缺少所需能力时，评估 Creator 原生插件和 JSB 桥接，并将宿主 SDK 调用封装在平台适配层。工程边界与实现选择遵循[原生平台插件选型](skills/cocos-game-architecture/SKILL.md#原生平台插件选型)。

所有已采用 SDK 的初始化由 `assets/scripts/platform/initialize-sdks.ts` 统一编排，应用装配入口独立投递各 SDK 任务后立即返回，Creator 首帧不等待整批初始化。真实完成回调、幂等状态和单 SDK 初始化重试集中维护，业务运行期恢复由所属模块负责，见[SDK 统一初始化](skills/cocos-game-architecture/references/sdk-initialization.md)。

MAX 首次初始化前手动设置 `hasUserConsent=false`，关闭内建隐私流程，再正常调用原生 SDK 初始化；该配置本身不阻断广告加载、展示或重试。MAX 与 AppsFlyer 各自独立启动、失败与恢复，不相互等待或复制同意状态；其他真实适用的隐私前置仍按[接入合同](skills/cocos-game-ad-integration/references/applovin-max-contract.md)核验。

## 安装

需要 Node.js 22.20 或更高版本：

以下两种方式任选其一：

从 GitHub 远程安装：

```powershell
npx -y github:weberwang/cocos-skills
```

在已克隆的仓库中，先安装仓库依赖，再安装到当前目录或指定目标项目：

```powershell
npm ci
node .\scripts\install-skills.mjs E:\Projects\my-cocos-game
```

安装器会把 Skills 和所需运行时依赖复制到目标项目，不修改目标项目的 `package.json`。

## 最短工作流

先按[简化工作流视图](skills/cocos-game-workflow-control/references/simplified-workflow.md)理解当前任务：

```text
需求与范围 → 全局基线 → 基础工程 → 逐场景生产 → 全局集成验证 → 发布
```

单场景视觉任务在“逐场景生产”内按“场景定义 → 拆解与布局确认 → 正式资源验收 → 正式场景实现、校准与运行验收”推进。V4 直接读取 V2 的结构和目标布局、V3 验收通过的正式资源，在实际场景中迭代还原效果。该视图只简化展示；全局状态、G0-G3、V0/V1/V2/V3/V4、A0-A6、F0-F4 和证据硬门继续由控制面维护，详见[控制模型](skills/cocos-game-workflow-control/references/control-model.md)与[状态、阶段与停止门](skills/cocos-game-workflow-control/references/state-gates.md)。

通用帧动画按普通、角色动作、特效或 UI 选择制作规则，默认视频抽帧，图片递归补帧仅在用户明确选用时启用。内部完成动作分析、时间轴、尺寸与批次方案后，先向用户说明目标感受、动作依据和节奏取舍，等待用户明确确认当前动作方案后，再在已有授权内制作真实视频或关键帧；只有玩法事件、时长或行为边界有决定性歧义时才询问。按复杂度安排专业设计师兼任或独立动画导演，先确定完整表演再安排制作容器。真实视频人工验收后才能抽帧；图片首尾、关键帧和递归父图逐张确认后继续制作，最终真实序列仍由用户验收。分辨率、条数、预算、来源证据和 Cocos 接入见[通用帧动画技能](skills/cocos-frame-animation/SKILL.md)与[区域规划](skills/cocos-frame-animation/references/region-planning.md)。

先在目标 Cocos 项目根目录初始化一个 Work Item。下面的 PowerShell 示例会以当前 Git HEAD 作为不可变基线，可直接复制执行：

```powershell
$repo = (Get-Location).Path
$head = (git rev-parse HEAD).Trim()
node .\.agents\skills\cocos-game-workflow-control\scripts\workflow-control.mjs init --repo $repo --work-item-id WI-1 --project-id my-cocos-game --module-id core --domain code --stage-id G0 --baseline-id $head --baseline-version 1 --baseline-hash $head --objective "建立当前功能的 Cocos 工作流记录" --user-text "请建立当前功能的 Cocos 工作流记录并限制在 core 模块" --object "core Cocos 功能" --allowed-path assets
```

初始化会生成 `$repo\.workflow-control\work-items\WI-1.json`；涉及 A4-A6 的具体操作时才按需使用 `$repo\.workflow-control\approvals\ledger.json`。也可以把同样字段写入 JSON 后通过 `init --record <bootstrap.json>` 传入。然后只使用三个稳定入口：

```powershell
node .\.agents\skills\cocos-game-workflow-control\scripts\workflow-control.mjs run --repo . --work-item <work-item> [--input <file> ...]
node .\.agents\skills\cocos-game-workflow-control\scripts\workflow-control.mjs check --repo . --work-item <work-item> [--implementation-package <package>] [--evidence <manifest>] [--input <file> ...]
node .\.agents\skills\cocos-game-workflow-control\scripts\workflow-control.mjs status --repo . --work-item <work-item> [--input <file> ...]
```

`run` 只读取、校验、推导路线，并连续推进已满足条件的安全控制面状态，进入实施或遇到缺证据、用户决定时停止；它不运行业务代码、测试、服务、外部动作或发布，也不会自动选择 `RETURN`。`check` 完全只读。三个入口可重复传入 `--input <file>` 绑定显式关键输入，默认文本优先显示六阶段/四步视图；JSON 仍输出稳定的 `status/stage/changed/blocking/next/metadata`，并在 `metadata.workflowView` 提供展示映射、`metadata.planFingerprint` 返回不含时间戳的确定性计划指纹。

图片与动画任务遵循[图片优先的确认方式](skills/cocos-game-workflow-control/references/simplified-workflow.md#图片优先的确认方式)：除帧动画先确认动作方案外，技术记录、拆解分析、布局决策和提示词由代理内部维护，直接展示真实图片或预览供用户确认；同目标返修直接展示前后对照。

## 控制面边界

游戏产物按[目录规范](skills/cocos-game-architecture/references/project-structure.md)与[产物存放及证据边界](skills/cocos-game-architecture/references/artifact-storage.md)落盘：`output/intermediate/` 保存可再生成中间文件，`output/candidates/` 保存未送审候选，`docs/confirmed/` 保存确认后的非运行成果，`assets-source/` 保存生产输入，Creator `assets/` 保存正式运行资源及其 `.meta`。Scene/Prefab UUID 引用资源按类型或功能域放入普通目录；`assets/resources/` 仅用于显式 `resources.load/loadDir` 按路径动态加载的资源，Asset Bundle 按自己的目录与加载机制管理。根级 `evidence/<workItemId>/reviews/` 和 `validation/` 用于人工审阅及验证，不等于机器 `evidenceRoot`；机器记录及视觉确认账本继续使用 `.workflow-control/` 下工具实际路径，受限字段不得填写外部目录。已冻结引用保持原位，不批量搬迁或改写。

- `$cocos-game-workflow-control` 独占全局状态、风险门、任务范围、状态迁移和证据一致性。普通 A0-A3 工作直接依据当前用户任务，不创建独立授权记录，也不设置 F0 授权有效硬门。
- 任务内可以调整实现方案、文件路径、资源清单和测试范围；同步更新 Work Item/实施包并重验受影响部分即可。无外部副作用的本地 A4 集成可按任务执行；涉及外部写入、付费、真机、破坏性或外部删除、发布的 A4-A6 操作仍必须逐对象建立 pending 并获得显式批准。控制面只校验和记录，不代执行这些动作。
- V0→V1→V2→V3→V4 的视觉硬门、全局静态基线、场景拆解与布局确认、高保真前置继续使用带真实路径和任务归属的证据；V4 直接消费当前 V2/V3 产物并对正式场景调整验收。缺失或失效时 fail closed。阶段与字段以控制面文档和 Schema 为准。
- 共享工作区不自动回滚、不覆盖他人修改；启动本地验证服务前先查找同项目健康实例并复用。
- 阶段任务验收完成后，执行代理按[最小 Git 提交集](skills/cocos-game-workflow-control/references/minimal-git.md)维护 `.gitignore`：只提交本任务运行/构建必需文件与当前工作项有效引用的必要记录和实际产物，逐层纳入仍需的图片、视频、Spine 文件、审阅页、截图、日志和源输入，不能只留下路径字符串。产物目录默认忽略文件再逐文件精确放行，未入库不代表可删除；Creator 正式资源及 `.meta`、工程设置和必要原生源配置不能整体忽略。使用当前分支提交并报告哈希，不自动推送。详见[阶段收尾与 Git 提交](skills/cocos-game-workflow-control/SKILL.md#阶段收尾与-git-提交)和[忽略模板](skills/cocos-game-workflow-control/assets/minimal-project.gitignore)。

视觉几何与测试默认以可用性为准：位置、尺寸、边距、换行允许合理偏差，越界、裁切、关键遮挡、不可读和交互失效必须修复。像素级容差、全视口/全状态矩阵只在任务明确要求或项目合同明确指定时启用；V2 拆解确认、布局确认、独立资源产物和关键功能证据仍然保留。

UI 中选择 `center` 时，默认严格居中；只有明确的设计偏移或经检查后的光学补偿才保留中心参照偏移，并说明理由。图标和文字可按组合整体居中，广告角标单独停靠；居中及父/定位参照的依赖位移会平移布局 bounds 并保持相对间距，不改普通图片 RAW 尺寸。详见[居中策略与组合定位](skills/cocos-game-ui-layout/references/center-alignment.md)。

美术质量另按[游戏美术体验与质量契约](skills/cocos-game-asset-integration/references/art-quality-contract.md)验收：结构化 brief 关联主题、受众、核心循环与观看情境；常态、操作反馈和关键事件分别限制视觉刺激。全局三候选逐项记录实际人工质量结果，所选候选任一失败或未验证都不能冻结，三张都不合格时返工。V4 提交正常游玩、重复反馈、叠加与收尾的适用动态片段，由用户检查持续观看效果；机器 PASS 只说明结构、参数和证据有效，不能代替美术验收。该要求复用既有阶段与确认，不增加审批流程或自动真机验收。

所有任务和阶段都逐一以当前用户明确要求和[实际完成情况](skills/cocos-game-workflow-control/references/control-model.md#按实际完成情况验收)判断验收，覆盖设计、工程、玩法、场景、UI、资源、动画、音频、数值、测试、性能、集成与发布。任何任务已按要求完成时，不因中途方案或内部实现调整而回改历史合同；记录实际结果并更新受影响证据即可。只有真实改变后续依赖的范围、公开接口或硬约束时才更新对应契约，不能通过修订合同降低未满足要求的验收标准。

工作流已取消所有 SHA 摘要验收校验，不要求提供或比对摘要，也不因摘要缺失、错误或变化阻断验收。摘要核对留到最终人工验收后处理；文件可读取、实际功能与内容约束、任务归属和人工确认仍会检查，内部缓存及事务并发保护保留。

UI 响应式验证按合同的 `orientationPolicy.allowed` 选择视口方向：单方向项目只验证支持方向内的窄宽尺寸、DPR 和连续 resize；只有同时支持竖屏与横屏时才验证方向切换。UI 父子分组按真实功能与布局职责，简单底板优先兼任组件根，额外纯结构容器须写明独立职责；独立位置参照不强制新增父子容器，明确视觉溢出不扩大父框。普通图片（包括作为容器的底板）运行时 `UITransform.contentSize` 等于 SpriteFrame RAW 原尺寸，`size_driver` 固定为 `SPRITE_RAW`；节点缩放动画仍按视觉几何合同验证，仅冻结九宫格纹理设置目标图片尺寸。九点停靠表达节点位置意图，与九宫格纹理拉伸分开处理。Widget 只使用已存在的真实父/祖先节点；V2 自动选型默认按 `scale=1`、`rotation=0`、`skew=0` 规划，不声称读取运行矩阵，已知非单位路径使用 `SHARED`，V4 实测不符则阻断并回上游调整。合成逻辑 `viewport`/`safe-area` 与兄弟参照、图文整体居中交给共享布局，安全区使用同一批实际安全区小矩形。Creator 原生 Layout 与项目自定义布局器分别使用 `LAYOUT` 与 `SHARED` 驱动（自定义布局可保留 `PARENT` 职责）。位置与尺寸可由不同驱动器负责，但同一属性不能并行写入；父 Layout 排布子位置时必须持有位置控制权。V4 组件快照必须从 Creator 实际读取全部业务节点，独立于几何容差测量；严格居中、中心参照及组合 union 用实际 `layout_bounds`/`reference_bounds` 校验，不能仅凭 Widget flag 判断。详见[功能语义分组](skills/cocos-game-ui-layout/references/functional-semantic-grouping.md)、[Widget 定位策略](skills/cocos-game-ui-layout/references/widget-layout.md)、[Widget 运行快照](skills/cocos-game-ui-layout/references/widget-runtime-evidence.md)与[Cocos 图片尺寸边界](skills/cocos-game-ui-layout/references/cocos-adapter.md#图片原尺寸与九宫格尺寸)。

玩家可见内容遵循[游戏内文案](skills/cocos-game-ui-layout/references/game-copy.md)：优先图片、图标、数字与符号，例如金币图标 `+100`，不重复写「获得 100 金币」；文字只保留必要的短名称、短动作、短状态或说明。该原则贯穿策划、美术 brief、效果图、布局和验收。程序化文本仍须支持英语、简体中文、日语、俄语和西班牙语，并逐语言验证字形宽度、字体回退、基线、断行和容器适配；每种语言独立选择单行或换行，禁止截断，也不把符号表达扩写成解释句。

详细状态、门、Schema 和返工语义见 [`cocos-game-workflow-control`](skills/cocos-game-workflow-control/SKILL.md) 及其 [`control-model.md`](skills/cocos-game-workflow-control/references/control-model.md)、[`state-gates.md`](skills/cocos-game-workflow-control/references/state-gates.md)、[`schemas.md`](skills/cocos-game-workflow-control/references/schemas.md)。

## 领域 Skill 索引

- `$cocos-game-orchestrator`：领域拆分、交接和执行协调。
- `$cocos-game-production`：制作策划、GDD、功能契约和验收范围。
- [`$cocos-game-juice`](skills/cocos-game-juice/SKILL.md)：汁水感与动态反馈的独立领域能力；用户明确提出相关需求，或当前核心事件缺少明确反馈语义时按需引用。它沿用当前 Work Item 和既有制作、玩法、UI、动画、音频与 QA 流程，不把普通玩法任务扩成全量润色。见[完整设计指南](skills/cocos-game-juice/references/design-guide.md)。
- `$cocos-game-architecture`：工程架构与公开契约。
- `$cocos-gameplay-development`：玩法规则、状态和交互实现。
- `$cocos-game-asset-integration`、`$cocos-game-ui-layout`：资源、效果图还原和 UI 布局。
- [`$cocos-frame-animation`](skills/cocos-frame-animation/SKILL.md)：普通、角色、特效、UI 分类规则；先说明并确认动作方案，再制作真实视频或关键帧，默认视频抽帧，可明确选用图片递归补帧。分辨率、批次与预算按[区域规划](skills/cocos-frame-animation/references/region-planning.md)执行，输出独立图集与预览。
- `$cocos-spine-generative-reskin`、`$cocos-game-image-optimization`：Spine 与图片处理。
- `$cocos-game-audio`、`$cocos-game-balance`：音频和数值平衡。
- [`$cocos-game-ad-integration`](skills/cocos-game-ad-integration/SKILL.md)：通过 Cocos 原生插件适配 AppLovin MAX SDK，接入移动端 Banner、插页与激励视频，管理全屏广告位静默预加载与持续重试、Banner 按需创建与布局刷新、视频不可用提示和隐私验收。
- `$cocos-game-qa-performance`：质量、测试和性能验证。
- [`$cocos-game-artifact-cleanup`](skills/cocos-game-artifact-cleanup/SKILL.md)：核对引用、保留策略与文件归属，清理过期记录和未使用中间产物，保留有效证据与审计链。
- `$cocos-game-release`：发布候选、渠道和合规交付。
- `$grilling`：只处理无法由事实确定且会改变范围、行为、预算、合规或数据边界的用户决定。

## 生图与去背景

系统根据提示词、参考图、边缘特征和已验证能力选择透明路线。硬边且主体与背景明显分离时可用纯色去背；直接 Alpha 必须经过工具与边缘类型能力验证，并解码 PNG 证明真实透明像素；复杂边缘使用独立遮罩/人工创作、重新生成或经明确合同批准的 Cocos 特效。半透明、辉光、柔和阴影、毛发、玻璃和混合边缘不得默认阈值去背。所有透明路线都绑定实际来源、生产记录、归一化实际输出与深浅底预览，SHA 仅可选追踪；已有透明图按 provided/reuse 接入，不伪造生成或去背记录。详见[资产生产路线](skills/cocos-game-asset-integration/references/asset-production-routes.md)。

在本仓库中处理简单纯色背景 PNG：

```powershell
npm run remove:background -- --source art/raw.png --output art/transparent.png --background-color '#00FF00' --tolerance 24 --require-solid-background --edge-profile hard-edge --color-separation-verified --record art/removal.json --preview-dir art/previews
```

该脚本只适用于 hard-edge 且颜色分离已确认的输入。背景与主体应有明显颜色差异；校验失败时修正输入或换路线，不提高容差吞掉棋盘格、硬抠复杂轮廓或删除光效。脚本输出处理记录与深浅底预览，不能替代 V4 对主体缺损、背景残留、色边和半透明区域的视觉检查。

## 高级诊断

稳定入口之外，控制面仍提供以下底层命令：

| 命令 | 用途 |
| --- | --- |
| `init` | 首次创建控制目录和 Work Item |
| `route` | 只推导风险通道与下一命令 |
| `preflight` | 写入或副作用前校验动作、路径和目标 |
| `advance` / `transition` | 迁移已满足门的状态；`transition` 支持显式回退记录 |
| `diff-audit` / `evidence-check` | 绑定真实候选 diff 与 F0-F3 证据 |
| `delegate-check` / `parallel-check` / `unit-check` | 管理 A3 委派、并行批次和执行单元 |
| `prepare-approval` / `handoff` / `approve` | 仅处理 A4-A6 的精确操作审批 |
| `lint` | 仓库级 Skill、Schema 和链接静态检查 |

底层命令不会改变任务范围、A4-A6 批准、视觉硬门或 fail-closed 约束。缺少非关键元数据时优先提醒并自动补齐；只有身份、所有权、关键产物或安全边界无法判断时才阻断。

## 测试入口

```powershell
npm run test:quick
npm run test:minimal-git
npm run test:workflow
npm run test:frame-animation
npm run test:production-build
npm run test:full
npm test
```

`test:quick` 覆盖稳定输出、指纹和最小提交规则，`test:minimal-git` 单独验证 Creator 源文件保留、产物精确放行和必要附件提交；`test:workflow` 覆盖控制面和视觉工作流，`test:frame-animation` 覆盖视频抽帧、图片规划/来源/打包及 accepted 文件门，`test:production-build` 验证最终公开产物的 Source Map 检查器，`test:full`/`test` 保留全量回归。工作流先按风险推荐 T0（仅静态检查）、T1（定向验证）、T2（受影响模块）或 T3（完整验证），说明理由、覆盖和命令后自动执行适用等级；不等待人工选择。T3 仍不包含隐式真机、外部写入或发布。

这些 Node 测试入口统一使用隔离运行器：每次运行的临时目录会在正常结束、失败、超时或可处理信号后回收。默认总超时为 10 分钟，可通过 `COCOS_TEST_TIMEOUT_MS`（毫秒）覆盖；超时返回 `124`。运行器只终止本次创建的测试进程树，不会停止已有 Cocos Creator 或外部服务，也不会删除显式项目路径下的证据输出。
