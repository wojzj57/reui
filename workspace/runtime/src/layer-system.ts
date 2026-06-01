/**
 * LayerSystem（RFC-002 §3.5）。
 *
 * 维护四个层级容器（HUD / Panel / Overlay / System），按 z-index 段位区分：
 *   - HUD     100-199  pointer-events: none（始终穿透，不阻挡游戏交互）
 *   - Panel   200-299  pointer-events: auto；同一时刻最多一个插件激活（互斥由 PluginManager 控制）
 *   - Overlay 300-399  pointer-events: auto；栈式管理（push/pop），栈顶可见且可交互
 *   - System  400-499  pointer-events: auto；保留给 Runtime 内置 UI——**不接受插件 attach**
 *
 * 设计要点：
 *   1. 仅负责 DOM/可见性管理，不发事件、不依赖 EventBus / PluginManager；
 *   2. 单例，`__resetForTests` 清状态以便 jsdom 用例隔离；
 *   3. iframe 实际从原父节点移走（appendChild 会自动 detach），
 *      `detachFromLayer` 才会调用 iframe.remove()，避免误删非 LayerSystem 托管的节点；
 *   4. HUD 层 iframe 默认设 pointer-events:none——若插件子页面需局部交互，
 *      可在子页面内部通过覆盖 CSS 自行启用（HUD 层容器本身保持穿透）。
 */

export type LayerType = 'hud' | 'panel' | 'overlay' | 'system';

export interface LayerSystemOptions {
  /** 层容器挂载到的宿主节点，默认 document.body */
  container?: HTMLElement;
}

const LAYER_BASE_STYLE = 'position:fixed;inset:0;';
const Z_INDEX: Record<LayerType, number> = {
  hud: 100,
  panel: 200,
  overlay: 300,
  system: 400,
};

export class LayerSystem {
  private static _instance: LayerSystem | null = null;

  private readonly container: HTMLElement;
  private readonly layers: Record<LayerType, HTMLDivElement>;
  private readonly overlayStack: HTMLIFrameElement[] = [];

  private constructor(opts: LayerSystemOptions) {
    this.container = opts.container ?? document.body;
    this.layers = {
      hud: this.createLayerDiv('hud'),
      panel: this.createLayerDiv('panel'),
      overlay: this.createLayerDiv('overlay'),
      system: this.createLayerDiv('system'),
    };
    for (const layer of ['hud', 'panel', 'overlay', 'system'] as const) {
      this.container.appendChild(this.layers[layer]);
    }
  }

  static getInstance(opts?: LayerSystemOptions): LayerSystem {
    if (!LayerSystem._instance) {
      LayerSystem._instance = new LayerSystem(opts ?? {});
    }
    return LayerSystem._instance;
  }

  static __resetForTests(): void {
    if (LayerSystem._instance) {
      LayerSystem._instance.dispose();
    }
    LayerSystem._instance = null;
  }

  // ── attach / detach ─────────────────────────────────────────────────────

  attachToLayer(iframe: HTMLIFrameElement, layer: LayerType): void {
    if (layer === 'system') {
      throw new Error(
        'LayerSystem: layer "system" is reserved for runtime; plugins cannot attach.',
      );
    }
    // 若已在另一层，先把它从原层状态/栈中移除（不调用 iframe.remove，
    // 因为 appendChild 会自动从旧父节点 detach）
    const previousLayer = this.findLayerOf(iframe);
    if (previousLayer === 'overlay') {
      this.removeFromOverlayStack(iframe);
      this.refreshOverlayVisibility();
    }

    iframe.style.position = 'absolute';
    iframe.style.inset = '0';
    iframe.style.border = '0';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    if (layer === 'hud') {
      iframe.style.pointerEvents = 'none';
    }

    this.layers[layer].appendChild(iframe);

    if (layer === 'panel') {
      // 新加入的 panel iframe 默认隐藏，等待 setActivePanel 显示
      iframe.style.display = 'none';
    } else if (layer === 'overlay') {
      iframe.style.display = 'none';
    }
  }

