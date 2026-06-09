import type { Meta, StoryObj } from '@storybook/react';
import { List } from '@reui/framework';

const mockItems = [
  { id: 1, name: 'Alice',   role: 'Admin' },
  { id: 2, name: 'Bob',     role: 'User' },
  { id: 3, name: 'Charlie', role: 'Moderator' },
  { id: 4, name: 'Diana',   role: 'User' },
  { id: 5, name: 'Eve',     role: 'Admin' },
];

const largeList = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `Player ${i + 1}`,
  score: Math.floor(Math.random() * 1000),
}));

const meta: Meta<typeof List> = {
  title: 'DataDisplay/List',
  component: List,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd List 封装。支持大数据集虚拟滚动（virtual + virtualThreshold）。',
      },
    },
  },
  argTypes: {
    virtual: { control: 'boolean' },
    virtualThreshold: { control: 'number' },
    itemDeletable: { control: 'boolean' },
    onItemDelete: { action: 'onItemDelete' },
  },
};

export default meta;
type Story = StoryObj<typeof List>;

export const Default: Story = {
  args: {
    items: mockItems,
    renderItem: (item: any) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
        <span>{item.name}</span>
        <span style={{ color: 'var(--reui-color-accent)' }}>{item.role}</span>
      </div>
    ),
    style: { width: 360 },
  },
};

export const Virtual: Story = {
  args: {
    items: largeList,
    virtual: true,
    virtualThreshold: 50,
    renderItem: (item: any) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
        <span>#{item.id} {item.name}</span>
        <span>{item.score} pts</span>
      </div>
    ),
    style: { width: 360, height: 300, overflow: 'auto' },
  },
  parameters: {
    docs: { description: { story: '超 50 条自动启用虚拟滚动，仅渲染可见区域。' } },
  },
};

export const Deletable: Story = {
  args: {
    items: mockItems,
    itemDeletable: true,
    onItemDelete: (item: any) => console.log('delete', item),
    renderItem: (item: any) => (
      <span>{item.name} ({item.role})</span>
    ),
    style: { width: 360 },
  },
  parameters: {
    docs: { description: { story: '启用 itemDeletable 后每项右侧显示删除按钮。' } },
  },
};
