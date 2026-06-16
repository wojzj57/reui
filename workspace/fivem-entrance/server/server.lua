-- ReUI fivem-entrance server（RFC-009 §8.3）
--
-- 占位 + 扩展点。RFC-002 的「服务端扫描插件目录、校验签名、下发清单」
-- 最终落在这里。第一阶段仅下发一个静态（空）清单，供 Runtime 的
-- PluginManager 后续加载使用。

RegisterNetEvent('reui:server:requestManifest', function()
  local src = source
  -- TODO(RFC-002): 扫描 plugins 目录 + 校验签名 + 下发清单。
  TriggerClientEvent('reui:client:manifest', src, {})
end)
