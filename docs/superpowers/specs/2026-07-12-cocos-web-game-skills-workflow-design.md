# Cocos 2D Web 游戏 Skills 工作流设计

## 1. 文档状态

- 状态：已确认设计，等待实施计划
- 日期：2026-07-12
- 目标平台：Web Mobile，本地构建包交付
- 项目类型：Cocos Creator 3.8.6+ 2D 游戏
- 设计输入：文字需求与参考图
- 自动化模式：人机协作
- 执行基础：`weberwang/cocos-mcp-server`
- 浏览器验证：Chrome 插件
- 生图能力：`imagegen`

## 2. 目标与边界

### 2.1 目标

构建一套由 Codex Skills 编排的 Cocos 项目开发工作流，将需求、视觉设计、生图、资源生产、代码开发、Cocos Editor 集成、Chrome 移动端验证、Web Mobile 构建和本地交付串成可重复、可审计、可恢复的生产链路。

工作流必须做到：

- 每个阶段有明确输入、输出、验收条件和责任边界。
- 子代理可以处理相互独立的任务，但不能并发修改同一个 Cocos Editor 状态。
- 所有结论必须关联日志、截图、文件或命令结果。
- 全局视觉方向冻结后，效果图和单图资源必须继承同一视觉契约。
- 项目方向、设计分辨率和适配策略在初始化时确认并冻结。
- Web Mobile 构建包能够通过本地静态服务器运行并完成核心路径验证。

### 2.2 首版包含

- 新项目或已有 Cocos 2D 项目的只读扫描。
- 文字需求结构化。
- 参考图分析。
- 全局视觉方向制定、审核和冻结。
- 单场景效果图生成和审核。
- 背景、角色、道具、UI、装饰等单图资源生成。
- TypeScript 玩法与界面逻辑开发。
- 使用 Cocos MCP 导入资源、构建场景、绑定组件和脚本。
- 使用 Chrome 执行手机视口截图、交互、控制台和资源请求验证。
- Web Mobile 本地构建、压缩、校验和交付报告。

### 2.3 首版不包含

- 3D 游戏生产流程。
- 微信小游戏、Android、iOS 或桌面原生平台发布。
- 自动上传到外部托管平台。
- 无人工门禁的全自动正式发布。
- 自动批准新视觉方向、新截图基线或质量豁免。
- 将复杂预制体自动实例化作为关键路径。
- 将 MCP 工具分组当作安全权限系统。

## 3. 核心原则

### 3.1 总控与阶段分离

总控 Skill 只负责状态、派发、门禁、汇合、失效和恢复，不承担具体需求、设计、实现或验证工作。阶段 Skills 只处理一个明确问题域。

### 3.2 单写者原则

同一时间只允许一个代理调用 `cocos-mcp-server` 修改 Cocos Editor。场景、预制体、资源引用和 `.meta` 文件不允许由多个代理并发写入。

### 3.3 先查询再修改

所有 Cocos 写操作必须先读取当前场景、节点、组件、资源或预制体状态。节点创建必须使用明确的父节点 UUID。名称查询结果不唯一时停止操作。

### 3.4 证据优先

代理不能只返回“已完成”。每项通过结论必须关联产物路径、MCP 调用结果、日志、Chrome 截图、测试结果或构建清单。

### 3.5 冻结与可追溯

项目配置、全局视觉方向、效果图、资源和验证基线均带版本与哈希。下游任务必须回传所使用的版本和哈希，汇合时不匹配则拒绝接收。

### 3.6 最小失效

上游发生变化时只使真实依赖的下游产物失效，不无条件重建整个项目。

## 4. Skills 架构