  detachFromLayer(iframe: HTMLIFrameElement): void {
    const layer = this.findLayerOf(iframe);
    if (!layer) return;
    if (layer === 'overlay') {
      this.removeFromOverlayStack(iframe);
      this.refreshOverlayVisibility();
    }
    iframe.remove();
  }

  // ── Panel: 单插件互斥 ───────────────────────────────────────────────────

  setActivePanel(iframe: HTMLIFrameElement | null): void {
    const panelDiv = this.layers.panel;
    if (iframe === null) {
      for (const child of Array.from(panelDiv.children)) {
        (child as HTMLElement).style.display = 'none';
      }
      panelDiv.style.display = 'none';
      return;
    }
    if (iframe.parentElement !== panelDiv) {
      throw new Error('LayerSystem: iframe is not attached to panel layer');
    }
    for (const child of Array.from(panelDiv.children)) {
      (child as HTMLElement).style.display = child === iframe ? '' : 'none';
    }
    panelDiv.style.display = '';
  }

  // ── Overlay: 栈式管理 ───────────────────────────────────────────────────

  pushOverlay(iframe: HTMLIFrameElement): void {
    if (iframe.parentElement !== this.layers.overlay) {
      throw new Error('LayerSystem: iframe is not attached to overlay layer');
    }
    this.removeFromOverlayStack(iframe); // 去重
    this.overlayStack.push(iframe);
    this.refreshOverlayVisibility();
  }

  popOverlay(iframe: HTMLIFrameElement): void {
    const idx = this.overlayStack.indexOf(iframe);
    if (idx === -1) return;
    this.overlayStack.splice(idx, 1);
    iframe.style.display = 'none';
    this.refreshOverlayVisibility();
  }

  clearOverlays(): void {
    for (const f of this.overlayStack) {
      f.style.display = 'none';
    }
    this.overlayStack.length = 0;
    this.layers.overlay.style.display = 'none';
  }

  // ── 通用层可见性控制 ────────────────────────────────────────────────────

  showLayer(layer: LayerType): void {
    this.layers[layer].style.display = '';
  }

  hideLayer(layer: LayerType): void {
    this.layers[layer].style.display = 'none';
  }

  isLayerVisible(layer: LayerType): boolean {
    return this.layers[layer].style.display !== 'none';
  }

  getLayerContainer(layer: LayerType): HTMLElement {
    return this.layers[layer];
  }

  dispose(): void {
    this.overlayStack.length = 0;
    for (const layer of ['hud', 'panel', 'overlay', 'system'] as const) {
      const div = this.layers[layer];
      while (div.firstChild) {
        div.removeChild(div.firstChild);
      }
      if (div.parentElement) {
        div.parentElement.removeChild(div);
      }
    }
    if (LayerSystem._instance === this) {
      LayerSystem._instance = null;
    }
  }

  // ── 内部辅助 ────────────────────────────────────────────────────────────

  private createLayerDiv(layer: LayerType): HTMLDivElement {
    const div = document.createElement('div');
    div.dataset.layer = layer;
    const pointerEvents = layer === 'hud' ? 'none' : 'auto';
    let extra = '';
    if (layer === 'panel' || layer === 'overlay') {
      extra = 'display:none;';
    }
    div.style.cssText = `${LAYER_BASE_STYLE}z-index:${Z_INDEX[layer]};pointer-events:${pointerEvents};${extra}`;
    return div;
  }

  private findLayerOf(iframe: HTMLIFrameElement): LayerType | null {
    for (const layer of ['hud', 'panel', 'overlay', 'system'] as const) {
      if (iframe.parentElement === this.layers[layer]) return layer;
    }
    return null;
  }

  private removeFromOverlayStack(iframe: HTMLIFrameElement): void {
    const idx = this.overlayStack.indexOf(iframe);
    if (idx !== -1) this.overlayStack.splice(idx, 1);
  }

  private refreshOverlayVisibility(): void {
    const overlayDiv = this.layers.overlay;
    if (this.overlayStack.length === 0) {
      overlayDiv.style.display = 'none';
      return;
    }
    const top = this.overlayStack[this.overlayStack.length - 1];
    for (const f of this.overlayStack) {
      f.style.display = f === top ? '' : 'none';
    }
    overlayDiv.style.display = '';
  }
}
