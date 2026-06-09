---
title: rconCommand
---

Parameters
----------

> [!WARNING]
> This event is deprecated. Please use [`REGISTER_COMMAND`](https://docs.fivem.net/natives/?_0x5FA79B0F) instead, and use the `restricted` flag.

```
string command, table/array arguments
```

- **command**: A string containing the command name that was executed.
- **arguments**: A list containing all arguments passed to the command.

Examples
--------

##### JavaScript Example:

```js
on('rconCommand', (command, args) => {
    console.log(`${command} called over RCON with ${args}`)
});
```