| Skill | 职责 | 主要输出 |
|---|---|---|
| `cocos-orchestrate-web-workflow` | 总入口、状态迁移、任务派发、人工门禁、汇合和恢复 | `workflow.yaml` |
| `cocos-define-game` | 将文字需求转成范围、玩法、页面和验收条件 | `requirements.yaml` |
| `cocos-freeze-visual-direction` | 制定、审核并冻结全局视觉方向 | `visual-direction.yaml` |
| `cocos-create-visual-concept` | 根据场景规格生成完整页面效果图 | 效果图、提示词、审核记录 |
| `cocos-generate-game-assets` | 从批准效果图拆解和生成独立图片资源 | 图片资源、生成记录 |
| `cocos-plan-project` | 规划场景、预制体、组件、脚本、资源和依赖 | `implementation-plan.yaml` |
| `cocos-implement-game` | 编写 TypeScript、测试和组件绑定需求 | 代码、测试、绑定清单 |
| `cocos-integrate-assets` | 通过 MCP 导入资源、搭建场景并绑定组件 | Cocos 项目改动、映射文件 |
| `cocos-verify-game` | 编译、日志、行为、Chrome 截图和移动端适配验证 | 验证报告、截图、错误证据 |
| `cocos-deliver-web` | Web Mobile 构建、本地冒烟、压缩和交付 | 构建包、哈希、交付报告 |

依赖声明：

- 所有阶段 Skills 以 `cocos-orchestrate-web-workflow` 作为必需背景。
- `cocos-create-visual-concept` 和 `cocos-generate-game-assets` 必须使用 `imagegen`。
- `cocos-verify-game` 必须使用 `chrome:control-chrome`。

## 5. 仓库结构

```text
cocos-skills/
├── skills/
│   ├── cocos-orchestrate-web-workflow/
│   │   ├── SKILL.md
│   │   ├── agents/openai.yaml
│   │   ├── references/
│   │   │   ├── workflow-contracts.md
│   │   │   ├── state-machine.md
│   │   │   └── mcp-safety-policy.md
│   │   └── scripts/
│   │       ├── init_workflow.py
│   │       ├── validate_workflow.py
│   │       └── invalidate_artifacts.py
│   ├── cocos-define-game/
│   ├── cocos-freeze-visual-direction/
│   ├── cocos-create-visual-concept/
│   ├── cocos-generate-game-assets/
│   ├── cocos-plan-project/
│   ├── cocos-implement-game/
│   ├── cocos-integrate-assets/
│   ├── cocos-verify-game/
│   └── cocos-deliver-web/
├── tests/
│   ├── scenarios/
│   ├── fixtures/
│   └── results/
└── docs/superpowers/specs/
```

公共契约、状态机和 MCP 安全策略集中在总控 Skill 中；阶段 Skills 只保留自身独有的过程和验收要求。

## 6. 项目工作目录

目标 Cocos 项目使用以下状态目录：

```text
.cocos-workflow/
├── workflow.yaml
├── project-profile.yaml
├── requirements.yaml
├── design-spec.yaml
├── implementation-plan.yaml
├── ownership.yaml
├── quality-gates.yaml
├── art/
│   ├── visual-direction.yaml
│   ├── visual-references/
│   ├── concepts/
│   ├── asset-manifest.yaml
│   ├── generation-log.yaml
│   ├── capture-manifest.yaml
│   └── runtime-baselines/
├── artifacts/
└── reports/
    ├── mcp-capabilities.json
    ├── project-snapshot.json
    └── chrome/
```

`workflow.yaml` 只能由总控 Skill 修改。验证代理只能写 `reports/` 和 `artifacts/`。Cocos 实现代理是场景、预制体、`.meta` 和资源引用的唯一写入者。

## 7. 项目初始化与屏幕方向

屏幕方向在 `bootstrap` 阶段由用户确认，不在 Skills 中写死。

```yaml
platform: web-mobile
orientation: landscape
design_resolution:
  width: 1920
  height: 1080
fit_policy:
  mode: show-all
  allow_letterbox: true
safe_area:
  enabled: true
status: frozen
```

允许值：

- `orientation: landscape`：默认设计分辨率 `1920×1080`。
- `orientation: portrait`：默认设计分辨率 `1080×1920`。

用户可以在冻结前覆盖默认设计分辨率。修改已冻结的屏幕方向会使效果图、布局、场景实现、截图基线、验证报告和构建包失效。

Chrome 手机视口根据方向生成：

| 档位 | 横屏 | 竖屏 |
|---|---|---|
| small | 667×375 | 375×667 |
| standard | 844×390 | 390×844 |
| large | 932×430 | 430×932 |

这些尺寸是 Chrome CSS 视口；Cocos 设计分辨率与浏览器视口分开记录。

