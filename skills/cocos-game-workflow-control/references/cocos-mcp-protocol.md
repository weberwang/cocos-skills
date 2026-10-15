# Cocos Creator MCP 操作协议

本工作流的 Creator 操作必须结合 `cocos-mcp-server`。当前核对源码位于 `E:\Git\cocos-mcp-server`，提交为 `779ee27cfe86652f4d3938ff132bff600b7f3453`，插件面向 Creator 3.8.6+；具体项目仍须核实编辑器版本和本次可用能力。控制 CLI 只负责工作项与证据，不自行执行编辑器动作。

纯 TypeScript 规则、测试及原始图片可在任务范围内使用文件工具；场景、节点、组件、Prefab、AssetDB、资源 UUID 绑定和编辑器操作经 MCP 执行。禁止手写 `.scene`、`.prefab`、`.meta` 代替编辑器操作；只读 `.meta` 用于核实真实资源及子资源。

## 连接与能力发现

1. 先检查现有 Creator、插件与端口服务，复用同项目健康实例。插件默认不自动启动；没有实例时按项目启动方式处理，不启动第二个编辑器或重复服务。
2. 默认 HTTP MCP 地址为 `http://127.0.0.1:9527/mcp`，可用实际配置覆盖。`GET /health` 检查服务，`GET /status` 核对项目身份；完成 MCP `initialize` 后读取 `tools/list`。
3. 保存本次工具名、`inputSchema`、项目路径、Creator 版本、发现时间和连接地址作为能力快照，按当前 Work Item 引用。文档中的名字只用于定位，只有实时快照中的工具和参数才可调用。
4. `/capabilities` 和 `/api/tools` 不提供完整参数 Schema，不能替代 `tools/list`。`writesEnabled: false`、`writeTools: []` 不是权限保护；服务实际可以注册和执行写工具。

