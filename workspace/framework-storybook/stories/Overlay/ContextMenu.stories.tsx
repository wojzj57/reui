import type { Meta, StoryObj } from '@storybook/react';
import { ContextMenu } from '@reui/framework';

const menuItems = [
  { key: 'cut',    label: 'Cut',    shortcut: 'Ctrl+X' },
  { key: 'copy',   label: 'Copy',   shortcut: 'Ctrl+C' },
  { key: 'paste',  label: 'Paste',  shortcut: 'Ctrl+V', disabled: false },
  { key: 'divider', label: '─', disabled: true },
  {
    key: 'share',
    label: 'Share',
    children: [
      { key: 'share-email', label: 'By Email' },
      { key: 'share-link',  label: 'Copy Link' },
    ],
  },
  { key: 'delete', label: 'Delete', danger: true },
];

const meta: Meta<typeof ContextMenu> = {
  title: 'Overlay/ContextMenu',
  component: ContextMenu,
  parameters: {
    docs: {
      description: {
        component:
          '右键菜单，基于 antd Dropdown 重写。支持嵌套子菜单、快捷键提示、danger 项。',
      },
    },
  },
  argTypes: {
    onClick: { action: 'onClick' },
    onOpenChange: { action: 'onOpenChange' },
  },
};

export default meta;
type Story = StoryObj<typeof ContextMenu>;

export const Default: Story = {
  args: {
    items: menuItems,
    onClick: (key: string) => console.log(' clicked:', key),
    children: <div style={{ padding: 32, border: '1px dashed #555', width: 240, textAlign: 'center' }}>Right-click me</div>,
  },
  parameters: {
    docs: { description: { story: '右键点击触发菜单。快捷提示显示在右侧。' } },
  },
};

export const NoShortcuts: Story = {
  args: {
    items: menuItems.map(({ shortcut, ...rest }) => rest),
    onClick: (key: string) => console.log(key),
    children: <div style={{ padding: 32, border: '1px dashed #555', width: 240, textAlign: 'center' }}>Right-click me</div>,
  },
  parameters: {
    docs: { description: { story: '不传 shortcut 字段即不显示快捷键提示。' } },
  },
};

export const WithDanger: Story = {
  args: {
    items: [
      { key: 'open',  label: 'Open' },
      { key: 'rename', label: 'Rename' },
      { key: 'delete', label: 'Delete', danger: true },
    ],
    onClick: (key: string) => console.log(key),
    children: <div style={{ padding: 32, border: '1px dashed #555', width: 240, textAlign: 'center' }}>Right-click me</div>,
  },
  parameters: {
    docs: { description: { story: 'danger: true 显示红色危险样式。' } },
  },
};
