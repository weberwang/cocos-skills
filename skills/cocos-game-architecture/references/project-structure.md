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
│   ├── resources/                # 运行时按需加载的资源
│   ├── textures/                 # 图片、SpriteFrame 来源和图集
│   ├── audio/                    # 音效与音乐
│   └── data/                     # 游戏数据和配置
├── settings/                     # Creator 工程设置
├── profiles/                     # 编辑器配置档
├── extensions/                   # 项目级 Creator 扩展（按需）
├── native/                       # 原生工程/插件相关源文件（按项目与版本需要）
├── package.json                  # Creator 项目标识及项目依赖配置
├── .workflow-control/            # Work Item、控制状态和证据引用
├── docs/                         # 设计、技术和交付文档
└── evidence/                     # 有归属的验证证据（按需）
```

Creator 项目实际还可能包含 `library/`、`temp/`、`local/`、`build/` 等编辑器或构建生成目录。它们的生成方式、版本控制策略及平台子目录随 Creator 版本和项目配置变化；依据锁定版本文档与项目 `.gitignore` 管理，不能移动或当作 `assets/` 源内容手工编辑。

## 资源与引用

- 按功能领域和资源类型组织 `assets/`，避免把所有文件平铺到同一目录。每项资源的 `scene_id`、共享范围和所有者在资产清单中登记。
- Creator AssetDB 导入后为资产建立 UUID。跨文件的编辑器引用使用 AssetDB 已生成的 UUID/子资源身份；代码侧加载可使用 Creator 支持的资源引用方式。不要自行生成 UUID，也不要将磁盘路径存在误判为导入完成。
- Sprite 图像常含可单独引用的 SpriteFrame 子资源；绑定前查询实际子资源 UUID 与资源类型。其他导入类型按对应 importer 的子资源结构检查。
- 批量导入遵循单写者边界：完成整批落盘后刷新一次批次目录并等待完成，执行有界查询确认导入状态；包含脚本的批次还检查编译/加载结果。就绪后才绑定、保存或进入下一批。
- 保存 Scene/Prefab 后读回并检查节点树、组件属性与资源引用，证明持久化结果符合预期。

## 模块分层

- `assets/scripts/` 下按领域放置脚本，例如 `core/`、`gameplay/`、`ui/`、`platform/`。只有具有稳定共享契约的代码才进入 `core/`；禁止无边界 `common/` 或 `utils/`。
- Scene 由 `Node` 树、`Component` 和 Prefab 组合构成。场景脚本通过公开服务、状态仓库或事件契约交互，不直接读写其他 Scene 的私有节点。
- 可复用 UI 或玩法对象优先形成职责明确的 Prefab；Prefab 与场景引用仍以 Creator 资源数据库中确认的 UUID 为准。
- `extensions/`、`native/` 仅在确有编辑器扩展、构建扩展或原生插件时启用。按项目 Creator 版本记录宿主工程、平台权限与插件构建边界。
- 测试脚本、服务启动配置和生成资源不混入 Creator 运行时 `assets/`，除非项目明确需要将其作为游戏资源。

官方参考：[Cocos Creator 3.8 项目结构](https://docs.cocos.com/creator/3.8/manual/en/getting-started/project-structure/index.html)。如项目使用其他 3.x 小版本，改查对应版本文档，不将 3.8 的细节自动推广到所有小版本。