当前 Codex 配置生成器采用直接 HTTP；stdio 适配器则把 JSON-RPC 转发到同一个 HTTP 服务，`COCOS_MCP_PORT` 默认 `9527`。不要为接入工作流修改用户其他客户端配置。若实际连接和工具发现不可用，阻塞对应 Creator 操作，继续无依赖的本地工作。

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"assetAdvanced_refresh_assets_and_wait","arguments":{"urls":["db://assets/ui/button.png"],"timeoutMs":10000,"pollIntervalMs":200,"refreshParentFolders":true}}}
```

## 操作映射

| 意图 | 已核实工具与参数 | 完成证据 |
| --- | --- | --- |
| 项目身份 | `project_get_project_info({})` | 当前项目目录和 Creator 信息 |
| AssetDB 就绪 | `assetAdvanced_query_asset_db_ready({})` | 就绪结果，失败不继续写入 |
| 批量导入 | `assetAdvanced_batch_import_assets({sourceDirectory, targetDirectory, fileFilter?, recursive?, overwrite?})` | 逐文件导入结果、实际目标与 UUID，随后刷新和读回 |
| 批量刷新 | `assetAdvanced_refresh_assets_and_wait({urls, timeoutMs?, pollIntervalMs?, refreshParentFolders?})` | `readyUrls`、`pendingUrls`、`metaReady`，以及后续资源读回 |
| 资源和 UUID | `project_get_asset_info({assetPath})`、`project_query_asset_uuid({url})` | 真实资源类型、UUID、sidecar 和所需子资源 |
| 创建/打开/保存场景 | `scene_create_scene({sceneName, savePath})`、`scene_open_scene({scenePath, autoSave?})`、`scene_save_scene({})` | `scene_get_current_scene({})`、`scene_get_scene_hierarchy({})` |
| 创建节点 | `node_create_node({name, parentUuid?, nodeType?, siblingIndex?, components?, initialTransform?, assetUuid?, assetPath?})` | `node_get_node_info({uuid})` 和层级读回 |
| 组件与属性 | `component_add_component({nodeUuid, componentType})`、`component_set_component_property({nodeUuid, componentType, property, propertyType, value})` | `component_get_components({nodeUuid})` 与属性读回 |
| 挂载现有脚本 | `component_attach_script({nodeUuid, scriptPath})` | 已编译组件、绑定和控制台结果 |
| Prefab | `prefab_create_prefab({nodeUuid, savePath, prefabName})`、`prefab_instantiate_prefab({prefabPath, parentUuid?, position?})` | `prefab_get_prefab_info({prefabPath})`、实例节点和组件读回 |
| 控制台 | `debug_get_console_logs({limit?, filter?})`、`debug_get_project_logs` | 本批开始时间之后的编译、加载和运行错误 |

工具组会过滤实际可用能力；缺少工具时不猜别名或额外参数。`asset_read_meta`、`asset_create_script` 虽出现在旧别名表，当前没有对应实现，不得当作可用工具。

`project_get_project_info` 的 `data.version` 是项目版本且可能回退为 `1.0.0`；`data.cocosVersion` 来自编辑器但也可能为 `Unknown`。当前 `/status.creatorVersion` 在服务源码中写死为 `3.8.8`，不能作为实际版本证据。不能拿项目版本或该固定值推断 Creator 或 Spine Runtime 版本；未知时保留未知并核对实际编辑器及其资源能力。

## 资源写入与读回

每批先核对文件和场景所有权，确认 AssetDB 就绪，在任务范围内写完原始资源或 TS 源码，再集中刷新。不要按文件反复主动刷新，也不要用固定延时推断完成。

从生产暂存目录接入正式资源时，优先使用实时能力中已提供的批量导入工具，显式保持 `overwrite: false`。当前批量导入按文件 basename 放入目标目录，递归输入会丢失来源目录层级；先按目标目录分组并排除重名，不能假设它保留目录树。导入顶层成功也不等于全部文件成功，逐文件核对实际结果和 UUID；发生重命名时按真实资源查询结果登记，不能继续使用请求前假定的路径。

`project_refresh_assets({folder?})` 只触发刷新，不等待。优先使用 `assetAdvanced_refresh_assets_and_wait`；它的实现仅等待 `.meta` 文件存在，返回成功不能证明资源导入有效、脚本已编译或子资源可用。必须继续查询资源、UUID，并只读检查实际 sidecar 中所需 SpriteFrame、纹理、图集等子资源。资源数据不完整时有界重试，失败停止后续绑定；不得创建假的 `.meta` 或 UUID。

MCP 没有独立 TypeScript 编译/编译完成轮询工具。脚本依赖 Creator 正常编译；记录本批开始时间，读取控制台和项目日志，确认组件可发现、可挂载且无相关编译/类注册错误。仅日志为空不能证明编译完成。`component_attach_script` 不负责编译，`debug_execute_script` 也不是编译器。

绑定必须使用读回的实际 UUID 和子资源标识。保存后重新读取场景、节点、组件属性和资源引用，并保留结果；文件存在、刷新返回成功或工具没有抛错都不能单独作为通过依据。

资源信息与 sidecar 读回只能证明已记录的身份，不能单独证明引擎已加载最新内容。若当前能力不能确认本批所需子资源可用、更新已生效或组件已编译，保持对应绑定/集成步骤 pending/blocked，说明缺少的实际证据；不要用静态文件事实代替加载完成证据。

## 写入者与批处理

同一 Creator 项目同时只允许一个工作流写入者；资源刷新、场景、节点、组件、Prefab 修改统一排队。其他代理可并行只读查询、纯规则代码或独立资源准备，不能并行调用编辑器写工具。

`batch_execute({commands, fail_fast?, max_commands?})` 按数组顺序执行，默认最多 25 条，硬上限 100 条。它没有事务、自动回滚或跨请求互斥；失败可能已完成部分命令。当前 `fail_fast: false` 时，子工具返回 `success: false` 可能不计入批次异常计数，顶层 `success` 仍为 `true`；必须逐条检查工具结果及其业务成功字段。每批保留逐条返回和保存读回证据，确认部分结果后再安排定向修复，禁止盲目重放整个批次。

执行前查目标和稳定 UUID，执行最小修改，执行后保存并读回。删除、移动、覆盖、任意脚本执行不因工具可见而获得授权，仍按当前用户范围和 A4-A6 的实际副作用判断。不得回滚共享工作区或覆盖其他人的修改。

读取批处理响应时，逐项核对 `data.results[].result.success`、对应错误、执行数量和目标读回；缺项、异常或业务失败均不得把整批标记为通过。

## 预览、构建与人工验收的真实边界

- `project_run_project({platform?})` 和 `project_build_project({platform, debug?})` 当前只打开构建面板，不启动游戏或完成构建。
- `project_get_build_settings()`、`project_check_builder_status()` 只能提供配置或构建 worker 就绪事实，不是构建进度、成功或产物证据。
- `project_start_preview_server`、`project_stop_preview_server` 虽有 Schema，当前实现明确不支持通过 MCP 控制。没有通用长任务 ID 或异步任务轮询协议。
- 因此应先经 MCP 核对项目、场景和面板状态，再将真实构建/预览启动交给 Creator UI 人工步骤，或仅在后续版本已核实提供相应能力时执行。未执行的运行、构建保持未完成，不以面板打开或 worker ready 冒充成功。
- Web 浏览器验证前先复用同项目健康预览实例；没有可复用实例且 MCP 不能启动时，报告所需人工启动步骤。截图/视频由用户检查显示效果，机器只检查结构、参数与证据；除非用户明确要求自动视觉检查，不分析画面、不判定视觉通过。真机运行和发布仍需明确授权。

## 源码核对位置

在 `E:\Git\cocos-mcp-server` 内核对：`source/mcp-server.ts`（协议和工具注册）、`source/tools/tool-groups.ts`（启用组）、`source/asset-db-wrapper.ts`（刷新实际语义）、`source/tools/project-tools.ts`、`scene-tools.ts`、`node-tools.ts`、`component-tools.ts`、`prefab-tools.ts`、`debug-tools.ts`、`batch-tools.ts`（具体参数与行为），以及 `source/client-config.ts`、`stdio-adapter/src/index.ts`（连接方式）。服务升级后按实际源码和运行发现重新核对，不沿用未经验证的能力声明。
