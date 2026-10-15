# 运行态验证与最终交付

`runtime-validate` 只接受 `cocos-spine-runtime-validation/2.0` JSON。报告必须以 `sp_skeleton_instance` 绑定实际启用的 `sp.Skeleton` 组件和 `SkeletonData` UUID，并声明 `animation_source: "sp.Skeleton.skeletonData"`；动画全集必须从该实例的 `skeletonData` 读取。报告还绑定目标 Spine Runtime 解析、每个动画找到并切换成功、Idle 默认循环且其他动作单次、纹理缺失/锚点漂移/Mesh 拉伸/闪烁/裁剪检查，以及真实 Bone/Slot/Animation/Atlas Page/Region 摘要。

`target_runtime` 来自项目真实的 `sp.SPINE_VERSION`，而 `target_runtime_parse.creator_version` 来自 Creator 项目版本信息，两者分别描述 Spine Runtime 与 Creator 引擎版本。用项目启用的 feature（例如 `spine-3.8` 或 `spine-4.2`）和实际解析结果确定目标分支；Creator 项目 `data.version` 是项目自身版本，不是 Creator 或 Spine Runtime 版本，`/status.creatorVersion` 也不是版本证据。Creator 版本证据须使用 MCP `project_get_project_info` 返回的 `data.cocosVersion`，并将 `creator_version_source` 精确填写为 `project_get_project_info.cocosVersion`；若项目版本未知，不得改填 `data.version` 或猜版本。`runtime_version_source` 必须为 `sp.SPINE_VERSION`。只对 3.8 分支应用该分支的导出兼容限制；4.2 分支按目标项目的 feature 和解析证据处理，不做跨分支拒绝。

`target_runtime_parse` 还必须写出实际 producer、Runtime owner/version、command 或 URL、当前验证 run 的实际原始日志路径和 `parsed=true`。这些字段须对应真实使用的 Creator Runtime 诊断来源；不得填写未实际调用的 MCP 工具名或用版本声明代替解析结果。Creator 项目资源、组件、场景与 AssetDB 操作必须经[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)和实时 `tools/list` schema 完成；不手写 `.meta`、`.scene` 或 `.prefab`。MCP 当前只打开构建面板/报告 worker ready 或不支持 Preview 启动时，不构成运行验证，必须保持 pending/blocked，直到取得真实运行证据。

截图、浏览器日志、Runtime 原始日志和结构化报告都绑定同一个 `validation_run_id`，并检查实际文件、动画与运行结果；`build_binding` 和各 SHA/fingerprint 仅作可选追踪，不比较或阻断验收。

报告还必须包含诊断页 URL、浏览器验证记录、桌面截图和约 390px 移动端截图；每个文件都须可读取。截图由用户人工检查；代理可提供截图及检查要点，未获明确授权不得自动分析图像。截图不能替代结构化字段，任意一张图片也不能直接驱动 `finalize`。只有 `runtime-validate` 通过后才允许 `finalize`，`verify` 检查实际报告内容和证据，不复算或比较验收摘要。

`report` 生成 `spine-reskin-final/1.0`，包括批次数量/Region 数量、Atlas 完整性、Skeleton 升级结果、Bone/Slot/Attachment/Mesh/Animation 统计、Atlas/Page/Skeleton 哈希、全部 Cell 状态、网页地址、全动画切换结果、桌面/移动截图、验证结果和 `independent-validation-candidate` 或 `integrated-main-game` 交付模式。默认是独立验证候选，正式接入必须由外层 Cocos 工作流另行证明。
