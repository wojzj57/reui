fx_version 'cerulean'
game 'gta5'

author 'ReUI Team'
description 'ReUI Runtime host — entrance resource for the ReUI plugin framework'
version '0.0.0'

-- NUI 宿主页面（Vite 构建产物）
ui_page 'dist/index.html'

-- 必须显式收录全部产物，否则 CEF 取不到 assets
files {
  'dist/index.html',
  'dist/**/*',
}

client_script 'client/client.lua'
server_script 'server/server.lua'
