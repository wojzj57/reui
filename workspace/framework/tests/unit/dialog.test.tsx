import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { dialog, DialogHost } from '../../src/stores/dialog';

afterEach(() => {
  dialog.closeAll();
  cleanup();
});

describe('DialogHost (regression: hooks order on empty↔non-empty)', () => {
  it('does not crash when stack transitions from empty to non-empty', async () => {
    // 宿主先以空栈渲染（旧实现此时在 early-return 之后调用 Hook，
    // 一旦 push Dialog 就会抛 "Rendered more hooks than during the previous render"）。
    render(<DialogHost />);

    let p: Promise<boolean>;
    act(() => {
      p = dialog.confirm({ title: '丢弃物品', content: '确定？', okText: '丢弃' });
    });

    await screen.findByText('丢弃物品');

    // 点击确认按钮 → resolve(true)
    // antd Button 会在两个 CJK 字符间自动插入空格，故用正则匹配。
    fireEvent.click(await screen.findByRole('button', { name: /丢\s*弃/ }));
    await expect(p!).resolves.toBe(true);
  });

  it('confirm resolves false on cancel', async () => {
    render(<DialogHost />);
    let p: Promise<boolean>;
    act(() => {
      p = dialog.confirm({ title: 'q', cancelText: '取消' });
    });
    await screen.findByText('q');
    fireEvent.click(await screen.findByRole('button', { name: /取\s*消/ }));
    await expect(p!).resolves.toBe(false);
  });

  it('prompt resolves with the entered value', async () => {
    render(<DialogHost />);
    let p: Promise<string | null>;
    act(() => {
      p = dialog.prompt({ title: '重命名', label: '新名称', okText: 'OK' });
    });
    await screen.findByText('重命名');

    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'newname' } });
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await expect(p!).resolves.toBe('newname');
  });

  it('alert resolves void on OK and hides cancel button', async () => {
    render(<DialogHost />);
    let p: Promise<void>;
    act(() => {
      p = dialog.alert({ title: '提示', content: '完成' });
    });
    await screen.findByText('提示');
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));
    await expect(p!).resolves.toBeUndefined();
  });
});
