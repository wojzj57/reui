# FiveM Resource Manifest

> 来源: https://docs.fivem.net/docs/scripting-reference/resource-manifest/
> 抓取日期: 2026-05-29

## 概述

资源清单文件名为 `fxmanifest.lua`（旧名为 `__resource.lua`），放置在服务器上的资源文件夹内。这是一个在独立运行时中执行的 Lua 文件，使用半声明式语法来定义元数据。

---

## 核心元数据字段

### `fx_version`

指定资源支持的功能级别。当前的 FXv2 版本是 `cerulean`。

```lua
fx_version 'cerulean'
```

### `games`

定义支持的游戏 API 集合。可选值：

- `common` — 通用资源
- `gta5` — GTA V (FiveM)
- `rdr3` — RDR2 (RedM)

```lua
games { 'gta5', 'rdr3' }
-- 或单一游戏
game 'gta5'
```

### `author`

资源创建者的名称，可选附带邮箱。

```lua
author 'Your Name <you@example.com>'
```

### `description`

资源用途的简要说明。

```lua
description 'A brief explanation of the resource.'
```

### `version`

资源的版本号。

```lua
version '1.0.0'
```

---

## 脚本加载指令

### `client_script`

在客户端加载脚本。支持 glob 通配符。文件扩展名决定处理方式：

- `.lua` → Lua 源文件
- `.net.dll` → .NET 程序集
- `.js` → JavaScript

```lua
client_script 'client.lua'
client_scripts {
    'cl_*.lua',
    'shared/**/*.lua'
}
```

### `server_script`

在服务端加载脚本。支持 glob 通配符及与客户端相同的扩展名类型。

```lua
server_script 'server.lua'
server_scripts {
    'sv_*.lua'
}
```

### `shared_script`

同时在客户端和服务端加载。支持 glob 通配符。

```lua
shared_script 'config.lua'
shared_scripts {
    'shared/*.lua'
}
```

---

## UI 与文件

### `ui_page`

将资源的 NUI 页面设置为指定文件或 URL。

```lua
ui_page 'html/index.html'
-- 或外部 URL
ui_page 'https://example.com/page.html'
```

### `file` / `files`

将文件加入资源 packfile 中以供客户端下载。

```lua
file 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js'
}
```

---

## 数据管理

### `data_file`

将数据文件加入游戏的额外内容（extra content）系统。需要指定文件类型，例如：

- `AUDIO_WAVEPACK`
- `VEHICLE_METADATA_FILE`
- `HANDLING_FILE`

```lua
data_file 'HANDLING_FILE' 'data/handling.meta'
data_file 'VEHICLE_METADATA_FILE' 'data/vehicles.meta'
```

### `replace_level_meta`

用指定的资源文件替换游戏的 level meta。

```lua
replace_level_meta 'data/levels_gta5.meta'
```

### `before_level_meta`

在主 meta 加载之前加载 level meta。

```lua
before_level_meta 'data/before_levels.meta'
```

### `after_level_meta`

在主 meta 加载之后加载 level meta。

```lua
after_level_meta 'data/after_levels.meta'
```

---

## Exports 与依赖

### `export`

定义客户端脚本导出的函数（供 Lua/JS 调用）。

```lua
export 'GetSomething'
exports {
    'GetSomething',
    'DoAction'
}
```

### `server_export`

从服务端脚本导出函数。

```lua
server_export 'ServerSideFunction'
server_exports {
    'GetPlayerData',
    'UpdateRecord'
}
```

### `dependency` / `dependencies`

要求指定的资源先加载完成。支持运行时约束：

- `/server:4500` — 服务器构建版本
- `/policy:subdir_file_mapping` — 服务器策略
- `/onesync` — OneSync 启用
- `/gameBuild:h4` — 游戏构建版本
- `/native:0xE27C97A0` — 特定 native 函数

```lua
dependency 'es_extended'

dependencies {
    'oxmysql',
    '/server:4500',
    '/onesync',
    '/gameBuild:h4'
}
```

---

## 资源分类

### `this_is_a_map`

