---
name: cocos-game-ad-integration
description: Cocos Creator 3.x 原生项目接入 AppLovin MAX 时使用；指导原生插件/JSB 适配层、Banner、插页与激励视频、广告位状态与重试、奖励和隐私验收，不用于 Web 或小游戏广告实现。
---

# Cocos Creator 3.x AppLovin MAX 广告接入

## 适用范围与硬边界

本 Skill 只处理 Cocos Creator 3.x 原生构建中的 Banner、插页与激励视频。业务流程、状态和验收以唯一细则合同 [AppLovin MAX 接入合同](references/applovin-max-contract.md)为准。

- Web、浏览器预览和小游戏不加载原生 SDK，也不请求 MAX 广告；能力显式返回 `unsupported-platform`，游戏继续运行。
- 原生端由项目维护的 Cocos 原生插件/适配层调用 AppLovin 对应平台的 MAX 原生 SDK；实际初始化、完成回调、幂等状态和初始化重试统一由[SDK 统一初始化](../cocos-game-architecture/references/sdk-initialization.md)编排。Cocos 场景只能调用共享 TypeScript 门面，不直接调用 Android/iOS SDK，也不依赖 Web 容器适配层。
- JS/native 消息使用目标 Creator 3.x 官方支持的桥接方式；若使用 `native.bridge`，须按 Creator 版本文档遵守字符串负载、单一 `onNative` 监听器和单向 `sendToNative` 语义。桥接收到命令不等于原生操作成功，状态通过带关联 ID 的异步事件回传。项目的 MCP 工具调用和 Creator 资源写入边界见[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)。
- 不得在 Cocos 场景或普通业务组件中持有 SDK key、广告网络凭证、MAX 原生对象或原生宿主 View。SDK key 与 ad unit ID 由受控分环境构建配置注入原生适配层；账号凭证与 Ad Review key 不进入客户端。
- 初始化和加载不得阻塞场景切换、输入、结算或主循环。插页与激励视频静默预加载；全屏展示只在自然中断点按当前就绪状态尝试。Banner 按请求创建/加载，只有已就绪且区域安全时显示。
- 每个广告位独立维护状态、失败计数、deadline 和至多一个重试任务；加载/重试静默。奖励只由匹配的激励回调异步发放并保证幂等；视频不可用或展示失败时通过统一 UI 显示一次本地化提示。
- MAX 内建 Terms and Privacy Policy Flow 在初始化前关闭；新实例首次初始化前由统一初始化入口设置 `hasUserConsent=false`。该值是 MAX 配置，不是用户回执，也不单独阻断广告请求；真实 CMP/TCF、地区、网络和 ATT 要求继续按官方文档处理。具体配置和隐私门以细则合同为准。

## 全局控制接入

本领域可在当前 Work Item、Implementation Package、A 等级和允许路径内提出、审查并实施广告方案；任务范围、控制状态和证据由 [`cocos-game-workflow-control`](../cocos-game-workflow-control/SKILL.md) 维护。本领域的结论、变更、验证和阻断项回到控制面登记复核。涉及外部写入、付费、真机、商店提交、破坏性操作或发布的 A4-A6 行为，必须逐项取得控制面批准。

涉及 Creator 编辑器、AssetDB、Scene/Node/Component、Prefab 或构建的操作必须遵守[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)并实时读取工具 schema；不得手写 `.scene`、`.prefab` 或 `.meta` 绑定。只有拿到实际构建结果才能报告构建通过；若 MCP 只打开构建面板或报告 worker ready，则记录 pending/blocked。

## 接入流程

