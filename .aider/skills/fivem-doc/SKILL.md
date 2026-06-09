---
name: fivem
description: FiveM/RedM scripting reference — fxmanifest.lua, NUI/postMessage, native functions, client/server scripts, events, exports, convars, OneSync, runtimes (Lua/JS/C#), and game references (blips, checkpoints, controls, vehicles, peds, weapons, zones). Use when writing FiveM resources, configuring fxmanifest, debugging NUI, looking up natives or events, integrating with built-in resources (chat, baseevents, mapmanager, spawnmanager, sessionmanager, loadscreen, txAdmin), or reading FiveM/RedM platform/security/sandbox docs.
---

# FiveM scripting reference

Mirror of the official FiveM docs (https://docs.fivem.net) bundled as Claude-readable references. Covers GTA V (FiveM) and RDR2 (RedM) scripting.

All Hugo shortcodes have been pre-resolved to plain Markdown:
- `{{% native_link "NAME" %}}` → `` [`NAME`](https://docs.fivem.net/natives/?_HASH) `` (real hashes)
- `{{% alert %}}` → GitHub callouts (`> [!NOTE]` / `[!TIP]` / `[!WARNING]` / `[!CAUTION]`)
- `{{% code file=... %}}` → inlined fenced code blocks
- `{{% events "client|server" %}}` → bullet lists with anchor links
- `{{% rmv2 %}}` → `cerulean`, `{{% rmv %}}` → legacy GUID

The reference tree mirrors the URL structure of `docs.fivem.net/docs/`. Section landing pages (the `_index.md` files used by Hugo) have been removed from this bundle; the directory listings below replace them. Leaf `.md` files are individual articles.

---

## How to use this skill

**To answer a FiveM question:**

1. Identify which **section** the question falls under (table below).
2. Use the directory listings below to pick the most specific subpage. The path is predictable from the URL — `/docs/scripting-reference/resource-manifest/` ↔ `references/scripting-reference/resource-manifest/` (read leaf `.md` files inside).
3. For a **specific native function** (e.g. `SET_PED_INTO_VEHICLE`): per-native pages are NOT in this bundle (they live at `https://docs.fivem.net/natives/?_HASH`). The references here mention natives by name with their canonical link — follow the link or `WebFetch` it for full signatures.

**Don't dump entire references into context.** Read the most specific file. Each file is self-contained.

---

## Section map

| Section | Folder | What's there |
|---|---|---|
| **scripting-manual** | `references/scripting-manual/` | How-to guides: writing your first script, runtimes, NUI, networking, events, debugging, voice, scaleform, migration |
| **scripting-reference** | `references/scripting-reference/` | API reference: fxmanifest, client/server function indexes, events list, convars, OneSync, runtime APIs (Lua/JS/C#) |
| **game-references** | `references/game-references/` | Game data: blips, checkpoints, controls, hud colors, markers, models, vehicles, weapons, zones, etc. |
| **resources** | `references/resources/` | Built-in resources: baseevents, chat, loadscreen, mapmanager, sessionmanager, spawnmanager, txAdmin (each with events/functions/exports) |
| **developers** | `references/developers/` | Platform-developer docs: sandbox, server-security, script-runtimes, etc. |
| **_examples** | `references/_examples/` | Example files (`fxmanifest.lua`, `server.cfg`) referenced by the docs |

---

## Topic → reference lookup

### Resource setup / fxmanifest.lua

- **fxmanifest.lua keys, FXv2 versions, exports, dependencies, data_files** → `references/scripting-reference/resource-manifest/` (the canonical reference for every manifest directive — `fx_version`, `games`, `client_script`, `server_script`, `shared_script`, `ui_page`, `files`, `data_file`, `dependency`, `exports`, `server_exports`, `this_is_a_map`, `loadscreen`, `convar_category`, `escrow_ignore`, etc.)
- **Sample `fxmanifest.lua`** → `references/_examples/manifest/fxmanifest.lua`
- **Resource folder structure / what is a resource** → `references/scripting-manual/introduction/introduction-to-resources.md`

### NUI (HTML/JS UI in CEF) — most relevant for ReUI itself

- **Full-screen NUI** → `references/scripting-manual/nui-development/full-screen-nui.md`
- **NUI callbacks (frontend → Lua)** → `references/scripting-manual/nui-development/nui-callbacks.md`
- **DUI (texture-rendered NUI)** → `references/scripting-manual/nui-development/dui.md`
- **Loading screens** → `references/scripting-manual/nui-development/loading-screens/` and `references/resources/loadscreen/`
- **NUI section** → `references/scripting-manual/nui-development/`

### Events

- **Event system (register, trigger, cancel)** → `references/scripting-manual/working-with-events/` (`listening-for-events.md`, `triggering-events.md`, `canceling-events.md`)
- **Client / server event indexes** → `references/scripting-reference/events/client-events/` and `references/scripting-reference/events/server-events/`
- **Event detail pages** → `references/scripting-reference/events/list/` (12 detail pages: `playerConnecting`, `playerDropped`, `onResourceStart`, `gameEventTriggered`, `rconCommand`, `respawnPlayerPedEvent`, `populationPedCreating`, `vehicleComponentControlEvent`, etc.)
- **Built-in resource events** → under `references/resources/<resource>/events/`

### Runtimes (Lua / JS / C#)

- **Picking & setting up a runtime** → `references/scripting-manual/runtimes/` (`lua.md`, `javascript.md`, `csharp.md`)
- **Lua API (`Citizen.*`, AddEventHandler, etc.)** → `references/scripting-reference/runtimes/lua/functions/` (54 function pages)
- **C# API** → `references/scripting-reference/runtimes/csharp/`
- **JS API** → `references/scripting-reference/runtimes/javascript/`

### Natives (game-side functions like `GET_PED_DRAWABLE_VARIATION`)

- **About natives, naming, types** → `references/scripting-manual/introduction/about-native-functions.md`
- **Per-native signatures** → NOT in this bundle. Use the markdown links already present (form: `https://docs.fivem.net/natives/?_HASH`) — `WebFetch` if you need the signature.

### Networking & state

- **Network IDs (entity, player, server ID)** → `references/scripting-manual/networking/ids.md`
- **State bags (replicated state)** → `references/scripting-manual/networking/state-bags.md`
- **OneSync** → `references/scripting-reference/onesync/`
- **Routing buckets** → covered in `scripting-reference/onesync/` and `developers/`

### Convars

- **Server convar reference** → `references/scripting-reference/convars/` (`sv_*`, `gametype`, etc.)

### Game references (look up models, IDs, hashes)

- `blips.md`, `checkpoints.md`, `controls.md`, `data-files.md`, `game-events.md`, `gamer-tags.md`, `hud-colors.md`, `instructional-buttons.md`, `markers.md`, `net-game-events.md`, `ped-models.md`, `pickup-hashes.md`, `profile-settings.md`, `radiostations.md`, `speeches.md`, `text-formatting.md`, `weapon-models.md`, `zones.md`
- Sub-listings: `references/game-references/input-mapper-parameter-ids/`, `references/game-references/vehicle-references/`

### Built-in resources

| Resource | Use it for | Path |
|---|---|---|
| `baseevents` | Standard player/vehicle event normalizations | `references/resources/baseevents/` |
| `chat` | In-game chat box (NUI), `/commands`, message templates | `references/resources/chat/` |
| `loadscreen` | Custom loading screen NUI | `references/resources/loadscreen/` |
| `mapmanager` | Map switching, gametype hooks | `references/resources/mapmanager/` |
| `sessionmanager` | Player session/connect lifecycle | `references/resources/sessionmanager/` |
| `spawnmanager` | Player spawn flow, default spawn | `references/resources/spawnmanager/` |
| `txAdmin` | Server admin panel reference | `references/resources/txAdmin/` |

Each (except `txAdmin`) has `events/` and `functions/` subfolders with per-event/per-export pages.

### Platform-developer / security topics

- **Sandbox model (what plugins can/can't do)** → `references/developers/sandbox.md`
- **Server security (anti-cheat, ACEs)** → `references/developers/server-security.md`
- **How runtimes work internally** → `references/developers/script-runtimes.md`
- All docs at `references/developers/`

### Migration / deprecated

- `references/scripting-manual/migrating-from-deprecated/` — moving away from `chatMessage`, `RegisterServerEvent` patterns, etc.
- `references/scripting-manual/migrating-from-other-platforms/` — for devs coming from MTA/SAMP/etc.

---

## Conventions in the references

- **Front matter**: every file has YAML (`title`, `weight`, sometimes `aliases`). Use `title` as the page name; ignore `weight` (Hugo render-order hint).
- **Internal links** (`/docs/scripting-reference/...`) point at `docs.fivem.net` URLs, NOT at this skill's filesystem. Translate `/docs/X/Y/` → `references/X/Y/` (read the leaf `.md` inside) when navigating locally. Section landing pages have been removed — refer to the directory listings in this file instead.
- **Native links** are real and clickable: `[NAME](https://docs.fivem.net/natives/?_HASH)`.
- **Forum links** point at `https://forum.cfx.re/t/<id>`.

---

## When NOT to use this skill

- Per-native function signatures → `WebFetch` `https://docs.fivem.net/natives/?_HASH` (or use the link already in the reference).
- Live FiveM server convar values / runtime state → those are dynamic, not docs.
- Community resources like ESX, QBCore, ox_lib → not in this bundle.
- ReUI's own architecture / RFCs → see `docs/designs/`, `docs/rfcs/` instead. This skill is the upstream FiveM platform reference only.

---

## Refresh

The reference set was generated from `citizenfx/fivem-docs@master` on 2026-05-29 with shortcodes resolved against:
- `https://static.cfx.re/natives/natives.json` + `natives_cfx.json` (native name → hash)
- `https://runtime.fivem.net/doc/events/{client,server}.html.json` (event index)
- `static/resource_manifest_version{,2}.txt` (rmv values)

To refresh: see `docs/FivemDocs/README.md` for the 4-step rebuild script. After regenerating `docs/FivemDocs/`, mirror it back to `references/` (and re-strip `_index.md` files if you want to keep this bundle's structure).

---

## Full directory listing

The directory tree below replaces the per-section `_index.md` landing pages. All paths are relative to `references/`.

### `_examples/` — sample assets referenced by the docs

```
_examples/
  config/server.cfg
  manifest/fxmanifest.lua
  using-scaleform/boilerplate.zip
```

### `developers/` — platform-developer docs

```
developers/
  coding-guidelines.md
  compiling-fivem.md
  sandbox.md
  script-runtimes.md
  server-security.md
```

### `game-references/` — game data lookups

```
game-references/
  blips.md
  checkpoints.md
  controls.md
  data-files.md
  game-events.md
  gamer-tags.md
  hud-colors.md
  instructional-buttons.md
  markers.md
  net-game-events.md
  ped-models.md
  pickup-hashes.md
  profile-settings.md
  radiostations.md
  speeches.md
  text-formatting.md
  weapon-models.md
  zones.md
  input-mapper-parameter-ids/
    digitalbutton_axis.md
    game_controlled.md
    joystick_axis.md
    joystick_axis_negative.md
    joystick_axis_positive.md
    joystick_button.md
    joystick_iaxis.md
    joystick_pov.md
    joystick_pov_axis.md
    keyboard.md
    mkb_axis.md
    mouse_absoluteaxis.md
    mouse_button.md
    mouse_buttonany.md
    mouse_centeredaxis.md
    mouse_normalized.md
    mouse_relativeaxis.md
    mouse_scaledaxis.md
    mouse_wheel.md
    pad_analogbutton.md
    pad_axis.md
    pad_debugbutton.md
    pad_digitalbutton.md
    pad_digitalbuttonany.md
    touchpad_absolute_axis.md
    touchpad_centered_axis.md
  vehicle-references/
    vehicle-colors.md
    vehicle-flags.md
    vehicle-models.md
```

### `resources/` — built-in resource references

```
resources/
  about_resource_template.md
  baseevents/
    events/
      enteredVehicle.md
      enteringAborted.md
      enteringVehicle.md
      leftVehicle.md
      onPlayerDied.md
      onPlayerKilled.md
      onPlayerWasted.md
  chat/
    events/
      chat-addMessage.md
      chat-addSuggestion.md
      chat-addSuggestions.md
      chat-addTemplate.md
      chat-clear.md
      chatMessage.md
      chat-removeSuggestion.md
    exports/
      addMessagecl.md
      addMessagesv.md
      addSuggestion.md
      registerMessageHook.md
      registerMode.md
    functions/                 (no leaf pages — index only upstream)
  loadscreen/
    events/                    (no leaf pages — index only upstream)
    functions/                 (no leaf pages — index only upstream)
  mapmanager/
    events/
      getMapDirectives.md
      onClientGameTypeStart.md
      onClientGameTypeStop.md
      onClientMapStart.md
      onClientMapStop.md
    functions/                 (no leaf pages — index only upstream)
  sessionmanager/
    events/
      playerActivated.md
      sessionInitialized.md
  spawnmanager/
    events/
      playerSpawned.md
    functions/
      addSpawnPoint.md
      forceRespawn.md
      loadSpawns.md
      removeSpawnPoint.md
      setAutoSpawn.md
      setAutoSpawnCallback.md
      spawnPlayer.md
  txAdmin/
    permissions.md
```

### `scripting-manual/` — how-to guides

```
scripting-manual/
  debugging/
    using-profiler.md
  introduction/
    about-native-functions.md
    creating-your-first-script.md
    creating-your-first-script-csharp.md
    creating-your-first-script-javascript.md
    fact-sheet.md
    introduction-to-resources.md
  migrating-from-deprecated/
    chat-messages.md
    creating-commands.md
  migrating-from-other-platforms/  (no leaf pages — index only upstream)
  networking/
    ids.md
    state-bags.md
  nui-development/
    dui.md
    full-screen-nui.md
    nui-callbacks.md
    loading-screens/
      endDataFileEntries.md
      endInitFunction.md
      initFunctionInvoked.md
      initFunctionInvoking.md
      loadProgress.md
      onDataFileEntry.md
      onLogLine.md
      performMapLoadFunction.md
      startDataFileEntries.md
      startInitFunction.md
      startInitFunctionOrder.md
  runtimes/
    csharp.md
    javascript.md
    lua.md
  using-new-game-features/
    collection-based-natives.md
    fuel-consumption.md
  using-scaleform/             (no leaf pages — index only upstream)
  voice/                       (no leaf pages — index only upstream)
  working-with-events/
    canceling-events.md
    listening-for-events.md
    triggering-events.md
```

### `scripting-reference/` — API reference

```
scripting-reference/
  client-functions/            (no leaf pages — index only upstream)
  convars/                     (no leaf pages — index only upstream)
  events/
    client-events/             (no leaf pages — index only upstream)
    server-events/             (no leaf pages — index only upstream)
    list/
      gameEventTriggered.md
      onClientResourceStart.md
      onClientResourceStop.md
      onResourceStart.md
      onResourceStarting.md
      onResourceStop.md
      playerConnecting.md
      playerDropped.md
      populationPedCreating.md
      rconCommand.md
      respawnPlayerPedEvent.md
      vehicleComponentControlEvent.md
  onesync/                     (no leaf pages — index only upstream)
  resource-manifest/           (no leaf pages — index only upstream)
  runtimes/
    csharp/
      client-functions.md
      server-functions.md
    javascript/
      client-functions.md
      server-functions.md
      functions/
        addRawEventListener.md
        clearTick.md
        emit-client.md
        emitNet-client.md
        emitNet-server.md
        emit-server.md
        exports.md
        on-client.md
        onNet-client.md
        onNet-server.md
        on-server.md
        RegisterNetEvent.md
        removeEventListener.md
        setTick.md
    lua/
      client-functions.md
      server-functions.md
      functions/
        AddEventHandler.md
        Citizen.Await.md
        Citizen.CanonicalizeRef.md
        Citizen.CreateThread.md
        Citizen.CreateThreadNow.md
        Citizen.GetFunctionReference.md
        Citizen.InvokeFunctionReference.md
        Citizen.InvokeNative.md
        Citizen.PointerValueFloat.md
        Citizen.PointerValueFloatInitialized.md
        Citizen.PointerValueInt.md
        Citizen.PointerValueIntInitialized.md
        Citizen.PointerValueVector.md
        Citizen.ResultAsFloat.md
        Citizen.ResultAsInteger.md
        Citizen.ResultAsLong.md
        Citizen.ResultAsObject.md
        Citizen.ResultAsString.md
        Citizen.ResultAsVector.md
        Citizen.ReturnResultAnyway.md
        Citizen.SetCallRefRoutine.md
        Citizen.SetDeleteRefRoutine.md
        Citizen.SetDuplicateRefRoutine.md
        Citizen.SetEventRoutine.md
        Citizen.SetTickRoutine.md
        Citizen.SetTimeout.md
        Citizen.Trace.md
        Citizen.Wait.md
        cross.md
        dot.md
        GetPlayerIdentifiers.md
        GetPlayers.md
        inv.md
        norm.md
        PerformHttpRequest.md
        PerformHttpRequestAwait.md
        promise.all.md
        promise.first.md
        promise.map.md
        promise.new.md
        quat.md
        RegisterNetEvent.md
        RegisterNUICallback.md
        RemoveEventHandler.md
        SendNUIMessage.md
        slerp.md
        TriggerClientEvent.md
        TriggerEvent.md
        TriggerServerEvent.md
        vec.md
        vector2.md
        vector3.md
        vector4.md
  server-functions/            (no leaf pages — index only upstream)
```

Folders marked "no leaf pages — index only upstream" had only an `_index.md` landing page in the source repo. Those landing pages are not part of this bundle; consult `https://docs.fivem.net/docs/<path>/` for that material.
