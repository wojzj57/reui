import type { Meta, StoryObj } from '@storybook/react';
import { Slider } from '@reui/framework';

const meta: Meta<typeof Slider> = {
  title: 'Form/Slider',
  component: Slider,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Slider 封装，吸收旧库「以中点为界双色」可视化。centered 模式下轨道以中点为界两侧异色。',
      },
    },
  },
  argTypes: {
    centered: { control: 'boolean' },
    color: { control: 'select', options: ['accent', 'success', 'warning', 'danger'] },
    onChange: { action: 'onChange' },
    min: { control: 'number' },
    max: { control: 'number' },
    range: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  args: {
    min: 0,
    max: 100,
    defaultValue: 30,
  },
};

export const Centered: Story = {
  args: {
    min: 0,
    max: 100,
    defaultValue: 30,
    centered: true,
    color: 'accent',
  },
  parameters: {
    docs: {
      description: {
        story: 'centered 模式下，轨道以中点为界双色显示，color 控制高位颜色。',
      },
    },
  },
};

export const Range: Story = {
  args: {
    min: 0,
    max: 100,
    defaultValue: [20, 60],
    range: true,
  },
};
