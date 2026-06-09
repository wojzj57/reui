---
name: qbcore-framework
description: QBCore Framework for FiveM - Player management, jobs, gangs, economy, inventory. Use when creating QBCore resources or working with Player object, PlayerData, QBCore functions.
author: wojzj57
version: 1.0.0
---

# QBCore Framework Development

Complete guide for developing with QBCore Framework — a comprehensive FiveM roleplay framework providing core functionalities and modules.

## When to use

- Creating or editing QBCore resources/scripts
- Working with player data (Player object, PlayerData)
- Implementing jobs, gangs, economy, or inventory systems
- Using QBCore client/server functions, callbacks, or events
- Questions about QBCore best practices and optimization

## How to use

Read individual rule files for detailed explanations and examples:

- **references/core-concepts.md** — QBCore architecture, PlayerData structure, Player object, framework initialization
- **references/player-methods.md** — Player object methods: money, items, jobs, gangs, metadata, accounts
- **references/best-practices.md** — QBCore coding standards, optimization, security, naming conventions
- **references/reference-links.md** — Official QBCore documentation links

## Key principles

1. **Always check for nil** — `if Player then ... end` before using Player object
2. **Use QBCore.Functions.GetPlayer** — Standard player retrieval: `local Player = QBCore.Functions.GetPlayer(source)`
3. **Wait for player load** — Check player loaded state on client before accessing PlayerData
4. **Never trust client** — Validate all data server-side, secure your events
5. **Follow QBCore patterns** — Use QBCore functions instead of reinventing (callbacks, notifications, etc.)
6. **Optimize loops** — Cache player objects, use dynamic Wait times, avoid unnecessary calls
7. **Use camelCase** — Follow Lua naming: `myVariable`, local over global
8. **Minimal globals** — Keep variables local unless they need global scope
9. **Use ox_lib for UI** — Prefer ox_lib for menus, dialogs, notifications, progress bars
