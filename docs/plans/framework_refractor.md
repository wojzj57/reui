| 组件 | 文件 | 用途 | 对应 RFC-004 | 适合迁移？ | 说明 |
|---|---|---|---|---|---|
| App | Framework/App | 顶栏应用壳 | — | **否** | 整文件注释掉的死代码 |
| Error | Framework/Error | — | — | **否** | 空文件 |
| Content | Framework/Content | 异步初始化容器 + 加载动画 | Panel/Loading | **重构** | 保留 onInit + 加载态概念，修 useEffect 依赖，去 antd/framer 重写 |
| Frame | Framework/Frame | iframe 全屏嵌网页 | — | **否** | 与新 Runtime（iframe 宿主）职责冲突 |
| Embed | Framework/Embed | iframe 弹窗嵌网页 | — | **否** | 同上 |
| Glass | Framework/Glass | 玻璃拟物容器（SVG 滤镜） | (Panel 视觉) | **概念** | 视觉效果吸收进 Panel/主题，参数需可配置（现全硬编码） |
| theme.ts | Framework/theme.ts | antd dark/light + lodash combine | 主题系统 | **否** | 已被 `framework/src/theme`（tokens/deepMerge/tokensToCssVars）取代且更优。`combine` = 已有 `deepMerge` |
| Input/Checkbox | Framework/Input/Checkbox | 自定义勾选框 | Checkbox | **重构** | 保留，使用antd |
| Input/Number | Framework/Input/Number | 数字输入 | NumberInput | **重构** | 同上，去掉硬编码 `#000` |
| Input/Select | Framework/Input/Select | 下拉（自定义箭头） | Select | **重构** | 交互保留，使用antd |
| Input/Slider | Framework/Input/Slider | 滑块 + 居中范围条 | Slider | **重构** | 范围条双色可视化是亮点，值得吸收 |
| Input/Title | Framework/Input/Title | 行内可编辑文本 | Input | **重构** | 概念保留，清理未用 `createRef` |
| Input/Radio | Framework/Input/Radio | 按钮组单选 | (Button group) | **重构** | 吸收，修 typo `ExConpactSelector` |
| Input/SelectInput | Framework/Input/SelectInput | tags 多选 | Select(多选) | **否** | onChange 逻辑有 bug，合并进 Select 多选模式 |
| Input/Upload | Framework/Input/Upload | 拖拽上传 | — | **重构** | NUI 内上传场景少，降优先级；事件清理/`enablePaste` 死代码 |
| Input/Birth | Framework/Input/Birth | 生日选择 + 算年龄 | — | **重构** | 2010 截断、年龄计算逻辑可吸收 |
| Item (Item/Card/ListItem) | Framework/Item | 字段行 / 卡片 / 列表项 | List/Stack | **重构** | ListItem 的 hover 删除交互可吸收 |
| Loading (Screen/Loading) | Framework/Loading | 全屏/区域加载 | Loading | **重构** | 概念保留，去掉硬编码 "CAEP" 与中文 |
| Navigation | Framework/Navigation | 竖向图标导航 | — | **概念** | 通用性一般，可作 sample，不进核心库 |
| Menu | Framework/Menu | antd Menu 包装 | ContextMenu | **否** | 仅改 prefixCls，价值低；RFC 要 使用antd ContextMenu |
| Message | Framework/Message | 全局轻提示（单例） | Toast | **概念** | import 期 `throw`、挂载后才可用的竞态。命令式 API 思路保留，实现重写 |
| Modal | Framework/Modal | antd Modal 默认值包装 | Dialog | **概念** | RFC 要焦点陷阱/ESC/ARIA，使用antd |
| Presence | Framework/Presence | valtio 全局命令式弹窗 | Dialog(命令式) | **重构** | `ExPresence.open()/close()` 命令式 API 设计好，吸收到 Dialog |
| Progress (number/loop) | Framework/Progress | 进度条 | ProgressBar/StatBar | **重构** | 吸收，修 typo `segmengts`，loop 动画参数 token 化 |