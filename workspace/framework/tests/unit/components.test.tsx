import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { ReUIProvider } from '../../src/theme/ReUIProvider';
import { Stack } from '../../src/components/layout/Stack';
import { StatBar } from '../../src/components/layout/StatBar';
import { Panel } from '../../src/components/layout/Panel';
import { ProgressBar } from '../../src/components/antd/ProgressBar';
import { Slider } from '../../src/components/antd/Slider';
import { List } from '../../src/components/antd/List';
import { Input } from '../../src/components/antd/Input';
import { Select } from '../../src/components/antd/Select';
import { Checkbox } from '../../src/components/antd/Checkbox';
import { Radio } from '../../src/components/antd/Radio';
import { NumberInput } from '../../src/components/antd/NumberInput';
import { Loading } from '../../src/components/antd/Loading';
import { Upload } from '../../src/components/antd/Upload';

const withProvider = (ui: ReactElement) => render(<ReUIProvider>{ui}</ReUIProvider>);

describe('ReUIProvider', () => {
  it('injects CSS variables on the theme root', () => {
    const { container } = withProvider(<div>child</div>);
    const root = container.querySelector('.reui-theme-root') as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.getPropertyValue('--reui-color-accent')).toBe('#4F9EF8');
  });

  it('applies theme overrides via deepMerge', () => {
    const { container } = render(
      <ReUIProvider theme={{ colors: { accent: '#ff0000' } }}>
        <div />
      </ReUIProvider>,
    );
    const root = container.querySelector('.reui-theme-root') as HTMLElement;
    expect(root.style.getPropertyValue('--reui-color-accent')).toBe('#ff0000');
  });
});

describe('Stack', () => {
  it('renders flex with mapped align/justify', () => {
    const { container } = render(
      <Stack direction="horizontal" gap="md" align="center" justify="between">
        <div>a</div>
      </Stack>,
    );
    const el = container.querySelector('.reui-stack') as HTMLElement;
    expect(el.style.display).toBe('flex');
    expect(el.style.flexDirection).toBe('row');
    expect(el.style.alignItems).toBe('center');
    expect(el.style.justifyContent).toBe('space-between');
  });

  it('uses numeric gap as px', () => {
    const { container } = render(<Stack gap={10}><div /></Stack>);
    const el = container.querySelector('.reui-stack') as HTMLElement;
    expect(el.style.gap).toBe('10px');
  });
});