## 8. 子代理编排

### 8.1 角色

| 角色 | 职责 | 写入范围 |
|---|---|---|
| 需求分析代理 | 需求、范围、页面与验收条件 | 需求产物 |
| 视觉设计代理 | 参考图、视觉方向、场景效果图规格 | 视觉规格与概念稿 |
| 技术规划代理 | 场景、预制体、组件、脚本和资源计划 | 实施计划 |
| 代码实现代理 | TypeScript 和测试 | 分配的代码文件 |
| 资源生成代理 | 背景、角色、道具、UI 等图片 | 分配的生成目录 |
| Cocos 实现代理 | MCP 写操作与场景集成 | Cocos Editor 和资源引用 |
| Chrome 验证代理 | 浏览器交互、截图、控制台和请求验证 | 验证报告 |
| Web 交付代理 | 构建、预览、压缩、哈希和报告 | 交付目录 |

### 8.2 并行规则

最大并行度为主代理加三个子代理。

可并行：

- 参考图分析与项目只读扫描。
- 无文件交集的 TypeScript 模块开发与资源生成。
- 实现完成后的静态检查、视觉检查准备和行为测试准备。
- 构建完成后的体积、资源引用和交付文档检查。

必须串行：

- 需求确认后才能冻结设计规格。
- 视觉方向冻结后才能生成正式场景效果图。
- 所有 Cocos MCP 写操作。
- 代码和资源完成后才能进行组件绑定与场景集成。
- 验证通过后才能构建。
- 人工验收后才能完成交付。

### 8.3 子任务契约

```yaml
task_id: WF-DESIGN-001
role: visual-designer
baseline_revision: git-sha-or-workspace-snapshot
allowed_paths: []
read_only: true
inputs: []
acceptance_checks: []
output_paths: []
depends_on: []
```

返回结果：

```yaml
status: passed
baseline_revision: git-sha-or-workspace-snapshot
changed_paths: []
artifacts: []
checks: []
evidence: []
issues: []
handoff_notes: []
```

子代理不得自行扩大 `allowed_paths`。需要越界时返回 `blocked`。

## 9. 总控状态机

| 状态 | 工作 | 退出条件 | 人工门禁 |
|---|---|---|---|
| `bootstrap` | 环境、MCP、项目和方向检查 | 项目配置冻结 | 是 |
| `requirements` | 需求、范围和验收条件 | 需求完整 | 是 |
| `visual-direction` | 制定和冻结视觉方向 | 状态为 `frozen` | 是 |
| `scene-concepts` | 生成场景效果图 | 必需场景均批准 | 是 |
| `planning` | 资源、代码、场景与测试计划 | 无未决项 | 是 |
| `production` | 并行开发代码和生成资源 | 生产任务通过 | 否 |
| `integration` | MCP 串行导入和集成 | 引用完整 | 否 |
| `verification` | 编译、行为、截图和适配验证 | 验收项具备证据 | 是 |
| `building` | Web Mobile 构建与预览 | 构建和冒烟通过 | 否 |
| `delivery` | 压缩、哈希和交付报告 | 交付清单完整 | 是 |
| `completed` | 工作流结束 | 无待处理问题 | — |

任务状态：

```text
pending → running → passed → merged
running → failed → retrying → running
running → blocked
passed → stale → pending
```

每次状态迁移记录来源、目标、时间、原因、证据和批准者。

## 10. 全局视觉方向冻结

`visual-direction.yaml` 至少包含：

- 项目标识、版本、状态、批准信息和内容哈希。
- 游戏类型、目标用户和情绪目标。
- 艺术风格、媒介、形状语言、细节密度和边缘处理。
- 透视、景深、色板、光照和阴影规则。
- 材质、纹理、角色比例、轮廓和身份锚点。
- 环境、建筑、道具和背景深度规则。
- UI 风格、安全区域和可读性规则。
- 设计分辨率、宽高比和资源拆分规则。
- 必须遵守与明确禁止的内容。

状态流：

```text
draft → reviewing → frozen
frozen → change-requested → reviewing → frozen
```

冻结后，子代理可以改变场景内容、构图、时间、天气和局部情绪，但不能改变艺术风格、全局色板、角色比例、材质语言、形状语言、边缘处理和渲染方式。

