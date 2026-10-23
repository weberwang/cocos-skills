# Cocos Creator 项目目录规范

本规范面向 Cocos Creator 3.x。先确认项目实际使用的 Creator 小版本，再以对应官方文档和仓库现状为准；这是一套便于协作的目录约定，不要求每个项目都创建所有可选目录。

Creator 项目的核心边界是 `assets/`、`settings/`、`profiles/` 和根目录 `package.json`。编辑器生成的 `library/`、`temp/`、`local/` 与 `build/` 不应被当作源资产目录。Creator 导入的 `assets/` 文件通常配有 `.meta` 文件，UUID 用于资源数据库引用；源文件与其 `.meta` 应一并维护和版本控制。

参考布局：

```text
project/
├── assets/
│   ├── scenes/                   # Scene 资产
│   ├── prefabs/                  # 可复用 Prefab
│   ├── scripts/                  # Component 与领域脚本
│   │   ├── platform/             # 平台适配；initialize-sdks.ts 统一编排第三方 SDK
│   │   ├── scenes/<scene-id>/     # 场景功能聚合与场景专属逻辑
│   │   ├── display-layers/<id>/   # 独立弹窗等显示层逻辑
│   │   └── shared/               # 稳定共享的运行代码（按需）
│   ├── shared/                   # 稳定共享的正式运行资源
│   ├── display-layers/<id>/      # 独立弹窗等显示层正式资源
│   ├── animations/               # 动画图集等按功能或类型归类的资源
│   ├── textures/                 # 图片、SpriteFrame 来源和图集
│   ├── audio/                    # 音效与音乐
│   └── data/                     # 游戏数据和配置
├── settings/                     # Creator 工程设置
├── profiles/                     # 编辑器配置档
├── extensions/                   # 项目级 Creator 扩展（按需）
├── native/                       # 原生工程/插件相关源文件（按项目与版本需要）
├── package.json                  # Creator 项目标识及项目依赖配置
├── .workflow-control/            # Work Item、控制状态、机器证据与用户决议账本
│   └── user-resolutions/         # 控制工具固定位置的视觉确认账本与回执
├── docs/                         # 设计、技术和交付文档
├── evidence/                     # 有归属的审阅与验证证据（按需）
├── assets-source/                # 可编辑源文件与重做输入（按需）
├── output/                       # 本地中间产物与未送审候选（按需）
└── tests/                        # 项目测试，不进入 Creator AssetDB（按需）
```

Creator 项目实际还可能包含 `library/`、`temp/`、`local/`、`build/` 等编辑器或构建生成目录。它们的生成方式、版本控制策略及平台子目录随 Creator 版本和项目配置变化；依据锁定版本文档与项目 `.gitignore` 管理，不能移动或当作 `assets/` 源内容手工编辑。

## 资源与引用

- 按功能领域和资源类型组织 `assets/`，避免把所有文件平铺到同一目录。每项资源的 `scene_id`、共享范围和所有者在资产清单中登记。
- `assets/resources/` 是可选目录，不默认创建或作为普通资源总目录。Scene、Prefab、Component 序列化 UUID 引用的纹理、图集、SpriteFrame、AnimationClip、字体、音频等资源，放在 `assets/` 下按资源类型或功能域规划的普通目录，例如 `assets/textures/ui/`、`assets/animations/`、`assets/audio/`、`assets/data/`；编辑器引用由 Creator AssetDB UUID 解析，不要求资源位于 `resources/`。
- 只有明确通过 `resources.load` 或 `resources.loadDir` 按路径动态加载的资源才放入 `assets/resources/`，并在通用资源清单中声明 `resource_loading.method`。资源被运行时播放、通过 Scene/Prefab 引用，或登记为生产输出，不构成使用 `resources/` 的理由。AnimationClip 等静态引用资源仍放在其规划的普通目录。
- Asset Bundle 资源保留在已规划并标记为 Bundle 的目录内，通过 Bundle 加载机制动态加载；不因运行时加载而迁入 `assets/resources/`。其他动态加载方式也沿用对应的资源域和加载机制，不强制使用 `resources/`。
- 示例：静态图集 `assets/animations/mechanism-open.png` 由 Scene/Prefab 的序列化引用绑定；显式使用 `resources.load('animations/mechanism-open')` 时，文件位于 `assets/resources/animations/mechanism-open.png`，清单声明 `{ "method": "resources.load" }`，路径 key 与文件相对 `assets/resources/` 的路径一致。Frame-animation 图集可用 `spritesheet.creator_resource_path` 直接声明这一动态加载用途，无需重复填写 `resource_loading`。
- Creator AssetDB 导入后为资产建立 UUID。跨文件的编辑器引用使用 AssetDB 已生成的 UUID/子资源身份；代码侧加载可使用 Creator 支持的资源引用方式。不要自行生成 UUID，也不要将磁盘路径存在误判为导入完成。
- Sprite 图像常含可单独引用的 SpriteFrame 子资源；绑定前查询实际子资源 UUID 与资源类型。其他导入类型按对应 importer 的子资源结构检查。
- 3D 模型的 `.blend` 源及烘焙输入保存在 `assets-source/<owner>/<asset-id>/<version>/`；运行时模型、材质和资源级 Prefab 放入 `assets/` 内既有归属目录。导入格式、网格/材质子资源与设置按实际 Creator 版本和 AssetDB 结果核验，遵循[建模工作流接入](../../cocos-game-3d-modeling/references/workflow-integration.md)，不把源 `.blend` 的存在当作可运行模型。
- 批量导入遵循单写者边界：完成整批落盘后刷新一次批次目录并等待完成，执行有界查询确认导入状态；包含脚本的批次还检查编译/加载结果。就绪后才绑定、保存或进入下一批。
- 保存 Scene/Prefab 后读回并检查节点树、组件属性与资源引用，证明持久化结果符合预期。

