下一步行动：

1. 确认项目为 Cocos Creator 3.8.6 的空白 2D 项目。
2. 将目标平台设为 Web Mobile，屏幕方向设为竖屏。
3. 因未提供自定义设计分辨率，采用竖屏默认值 `720 × 1280`。
4. 初始化首个 2D 场景及 Canvas，并将 Canvas 设计分辨率设为 `720 × 1280`。
5. 暂不创建具体业务界面，等待后续页面或功能需求。

准备写入的状态文件示例：

```json
{
  "workflow": "web-mobile",
  "status": "initialized",
  "engine": {
    "name": "cocos-creator",
    "version": "3.8.6"
  },
  "project": {
    "type": "2d",
    "isEmpty": true
  },
  "display": {
    "orientation": "portrait",
    "designResolution": {
      "width": 720,
      "height": 1280,
      "source": "default"
    }
  },
  "nextStep": "create-initial-scene"
}
```

状态迁移：

```text
未初始化
→ 已确定 Web Mobile 工作流
→ 已确定竖屏方向
→ 已应用默认设计分辨率 720 × 1280
→ 等待创建初始场景
```

理由：竖屏方向已经明确，但缺少自定义设计分辨率，因此使用常见的竖屏默认基准，避免初始化流程因非必要参数而中断。实际写入前仍需以项目约定的状态文件路径和字段格式为准。
