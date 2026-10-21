# Cocos Creator 生产构建与发布检查

新建或调整 Creator 生产构建、准备发布候选时读取本文件。先确定项目锁定的 Creator 版本和真实构建入口；以该版本官方文档、工程配置、构建日志与最终产物共同证明构建设置生效。

## Creator 构建配置

- 检查 Creator 编辑器版本、构建目标、构建面板/配置档、命令行选项、构建扩展及后处理脚本，记录实际生效设置。不得将 Phaser/Vite 或其他引擎的配置键直接复制到 Creator 工程。
- release 构建应关闭 Creator 的 Debug 选项，并核验该版本将发布构建压缩/混淆 UUID、引擎与项目脚本的实际效果。还要通过实际输出确认需要移除的开发注释已移除；如果项目使用 Terser 等扩展，只按该扩展和 Creator 锁定版本文档核对其配置，不凭空指定固定键或压缩轮数。
- 若项目已有或明确采用 Terser 构建扩展，按扩展当前官方配置显式设置 `compress.passes: 2`、`mangle: true`、`format.comments: false`，不额外启用属性名混淆；核对实际构建入口、依赖声明与锁文件，并保留第三方要求随包分发的 NOTICE/许可证。该要求只适用于实际采用的 Terser 扩展，不能将这些字段当作 Creator 内建配置键或为此强行引入 Terser。
- 生产 Source Map 默认关闭。Creator 3.8 的 Source Maps 选项会生成映射文件；对其他 Creator 版本核对对应官方配置。检查 profile、CLI 覆盖、构建扩展、渠道覆盖和打包后处理没有重新启用或复制映射。
- 保留第三方依赖依法或按许可要求随包分发的许可证与 NOTICE 文件。压缩、改名或移除注释不等于完整反编译加固，也不替代授权材料交付。

Creator 3.8 的核对入口：[General Build Options](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/build-options.html)、[Build Guide](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/build-guide.html) 和 [Feature Cropping](https://docs.cocos.com/creator/3.8/manual/en/editor/project/)。项目使用其他版本时改查对应版本文档，不推广 3.8 的界面、配置名或内部行为。

## 最终产物 Source Map 检查

- 发布前检查 Creator 实际构建目录与已解包的渠道包资源，包括 JS、CSS、Worker、引擎文件及预压缩副本：不得包含 Source Map 文件（通常为 `*.map`、`*.map.gz`、`*.map.br`）、内联映射、`sourceMappingURL` 指令或可见的 `SourceMap`/`X-SourceMap` 引用。不能只因配置为关闭就判定候选通过。
- 使用只读检查器检查已解包的公开资源目录，并将目标 Creator 构建目录和渠道 Web 资源目录一并传入：

```powershell
node <skill-dir>/scripts/validate-production-build.mjs <Creator构建公开资源目录> [<已解包渠道资源目录> ...]
```

安装后的 `skill-dir` 指 `cocos-game-architecture` Skill 的实际目录。只传入实际构建输出或真实解包后的发布资源目录，不传 Creator `assets/` 源树。

- 检查器拒绝空目录、映射文件、压缩映射副本、源码映射指令、内联映射及可见响应头引用。它不解包渠道归档、不构建 Creator 工程、不证明压缩有效，也不检查远端响应头或实际运行。符号链接须按最终打包后解引用的文件检查，不能跳过检查以取得通过。
- 将检查对象、方法、实际命令和结果写入发布清单。发现映射时追查其生成/复制来源，修正后重做生产构建并复查整个候选，而不是只删除一个文件。部署/CDN 的旧映射在允许只读检查时核对；外部删除仍按已有授权执行。
- 生产排错确需保留映射时，单独记录理由、存放位置和访问范围；映射不得进入公开构建目录、发布包或公开 CDN。外部上传仍按精确对象与已有授权执行。

## Creator Feature Cropping 评估

1. 按锁定 Creator 版本核对 Feature Cropping 实际支持方式、构建目标、项目启用模块和所需引擎能力。它是引擎模块裁剪评估，不是业务代码加密；不支持或没有实测收益时记录未采用原因，不降级 Creator 或新增未经批准的工具。
2. 根据实际场景、组件、插件和动态创建能力整理保留/移除清单，只裁剪有证据确认未用的模块。记录 Creator 版本、配置位置、构建目标和生成方式。
3. 核对工程仅使用预期的引擎模块和版本、插件与业务代码解析入口一致、必要许可证保留。Creator 构建资源、AssetDB 引用与 `.meta` 由实际工程核验，不能手工改写绑定以绕过导入。
4. 用同一代码、资源和渠道条件比较裁剪前后的引擎及完整包体积，记录比较口径。验证启动、场景切换、资源加载、渲染、物理、加载器和插件路径；模块缺失、运行错误或无可测收益时调整方案，不用宣传比例替代测量。
5. 在发布清单登记裁剪采用状态、Creator 版本、配置位置、构建目标、体积对比及功能验证。Creator、插件、组件或功能清单变更时重新评估并重验受影响候选。

## 验证与发布交接

1. 核对 Creator 实际构建入口、配置档和构建目标，确认 Debug、Source Maps、压缩/混淆及去注释结果；记录版本、配置来源与构建命令。
2. 使用项目已配置的 Creator 编辑器或命令行构建生产候选。检查完整构建结果，不将构建面板打开、worker ready、构建配置截图或单个日志当作成功证据。
3. 对最终构建目录和已解包渠道包运行 Source Map 检查器；另行核验 Creator Feature Cropping 适用性/采用结果、包体积、场景与资源路径。报告构建命令、候选目录、Creator 版本、检查结果和未覆盖项。
4. 对候选包定向检查启动、场景切换、AssetDB 资源消费和适用插件。复用同项目健康实例；需要启动新服务前先检查是否有可复用进程。视觉显示由用户人工检查，不自动发起真机验收。
5. 在 TDD 与发布清单登记 Creator 版本、有效配置、构建结果、压缩/Source Map/裁剪检查及未覆盖项。构建成功不代表运行烟测、完整平台矩阵或发布放行通过。
