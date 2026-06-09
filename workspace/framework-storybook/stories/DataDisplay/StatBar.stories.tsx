import type { Meta, StoryObj } from '@storybook/react';
import { StatBar } from '@reui/framework';
import type { StatItem } from '@reui/framework';

const playerStats: StatItem[] = [
  { key: 'health',   label: 'HP',    value: 85,  color: 'success', showLabel: true },
  { key: 'armor',   label: 'ARMOR', value: 60,  color: 'accent',  showLabel: true },
  { key: 'hunger',  label: 'HUNGER', value: 40,  color: 'warning', showLabel: true },
  { key: 'thirst',  label: 'THIRST', value: 20,  color: 'danger',  showLabel: true },
];

const meta: Meta<typeof StatBar> = {
  title: 'DataDisplay/StatBar',
  component: StatBar,
  parameters: {
    docs: {
      description: {
        component:
          '状态条组组件，底层复用 ProgressBar。适合展示玩家属性（HP/饥饿/口渴等）。',
      },
    },
  },
  argTypes: {
    direction: { control: 'select', options: ['horizontal', 'vertical'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

export default meta;
type Story = StoryObj<typeof StatBar>;

export const Default: Story = {
  args: {
    items: playerStats,
    direction: 'vertical',
    size: 'md',
  },
  decorators: [(Story) => <div style={{ width: 240, padding: 16 }}><Story /></div>],
};

export const Horizontal: Story = {
  args: {
    items: playerStats,
    direction: 'horizontal',
    size: 'sm',
  },
  decorators: [(Story) => <div style={{ width: '100%', padding: 16 }}><Story /></div>],
  parameters: {
    docs: { description: { story: '水平布局，适合 HUD 顶部状态条。' } },
  },
};

export const CustomColors: Story = {
  args: {
    items: [
      { key: 'stamina', label: 'STAMINA', value: 70, color: '#22d3ee', showLabel: true },
      { key: 'oxygen',  label: 'OXYGEN',  value: 90, color: '#818cf8', showLabel: true },
    ],
    direction: 'vertical',
    size: 'md',
  },
  decorators: [(Story) => <div style={{ width: 240, padding: 16 }}><Story /></div>],
};
