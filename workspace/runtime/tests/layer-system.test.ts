/**
 * 单元测试：LayerSystem（RFC-002 §3.5）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LayerSystem, type LayerType } from '../src/layer-system';

const ALL_LAYERS: LayerType[] = ['hud', 'panel', 'overlay', 'system'];

function makeIframe(): HTMLIFrameElement {
  return document.createElement('iframe');
}

describe('LayerSystem.lifecycle', () => {
  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
  });

  it('should create four layer divs attached to container when getInstance is called', () => {
    // act
    LayerSystem.getInstance();

    // assert
    const divs = document.body.querySelectorAll('div[data-layer]');
    expect(divs).toHaveLength(4);
    const labels = Array.from(divs).map((d) => (d as HTMLElement).dataset.layer);
    expect(new Set(labels)).toEqual(new Set(ALL_LAYERS));
  });

  it('should assign correct z-index per layer when initialized', () => {
    // arrange
    const sys = LayerSystem.getInstance();

    // assert
    expect(sys.getLayerContainer('hud').style.zIndex).toBe('100');
    expect(sys.getLayerContainer('panel').style.zIndex).toBe('200');
    expect(sys.getLayerContainer('overlay').style.zIndex).toBe('300');
    expect(sys.getLayerContainer('system').style.zIndex).toBe('400');
  });

  it('should set pointer-events none for hud and auto for others when initialized', () => {
    // arrange
    const sys = LayerSystem.getInstance();

    // assert
    expect(sys.getLayerContainer('hud').style.pointerEvents).toBe('none');
    expect(sys.getLayerContainer('panel').style.pointerEvents).toBe('auto');
    expect(sys.getLayerContainer('overlay').style.pointerEvents).toBe('auto');
    expect(sys.getLayerContainer('system').style.pointerEvents).toBe('auto');
  });

  it('should return the same instance when getInstance is called twice', () => {
    // arrange
    const a = LayerSystem.getInstance();

    // act
    const b = LayerSystem.getInstance();

    // assert
    expect(b).toBe(a);
  });

  it('should re-create layer divs on a fresh instance after dispose+reset', () => {
    // arrange
    LayerSystem.getInstance();
    LayerSystem.__resetForTests();

    // act
    LayerSystem.getInstance();

    // assert
    expect(document.body.querySelectorAll('div[data-layer]')).toHaveLength(4);
  });

  it('should mount layer divs into a custom container when provided', () => {
    // arrange
    const host = document.createElement('div');
    document.body.appendChild(host);

    // act
    LayerSystem.getInstance({ container: host });

    // assert
    expect(host.querySelectorAll('div[data-layer]')).toHaveLength(4);
    expect(document.body.querySelectorAll(':scope > div[data-layer]')).toHaveLength(0);
  });
});

describe('LayerSystem.attachToLayer', () => {
  let sys: LayerSystem;

  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
    sys = LayerSystem.getInstance();
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
  });

  it('should move iframe into hud container when attaching to hud', () => {
    // arrange
    const f = makeIframe();

    // act
    sys.attachToLayer(f, 'hud');

    // assert
    expect(f.parentElement).toBe(sys.getLayerContainer('hud'));
  });

  it('should set pointer-events none on iframe when attached to hud', () => {
    // arrange
    const f = makeIframe();

    // act
    sys.attachToLayer(f, 'hud');

    // assert
    expect(f.style.pointerEvents).toBe('none');
  });

  it('should throw when attaching to system layer', () => {
    // arrange
    const f = makeIframe();

    // act + assert
    expect(() => sys.attachToLayer(f, 'system')).toThrow(/system.*reserved/i);
  });

  it('should move iframe between layers when attached again to a different layer', () => {
    // arrange
    const f = makeIframe();
    sys.attachToLayer(f, 'hud');

    // act
    sys.attachToLayer(f, 'panel');

    // assert
    expect(sys.getLayerContainer('hud').contains(f)).toBe(false);
    expect(sys.getLayerContainer('panel').contains(f)).toBe(true);
  });

  it('should remove iframe from overlay stack when re-attaching to another layer', () => {
    // arrange
    const f = makeIframe();
    sys.attachToLayer(f, 'overlay');
    sys.pushOverlay(f);

    // act
    sys.attachToLayer(f, 'panel');

    // assert: overlay container should now be hidden because stack is empty
    expect(sys.isLayerVisible('overlay')).toBe(false);
  });
});

describe('LayerSystem.setActivePanel', () => {
  let sys: LayerSystem;

  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
    sys = LayerSystem.getInstance();
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
  });

  it('should show target iframe and hide siblings when setActivePanel is called', () => {
    // arrange
    const a = makeIframe();
    const b = makeIframe();
    sys.attachToLayer(a, 'panel');
    sys.attachToLayer(b, 'panel');

    // act
    sys.setActivePanel(a);

    // assert
    expect(sys.isLayerVisible('panel')).toBe(true);
    expect(a.style.display).toBe('');
    expect(b.style.display).toBe('none');
  });

  it('should hide panel container when setActivePanel(null) is called', () => {
    // arrange
    const a = makeIframe();
    sys.attachToLayer(a, 'panel');
    sys.setActivePanel(a);

    // act
    sys.setActivePanel(null);

    // assert
    expect(sys.isLayerVisible('panel')).toBe(false);
    expect(a.style.display).toBe('none');
  });

  it('should throw when iframe is not attached to panel layer', () => {
    // arrange
    const f = makeIframe();
    sys.attachToLayer(f, 'hud');

    // act + assert
    expect(() => sys.setActivePanel(f)).toThrow(/panel layer/);
  });
});

describe('LayerSystem.overlay stack', () => {
  let sys: LayerSystem;

  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
    sys = LayerSystem.getInstance();
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
  });

  it('should show overlay container and top iframe when pushOverlay is called', () => {
    // arrange
    const a = makeIframe();
    sys.attachToLayer(a, 'overlay');

    // act
    sys.pushOverlay(a);

    // assert
    expect(sys.isLayerVisible('overlay')).toBe(true);
    expect(a.style.display).toBe('');
  });

  it('should hide previous top and show new top when a second overlay is pushed', () => {
    // arrange
    const a = makeIframe();
    const b = makeIframe();
    sys.attachToLayer(a, 'overlay');
    sys.attachToLayer(b, 'overlay');
    sys.pushOverlay(a);

    // act
    sys.pushOverlay(b);

    // assert
    expect(a.style.display).toBe('none');
    expect(b.style.display).toBe('');
  });

  it('should reveal previous overlay when top is popped', () => {
    // arrange
    const a = makeIframe();
    const b = makeIframe();
    sys.attachToLayer(a, 'overlay');
    sys.attachToLayer(b, 'overlay');
    sys.pushOverlay(a);
    sys.pushOverlay(b);

    // act
    sys.popOverlay(b);

    // assert
    expect(a.style.display).toBe('');
    expect(b.style.display).toBe('none');
  });

  it('should silently ignore popOverlay when iframe is not in stack', () => {
    // arrange
    const a = makeIframe();
    sys.attachToLayer(a, 'overlay');

    // act + assert
    expect(() => sys.popOverlay(a)).not.toThrow();
    expect(sys.isLayerVisible('overlay')).toBe(false);
  });

  it('should hide overlay container and clear stack when clearOverlays is called', () => {
    // arrange
    const a = makeIframe();
    const b = makeIframe();
    sys.attachToLayer(a, 'overlay');
    sys.attachToLayer(b, 'overlay');
    sys.pushOverlay(a);
    sys.pushOverlay(b);

    // act
    sys.clearOverlays();

    // assert
    expect(sys.isLayerVisible('overlay')).toBe(false);
    expect(a.style.display).toBe('none');
    expect(b.style.display).toBe('none');
  });

  it('should throw when pushOverlay receives an iframe not attached to overlay layer', () => {
    // arrange
    const f = makeIframe();
    sys.attachToLayer(f, 'hud');

    // act + assert
    expect(() => sys.pushOverlay(f)).toThrow(/overlay layer/);
  });

  it('should de-duplicate iframe in overlay stack when pushed twice', () => {
    // arrange
    const a = makeIframe();
    const b = makeIframe();
    sys.attachToLayer(a, 'overlay');
    sys.attachToLayer(b, 'overlay');
    sys.pushOverlay(a);
    sys.pushOverlay(b);

    // act
    sys.pushOverlay(a);
    sys.popOverlay(a);

    // assert: after popping `a` once, `b` (the previous top) should be visible
    expect(b.style.display).toBe('');
  });
});

describe('LayerSystem.layer visibility', () => {
  let sys: LayerSystem;

  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
    sys = LayerSystem.getInstance();
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
  });

  it('should hide and show layer when hideLayer/showLayer is called', () => {
    // act
    sys.hideLayer('hud');

    // assert
    expect(sys.isLayerVisible('hud')).toBe(false);

    // act
    sys.showLayer('hud');

    // assert
    expect(sys.isLayerVisible('hud')).toBe(true);
  });

  it('should report panel layer hidden by default before any setActivePanel call', () => {
    // assert
    expect(sys.isLayerVisible('panel')).toBe(false);
  });
});

describe('LayerSystem.detachFromLayer', () => {
  let sys: LayerSystem;

  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
    sys = LayerSystem.getInstance();
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
  });

  it('should silently ignore detach when iframe is not managed', () => {
    // arrange
    const f = makeIframe();

    // act + assert
    expect(() => sys.detachFromLayer(f)).not.toThrow();
    expect(f.parentElement).toBeNull();
  });

  it('should remove iframe and pop it from overlay stack when attached as overlay', () => {
    // arrange
    const a = makeIframe();
    sys.attachToLayer(a, 'overlay');
    sys.pushOverlay(a);

    // act
    sys.detachFromLayer(a);

    // assert
    expect(a.parentElement).toBeNull();
    expect(sys.isLayerVisible('overlay')).toBe(false);
  });
});

describe('LayerSystem.dispose', () => {
  beforeEach(() => {
    LayerSystem.__resetForTests();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    LayerSystem.__resetForTests();
  });

  it('should remove all layer divs and yield a fresh instance after reset+getInstance', () => {
    // arrange
    LayerSystem.getInstance();
    expect(document.body.querySelectorAll('div[data-layer]')).toHaveLength(4);

    // act
    LayerSystem.__resetForTests();

    // assert
    expect(document.body.querySelectorAll('div[data-layer]')).toHaveLength(0);

    // act: new instance
    const fresh = LayerSystem.getInstance();

    // assert
    expect(document.body.querySelectorAll('div[data-layer]')).toHaveLength(4);
    expect(fresh).toBe(LayerSystem.getInstance());
  });
});
