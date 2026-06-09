---
name: fivem-basics
description: FiveM resource structure, fxmanifest, client/server scripting, events. Use when creating or editing FiveM resources or Lua scripts, or when the user asks how FiveM works.
author: wojzj57
version: 1.0.0
---

# FiveM basics

Best practices for FiveM — resources, manifest, client/server, events. Use this skill whenever you are dealing with FiveM code to obtain domain-specific knowledge.

## When to use

- User asks how FiveM resources or scripts work.
- Editing or creating `fxmanifest.lua`, `client_*.lua`, or `server.lua`.
- Questions about client/server, events, or exports.
- Need to look up natives or detailed docs → point to https://docs.fivem.net/natives/ and https://docs.fivem.net/docs/.

## How to use

Read individual rule files for detailed explanations and examples:

- **references/structure.md** — Resource structure and organization: scope, client/server separation, logical grouping, naming conventions.
- **references/fxmanifest.md** — Resource manifest (fxmanifest.lua): fx_version, game, client_scripts, server_script, files, dependencies.
- **references/client-server.md** — Client vs server scripts, shared code, communication patterns.
- **references/events.md** — Events in Lua: RegisterNetEvent, TriggerServerEvent, TriggerClientEvent, naming conventions, security.
- **references/exports.md** — Defining and consuming exports between resources.
- **references/debugging.md** — Server vs client (F8) logs; when to ask the user for F8 logs if there's no server-side error.
- **references/optimization.md** — Lua/FiveM optimization: locals, loops, natives (PlayerPedId, vector distance), state bags, security, readability, folder structure.
- **references/reference-links.md** — Official docs and natives reference.