1. 读取 Work Item、Creator 版本、TDD、依赖能力档和原生目标配置；确认目标原生插件/SDK 与 Android/iOS 构建环境的版本、许可、权限、生命周期和失败语义。先查项目已有实现，避免重复引入 SDK。初始化任务需登记到统一的 `assets/scripts/platform/initialize-sdks.ts`，广告服务只管理 SDK 就绪后的广告位状态和加载恢复。
2. 先阅读[唯一运行合同](references/applovin-max-contract.md)，冻结公开业务门面、广告位状态所有权、自然中断点、广告展示时序、隐私边界和奖励幂等规则。广告属于可选商业能力，不得成为 Cocos Web 核心循环前置。
3. 按目标 Creator 版本的[原生插件文档](https://docs.cocos.com/creator/3.8/manual/en/native-development/native-plugin/)与[JSB 桥接文档](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/js-oc-bridge.html)实现平台适配。Creator 编辑器和项目资源操作按上面的 MCP 协议执行。
4. MAX 原生 API 按平台官方集成文档核对，不把其他引擎或跨平台框架的同名 API 当作 Cocos API。Android 官方示例使用 `AppLovinSdkInitializationConfiguration`、`AppLovinSdk.getInstance(context).initialize(...)`；初始化由唯一初始化模块调用。插页 `MaxInterstitialAd` 与激励 `MaxRewardedAd` 通过 `loadAd()`、`isReady()`、相应 `showAd(...)` 和官方 listener 管理，奖励以 `onUserRewarded(...)` 为准。Banner 使用 `MaxAdView`、listener 和原生 View 层级。iOS 使用对应官方原生 SDK API，并按当前 SDK 版本验证；不要凭类名推导桥接接口。
5. 将 MAX 初始化、广告加载/展示/隐藏/奖励和 Banner 布局事件映射为带 `requestId`/实例代次的结构化异步消息。Creator `native.bridge.sendToNative` 无操作结果返回值，不能用它的返回值假定 SDK 已接受或完成调用；注册唯一 JS 监听器并在适配层分发事件。
6. 先做静态审查、Android/iOS 原生编译和状态机单测，再在当前已批准范围内运行平台集成验证。使用 MAX Test Mode 与 Mediation Debugger 分广告位、格式和网络核验。若 MCP 构建接口仅打开 Creator 构建面板或报告 worker ready，不算真实构建通过；须取得实际构建输出，否则记录 pending/blocked。真机、真实流量、商店提交、控制台写入和发布依照控制面逐对象审批，不由本 Skill 自动发起。
7. 把候选 diff、脱敏平台日志、状态与退避轨迹、合规证据和未覆盖目标提交给 `$cocos-game-workflow-control`。局部验证不得冒充全平台通过。

## 官方参考

- [Cocos Creator 3.8 原生插件](https://docs.cocos.com/creator/3.8/manual/en/native-development/native-plugin/)
- [Cocos Creator 3.8 JS/原生桥接](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/js-oc-bridge.html)
- [AppLovin Android MAX SDK 集成](https://developers.applovin.com/en/max/android/overview/integration/)
- [AppLovin Android 插页广告](https://developers.applovin.com/en/max/android/ad-formats/interstitial-ads/)
- [AppLovin Android 激励广告](https://developers.applovin.com/en/max/android/ad-formats/rewarded-ads/)
- [AppLovin Android Banner/MREC](https://developers.applovin.com/en/max/android/ad-formats/banner-and-mrec-ads/)
- [AppLovin iOS MAX SDK 集成](https://developers.applovin.com/en/max/ios/overview/integration/)
- [AppLovin iOS 插页广告](https://developers.applovin.com/en/max/ios/ad-formats/interstitial-ads/)
- [AppLovin iOS 激励广告](https://developers.applovin.com/en/max/ios/ad-formats/rewarded-ads/)
- [AppLovin iOS Banner/MREC](https://developers.applovin.com/en/max/ios/ad-formats/banner-and-mrec-ads/)
- [AppLovin Android Terms and Privacy Policy Flow](https://support.applovin.com/en/max/android/overview/terms-and-privacy-policy-flow)
- [AppLovin iOS Terms and Privacy Policy Flow](https://support.applovin.com/en/max/ios/overview/terms-and-privacy-policy-flow)