新版本冻结后，旧视觉方向生成的场景效果图、单图资源和视觉验证结果标记为 `stale`。

## 11. 单场景效果图提示词

每个场景先形成结构化规格：

```yaml
scene_id: lobby
scene_name: 游戏大厅
visual_direction_version: 1
visual_direction_hash: sha256-value
purpose: 向玩家展示主要入口和当前进度
player_focus: 开始游戏按钮
narrative_moment: 玩家进入游戏后的第一个画面
scene:
  location: 游戏大厅环境
  time: 与需求一致
  weather: 与需求一致
  subject: 主要场景主体
  action: 当前叙事动作
  supporting_elements: []
composition:
  viewpoint: 正面平视
  framing: 由项目方向决定的完整游戏页面
  focal_point: 开始游戏区域
  foreground: 前景定义
  midground: 中景定义
  background: 背景定义
  visual_flow: 视觉动线
  negative_space: UI 留白
  ui_safe_zones: []
local_mood:
  emotion: 场景局部情绪
  lighting_variation: 允许的局部变化
  local_accent_color: 冻结色板内的局部强调色
ui_overlay:
  enabled: true
  elements: []
  render_text: false
references: []
invariants: []
avoid: []
output:
  stage: draft
  variants: 2
  approved_path: ""
```

编译提示词使用固定顺序：

1. 用途与页面目标。
2. 已冻结的全局视觉方向。
3. 场景、主体和叙事动作。
4. 构图、视点、前中后景和 UI 安全区。
5. 局部情绪和允许变化。
6. 参考图及其明确角色。
7. 不变量和禁止项。

效果图表现为可实际制作的游戏页面，不是孤立概念插画。默认不生成可读文字，按钮文字、数字和动态内容由 Cocos `Label` 实现。

编译后的提示词模板：

```text
Use case: ui-mockup
Asset type: 2D Web Mobile game full-scene visual concept

Primary request:
为场景「{{scene_name}}」生成完整游戏页面效果图。
场景用途：{{purpose}}
叙事时刻：{{narrative_moment}}
玩家第一视觉焦点：{{player_focus}}

Global visual direction — frozen:
艺术风格：{{visual.art_style}}
表现媒介：{{visual.medium}}
形状语言：{{visual.shape_language}}
细节密度：{{visual.detail_density}}
边缘处理：{{visual.edge_treatment}}
透视规则：{{visual.perspective}}
主色板：{{colors.primary}}
辅助色板：{{colors.secondary}}
强调色：{{colors.accent}}
光照模型：{{lighting.global_model}}
阴影风格：{{lighting.shadow_style}}
材质语言：{{materials.texture_language}}
角色比例：{{characters.proportion_rule}}
环境语言：{{environment.architecture_language}}

Scene/backdrop:
地点：{{scene.location}}
时间：{{scene.time}}
天气与氛围：{{scene.weather}}
主要主体：{{scene.subject}}
主要动作：{{scene.action}}
辅助元素：{{scene.supporting_elements}}

Composition/framing:
项目方向：{{project.orientation}}
设计分辨率：{{project.design_resolution}}
视角：{{composition.viewpoint}}
视觉焦点：{{composition.focal_point}}
前景：{{composition.foreground}}
中景：{{composition.midground}}
背景：{{composition.background}}
视觉动线：{{composition.visual_flow}}
留白区域：{{composition.negative_space}}
必须保留的 UI 安全区域：{{composition.ui_safe_zones}}

Local mood:
场景情绪：{{mood.emotion}}
允许的局部光照变化：{{mood.lighting_variation}}
允许的局部强调色：{{mood.local_accent_color}}

UI relationship:
表现为可实际制作的游戏页面效果图，不是孤立概念插画。
为 {{ui.elements}} 保留清晰区域。
只表现 UI 容器、层级和占位关系，不生成可读文字。
按钮文字、数字和动态内容后续由 Cocos Label 实现。

Input images:
{{references_with_explicit_roles}}

Constraints:
严格继承 visual-direction v{{visual_direction_version}}。
保持色板、角色比例、材质、边缘和渲染方式一致。
不得自行增加新的角色、叙事事件或核心物件。
不得改变已冻结的全局视觉方向。
无水印、无商标、无乱码、无额外文字。

Avoid:
{{scene.avoid}}
```