## 模块分层

- `assets/scripts/` 下按领域放置脚本，例如 `core/`、`gameplay/`、`ui/`、`platform/`。只有具有稳定共享契约的代码才进入 `core/`；禁止无边界 `common/` 或 `utils/`。
- 一个 Scene 的运行规则、实体、专属 UI 和布局代码按功能聚合在 `assets/scripts/scenes/<scene-id>/` 等场景域目录；不把所有场景的私有实现汇集到根级 `entities/`、`managers/` 或 `ui/`。测试不进入 Creator AssetDB 管理的运行时 `assets/`，按同一场景归属放入 `tests/scenes/<scene-id>/` 等项目测试目录。Scene 仍由 Creator 的 `Node` 树、`Component` 和 Prefab 组合，场景脚本通过公开服务、状态仓库或事件契约交互，不直接读写其他 Scene 的私有节点。
- modal/popup 等瞬态显示层按需进入 `assets/scripts/display-layers/<id>/`，与宿主 Scene 的私有 `ui/` 独立；宿主通过公开接口和上下文协作。共享实现进入 `assets/scripts/shared/` 仅限至少两个已确认场景稳定复用的能力，或运行启动必需的能力；模块不得反向依赖 Scene/显示层。
- 可复用 UI 或玩法对象优先形成职责明确的 Prefab；Prefab 与场景引用仍以 Creator 资源数据库中确认的 UUID 为准。
- `extensions/`、`native/` 仅在确有编辑器扩展、构建扩展或原生插件时启用。按项目 Creator 版本记录宿主工程、平台权限与插件构建边界。
- 第三方 SDK 唯一初始化编排位于 `assets/scripts/platform/initialize-sdks.ts`，由唯一应用装配/最小 Boot 启动点调用；Scene、Component、构造函数和平台适配器不另行初始化 SDK。编辑器/引擎及 AssetDB 生命周期不迁入该文件，细则见[SDK 统一初始化](sdk-initialization.md)。
- 测试脚本、服务启动配置和生成资源不混入 Creator 运行时 `assets/`，除非项目明确需要将其作为游戏资源。

## 产物与生产构建

- 资源临时文件、候选、确认设计成果、正式资源、人工证据与控制面机器记录按[产物存放与证据边界](artifact-storage.md)流转。正式资源使用 Creator `assets/` 计划路径；源文件与 Creator `.meta` 一并维护，AssetDB 导入和引用需按 Creator MCP 协议核验。
- 新建或调整 Creator 生产构建及准备发布候选时按[生产构建与发布检查](production-build.md)核对锁定版本对应的 Debug、Source Maps、压缩/混淆、注释处理、最终发布包及 Feature Cropping；构建选项依据工程实际生效配置，不照搬其他引擎配置。

官方参考：[Cocos Creator 3.8 项目结构](https://docs.cocos.com/creator/3.8/manual/en/getting-started/project-structure/index.html)。如项目使用其他 3.x 小版本，改查对应版本文档，不将 3.8 的细节自动推广到所有小版本。