将资源标记为 GTA 地图，加载时会重新加载 map storage。

```lua
this_is_a_map 'yes'
```

### `server_only`

阻止客户端下载该资源的文件（仅服务端使用）。

```lua
server_only 'yes'
```

### `provide`

将当前资源标记为指定资源的替代品。

```lua
provide 'mysql-async'
```

---

## 加载屏

### `loadscreen`

将 HTML 文件设置为游戏的加载屏幕。

```lua
loadscreen 'html/loadscreen.html'
```

### `loadscreen_manual_shutdown`

防止加载屏 NUI 在数据加载完成后自动关闭，需通过 native 手动关闭。

```lua
loadscreen_manual_shutdown 'yes'
```

### `loadscreen_cursor`

控制加载屏内是否显示鼠标光标。

```lua
loadscreen_cursor 'yes'
```

---

## 高级配置

### `lua54`

启用 Lua 5.4（现已默认开启，该选项被弃用）。

```lua
lua54 'yes'
```

### `node_version`

为服务端脚本选择 NodeJS 版本（`16` 或 `22`）。

```lua
node_version '22'
```

### `use_experimental_fxv2_oal`

为 Lua 启用 One Argument List（OAL）模式，提升性能但需要手动解包 vector 类型。

```lua
use_experimental_fxv2_oal 'yes'
```

### `clr_disable_task_scheduler`

在服务端禁用自定义 C# task scheduler，以兼容某些第三方库。

```lua
clr_disable_task_scheduler 'yes'
```

### `convar_category`

将 convar 加入 FxDK 的 Project Settings 面板。支持类型：

- `CV_STRING` — 字符串
- `CV_BOOL` — 布尔值
- `CV_INT` — 整数
- `CV_SLIDER` — 滑块
- `CV_COMBI` — 组合
- `CV_PASSWORD` — 密码
- `CV_MULTI` — 多选

```lua
convar_category 'My Resource' {
    'My Resource Settings',
    {
        { 'Server Name', 'sv_serverName', 'CV_STRING', 'Default Server' },
        { 'Max Players', 'sv_maxPlayers', 'CV_INT', '32' },
        { 'Enable Feature', 'feature_enabled', 'CV_BOOL', 'false' }
    }
}
```

### `escrow_ignore`

指定使用 Asset Escrow 时要忽略（不加密）的文件。

```lua
escrow_ignore 'config.lua'
escrow_ignore 'shared/*.lua'
```

### `disable_lazy_natives`

禁用 native 的延迟加载机制。

```lua
disable_lazy_natives 'yes'
```

---

## 清单版本

资源必须指定一个 FXv2 版本：

| 版本 | 发布时间 | 说明 |
|------|---------|------|
| **cerulean** | 2020-05 | 在安全上下文中加载 NUI（**推荐当前版本**） |
| **bodacious** | 2020-02 | 禁用 task scheduler；在 JS 中移除 `window` |
| **adamant** | 2019-12 | 要求指定 game；RedM 必需 |

旧的 manifest GUID 出于向后兼容仍然存在，但已被弃用。

---

## 完整示例

```lua
fx_version 'cerulean'
games { 'gta5' }

author 'ReUI Team'
description 'Example FiveM resource using ReUI framework'
version '1.0.0'

shared_scripts {
    'config.lua',
    'shared/*.lua'
}

client_scripts {
    'client/main.lua',
    'client/cl_*.lua'
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server/main.lua',
    'server/sv_*.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/app.js',
    'html/assets/**/*'
}

dependencies {
    'oxmysql',
    '/server:5848',
    '/onesync'
}

exports {
    'GetClientData'
}

server_exports {
    'GetServerData'
}

lua54 'yes'
```

---

## 参考链接

- 官方文档: https://docs.fivem.net/docs/scripting-reference/resource-manifest/
- FXv2 版本说明: https://docs.fivem.net/docs/scripting-reference/resource-manifest/fxmanifest/
- Data file 类型列表: https://docs.fivem.net/docs/scripting-reference/resource-manifest/data-files/