模板变量必须全部来自已批准的项目配置、视觉方向和场景规格。缺少影响构图或风格的必需变量时，生成任务返回 `blocked`，不能由子代理自行补写新的视觉设定。

## 12. 单图资源生成

每个资源必须先进入 `asset-manifest.yaml`：

```yaml
asset_id: ui-start-button
type: ui-element
source_concept: lobby/approved.png
purpose: 大厅开始按钮
size: 512x192
alpha: true
variants:
  - normal
  - pressed
  - disabled
safe_padding: 16
text_in_image: false
output: assets/art/generated/ui/start-button.png
```

规则：

- 不同资源使用独立提示词和独立生图调用。
- 多个资源可以由不同子代理并行生成。
- 同一资源的不同状态必须保持构图、比例和风格一致。
- 未批准图片不能进入正式 `assets/`。
- 默认不将可变文字生成到图片中。
- 不直接覆盖现有资源，除非用户明确批准替换。
- 透明图片优先采用纯色背景生成、本地去背和透明通道验证。
- 复杂透明主体需要真实原生透明时，必须另行取得用户确认。
- 最终项目资源必须复制到工作区，不能只保留在生图工具默认目录。
- 保存最终提示词、参考图角色、视觉方向哈希和审核结果。

## 13. MCP 能力发现与安全策略

### 13.1 运行时能力发现

`bootstrap` 必须：

1. 检查 `http://127.0.0.1:9527/health`。
2. 读取 `/capabilities` 或 MCP `tools/list`。
3. 保存实际工具列表到 `mcp-capabilities.json`。
4. 检查阶段必需工具是否存在。
5. 记录插件、Creator、项目 UUID 和项目路径。

静态文档只用于规划。运行时工具列表是实际执行依据，禁止猜测不存在的工具。

### 13.2 只读扫描工具

```text
server_get_server_info
server_get_editor_version
server_get_project_name
server_get_project_path
server_get_project_uuid
project_get_project_info
project_get_project_settings
scene_get_current_scene
scene_get_scene_list
scene_get_scene_hierarchy
node_get_all_nodes
node_get_node_info
component_get_components
component_get_component_info
prefab_get_prefab_list
prefab_get_prefab_info
project_get_assets
project_get_asset_info
project_get_build_settings
debug_get_editor_info
```

### 13.3 资源导入工具

```text
project_import_asset
project_refresh_assets
asset_refresh_and_wait
project_get_asset_info
project_query_asset_uuid
project_query_asset_url
project_query_asset_path
project_reimport_asset
```

顺序：图片 QA 通过、复制到批准目录、导入、等待 `.meta`、查询 UUID、校验资源、更新映射。

### 13.4 场景集成工具

```text
scene_create_scene
scene_open_scene
scene_get_scene_hierarchy
scene_save_scene
node_find_nodes
node_get_all_nodes
node_create_node
node_set_node_property
node_move_node
component_add_component
component_set_component_property
component_attach_script
```

写操作执行后必须重新读取目标并验证结果。

### 13.5 预制体策略

允许创建、更新和检查预制体。复杂预制体实例化不是关键路径，因为当前工具实现可能无法恢复完整子节点。复杂预制体需要先在临时环境验证层级，失败时改为节点和组件的确定性重建。

### 13.6 调试与构建工具

```text
debug_clear_console
debug_get_console_logs
debug_get_project_logs
debug_search_project_logs
debug_get_node_tree
debug_validate_scene
debug_get_performance_stats
project_run_project
project_get_build_settings
project_check_builder_status
project_build_project
project_start_preview_server
project_stop_preview_server
```

构建使用 `web-mobile` 和 `debug: false`。

### 13.7 默认禁止工具

```text
node_delete_node
project_delete_asset
project_move_asset
project_save_asset
debug_execute_script
preferences_set_preferences
preferences_set_global_preferences
server_restart_editor
server_quit_editor
```

普通阶段禁止使用这些工具。确需使用时，必须列出目标、依赖、影响范围和恢复方法，并取得人工批准。`overwrite: true` 默认禁止。

