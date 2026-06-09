import type { Meta, StoryObj } from '@storybook/react';
import { ProgressBar } from '@reui/framework';

const meta: Meta<typeof ProgressBar> = {
  title: 'DataDisplay/ProgressBar',
  component: ProgressBar,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Progress 封装，支持 number/loop 双模式。吸收旧库 segmengts typo 修复。',
      },
    },
  },
  argTypes: {
    value: { control: { type: 'number', min: 0, max: 100 } },
    max: { control: 'number' },
    mode: { control: 'select', options: ['number', 'loop'] },
    color: { control: 'select', options: ['accent', 'success', 'warning', 'danger'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    showLabel: { control: 'boolean' },
    animated: { control: 'boolean' },
    segments: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof ProgressBar>;

export const Default: Story = {
  args: {
    value: 65,
    showLabel: true,
  },
};

export const LoopMode: Story = {
  args: {
    value: 0,
    mode: 'loop',
    color: 'accent',
    showLabel: true,
  },
  parameters: {
    docs: { description: { story: 'loop 模式为无限循环动画（不确定进度）。' } },
  },
};

export const Segments: Story = {
  args: {
    value: 60,
    segments: 5,
    color: 'success',
    showLabel: true,
  },
  parameters: {
    docs: { description: { story: 'segments 分段显示，类似生命值分段条。' } },
  },
};

export const Colors: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ProgressBar value={80} color="success" showLabel />
      <ProgressBar value={55} color="warning" showLabel />
      <ProgressBar value={20} color="danger" showLabel />
    </div>
  ),
};
