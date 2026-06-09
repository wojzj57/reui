---
title: Direct-rendered UI
weight: 40
---

In FiveM, you can also render NUI to a runtime texture, which is called DUI for 'direct NUI'. The following natives help
with this:

* [`CREATE_DUI`](https://docs.fivem.net/natives/?_0x23EAF899)
* [`CREATE_RUNTIME_TEXTURE_FROM_DUI_HANDLE`](https://docs.fivem.net/natives/?_0xB135472B)
* [`DESTROY_DUI`](https://docs.fivem.net/natives/?_0xA085CB10)
* [`GET_DUI_HANDLE`](https://docs.fivem.net/natives/?_0x1655D41D)
* [`IS_DUI_AVAILABLE`](https://docs.fivem.net/natives/?_0x7AAC3B4C)
* [`SEND_DUI_MESSAGE`](https://docs.fivem.net/natives/?_0xCD380DA9)
* [`SEND_DUI_MOUSE_DOWN`](https://docs.fivem.net/natives/?_0x5D01F191)
* [`SEND_DUI_MOUSE_MOVE`](https://docs.fivem.net/natives/?_0xD9D7A0AA)
* [`SEND_DUI_MOUSE_UP`](https://docs.fivem.net/natives/?_0x1D735B93)
* [`SEND_DUI_MOUSE_WHEEL`](https://docs.fivem.net/natives/?_0x2D62133A)
* [`SET_DUI_URL`](https://docs.fivem.net/natives/?_0xF761D9F3)

The native documentation contains information for each of these, but here are some creative use cases for this:

* Rendering in 2D space using [`DRAW_SPRITE`](https://docs.fivem.net/natives/?_0xE7FFAE5EBF23D890)
* Rendering to a game render target object using similar natives.
* Rendering arbitrarily in world space using a specialized Scaleform, like in this
  [forum topic](https://forum.cfx.re/t/131208).

This can be used to make cinema screens, asynchronous in-game hint overlays, etc. fairly trivially.