## 14. Chrome 移动端验证

### 14.1 职责

- Cocos MCP 启动 Web 预览或构建服务。
- Chrome 打开本地地址、设置手机视口、执行交互、截图、收集控制台错误和失败请求。
- Cocos MCP 检查场景、节点和资源引用。
- 人工完成最终设计符合性确认。

用户明确指定 Chrome，因此 Chrome 不可连接时验证状态为 `blocked`，不能静默切换到其他浏览器。

### 14.2 稳定截图模式

开发环境提供类似以下入口：

```text
?workflowCapture=1&scene=Lobby&state=default&seed=1001
```

截图模式负责固定随机种子、稳定或暂停循环动画、隐藏调试元素、等待字体和资源加载、设置可重复场景状态并提供业务语义定位标识。

定位标识使用 `workflow:start-button` 等业务名称，不依赖可能变化的节点 UUID。

### 14.3 截图清单

`capture-manifest.yaml` 定义预览地址、稳定条件、超时、手机视口、场景状态、前置交互、断言和效果图基准。

每个必需场景状态在 small、standard、large 三档手机视口验证：

- Canvas 完整可见。
- 无非预期滚动条。
- 必需 UI 不裁切、不重叠且符合安全区。
- 主要触摸目标可达。
- 核心路径可执行。
- 控制台无新增未豁免错误。
- 必需资源没有加载失败。

### 14.4 两层视觉比较

设计符合性：实际截图与批准效果图比较构图、焦点、色板、材质、UI 层级和视觉方向，由视觉代理检查并保留人工门禁。

运行时回归：首次批准的 Chrome 截图成为运行时基线。后续相同视口、场景和状态执行像素差异比较。动态区域必须显式声明遮罩，新基线不能自动接受。

## 15. 质量门禁

### 15.1 级别

| 等级 | 含义 | 处理 |
|---|---|---|
| `P0` | 正确性和交付完整性 | 未通过立即停止，不可豁免 |
| `P1` | 视觉、适配和核心体验 | 修复或人工豁免后继续 |
| `P2` | 性能趋势和优化建议 | 仅报告，不阻塞首版 |

### 15.2 P0

- TypeScript 编译错误为零。
- Creator 新增错误为零。
- Chrome 控制台错误为零，已批准白名单除外。
- 必需资源失败请求为零。
- 缺失资源、未解析组件和损坏场景入口为零。
- 必需测试和核心流程通过率为 100%。
- 构建命令成功。
- `index.html`、本地预览、首场景、构建清单和哈希均存在且有效。

### 15.3 P1

- 人工设计符合性审核通过。
- 运行时截图最大变化比例默认 `0.005`，像素阈值默认 `10`。
- Canvas 在全部手机视口完整可见。
- 必需 UI 不裁切、不重叠并符合安全区。
- 最小触摸目标默认 44 CSS 像素。
- 主要操作可达、场景导航可恢复且不能重复触发。

Canvas 内触摸目标结合 Cocos 节点尺寸、设计分辨率和 Chrome 实际缩放比例检查，不能只依赖 DOM 尺寸。

### 15.4 P2

采集但默认不阻塞：首次加载时间、首场景时间、平均 FPS、P95 帧时间、DrawCall、场景节点数、纹理数、资源体积、构建体积和压缩包体积。

具体项目可以在初始化时将性能预算升级为硬门禁。未配置的数值只能报告，代理不能自行发明阈值。

## 16. 失败、恢复与失效

### 16.1 失败分类

- 可重试：MCP 临时断开、生图请求失败、Creator 刷新超时。只重试最小失败步骤。
- 可修复：编译错误、资源缺失、截图不符合规格。创建修复任务并重新执行受影响验证。
- 人工阻塞：需求不明确、视觉未批准、版权来源不明、Chrome 不可连接。
- 严重失败：场景损坏、大量错误导入、项目状态不可解析。停止写入、保存证据并恢复到批准检查点。

恢复后必须重新扫描当前项目，不沿用未验证的旧状态。

### 16.2 失效矩阵

