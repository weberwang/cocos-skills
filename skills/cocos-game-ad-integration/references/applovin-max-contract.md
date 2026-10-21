# AppLovin MAX 广告接入合同

本文件是 `cocos-game-ad-integration` 的唯一详细运行合同。它约束 Cocos Creator 3.x 原生项目通过项目维护的 Cocos 原生插件/JSB 适配层接入 AppLovin MAX 原生 SDK：平台边界、责任、网络集合、状态、公开接口、静默预加载、广告位独立加载重试、Banner 布局与刷新、视频不可用提示、奖励、隐私、遥测和验收。实施时按 Creator 实际版本核对 [Cocos 原生插件](https://docs.cocos.com/creator/3.8/manual/en/native-development/native-plugin/)与 [JSB 桥接](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/js-oc-bridge.html)，并核对 [AppLovin Android SDK 集成](https://developers.applovin.com/en/max/android/overview/integration/)和 [AppLovin iOS SDK 集成](https://developers.applovin.com/en/max/ios/overview/integration/)及广告格式文档。SDK 类、回调和配置以当前官方原生文档及项目锁定版本为准；本文件描述业务合同，不替代 SDK/API 文档或法律意见。

## 不变量与平台边界

- Cocos Web、浏览器预览、小游戏和其他没有原生 MAX 容器的目标不直接调用 MAX、不导入原生 SDK，也不发起网络广告请求。共享 TypeScript 门面在这些目标上返回结构化 `unsupported-platform` no-op，并立即让游戏继续。
- iOS 与 Android 由项目维护的 Creator 原生插件/适配层调用 MAX 对应平台原生 SDK。Cocos 场景只能调用共享 TypeScript 门面，不能直接触碰 Android Activity、iOS ViewController、MAX 原生对象或任何网络 SDK。
- 不依赖 Web 容器兼容层，也不假设存在 AppLovin 官方 Cocos 插件。原生实现须符合当前 Creator 版本的原生插件、构建和 JSB 接口要求；无法满足平台构建条件时标记阻断并回到 Work Item 决策，不静默切换到其他引擎或框架插件。
- 所有已启用的插页与激励视频广告位都在初始化成功后立即投递后台静默预加载意图，实际 load 经过广告请求隐私门，未满足时保留意图待恢复；初始化不主动创建广告对象或视图，Banner 不预加载，只在展示请求时创建并加载；加载、重试和展示回调均走后台/事件驱动路径。游戏主循环、输入、场景切换和结算不得等待广告加载、网络响应、CMP、展示或隐藏；全屏展示触发只读取当前状态并快速返回，不能在触发路径临时 load；Banner 展示触发允许按需创建并加载，但同样立即返回。
- 任何平台只允许一个广告服务实例和一个平台原生适配器实例。每个广告位持有独立业务状态和至多一个加载重试 timer，格式匹配的 MAX 原生对象由原生适配器管理；所有广告位只共用激励视频结束后的插页保护截止时间等服务级状态，不设置跨广告位全屏互斥，不共用加载重试 timer。重复初始化、预加载、展示请求或 SDK 回调不能造成同广告位并发 load、递归回调或多套退避机制。
- 加载失败、无填充和后台重试始终静默，不弹 Toast。视频广告触发时已不可用，或展示请求发出后收到 `displayFailed`，必须由共享 UI 层显示一次本地化“视频广告暂不可用，请稍后再试”Toast；重复和迟到事件不得重复提示。
- Banner 使用原生 MAX ad view，不预加载也不默认创建；首次展示请求才创建并加载。只有收到 `loaded`、布局已确认安全且业务仍请求可见时才能显示；未 ready、加载失败或布局不可用时保持隐藏并立即返回，不弹 Toast，也不让空白广告位阻塞或覆盖游戏。

## 固定聚合网络与别名

以下七项是本合同的固定集合。`canonical` 用于代码和遥测的稳定分类；控制台显示名、adapter 名称和区域要求必须按 AppLovin 当前页面核对。

| canonical | MAX/控制台常见名称 | 别名与注意事项 |
| --- | --- | --- |
| `applovin` | AppLovin / AppLovin Exchange 或 AppLovin Bidding | MAX 自有需求；不另接一个“AppLovin adapter”来代替 SDK 初始化。 |
| `admob` | Google Bidding and Google AdMob | Google AdMob 是同一项固定渠道；不要把 Google Ad Manager 误加入本次集合。 |
| `mintegral` | Mintegral | 以官方 MAX Mintegral adapter 与当前隐私说明为准。 |
| `pangle` | Pangle | ByteDance 相关名称可能出现在 SDK/adapter 资料中；国家、地区、商店和流量限制必须按官方当前要求逐项配置，不预设地区规则。 |
| `unity` | Unity Ads | 使用 MAX 的 Unity Ads adapter，不把 Unity 游戏插件或 Unity 引擎依赖带入 Cocos 项目。 |
| `dt-exchange` | DT Exchange | Fyber 是历史/常用别名；本合同只计为一个渠道，不重复接入。 |
| `verve` | Verve | PubNative、HyBid 是历史/产品别名；本合同只计为一个渠道。 |

固定集合不代表每个平台、国家或广告格式都一定有填充。适配器在 Android 与 iOS 的可用性、支持的竞价方式、SDK 要求和区域限制必须分别从官方当前文档核对并记录；缺少支持证据时，将该平台/网络标为 `not-supported`，不能用自定义网络假装已接入。

## 三方职责分离

### MAX 控制台

MAX 控制台负责以下外部配置，由账号/变现责任人执行并留存脱敏证据：

1. 按平台登记 Android package name、iOS bundle ID 和商店信息，并为每个 Banner、插页和激励视频广告位创建格式正确的 ad unit。每个平台、格式和业务广告位使用清晰稳定的标识，避免共享状态或混用测试与生产。
2. 在 `Mediation > Manage > Networks` 连接并启用固定七项渠道，填写各渠道要求的账号、API key、placement 或应用信息；把渠道加入对应 waterfall，并按需启用 bidding/auto-CPM。
3. 创建测试设备、选择 Test Mode、导出或查看 Mediation Debugger 结果，并在发布前确认 `app-ads.txt`。
4. 记录控制台环境、平台、ad unit 所属 Work Item 和责任人。SDK key 与 ad unit ID 由分环境构建配置注入原生适配器，不手写进业务源码、示例、公开文档、遥测或本仓库；广告网络账号凭证不得进入客户端。

本 Skill 不自动登录、写入或修改 MAX 控制台，也不自动创建网络账号、placement、waterfall、`app-ads.txt` 或商店资料；这类外部动作按 [`$cocos-game-workflow-control`](../../cocos-game-workflow-control/SKILL.md) 的对象级边界处理。

### 官方原生插件与依赖

项目按 Creator 原生构建接入对应平台的 AppLovin MAX SDK，并由 Cocos 原生插件/适配层管理 SDK 实例、广告格式对象和回调。Android SDK 与 iOS SDK 的版本和 mediated network adapters 分别按 AppLovin 对应平台当前官方文档锁定；同一平台不能重复引入多个 MAX SDK 副本。

本合同不写死 Creator、SDK、adapter 或第三方网络 SDK 版本，也不允许无约束的版本通配。实施时记录平台 SDK 与 adapter 的实际版本、官方页面、目标平台构建方式和兼容性证据；Android 与 iOS 的依赖声明分别维护。Pangle 的区域配置、平台差异和必要参数以 AppLovin 当前 Pangle 章节为准。

### Cocos 原生插件与 JSB 适配层

TypeScript 门面只与项目的 Cocos 原生适配层通信，再由原生实现调用 MAX SDK。若 Creator 目标版本支持 `native.bridge`，官方 JS API 为 `native.bridge.sendToNative(arg0, arg1?)` 和唯一可赋值的 `native.bridge.onNative`；参数只传字符串，复杂负载需编码为 JSON。`sendToNative` 是单向调用、没有返回值，不能证明原生操作成功。建立单一桥接监听器，以稳定事件名和 JSON `requestId`/实例代次回传异步结果；不得在各业务组件重复覆盖 `onNative`。实际接口以[Creator 对应版本桥接文档](https://docs.cocos.com/creator/3.8/manual/en/advanced-topics/js-oc-bridge.html)为准。

- 接收统一 SDK 初始化模块的 MAX 初始化配置/重试请求，以及广告门面的按广告位预加载、状态查询和展示请求；验证原生平台、生命周期、业务 `slotId` 和环境配置，映射为 MAX ad unit ID，再调用当前版本的 SDK API。初始化编排、完成状态和初始化恢复由[SDK 统一初始化](../../cocos-game-architecture/references/sdk-initialization.md)唯一管理。
- 原生层把 SDK 初始化回调、load、display、hidden、reward、Banner expand/collapse、click 和 failure callbacks 映射为稳定事件与结构化结果；初始化事件回给统一 SDK 初始化模块，广告事件回给广告服务。原始错误消息不得直接进入业务 UI 或遥测。
- Android 原生 API 由统一初始化任务通过插件适配器调用 `AppLovinSdkInitializationConfiguration`、`AppLovinSdk.getInstance(context).initialize(...)`；插页/激励对象在对应版本支持时使用 `loadAd()`、实例 `isReady()` 与 `showAd(...)`。激励只能在 `onUserRewarded(...)` 收到原生奖励回调后发放。Banner 使用 `MaxAdView`、加载监听与原生 View 层级。iOS 侧使用相应官方原生 SDK 对象和 delegate，不将 Android 类名照搬到 iOS。
- 保存服务实例、每广告位状态和独立加载重试 timer；不把平台对象、SDK 类、网络凭证、MAX waterfall 或设备标识返回 Cocos 层。
- 在 Android 绑定当前有效 Activity，在 iOS 绑定当前有效 ViewController；后台、恢复、销毁和重复回调都必须有明确处理。不存在有效宿主时立即返回 `no-host`，不阻塞等待。

SDK key 与 MAX ad unit ID 是 MAX 原生 SDK 所需的客户端配置，由生成式、分环境构建配置注入原生适配器并按 debug/test/release 隔离；业务场景只使用 `slotId`，不得直接持有这些值。它们不得写入手工维护的业务源码、示例、日志、遥测或版本库。广告网络账号凭证、Ad Review key 和服务器 API key 属于秘密，只能留在对应控制台、CI 秘密或原生构建配置，绝不传给 Cocos 层。

## 平台行为矩阵

| 运行目标 | 初始化/预加载 | 状态/触发 |
| --- | --- | --- |
| Cocos Web / 浏览器 | 立即返回 `unsupported-platform`，不调用 MAX | `isReady=false`；全屏展示和 Banner 显隐均立即 no-op |
| 小游戏或其他 Web 容器 | 同上；若平台有独立广告 SDK，另建经批准的 Skill/模块 | 不在本合同内实现或兜底为 no-op |
| Cocos Creator Android Native | 项目原生插件调用 MAX Android SDK；初始化完成后静默预加载启用的插页与激励广告位 | 全屏复核 MAX 实例 `isReady()` 和业务门后调用 `showAd(Activity)`；Banner 首次展示时创建 `MaxAdView` 并加载，按安全布局加入原生 View 层级 |
| Cocos Creator iOS Native | 项目原生插件调用 MAX iOS SDK；初始化完成后静默预加载启用的插页与激励广告位 | 全屏复核对应原生实例 readiness 与业务门后调用官方 `showAd`；Banner 首次展示时创建原生广告视图并加载，按安全布局加入宿主视图层级 |

## 公开桥接接口与结构化结果

参数命名可按目标项目约定调整，但不得改变“快速返回、事件最终确认”的语义。桥接调用只表示消息已发送；适配器在可用时可将本地消息派发包装成快速 `Promise`，该 Promise 只表示桥接请求已受理/拒绝，不表示 SDK 初始化、广告网络加载、展示或隐藏已完成。SDK 初始化只由统一初始化模块发起；广告调用方不得等待 SDK/广告完成来推进游戏流程。业务层只传环境、能力开关、自然中断上下文和 `slotId`；SDK key 与 MAX ad unit ID 由原生适配层从受控构建配置解析，广告网络 placement/账号凭证绝不从 Cocos 层传入。

```ts
initialize(config: InitConfig): Promise<InitResult> // 仅供统一 SDK 初始化模块调用；快速返回本地受理/拒绝
retryInitialize(): Promise<InitResult>        // 如需显式重试，由统一初始化模块路由至 MAX 独立任务
preload(slotId: AdSlotId): Promise<PreloadResult> // 仅插页/激励后台加载；Banner 返回 format-mismatch
isReady(slotId: AdSlotId): ReadyResult        // 全屏读取实例就绪属性；Banner 读取加载状态，不创建或加载
tryShow(context: ShowContext): Promise<ShowResult> // 复核当前实例就绪属性后展示或立即拒绝
setBannerVisibility(slotId: AdSlotId, visible: boolean): Promise<BannerVisibilityResult>
```

最小类型合同如下；实现可以增加字段，但不能改变字段含义、关联规则和快速返回时序：

```ts
type Platform = "android" | "ios" | "web" | "unsupported";
type AdFormat = "banner" | "interstitial" | "rewarded";
type AdSlotId = string;
type BannerVisibility = "not-applicable" | "hidden" | "visible";
type AdPhase =
  | "unsupported" | "new" | "initializing" | "failed" | "idle"
  | "loading" | "ready" | "showing";
type GateStatus = "open" | "closed" | "unknown";

interface InitConfig {
  environment: "test" | "staging" | "production";
  enabled: boolean;
}

interface ShowContext {
  slotId: AdSlotId;          // 业务广告位标识，不是 MAX ad unit ID
  naturalBreak: boolean;     // false 时立即返回 not-natural-break
}

interface GateSnapshot {
  host: GateStatus;          // Activity/ViewController provider
  foreground: GateStatus;
  connectivity: GateStatus;
  privacy: "ready" | "pending" | "blocked";
}

interface AdResult {
  ok: boolean;
  code: string;
  platform: Platform;
  phase: AdPhase;            // 资源/展示 phase，不是 Cocos 场景状态
  gates: GateSnapshot;
  instanceGeneration: number;
  slotId?: AdSlotId;
  format?: AdFormat;
  bannerVisibility?: BannerVisibility;
  retryScheduled?: boolean;
}

interface InitResult extends AdResult {
  operation: "initialize" | "retryInitialize";
  accepted: boolean;          // 仅表示本地受理，不表示 MAX 已完成
}
interface PreloadResult extends AdResult {
  operation: "preload";
  accepted: boolean;
}
interface ReadyResult extends AdResult {
  operation: "isReady";
  ready: boolean;
}
interface ShowResult extends AdResult {
  operation: "tryShow";
  accepted: boolean;
  showRequestId?: string;
  interstitialDelayRemainingMs?: number; // 激励视频结束后的插页保护期剩余时间
  noticeCode?: "video-ad-unavailable"; // UI 层本地化并显示一次 Toast
  noticeDedupeKey?: string;             // 立即拒绝时每次触发唯一
}
interface BannerVisibilityResult extends AdResult {
  operation: "setBannerVisibility";
  accepted: boolean;
  visible: boolean;
  widthPx?: number;
  heightPx?: number;
}
```

原生事件必须携带可关联的最小 payload；`displayed`、`displayFailed` 和 `hidden` 必须匹配当前 `instanceGeneration`、`slotId` 与当前展示 `showRequestId`。`rewarded` 必须匹配奖励待决账本中的 generation/slot/request，即使 `hidden` 已到达或后续展示已经开始也仍可结算；没有对应记录的事件才丢弃并记为 `stale-event`：

```ts
interface NativeAdEvent {
  type: "initialized" | "loadStarted" | "loaded" | "loadFailed"
    | "displayed" | "displayFailed" | "hidden" | "rewarded"
    | "bannerExpanded" | "bannerCollapsed" | "bannerSizeChanged"
    | "appBackground" | "appForeground"
    | "networkAvailable" | "networkUnavailable";
  instanceGeneration: number;
  eventId: string;           // 原生回调首次归一化时生成，跨桥重投保持不变
  slotId: AdSlotId | null;  // 初始化和生命周期事件为 null
  format: AdFormat | null;
  showRequestId: string | null; // 初始化、load 和生命周期事件为 null；展示/奖励事件携带关联请求
  loadOperationId?: string;  // 应用主动 load 时由对应广告位的 RetryState 生成
  refreshEpoch?: number;     // Banner auto-refresh 启动代次
  phase: AdPhase;
  monotonicAtMs: number;
  code?: string;
  errorCategory?: string;     // 稳定分类，不是永久 SDK 枚举
  widthPx?: number;           // Banner 自适应尺寸，其他格式不传
  heightPx?: number;
}

interface AdUiNoticeEvent {
  type: "showUiNotice";
  code: "video-ad-unavailable";
  slotId: AdSlotId;
  showRequestId: string | null;
  dedupeKey: string;         // 同一次触发或展示失败只允许消费一次
}
```

服务首次创建时从 `instanceGeneration=0` 开始；实例重建（原生 SDK 重启、宿主切换或配置变更）必须先使旧实例失效，再将 `instanceGeneration` 加一；每次实际展示尝试生成进程内唯一 `showRequestId`。全屏事件按 generation/slot/request 关联：第一次 `rewarded` 才发放奖励，第一次 `displayFailed` 或 `hidden` 才结束该广告位的展示状态并立即预加载；迟到、重复或跨实例事件不得改变新实例 phase、奖励或计数。激励请求另存于幂等的奖励待决账本，`hidden` 只结束该广告位的展示状态，不能删除尚未结算的奖励资格。`interstitialBlockedUntilMonotonicMs` 放在不随 `instanceGeneration` 重建的进程内服务策略状态中；完整销毁广告服务或进程重启时可重新初始化为 `0`，无需跨进程持久化。

所有原生回调另带稳定 `eventId`，同一回调跨桥重投时不得重新生成，以此去重传输层重复。应用主动 load 的回调必须匹配当前 `loadOperationId`；Banner auto-refresh 的回调必须匹配当前活动 `refreshEpoch`。同一 refresh epoch 可以产生多轮合法 `loaded`，不能仅因 generation/slot 相同而丢弃；停止 auto-refresh 时立即使该 epoch 失效，之后到达的旧回调不得进入重试或改变可见性。上述类型中的 `phase` 只描述对应广告位自身，所有 gates 由原生服务依赖计算，不能镜像到 Cocos 场景状态。

至少定义下列结果码，并让所有不可展示情况在一次桥接往返内返回：

- `unsupported-platform`：Web/小游戏/no-op。
- `unknown-slot`、`format-mismatch`：广告位不存在或其格式与调用不一致。
- `layout-not-ready`、`banner-visible-conflict`：Banner 尚无安全布局，或当前 viewport 已有另一个可见 Banner。
- `not-initialized`、`initializing`、`privacy-pending`、`privacy-blocked`：初始化或合规前置未完成。
- `not-ready`、`loading`、`already-showing`：当前没有可立即展示的缓存广告，或同一广告位已有展示请求；其他广告位的展示状态不参与拒绝判定。
- `background`、`offline`、`no-host`：当前生命周期或网络不适合展示。
- `not-natural-break`：调用点不是明确的自然中断点，不发起展示。
- `rewarded-interstitial-delay`：匹配的激励视频结束后 30 秒内跳过插页展示；返回剩余毫秒数，不产生 UI 提示。
- `request-dispatched`：已向原生 MAX 发起展示请求；这不是展示成功确认。
- `already-ready`：当前全屏广告实例就绪属性已为 true，预加载无需再次发起。
- `load-started`、`load-in-flight`、`retry-scheduled`：预加载已发起、已有加载或已登记退避。
- `banner-create-failed`：本次 Banner 创建失败；当前展示请求仍有效时已登记独立退避恢复。
- `banner-load-started`：Banner 展示请求已受理并按需创建/加载，不表示已经可见。
- `banner-shown`、`banner-hidden`：Banner 已按当前状态立即显示或隐藏。
- `config-error`、`adapter-error`、`load-failed`、`display-failed`：可诊断失败。
- `video-ad-unavailable`：供 UI 层选择本地化 Toast 的稳定提示码；不得把 SDK 原始消息直接展示给用户。

原生事件至少要归一化为 `initialized`、`loaded`、`loadFailed`、`displayed`、`displayFailed`、`hidden`、`rewarded`、`bannerExpanded`、`bannerCollapsed`、`bannerSizeChanged`、`appBackground`、`appForeground`、`networkAvailable` 和 `networkUnavailable`。Banner 不依赖仅为全屏格式保留的 displayed/hidden 回调；事件可以晚于方法返回到达，不能用 `request-dispatched` 推断 `displayed` 或 `rewarded`。

## 多广告位状态与单一服务

每个广告位使用独立业务 `phase`、加载失败计数、retry deadline 和加载重试 timer；平台原生适配器持有格式匹配的 MAX 原生对象，Banner 另有独立 `bannerVisibility`。不能把“已加载”和“当前可见”混成一个 phase。服务级统一持有实例代次、Banner 可见性仲裁和 `interstitialBlockedUntilMonotonicMs`。该截止时间只表达激励视频结束后的 30 秒跨格式保护，不是广告位加载重试 deadline，也不创建 timer。广告服务仍是业务状态的单一所有者；每个广告位的加载重试独立定时，不得复制另一套退避算法。

### 广告实例就绪属性与预加载成功

插页与激励视频预加载是否成功，唯一依据是当前有效 MAX 广告实例对象的就绪属性。Android 官方示例在 `MaxInterstitialAd`/`MaxRewardedAd` 实例上调用 `isReady()`；iOS 使用对应 SDK 实例的 readiness API。`ready` 若作为项目适配对象只读字段，只能实时委托给原生对象，不能由事件单独缓存成可独立过期的布尔值。不得通过实例存在、load 方法受理、桥接消息发送成功或业务 `phase=ready` 推断广告已就绪。读取不得隐式创建实例、发起 load、请求网络或等待加载事件。

- 实例不存在、已销毁、代次不匹配或就绪属性读取失败时，一律按未就绪处理，不复用旧实例结果。
- `loaded` 只通知服务复核对应实例就绪属性；只有属性为 true 才确认全屏预加载成功、投影资源 phase 为 ready、清零该广告位失败计数并取消其重试任务。属性为 false 时不能停止恢复，清除本次已结束的 in-flight 标记，并由原有 `RetryState` 按同一退避规则登记一次重试，记录 `readiness-unconfirmed`；不得另建轮询 timer。
- `isReady`、`tryShow` 和后台准备投递 load 的入口都读取当前实例属性；业务 phase 仅用于加载、展示和请求去重。缓存 phase 与属性冲突时，以属性判断资源就绪；同广告位正在展示的请求仍保持 showing 与去重，不被就绪查询覆盖。资源属性已为 true 时停止无效重试且不重复 load；已为 false 时不能仅凭旧 phase 发起 show。`tryShow` 拒绝后立即返回，仍不顺带创建或预加载。
- Banner 不预加载；创建后的加载与刷新继续按其专属事件、loadOperationId/refreshEpoch 和可见请求管理，不假设官方存在 Banner 就绪查询属性。

### phase 与原生 gates 分离

`phase` 只描述一个广告位的资源/展示阶段（`new`、`initializing`、`failed`、`idle`、`loading`、`ready`、`showing` 或 `unsupported`）；它不是 Cocos 场景状态。`initializing` 与初始化 `failed` 是统一 SDK 初始化模块状态在广告门面的只读投影，广告服务不另持一份 SDK 初始化状态或重试器。以下 gates 是原生服务依赖，不能复制到场景状态机或由场景自行维护：

- `host`：Activity/ViewController provider 能否提供当前有效宿主；
- `foreground`：App 是否在前台并允许呈现全屏界面；
- `connectivity`：网络连通性监视器是否允许请求；
- `privacy`：除 MAX `hasUserConsent` 首次初始化配置外，其他实际适用广告请求/展示隐私条件是否达到 `ready`；不参与 MAX 初始化及初始化重试判定。`hasUserConsent=false` 本身不能产生 `privacy-pending` 或 `privacy-blocked`，初始化成功与用户选择分别记录，不能互相推断。

Cocos 场景只提供 `slotId` 与自然中断点上下文并消费结构化结果；`tryShow` 前由项目原生适配层读取该广告位当前实例就绪属性、phase 和共享 gates，任一 gate closed/unknown 都立即拒绝。前后台、断网、隐私变化和宿主切换由 Android/iOS 生命周期及 MAX 回调归一化后发布，恢复时重新计算 gates，而不是让场景写入广告 phase。

1. `new → initializing` 是统一 SDK 初始化模块状态在广告门面的投影；只由该模块首次有效投递 MAX 任务触发。相同配置的重复入口复用原请求，不重复创建 SDK/广告对象。广告服务不得直接启动 MAX 或持有第二套初始化重试。
2. MAX 真实初始化回调成功后，统一初始化模块通知广告服务，广告位业务状态进入 `idle`，再通过插页与激励视频各自服务入口去重投递一次预加载意图。Banner 保持未创建，不投递 load；初始化失败投影为 `failed`，恢复由统一初始化模块负责。隐私门只约束实际适用的广告请求/展示条件；不因 `hasUserConsent=false` 阻断请求或改变已确认的 SDK 初始化状态。
3. 每个全屏广告位的 `idle → loading → ready` 是一次独立加载生命周期；重复 `preload(slotId)` 先读取实例就绪属性，属性为 true 或仍有 in-flight load 时不重复加载；`preload(bannerSlotId)` 始终返回 `format-mismatch` 且不创建、不加载。预加载成功由当前实例就绪属性确认，`loaded` 仅触发复核，phase 是资源状态的投影。
4. 全屏广告的 `ready → showing` 只由 `tryShow` 触发，前提是当前实例就绪属性为 true、所有 gates open、自然中断条件成立且满足格式策略。插页还必须满足当前单调时间不早于 `interstitialBlockedUntilMonotonicMs`；保护期内返回 `rewarded-interstitial-delay`，不能调用 MAX 的 show，也不能在触发路径补做 load。
5. `showing → idle` 的 `displayFailed` 立即发起一次去重后的后台预加载；只有这次加载失败后才进入指数退避。`showing → idle` 的 `hidden` 也必须立即后台预加载。若该事件属于当前匹配的激励视频展示，请先以事件的 `monotonicAtMs + 30_000` 更新插页保护截止时间，再结束该广告位的展示状态并立即预加载；重复、迟到、旧实例或不匹配的 `hidden` 不得延长保护期。激励视频 `displayFailed` 不启动保护期。
6. 后台、离线、真实适用隐私条件未决或无有效宿主时保留当前 phase 快照，但不发起新的 load/show；`hasUserConsent=false` 本身不是暂停条件。恢复到前台且网络可用后重新计算 gates，并按保留的广告位退避 deadline 最多恢复一次调度。
7. 任何销毁、平台切换或配置变更都使旧回调携带的实例代次失效；旧事件不得把新实例推进到 `ready` 或重置新实例的计数。
8. Banner 初始未创建且 `bannerVisibility=hidden`。首次有效 `setBannerVisibility(true)` 记录可见请求，创建视图并发起加载，立即返回 `banner-load-started`；重复请求复用同一视图、in-flight load 或 retry timer。`loaded` 把 phase 置为 `ready`，仅当业务仍请求可见、gates open 且布局安全时显示。`setBannerVisibility(false)` 清除可见请求、取消待执行恢复 timer、停止刷新并立即隐藏；未创建时不创建视图。

每广告位的 deadline、失败计数、加载重试 timer 和正在加载标记，以及各广告位自己的正在展示标记、共享的奖励待决账本、插页保护截止时间和实例代次，都属于广告服务这个单一状态所有者。独立表示加载重试 timer 按 `slotId` 隔离，不表示由 Cocos 场景或组件自行创建；不得让场景、多个组件或多个原生回调各自维护另一份重试、保护时间或奖励状态。

### SDK 初始化与广告位恢复的边界

MAX 的初始化状态、真实完成回调、配置、失败分类、幂等、请求身份和初始化重试由[SDK 统一初始化](../../cocos-game-architecture/references/sdk-initialization.md)中的单一 TypeScript 所有者管理。原生插件/JSB 层只封装平台 API 并回传事件；广告服务只投影初始化状态、消费真实完成事件及管理各广告位自己的 load/create 恢复。初始化恢复不与广告位恢复共用 timer、计数、deadline 或实例状态；不得在 Scene、Component 或广告服务里复制 MAX 初始化任务。

MAX 初始化成功后，广告服务去重投递启用的插页与激励视频预加载意图；每个 load 仍检查实际广告请求隐私条件，未满足时保留该广告位意图，条件恢复后去重恢复。Banner 不参与初始化预加载。MAX 初始化失败、显式单 SDK 重试、网络/生命周期条件恢复和迟到回调按统一初始化规范处理；这些事件不得重跑其他 SDK 或直接改变广告位加载计数。

### MAX 初始化失败分类与独立自动重试

以下所有初始化状态和恢复规则均由 `assets/scripts/platform/initialize-sdks.ts` 内 MAX 独立任务持有，原生插件/JSB 只返回请求受理结果和带操作身份的 SDK 回调；广告服务只投影状态并管理广告位 load/create 恢复，不得复制初始化计数、deadline、timer 或重试逻辑。

- MAX 的真实初始化错误进入 `failed`，返回稳定错误类别和 `retryScheduled`，不阻塞游戏。相同配置的重复 `initialize` 复用 in-flight 请求或失败/恢复快照，不递归初始化，也不重置退避。
- 网络超时、网络服务暂不可用和明确的原生瞬时错误按 2/4/8/16/32/64 秒公式独立退避，使用与广告合同一致的 `0.8–1.2` 抖动并将最终延迟封顶在 64 秒；无次数上限，持续到成功、MAX 被禁用或该任务销毁。初始化连续失败次数、单调时钟 deadline、timer 和 in-flight 状态只由 MAX 任务保存；失败回调只登记任务，不同步递归初始化。
- `host`、`foreground` 或 `connectivity` 条件关闭时不发起新初始化。已有退避时暂停 timer，但保留失败计数与 deadline；条件变化不增加计数。配置/策略阻断及未知待诊断错误解除后，没有 deadline 时最多立即投递一次；到期的 deadline 才允许投递，未来 deadline 则按剩余时间恢复 timer。重复恢复事件不得重复请求。
- 缺失 SDK/adapter、无效配置、平台不支持或明确策略阻断不自动重试：取消 MAX 恢复 timer 并报告原因。修复配置/依赖或解除明确策略阻断后，才由调用方显式 `retryInitialize()`；未修复时返回原阻断。前台、网络、宿主或 CMP/ATT 状态变化不能替代修复或自动解除阻断。无法归类的错误先诊断，不凭自由文本无限退避，只有确认是瞬时故障后才进入自动重试。
- `retryInitialize()` 是同一 MAX 任务的手动入口：初始化进行中复用原请求；已有自动退避时复用原 deadline，不抢跑、不清零计数；宿主/前台/网络条件关闭时返回原因并保留待恢复意图。确定性配置问题修复后，清除对应阻断和旧失败计数，再受理一次新初始化；已成功则返回成功快照，不重复初始化。
- 每次原生尝试和回调都关联唯一操作身份及当前配置/实例代次。迟到、重复或旧实例回调不得覆盖当前状态、增加失败计数、重复启动恢复或再次投递预加载；配置替换、MAX 禁用、宿主实例重建或应用级初始化任务销毁时，使旧请求与 timer 失效。timer 执行前清空自身引用并复核代次、请求有效性、SDK 自身运行条件和非 in-flight 状态。
- 只有 MAX 真实初始化完成回调能确认成功。当前有效请求出现可观测的真实失败信号（同步调用异常、本地受理拒绝或 SDK 官方提供的失败回调）时，才按错误类别处理；单纯等待超时或没有任何回调时保留同一 in-flight 状态，不伪造失败或启动重试。
- 初始化成功立即清零 MAX 初始化失败计数、取消 timer、清空 deadline/恢复意图，并只向广告服务投递一次全部启用插页与激励视频的预加载意图；广告位继续检查真实广告请求隐私条件并分别恢复。Banner 不创建、不预加载。MAX 初始化任务与每个广告位 RetryState 完全隔离，任一侧的重试不共享或改写另一侧 timer、计数、deadline。

MAX 内建 Terms and Privacy Policy Flow 已在初始化前关闭，因此 MAX 初始化回调不得等待该弹窗。项目的 CMP/Google UMP/TCF 与 ATT 各自维护真实状态及用户界面，不与 MAX 初始化任务共用完成条件、失败计数或 timer；CMP/ATT 尚无结果、失败或用户拒绝都不能替代 MAX 的真实初始化回调，不能把 MAX 任务标为成功/失败或自动再次初始化。真实且有官方依据的前置只影响它明确约束的任务/广告请求，不伪造隐私结果。

## MAX 隐私配置与初始化时序

1. 唯一初始化入口检查受控平台配置、当前 Activity/ViewController、环境开关与原生 SDK 配置；Web/小游戏直接 no-op。Cocos 引擎和 AssetDB 按自身生命周期运行，不作为第三方 SDK 初始化的一部分。
2. 每个新 MAX 实例首次初始化前，通过锁定插件/SDK 支持的原生入口设置 `hasUserConsent=false`，并在初始化前关闭 MAX 内建 Terms and Privacy Policy Flow。Android 官方原生 API 为 `AppLovinPrivacySettings.setHasUserConsent(false)` 与 `AppLovinSdk.getInstance(context).getSettings().getTermsAndPrivacyPolicyFlowSettings().setEnabled(false)`；iOS 官方原生 API 为 `[ALPrivacySettings setHasUserConsent:NO]` 与 `[ALSdk shared].settings.termsAndPrivacyPolicyFlowSettings.enabled = NO`（Swift 使用 `isEnabled = false`）。随后由统一初始化模块调用当前版本的 MAX `initialize` 并只凭真实完成回调确认成功。按项目锁定 SDK/插件版本核验调用可用性和最终生效值。
3. 官方也支持原生资源配置 `consent_flow_enabled=false`（Android）和 `ConsentFlowEnabled=NO`（iOS）。如项目采用资源配置，应合并保留其他有效值，并检查打包后的有效配置；不能因官方页面演示启用示例而保留 `true`。关闭流程不等于关闭 SDK、跳过 MAX 初始化或完成用户同意收集。
4. 首次设置的 `hasUserConsent=false` 是 MAX 配置，不是用户已同意或拒绝的回执，不得据此伪造 CMP/TCF/ATT 结果或阻断初始化、广告请求和 load 重试。后续真实用户选择到达时按锁定插件官方接口同步，不由同实例初始化重试再次写入初始 `false` 覆盖。真实适用的 CMP/TCF、地区、网络及 ATT 条件继续由各自流程处理；确有官方前置时不得伪造完成，只阻断对应 SDK/广告动作并记录来源。
5. iOS `Info.plist` 按当前 AppLovin SKAdNetwork 页面与实际启用的 mediated networks 生成/维护 `SKAdNetworkItems`，不能复制过期固定清单。Android/iOS 隐私 manifest、数据安全声明、商店隐私资料和目标地区限制由发布责任人核对；ATT 描述和请求时序按平台官方流程及项目决策处理，不重复弹窗，也不把未授权结果说成已授权。
6. 若使用 Google UMP/CMP，核对实际消息配置、IAB TCF 与聚合网络覆盖；任何外部控制台配置由责任人在授权范围内完成。隐私状态由适配层按官方 API 如实读取/传递；广告请求门只表达确有适用的阻断条件，不能仅因 `hasUserConsent=false` 返回 `privacy-pending` 或 `privacy-blocked`。儿童数据、年龄限制和地区义务不能自行假设或绕过。

官方参考：[Android MAX Privacy](https://support.applovin.com/en/max/android/overview/privacy)、[iOS MAX Privacy](https://support.applovin.com/en/max/ios/overview/privacy)、[Android Terms and Privacy Policy Flow](https://support.applovin.com/en/max/android/overview/terms-and-privacy-policy-flow) 和 [iOS Terms and Privacy Policy Flow](https://support.applovin.com/en/max/ios/overview/terms-and-privacy-policy-flow)。

## 全屏广告静默预加载与独立持续重试

### 常规路径

- `initialize` 完成后，广告服务立即为全部启用的插页与激励视频广告位各投递一次后台静默预加载意图；隐私门未满足时保留意图，满足后去重发起实际 load；新增或重新启用的全屏广告位也通过该广告位的服务入口发起；Banner 仅在展示请求时创建并加载，禁止各业务组件自行 load。
- 全屏 `loaded` 事件先复核对应当前实例的就绪属性；仅属性为 true 时确认预加载成功、投影 phase 为 `ready`、清零 `consecutiveLoadFailures` 并清空自身 retry deadline 与 timer。属性为 false 时继续独立退避恢复；后台重试投递前也先读取属性，已就绪则取消重试，不重复 load。
- 全屏广告的 `hidden` 事件后立即静默预加载该广告位的下一条广告；`displayFailed` 事件立即发起一次去重后的静默预加载，但遥测原因与 load failure 分开。Banner 不使用这些全屏回调。只有新的加载请求失败时才进入加载退避。
- 所有 preload/loadFailed/retry 路径禁止 Toast、弹窗、loading 遮罩和声音；只有展示触发不可用或 `displayFailed` 才产生 UI 提示事件。

### 退避公式

对任何已发起加载的广告位的全部 load failure（包括 no-fill、网络错误、超时、configuration、adapter 和 unknown），都由该广告位自己的 `RetryState` 使用以下公式。每个广告位的 `consecutiveLoadFailures` 独立初始化为 `0`；该广告位每次新的 load failure 先递增，再计算 deadline：

```text
n = consecutiveLoadFailures（本次失败递增后的值，n >= 1）
基础延迟（秒）= min(2^n, 64)
抖动后延迟（秒）= 基础延迟 × random(0.8, 1.2)
最终延迟（秒）= min(抖动后延迟, 64)
```

第一次加载失败使用 2 秒，随后为 4、8、16、32、64 秒；继续失败时保持 64 秒封顶。64 秒档在启用抖动时的有效范围为 51.2–64 秒（先抖动、再封顶），不能出现超过 64 秒的最终 deadline。重试次数没有上限，持续重试直到成功；全屏广告仅在广告位禁用、配置移除或服务销毁时终止，运行 gates 关闭只暂停，恢复后继续。Banner 恢复任务还要求业务持续请求可见，主动隐藏后取消待执行恢复。成功加载立即把 `consecutiveLoadFailures` 清零。测试应支持关闭抖动并精确断言这六个基线值；生产可启用 `0.8–1.2` 抖动以减少多实例同时重试。

广告位独立定时规则：

1. 每个广告位的 `RetryState` 独立保存失败计数、`retryDeadlineMonotonicMs` 和 timer 引用；每次主动 load 生成唯一 `loadOperationId`。同一广告位最多一个待执行 timer 和一个 in-flight load，重排或取消只作用于该广告位。
2. timer 回调开始时先清空本广告位的 timer 引用，再检查实例代次、广告位启用状态、前台、在线、隐私、宿主及该广告位 phase；Banner 还必须处于当前有效展示场景且业务仍请求可见；待恢复操作为 create 时允许尚无视图，为 load 时必须已有有效视图；条件满足时只为该广告位投递一次 load，不扫描或触发其他广告位。
3. 后台或离线暂停时分别取消每个广告位的 timer，但保留各自基于单调时钟的 deadline，不把剩余时间改写成墙上时间。恢复前台、在线且 privacy ready 后，每个已到期广告位独立恢复至多一次请求；未到期广告位按自己的 deadline 重建 timer。
4. 每次加载失败只登记到发生失败广告位的 `RetryState`，不在 failure callback 内同步递归 `load`；不要使用零延迟轮询、组件级定时器、同一广告位的重复 timer 或重复事件订阅。
5. 已收到的 `loadFailed` 无论错误类别都登记持续退避重试，不因 configuration、adapter 或 unknown 类别停止或设置次数上限，并把诊断原因报告给控制面。隐私、前后台、网络和宿主 gates 关闭时保留重试任务但暂停请求，恢复后继续；MAX 初始化未成功时只由统一初始化模块持有独立的分类恢复任务，广告位恢复不代管或绕过该任务。Banner 只恢复由当前展示场景请求发起的创建或加载，隐藏或离开展示场景后取消待执行恢复；创建失败时可以在原展示请求有效期间重试创建，不能借重试创建从未请求展示的视图。
6. `displayFailed` 使用对应广告位的服务入口清理展示状态并立即请求一次静默预加载，不等待退避；若该加载随后失败，再从 2 秒开始计算并调度该广告位自己的加载重试 timer。不得把展示失败当作展示成功。

### 快速返回语义

`preload(bannerSlotId)` 返回 `format-mismatch` 且不创建、不加载；全屏广告位的 `preload(slotId)` 只返回 `already-ready`、`load-started`、`load-in-flight`、`retry-scheduled`、`background`、`offline`、`privacy-pending`、`no-host`、`unknown-slot` 或相应错误；它不等待 MAX `loaded`/`loadFailed`，也不产生 UI 提示。`isReady(slotId)` 对全屏广告读取当前实例就绪属性，对 Banner 读取其已创建视图的加载状态，不触发创建或加载。`tryShow(context)` 同样先复核全屏实例属性：属性为 true 且业务门通过时投递 show，否则立即返回，不得顺带调用 `preload` 或等待下一次加载。

## Banner 布局、显隐与刷新

### 提前规划 UI 布局

支持原生 Banner、广告位启用且当前页面允许展示时，页面必须在首帧前完成广告区域预留和游戏 UI 布局。这里的“允许展示”是平台能力、广告位配置与页面策略判定，不依赖 Banner 是否已创建、loaded、ready 或有填充；暂时离线、加载失败或隐私状态未决仍保持本页面既定布局，广告请求与实际显示继续遵守运行 gates。

布局模块提前根据当前平台支持的 Banner 格式尺寸规则、可用宽度、density/points/CSS 像素换算与 safe area，形成广告区域、内容 inset 和布局代次。尺寸计算必须使用项目所锁定插件/SDK 支持的规则或不创建视图的尺寸查询能力，不为测量提前创建 Banner 或发起 load。不支持 Banner、广告位禁用或页面明确不展示时，首帧采用无广告区域的布局。安全区与广告高度分开计算，不能重复叠加或把固定 50px/50dp 当作跨设备尺寸。

- Banner 的创建、loaded、失败、重试、显示、隐藏和刷新回调只控制原生广告视图，不修改游戏 UI 位置、内容 inset 或可用游戏区域；未加载或无填充时保留空的预留区域，不伪装成已加载广告，也不随请求结果收缩/撑开布局。
- 实际广告尺寸只用于验证能否安全放入预留区域。布局尚未预备或实际尺寸超出区域时，返回/记录 `layout-not-ready` 并保持广告隐藏，不在显示或 loaded 回调中挤压游戏 UI；尺寸未知时也不能猜测后先显示。
- 页面切换、窗口/方向/折叠屏或 safe-area 变化由布局模块发起新的布局周期：先隐藏广告并使旧布局代次失效，提前重新规划 UI，布局提交后再按当前可见请求显示。加载中的旧尺寸回调不得修改新布局；同一页面内临时隐藏或重试不触发布局周期。

### 原生视图和安全布局

- 每个 Banner 广告位在首次有效展示请求时创建一个原生 MAX ad view 并加载；初始化不创建、不预加载，`preload(bannerSlotId)` 返回 `format-mismatch` 且不触发原生 API。场景切换只通过 `setBannerVisibility` 显隐，不反复创建/销毁视图；服务销毁、配置移除或平台实例重建时才释放。
- 默认只允许在 viewport 顶部或底部显示一个 Banner。另一个 Banner 已可见时返回 `banner-visible-conflict`；所有实际显示路径（含 loaded、恢复 loaded、布局就绪和前台恢复）必须原子重新检查并取得可见权，冲突时保持隐藏；除非产品布局明确证明互不遮挡，否则不得叠放多个 Banner。
- Banner 位于原生视图层并遵守系统 safe area。内容 inset 在页面布局阶段按当前平台支持的尺寸规则预先确定，MAX 回调中的实际/自适应尺寸仅用于核对预留区域；不得把固定 50px/50dp 当作所有设备的真实高度，也不得把 Banner 尺寸乘入 Cocos 渲染 DPR。
- Banner 不得覆盖主要按钮、摇杆、手势热区、系统导航区域或付费/确认操作。可展示 Banner 的页面必须提前预留区域，不能等到 loaded 或展示时再提交 inset。未 ready 时广告视图保持隐藏且 `visible=false`，预留区域保持稳定，不使用错误尺寸挤压画面。
- 旋转、窗口尺寸变化、折叠屏状态或 safe-area 改变时，先隐藏并使旧布局代次失效，由布局模块先重新规划并提交 UI 布局；广告重新加载仅在官方当前 API 要求时进行，再在布局稳定且业务仍请求可见时显示，广告回调不负责调整 UI。旧尺寸回调不能覆盖新布局。

### 显隐快速返回

- `setBannerVisibility(slotId, true)` 检查平台、初始化、前台/宿主/网络/隐私 gate 和可见性仲裁；门关闭或冲突时立即返回原因。条件满足时记录当前场景的可见请求；已有创建/加载请求或重试任务时先复用并立即返回，不因视图尚未创建而绕过退避。无现有任务且未创建时才创建视图并加载、返回 `banner-load-started`；已有视图但处于 idle 或隐藏时取消了恢复任务的，复用视图，保留失败计数并按原 deadline 恢复加载，不重新创建。加载中或重试中复用现有任务并立即返回。ready 且布局安全时立即显示并返回 `banner-shown`；布局未就绪时保持隐藏并返回 `layout-not-ready`。首次加载完成后仅在可见请求仍有效且 gates/layout 满足时显示，禁止等待网络完成。
- `setBannerVisibility(slotId, false)` 无论当前 phase 如何都清除可见请求、使其请求代次失效、取消创建/加载重试与待恢复操作，幂等停止刷新并隐藏，返回 `banner-hidden`；离开展示场景必须调用此入口。Banner 未 ready、显隐失败或 loadFailed 都不显示视频不可用 Toast，也不阻塞 Cocos 场景。
- Banner 不使用全屏 `showRequestId`、`displayed`/`hidden`、激励账本。点击、展开和收起使用 Banner 专属回调；不得依赖官方标记为全屏保留的 displayed/hidden 回调判断 Banner 可见性。

### 创建失败重试与场景退出

- Banner 创建调用被拒绝、抛出异常或适配器确认创建失败时，保持视图未创建、广告隐藏，保留当前展示场景的可见请求；立即返回结构化 `banner-create-failed` 与 `retryScheduled`，不等待重试、不弹 Toast。适配器不得把调用受理或无返回值误判为创建成功，应按所锁定插件可观测的结果确认；不得臆造官方创建成功/失败事件。
- 创建与加载恢复共用该广告位唯一的 `RetryState` 和 timer，并记录待恢复操作为 create 或 load。创建失败计入同一连续失败计数，按 2/4/8/16/32/64 秒退避无限重试；timer 到期若尚无有效视图就重试创建，已有视图则复用并恢复加载。创建成功但加载尚未成功时不清零失败计数，收到有效 loaded 后才清零；不新增另一套创建重试 timer，也不在异常回调中递归创建。存在部分创建资源时，适配器先确认复用或清理失效资源，不能叠加多个视图。
- 可见请求必须关联当前展示场景的请求代次；每次创建/加载恢复都携带该代次。离开允许展示的场景（含 shutdown、destroy 或导航到不展示 Banner 的页面）时，场景通过共享门面调用 `setBannerVisibility(slotId, false)`：立即清除可见请求、使请求代次失效、取消 timer 和待恢复操作、停止刷新并隐藏视图；未创建时只取消任务，不创建视图。此处是取消，不是后台/离线时的暂停，不影响其他广告位或全屏预加载。
- 已发出的原生调用无法撤销时，迟到完成或失败仍按失效请求代次隔离；不得重新登记重试、显示广告、启动刷新或调整 UI。已创建的有效视图可以由服务保持隐藏供后续复用，失效的部分资源由适配器清理；不得保存已销毁的场景引用。
- 再次进入允许展示的场景时先按既定规则准备 UI 布局，由新展示请求建立新代次；旧 timer 和旧回调不能作用于新请求。重复请求仍去重，创建失败重试期间 UI 预留区域不变。

### 刷新单一所有者

- Banner 正常刷新只允许 MAX 原生 auto-refresh 作为所有者；禁止 Cocos、JavaScript、场景组件或通用 timer 另建固定刷新循环。刷新间隔和策略以 MAX 控制台与当前官方 API 为准，不在 Skill 中硬编码。
- 按当前 Android/iOS 官方 Banner 文档，在需要可靠暂停刷新时先对 ad view 设置 `allow_pause_auto_refresh_immediately=true`，再调用 `stopAutoRefresh()`；实现阶段必须按项目锁定 SDK 的当前文档复核该参数是否仍必需，并用平台测试证明停止后不再发起刷新，不能只根据方法已调用就判定成功。
- Banner 隐藏、App 进入后台、宿主失效或 privacy gate 关闭时停止/暂停 auto-refresh；重新请求显示时按 ready 状态立即显示，或按独立恢复任务继续加载；auto-refresh 仅在 ready 且 gates open 后恢复。显隐重复调用不得重复 start/stop 或注册 listener。
- 每次启动 Banner auto-refresh 都递增 `refreshEpoch`；正常刷新可在同一 epoch 内产生多轮 `loaded`。MAX 暴露给应用层的 load failure 必须先使 epoch 失效、可靠停止 auto-refresh、隐藏视图但保留当前可见请求，再仅在业务仍请求可见时由该 Banner 广告位自己的 `RetryState` 按退避公式登记一个 timer，避免 SDK 与手动恢复双重请求。恢复 `loaded` 后仅在业务仍请求可见且 gates/layout 满足时显示并开启新 epoch；业务隐藏后到达的回调不得重新显示，也不得启动重试或刷新。
- Banner 展开期间保持视图归属但禁止布局抖动；收起后恢复已确认尺寸。离开展示场景时取消创建/加载恢复任务并停止刷新；长期隐藏时停止刷新，均可保留已创建的有效视图，只有服务销毁或配置移除才销毁对象。

## 展示触发与视频失败提示

插页只放在用户自然停顿处，例如关卡完成、结算页进入前或明确的主视图切换后；激励视频只由明确的用户操作触发。不得在启动、首屏加载、输入手势中间、战斗关键帧、失败即时反馈、连续点击处理或网络请求等待期间强行打断。

- `tryShow` 先检查平台、`slotId`/格式和 `naturalBreak`；这些基础条件无效时返回各自结果。对基础条件有效的插页请求，随后优先用单调时钟检查 `interstitialBlockedUntilMonotonicMs`，再检查前台状态、privacy、宿主、该广告位当前实例就绪属性及同广告位展示状态。当前时间早于截止时间时固定返回 `rewarded-interstitial-delay` 和向上取整且不小于 1 的 `interstitialDelayRemainingMs`，即使资源同时未 ready 或某个运行 gate 关闭也不改报其他错误；不得调用 MAX show、等待或补做 load。
- 只在当前匹配的激励视频 `hidden` 事件到达时，将截止时间更新为 `max(现有截止时间, event.monotonicAtMs + 30_000)`。这 30 秒从视频关闭/结束回调起算，只阻断插页，不阻断 Banner、下一次激励视频、奖励结算或任何后台预加载；保护期自然过期，不创建 timer，也不因进程内 SDK 实例重建而提前清空。

最小调用方式应类似“发起展示尝试后立即结束当前同步处理”；禁止 `await ad.load()`、`await ad.showUntilHidden()` 或为了广告结果暂停 Cocos 更新。激励 show 受理时以 generation/slot/request 建立奖励待决记录；`rewarded` 事件可以在 `hidden` 前后到达，只要匹配一条仍有效且未失败的待决记录就异步发奖并原子标记已结算。`hidden` 不发奖也不删除待决记录，下一次展示不能覆盖上一条记录；`displayFailed` 将对应记录标为不可发奖。待决记录只能在发奖、明确展示失败或经过项目基于平台测试确定的有界结算窗口后清理，超时必须记录 `reward-settlement-timeout`。高价值或跨进程奖励应采用 MAX S2S rewarded callback 与服务端幂等账本。

### 视频广告不可用 Toast

- `tryShow` 因 `unknown-slot`、`not-initialized`、`privacy-pending`、`not-ready`、`loading`、`already-showing`、`background`、`offline`、`no-host` 或其他不可展示状态立即拒绝时，`ShowResult.noticeCode` 返回 `video-ad-unavailable`，并携带本次触发唯一的 `noticeDedupeKey`。共享 UI 层必须立即显示一次本地化 Toast，默认中文语义为“视频广告暂不可用，请稍后再试”。`rewarded-interstitial-delay` 是预期的插页静默跳过策略，不返回 `noticeCode` 或 `noticeDedupeKey`。
- 原生 show 已受理后若收到匹配当前 generation/slot/request 的 `displayFailed`，桥接层发布一个 `AdUiNoticeEvent`；UI 层按 `dedupeKey` 只显示一次相同 Toast。迟到、重复或旧实例回调不提示。
- 后台预加载失败、no-fill、退避重试、恢复调度和被动状态变化不产生 Toast；只有实际展示触发失败才提示，避免后台错误打扰用户。
- Toast 是 UI 反馈，不改变加载计数、奖励和游戏流程。原生适配层只发送稳定 `noticeCode`，不直接操作 Cocos UI，也不把 SDK 原始错误文本展示给用户。

## 展示失败、生命周期与断网

- MAX `displayFailed` 要记录脱敏原因码、结束该广告位当前展示状态、清除对应广告位失效 ready 标记、发布一次去重的 `video-ad-unavailable` UI 提示事件，并通过对应广告位的服务入口静默预加载；不得立即递归 show。
- MAX `hidden` 要结束该广告位展示状态并立即静默预加载同一广告位的下一条；匹配当前激励视频展示的事件还要先更新 30 秒插页保护截止时间。如果用户快速离开场景，预加载请求仍不得持有已销毁的 Cocos/Activity/ViewController。
- App 进入后台时禁止新的 show，并暂停 retry timer；回到前台后检查宿主、隐私和网络，再恢复各全屏广告位待执行的预加载；Banner 仅在当前展示场景和可见请求仍有效时恢复待执行的创建或加载；离开场景取消的任务不得随前台或网络恢复自动重启。不要因为前后台切换重置成功加载计数或重复注册 MAX listener。
- 网络不可用时不发起新 load/show，保留退避 attempt；网络恢复后按当前 attempt 恢复一次。离线期间调用 `tryShow` 必须快速返回 `offline`。
- 原生宿主暂不可用、旋转/导航期间 ViewController 不合法、Android Activity 被销毁时，立即返回 `no-host`；不阻塞等待宿主出现。

## 错误分类与处理原则

公开结果和遥测以稳定的类别为主，不能把某一版 MAX 或 adapter 的数字错误码写成永久公共枚举。原生层可在受控诊断中附带当前官方错误码，映射表按平台文档更新：

| 类别 | 常见含义/官方码示例 | 处理 |
| --- | --- | --- |
| `unsupported` | Web/小游戏或未实现的平台 | 立即 no-op，不初始化、不重试。 |
| `configuration` | 无效 ad unit、缺失 SDK/adapter、包名不匹配；例如 `-5603` | SDK 初始化配置错误修正后由统一初始化模块显式重试；加载失败持续退避重试并报告配置问题。 |
| `privacy` | 有来源的实际隐私阻断、ATT/CMP/SKAN 前置未完成 | 不请求广告；监听隐私状态变化后重新评估 gates。MAX 初始 `hasUserConsent=false` 不是同意回执或阻断原因。 |
| `lifecycle` | 无有效 Activity/ViewController、后台、宿主已销毁 | 快速返回并暂停调度；前台/宿主恢复后最多恢复一次。 |
| `connectivity` | 无网络、超时、网络错误；例如 `-1009`、`-1001`、`-1000` | SDK 初始化瞬时失败由统一初始化模块独立退避，离线暂停后按原 deadline 恢复；load 失败使用广告位独立退避。 |
| `no-fill` | 当前设备/地区无可用填充；例如 `204` | 视为瞬时 load failure，使用统一指数退避。 |
| `adapter` | adapter/第三方 SDK 载入失败、内部错误；例如 `-5001`、`-5209` | 记录渠道别名和类别，按 load 退避；依赖缺失则升级为 configuration。 |
| `concurrency` | 同广告位已有展示请求、广告未 ready 或 Banner 可见性冲突 | 不重试 show、不设置跨广告位全屏互斥；Banner 保持隐藏。 |
| `display` | 展示过程失败；iOS 例如 `-4205` | 独立记录，结束对应广告位展示状态并立即重新预加载。 |
| `unknown` | 无法归类的 SDK/桥接异常；例如 `-1` | SDK 初始化未知错误由统一初始化模块先诊断，确认瞬时后按 SDK 合同恢复；加载失败持续退避重试。gates 关闭时暂停，恢复后继续。 |

这些数字只是官方页面当前可能出现的示例，不是跨平台、跨版本的稳定接口；对外只保证类别、`code` 字符串和结构化状态。未知错误不得通过解析自由文本来决定是否展示，也不得因为错误回调重复而开启多个初始化或 load 任务。

## 遥测与安全

允许记录聚合且脱敏的事件：`initialize_started`、`initialize_completed`、`initialize_failed`、`initialize_retry_scheduled`、`preload_requested`、`load_succeeded`、`load_failed`、`retry_scheduled`、`show_requested`、`show_skipped_rewarded_delay`、`ad_displayed`、`display_failed`、`ad_hidden`、`banner_shown`、`banner_hidden`、`banner_expanded`、`banner_collapsed`、`banner_size_changed`、`reward_granted`、`ui_notice_requested`、`paused`、`resumed`。每条事件只保留事件名、平台、业务广告位、广告格式、稳定原因码、`consecutiveLoadFailures` 或初始化连续失败计数、保护期剩余毫秒数、延迟/耗时、phase 和可选的 canonical 网络别名。

禁止记录或上传 SDK key、MAX ad unit ID、网络 placement/账号凭证、IDFA/AAID、设备标识、用户标识、IP、完整 SDK 错误消息、完整 waterfall、竞价凭证、CMP 原文或可反推出个人的自由文本。原生错误对象只取稳定分类/数值码；原始日志仅限受控本地 debug，发布构建关闭敏感日志。

测试、debug、staging 和生产的 SDK key、ad unit、MAX Test Mode 与遥测端点必须隔离。SDK key 与 ad unit 通过不入库的生成式构建配置提供给原生适配器；广告网络账号凭证、Ad Review key 和服务器 API key 保持在 CI 秘密或原生构建配置中。广告模块不建立新的用户画像、个性化标识或绕过 CMP/ATT 的通道。

## 验收与测试矩阵

### 状态机和非阻塞单测

使用假的单调时钟、timer、原生适配器和网络/生命周期事件，至少覆盖：

- Web/小游戏所有入口均为 no-op，`isReady=false`，且不导入或触发原生 API。
- 重复 `initialize`、同广告位重复 `preload`、重复 `tryShow` 和重复 listener 回调保持幂等；每广告位最多一个 in-flight load 和一个待执行加载重试 timer，服务不存在共享加载重试 timer。
- 全屏 loaded 到达但实例就绪属性为 false 时不确认成功、不清零失败计数且继续退避；旧 phase 为 ready 但属性为 false 时禁止 show；phase 尚未同步但属性为 true 时按当前属性判断。重试执行前属性已为 true 时取消重试且不重复 load，成功只清理自身任务；实例缺失/销毁/旧代次/读取异常均不判成功，同广告位 showing 不被就绪查询覆盖。
- 用原生插件替身核验新实例首次初始化前先设置 `hasUserConsent=false` 并关闭 MAX 内建 Terms and Privacy Policy Flow，再调用 `initialize`；同实例重入/初始化重试不重复写入 false 或覆盖后续真实用户选择，新实例重新按首次配置执行。
- 使用永不结束、失败和返回真实状态的独立 CMP/ATT 替身验证：MAX 内建流程关闭后，MAX 的真实初始化回调可独立确认 SDK 成功，不等待 CMP/ATT 用户界面；CMP/TCF/ATT 的真实状态与错误只更新对应隐私任务，不改变 MAX 初始化状态。
- 对 MAX 任务的假时钟/原生回调分别验证瞬时错误的 2/4/8/16/32/64 秒退避、`0.8–1.2` 抖动及 64 秒硬上限；重复瞬时失败无次数上限。配置/依赖/明确策略错误修正前不自动请求；unknown 先诊断，不能凭错误文本无限退避。
- 分别注入当前有效请求的同步调用异常、本地受理拒绝和 SDK 官方失败回调，断言它们按真实失败信号分类；只有纯超时或完全无回调时保持 in-flight，不伪造失败或启动重试。
- 关闭 `host`、`foreground`、`connectivity` 任一门时验证暂停 timer 且保留单调 deadline 和失败计数；恢复时仅按 deadline 恢复一次，重复恢复事件不能重复投递。
- 初始化中和退避中的 `retryInitialize()` 分别复用 in-flight 请求或原 deadline，不抢跑、不重置计数；问题修复后只重新受理一次。旧/重复操作身份回调不能覆盖新状态或重复计数；配置替换、禁用和任务销毁使旧 timer/回调失效。
- MAX 回调未到时保持同一个 in-flight 状态，不伪造 `failed`、`retryScheduled` 或成功；有真实成功回调时仅一次清零初始化计数并投递全部启用全屏广告位的预加载，Banner 不创建，广告位恢复不改写 MAX 初始化 timer/计数。
- `hasUserConsent=false` 且无其他实际隐私阻断时，断言 `privacy=ready`，全屏预加载、Banner 按需加载、ready 展示和失败后的 load 重试正常执行；不得返回 `privacy-pending`/`privacy-blocked`，不得把 false 解释为同意、拒绝或 CMP/TCF 完成。
- 对统一 SDK 初始化模块验证 MAX 与 AppsFlyer 等已采用 SDK 独立投递；一个失败、拒绝或不回调不能延迟其他 SDK或游戏首帧。MAX 真实完成回调、失败分类、幂等和重试不由广告服务重复持有，SDK 重试与各广告位恢复 timer/计数/deadline 相互独立。
- 覆盖后台、离线、宿主条件恢复与初始化配置修正：只恢复 MAX 自己的待办/退避，不重跑其他 SDK；初始化事件不改变广告位 load 失败计数，不因 MAX 内建流程显示/隐藏而转换状态。
- 初始化成功立即静默预加载全部启用的插页与激励视频广告位；任一广告位 load success 只清零自身计数；所有已发起加载的广告位 load failure 都使用相同的 2/4/8/16/32/64 秒公式并封顶，抖动在 0.8–1.2 范围内且最终不超过 64 秒。
- 重试超过六次乃至任意次数仍继续，configuration、adapter、unknown 加载失败不停止；禁用/移除/销毁终止重试，gates 暂停后恢复，初始化失败不混入 load 重试。
- 不存在全屏共享锁、fullscreen gate 或跨广告位 already-showing 判定；不同广告位独立展示，同一广告位重复请求仍去重。
- 多广告位同时失败时，各广告位的任务、deadline 和 timer 完全独立；取消或触发一个广告位的 timer 不改变其他广告位。后台、离线、无宿主和隐私阻断时分别暂停，恢复后每个到期广告位只恢复一次，不产生递归风暴、零延迟循环或同广告位重复 timer。
- 初始化不创建任何广告视图或主动创建全屏对象，只立即预加载插页/激励；Banner 不参与预加载，`preload(bannerSlotId)` 返回 `format-mismatch`。首次有效展示请求创建并加载 Banner，重复请求不重复创建或 load；loaded 仅在可见请求仍有效且 gates/layout 满足时显示；隐藏取消恢复任务，迟到回调不重新显示，未创建时隐藏不创建。
- Banner 创建同步异常、调用拒绝或可观测创建失败均持续退避重试，创建与加载共用一个 timer 和失败计数；重复失败不递归创建、不叠加视图，创建成功不提前清零计数。
- 在创建重试、加载重试或原生请求进行中离开展示场景，立即取消待执行任务并失效请求代次；随后 timer、创建完成、loaded/loadFailed、网络或前台恢复均不重启任务、不显示广告。重新进入后的新展示请求不受旧回调影响，且不改变其他广告位任务或提前预留的 UI 布局。
- 两个 Banner 同时按需加载，loaded/恢复/布局就绪再次原子检查可见权，最多显示一个；隐藏后再次展示复用视图并按原 deadline 恢复加载，不重复创建或丢失失败计数。
- 可展示 Banner 的页面首帧前已预留区域；规划期间不创建 Banner、不发起 load。加载成功/失败、无填充、持续重试、显隐及刷新前后，游戏 UI 位置、内容 inset 和可用游戏区域保持一致；不支持、禁用或页面禁止 Banner 时首帧不预留。
- 实际 Banner 尺寸超出预留区域或布局未就绪时保持隐藏，不在广告回调中重排游戏 UI；方向/窗口/safe-area 变化先隐藏并由布局模块重新提交，旧回调不污染新布局；主要按钮和手势区不遮挡，内容 inset 不修改 Cocos DPR。
- Banner 只有 MAX auto-refresh 一个正常刷新所有者；隐藏/后台时停止，重新显示时恢复；load failure 先停止 auto-refresh，再向该 Banner 广告位自己的 `RetryState` 只登记一次，避免 SDK 与手动恢复双重 load。
- 连续 Banner auto-refresh 成功回调在同一 `refreshEpoch` 内均被处理；重复桥接事件按 `eventId` 去重。refresh failure 使旧 epoch 失效，随后旧回调不改变状态；该广告位的 retry timer 恢复 load 时使用新的 `loadOperationId`。
- 未 ready、同广告位已经展示、非自然时机和 display failure 都立即返回并继续业务流程。
- 匹配的激励视频 `hidden` 后第 0–29,999 毫秒内，基础条件有效的插页 `tryShow` 均优先返回 `rewarded-interstitial-delay`、准确剩余毫秒数且不调用 MAX show、不产生 Toast，即使广告未 ready 或运行 gate 关闭也保持该结果；第 30,000 毫秒恢复正常判定。重复/迟到/旧实例 `hidden`、激励 `displayFailed` 和插页 `hidden` 不得启动或延长保护期；保护期不影响 Banner、激励视频和后台预加载，不创建 timer，不随进程内 `instanceGeneration` 重建而清空。
- 所有 preload/load failure/retry 路径不产生 Toast；除 `rewarded-interstitial-delay` 按节奏静默跳过外，`tryShow` 立即拒绝时返回 `video-ad-unavailable`，异步 display failure 发布一次同码 UI 事件，重复/迟到回调按 dedupeKey 不重复提示。
- Banner 未 ready、布局失败、加载失败和显隐冲突均保持隐藏且不产生视频 Toast，不使用激励账本。
- hidden 和 display failure 都立即静默重新预加载对应广告位；销毁后的旧回调不会污染新实例。
- 激励视频只在匹配奖励待决账本的 `rewarded` 事件到达时发奖，同一 `showRequestId` 最多发放一次；覆盖 hidden→rewarded、开始新展示后旧 rewarded、display failure 后 rewarded、重复 rewarded 和结算超时，确保不漏发、不串单、不重复发奖。
- 使用永不返回广告事件的 fake 原生适配器：结算调用 `void ad.tryShow(context)` 后仍立即推进下一场景；断言适配器调用只等待本地受理/拒绝，不等待 `loaded`、`displayed`、`hidden` 或任何广告回调。

### 原生与渠道验收

在已批准的环境中分别执行 Android 与 iOS 编译/集成检查，并在 MAX Test Mode、Mediation Debugger 或同等官方测试工具中按平台、渠道和格式逐项验证。某渠道在当前平台不支持 Banner、插页或激励视频时，必须记录官方证据并标记 `not-supported`，不能伪造通过：

| 渠道 | 必验别名 | 最低证据 |
| --- | --- | --- |
| AppLovin | `applovin` | MAX 初始化；Banner load/显隐/刷新；插页与激励视频 load/display/hidden/reward；测试模式和 waterfall 可见。 |
| Google AdMob | `admob` / Google Bidding and Google AdMob | adapter/SDK 状态、当前支持格式的测试广告、自适应 Banner、Google CMP/TCF 配置。 |
| Mintegral | `mintegral` | Android/iOS adapter 状态、当前支持格式的测试广告、隐私传递。 |
| Pangle | `pangle` | adapter 状态、当前支持格式的测试广告、目标国家/地区配置和 SKAdNetwork/隐私要求。 |
| Unity Ads | `unity` | MAX Unity Ads adapter 状态、当前支持格式的测试广告和展示/奖励回调。 |
| DT Exchange | `dt-exchange` / Fyber | MAX DT Exchange adapter 状态、当前支持格式的测试广告和失败回调。 |
| Verve | `verve` / PubNative / HyBid | MAX Verve adapter 状态、当前支持格式的测试广告和失败回调。 |

发布前还要绑定 `app-ads.txt`、iOS SKAdNetwork IDs、ATT、隐私 manifest、商店数据安全/隐私声明和 Google CMP 证据。不要以“MAX SDK 初始化成功”或“AppLovin 单渠道有填充”代替七项渠道验证。真实广告流量、生产 waterfall、商店上传、真机验收和外部渠道修改属于受保护动作，须由 `$cocos-game-workflow-control` 逐对象处理。

## 官方 AppLovin 资料

页面会随 SDK 和控制台更新；每次实施先打开当前页面，核对平台要求、支持网络、adapter、隐私、地区和错误码。以下均为 AppLovin 官方来源：

- [Android MAX SDK Integration](https://developers.applovin.com/en/max/android/overview/integration/)
- [iOS MAX SDK Integration](https://developers.applovin.com/en/max/ios/overview/integration/)
- [Android Banner & MREC Ads](https://developers.applovin.com/en/max/android/ad-formats/banner-and-mrec-ads/)
- [iOS Banner & MREC Ads](https://developers.applovin.com/en/max/ios/ad-formats/banner-and-mrec-ads/)
- [Android Interstitial Ads](https://developers.applovin.com/en/max/android/ad-formats/interstitial-ads/)
- [iOS Interstitial Ads](https://developers.applovin.com/en/max/ios/ad-formats/interstitial-ads/)
- [Android Rewarded Ads](https://developers.applovin.com/en/max/android/ad-formats/rewarded-ads/)
- [iOS Rewarded Ads](https://developers.applovin.com/en/max/ios/ad-formats/rewarded-ads/)
- [Android Preparing Mediated Networks](https://developers.applovin.com/en/max/android/preparing-mediated-networks/)
- [iOS Preparing Mediated Networks](https://developers.applovin.com/en/max/ios/preparing-mediated-networks/)
- [Android Error Handling](https://developers.applovin.com/en/max/android/overview/error-handling/)
- [iOS Error Handling](https://developers.applovin.com/en/max/ios/overview/error-handling/)
- [Android Privacy](https://developers.applovin.com/en/max/android/overview/privacy/)
- [iOS Privacy](https://developers.applovin.com/en/max/ios/overview/privacy/)
- [Android Terms and Privacy Policy Flow](https://developers.applovin.com/en/max/android/overview/terms-and-privacy-policy-flow/)
- [iOS Terms and Privacy Policy Flow](https://developers.applovin.com/en/max/ios/overview/terms-and-privacy-policy-flow/)
- [iOS SKAdNetwork](https://developers.applovin.com/en/max/ios/overview/skadnetwork/)
- [SDK Bidder Network Guides](https://developers.applovin.com/en/max/mediated-network-guides/sdk-bidder-network-guides/)
- [Traditionally Mediated Network Guides](https://developers.applovin.com/en/max/mediated-network-guides/traditionally-mediated-network-guides/)
- [MAX Dashboard: Connect Networks](https://developers.applovin.com/en/max/max-dashboard/networks/connect-networks/)
- [Android Mediation Debugger](https://developers.applovin.com/en/max/android/testing-networks/mediation-debugger/)
- [iOS Mediation Debugger](https://developers.applovin.com/en/max/ios/testing-networks/mediation-debugger/)
- [Android Test Mode](https://developers.applovin.com/en/max/android/testing-networks/test-mode/)
- [iOS Test Mode](https://developers.applovin.com/en/max/ios/testing-networks/test-mode/)
- [MAX Getting Started](https://developers.applovin.com/en/max/getting-started/)

如果官方页面改名、重定向或把网络拆成新的平台章节，保留本合同的行为不变量，并把新页面、版本和审查结论写入当前 Work Item，而不是在代码中猜测旧 API。
