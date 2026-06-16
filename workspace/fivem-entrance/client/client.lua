-- ReUI fivem-entrance client（RFC-009 §8.2）
--
-- 职责：
--   1. 资源就绪后向 NUI 发 reui:init 握手，把 resourceName 推给 Runtime
--      （NuiBridge 取顶层字段 resourceName，见 RFC-009 §7.1 / nui-bridge.ts）；
--   2. 把 Runtime 的 sendToGame 调用桥接到游戏（RegisterNUICallback）；
--   3. 按 Layer 焦点需求管理 SetNUIFocus，并保证关闭时复位，避免卡死输入。

-- 1. 握手：把 resourceName 推给 Runtime。
AddEventHandler('onClientResourceStart', function(res)
  if res ~= GetCurrentResourceName() then return end
  SendNUIMessage({ type = 'reui:init', resourceName = GetCurrentResourceName() })
end)

-- 2. 焦点控制：Runtime 通过 sendToGame('reui:setFocus', { keyboard, cursor }) 请求。
--    默认不开焦点；只有 Panel/Overlay 需要交互时才开启，关闭时务必复位。
RegisterNUICallback('reui:setFocus', function(data, cb)
  local keyboard = data ~= nil and data.keyboard == true
  local cursor = data ~= nil and data.cursor == true
  SetNUIFocus(keyboard, cursor)
  cb({ ok = true })
end)

-- 3. 业务回调示例：Runtime sendToGame('reui:log', { message }) → 此处接收。
RegisterNUICallback('reui:log', function(data, cb)
  local message = data ~= nil and data.message or ''
  print(('[ReUI] %s'):format(tostring(message)))
  cb({ ok = true })
end)

-- 4. 反向推送游戏事件到 Runtime：转成 nui:<event>，由 NuiBridge → EventBus。
RegisterNetEvent('reui:client:push', function(event, payload)
  SendNUIMessage({ type = ('nui:%s'):format(event), payload = payload })
end)