| 变化 | 失效内容 |
|---|---|
| 需求变化 | 视觉方向、效果图、计划、资源、实现、验证和构建 |
| 项目方向或设计分辨率变化 | 效果图、布局、场景、截图基线、验证和构建 |
| 全局视觉方向变化 | 效果图、生成资源、视觉验证和构建 |
| 单场景规格变化 | 对应效果图、资源、场景实现和验证 |
| 资源清单变化 | 对应资源、导入映射、引用、验证和构建 |
| 代码或场景变化 | 验证报告、构建包和交付报告 |
| 构建配置变化 | 构建包和交付报告 |

## 17. Web Mobile 交付

首版完成标准是生成可本地运行的 Web Mobile 构建包，不上传外部托管平台。

```text
delivery/
├── web-build/
├── web-build.zip
├── checksums.sha256
├── build-manifest.json
├── verification-report.json
├── delivery-report.md
└── known-issues.md
```

通过条件：

- 构建成功且入口文件存在。
- 本地静态服务器可以启动。
- Chrome 能加载首场景并完成核心路径。
- 必需静态资源均可访问。
- 控制台无新增未批准错误。
- 压缩包和 SHA-256 生成成功。
- 报告记录 Creator、插件、项目、需求和视觉方向版本。

## 18. 确定性脚本

脚本只处理机械且容易出错的工作：

- 初始化和校验 `.cocos-workflow/`。
- 校验状态迁移、版本和哈希。
- 计算依赖失效范围。
- 检查图片尺寸、命名和透明通道。
- 比较 Chrome 运行时截图。
- 生成构建清单、压缩包和 SHA-256。
- 检查交付目录完整性。

脚本不能决定需求、视觉批准、P1 豁免、危险操作、新截图基线或最终交付。

## 19. Skills 测试策略

Skills 按以下顺序逐个创建和验证：

1. `cocos-orchestrate-web-workflow`
2. `cocos-define-game`
3. `cocos-freeze-visual-direction`
4. `cocos-create-visual-concept`
5. `cocos-generate-game-assets`
6. `cocos-plan-project`
7. `cocos-implement-game`
8. `cocos-integrate-assets`
9. `cocos-verify-game`
10. `cocos-deliver-web`

每个 Skill 执行以下循环：

1. 建立正常、缺失输入、越权、版本不匹配、重复执行和失败恢复场景。
2. 让子代理在没有 Skill 时执行，记录基线失败。
3. 编写最小 Skill 和必需资源。
4. 运行 Skill 结构校验和脚本测试。
5. 让新子代理使用 Skill 执行同一场景。
6. 增加变化场景与反例，关闭发现的漏洞。
7. 验证完成后再开始下一个 Skill。

不得批量生成十个未经测试的 Skills。

## 20. 实施完成标准

整套工作流只有同时满足以下条件才算实施完成：

- 十个 Skills 均通过格式校验。
- 所有确定性脚本都有自动化测试。
- 每个 Skill 都经过无 Skill 基线测试和有 Skill 验证。
- 总控状态机覆盖成功、失败、阻塞、恢复和失效。
- MCP 写操作执行单写者和工具允许列表。
- 生图产物遵守冻结视觉方向。
- Chrome 手机截图流程能够产生可追溯证据。
- Web Mobile 构建包能够本地运行。
- 交付报告能追溯到需求、视觉、代码、资源和验证证据。

## 21. 风险与前置条件

- `cocos-mcp-server` 是项目内 Cocos Creator 扩展，Creator 未运行时不能独立完成编辑器操作。
- 实际工具能力必须以运行时 `tools/list` 为准，因为仓库辅助文档可能滞后。
- 复杂预制体实例化存在丢失子节点的风险，首版使用确定性节点重建作为降级路径。
- Chrome 插件不可连接时，正式截图验证阻塞。
- 生图模型不保证精确文字，项目内动态文本默认由 Cocos `Label` 实现。
- 商业使用前必须确认 `cocos-mcp-server` 的授权范围。
- Git 提交和推送不属于自动阶段，必须遵守用户选择的提交工作流。

## 22. 下一阶段

用户审阅并批准本文档后，使用实施计划流程把每个 Skill 拆成可验证的小任务。实施从 `cocos-orchestrate-web-workflow` 开始，完成并验证一个 Skill 后才能进入下一个。