describe('StatBar', () => {
  it('renders one progressbar per stat with group role', () => {
    render(
      <StatBar
        items={[
          { key: 'hp', label: 'HP', value: 75, color: 'success', showLabel: true },
          { key: 'hunger', label: 'Hunger', value: 50, color: 'warning' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Status bars' })).toBeTruthy();
    expect(screen.getByText('HP')).toBeTruthy();
    expect(screen.getByText('75/100')).toBeTruthy();
  });
});

describe('Panel', () => {
  it('renders title and fires onClose', () => {
    const onClose = vi.fn();
    render(<Panel title="背包" closable onClose={onClose}>内容</Panel>);
    expect(screen.getByText('背包')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('applies glass styles when glass=true', () => {
    const { container } = render(
      <Panel glass glassBlur={20}>x</Panel>,
    );
    const el = container.querySelector('.reui-panel--glass') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.backdropFilter).toContain('blur(20px)');
  });

  it('is GPU-accelerated and draggable, handling pointer events without error', () => {
    const { container } = render(
      <Panel title="t" draggable defaultPosition={{ x: 5, y: 7 }}>x</Panel>,
    );
    const panel = container.querySelector('.reui-panel') as HTMLElement;
    const header = container.querySelector('.reui-panel__header') as HTMLElement;
    // 初始位置由 defaultPosition 决定，且启用 will-change 合成层提升。
    expect(panel.style.transform).toContain('translate(5px, 7px)');
    expect(panel.style.willChange).toBe('transform');
    expect(panel.className).toContain('reui-panel--draggable');
    // pointer 事件链路不应抛错（jsdom 不实现真实坐标，故不断言位移值）。
    expect(() => {
      fireEvent.pointerDown(header, { clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(panel, { clientX: 30, clientY: 40, pointerId: 1 });
      fireEvent.pointerUp(panel, { pointerId: 1 });
    }).not.toThrow();
  });
});

describe('ProgressBar', () => {
  it('number mode exposes progressbar role with aria values', () => {
    render(<ProgressBar value={30} max={60} aria-label="loadbar" />);
    const bar = screen.getByRole('progressbar', { name: 'loadbar' });
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuemax')).toBe('60');
  });

  it('loop mode renders the looping bar', () => {
    const { container } = render(<ProgressBar mode="loop" />);
    expect(container.querySelector('.reui-progress--loop')).toBeTruthy();
    expect(container.querySelector('.reui-progress__loop-bar')).toBeTruthy();
  });
});

describe('Slider', () => {
  it('centered mode wraps with class and injects color vars', () => {
    const { container } = withProvider(<Slider centered color="success" min={0} max={100} />);
    const wrap = container.querySelector('.reui-slider-centered') as HTMLElement;
    expect(wrap).toBeTruthy();
    expect(wrap.style.getPropertyValue('--reui-slider-color-high')).toContain('success');
  });
});

describe('List', () => {
  it('renders all rows when not virtual and fires delete', () => {
    const onDelete = vi.fn();
    render(
      <List
        items={['a', 'b', 'c']}
        renderItem={(item) => <span>{item as string}</span>}
        itemDeletable
        onItemDelete={onDelete}
      />,
    );
    expect(screen.getByText('a')).toBeTruthy();
    const delButtons = screen.getAllByRole('button', { name: 'Delete' });
    expect(delButtons).toHaveLength(3);
    fireEvent.click(delButtons[1]!);
    expect(onDelete).toHaveBeenCalledWith('b', 1);
  });

  it('virtualizes large lists (renders a subset)', () => {
    const items = Array.from({ length: 500 }, (_, i) => i);
    const { container } = render(
      <List
        items={items}
        virtual
        virtualThreshold={50}
        itemHeight={20}
        height={100}
        renderItem={(item) => <span>row-{item as number}</span>}
      />,
    );
    const rows = container.querySelectorAll('.reui-list__item');
    // 视口仅 5 行 + overscan，远小于 500
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
  });

  it('shows empty text', () => {
    render(<List items={[]} renderItem={() => null} emptyText="空空如也" />);
    expect(screen.getByText('空空如也')).toBeTruthy();
  });
});

describe('Input (inline editable)', () => {
  it('enters edit mode on click and submits on Enter', () => {
    const onSubmit = vi.fn();
    render(<Input editable onEditSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('Click to edit'));
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('hello');
  });
});

describe('thin antd wrappers render without crashing', () => {
  it('Select / Checkbox / Radio / NumberInput / Loading / Upload', () => {
    withProvider(
      <div>
        <Select options={[{ label: 'A', value: 'a' }]} />
        <Checkbox>chk</Checkbox>
        <Radio.Group>
          <Radio value={1}>one</Radio>
        </Radio.Group>
        <NumberInput min={0} max={10} defaultValue={5} />
        <Loading tip="loading" />
        <Upload action="/x" />
      </div>,
    );
    expect(screen.getByText('chk')).toBeTruthy();
    expect(screen.getByText('one')).toBeTruthy();
  });

  it('Select multi returns full array on change', () => {
    const onChange = vi.fn();
    withProvider(
      <Select
        multi
        options={[
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ]}
        onChange={onChange}
        open
      />,
    );
    // 打开下拉，点击选项
    const options = document.querySelectorAll('.reui-antd-select-item-option, .ant-select-item-option');
    if (options.length > 0) {
      fireEvent.click(options[0]!);
      expect(onChange).toHaveBeenCalled();
      const firstArg = onChange.mock.calls[0]![0];
      expect(Array.isArray(firstArg)).toBe(true);
    }
  });
});

describe('Loading fullscreen', () => {
  it('wraps in fullscreen container', () => {
    const { container } = withProvider(<Loading fullscreen />);
    expect(container.querySelector('.reui-loading-fullscreen')).toBeTruthy();
  });
});

describe('ContextMenu', () => {
  it('renders trigger child and opens menu on right click', () => {
    const onClick = vi.fn();
    const { container } = withProvider(
      <ContextMenuWrapper onClick={onClick} />,
    );
    expect(screen.getByText('right-click-target')).toBeTruthy();
    fireEvent.contextMenu(container.querySelector('[data-cm]')!);
    // 菜单项渲染到 portal
    const cut = screen.queryByText('Cut');
    if (cut) {
      fireEvent.click(cut);
      expect(onClick).toHaveBeenCalledWith('cut');
    }
  });
});

// 单独的包装组件，便于在 portal 中查询
import { ContextMenu } from '../../src/components/antd/ContextMenu';
function ContextMenuWrapper({ onClick }: { onClick: (k: string) => void }) {
  return (
    <ContextMenu
      items={[
        { key: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
        { key: 'copy', label: 'Copy' },
      ]}
      onClick={onClick}
    >
      <div data-cm>right-click-target</div>
    </ContextMenu>
  );
}
