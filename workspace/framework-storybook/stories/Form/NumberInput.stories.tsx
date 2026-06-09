import type { Meta, StoryObj } from '@storybook/react';
import { NumberInput } from '@reui/framework';

const meta: Meta<typeof NumberInput> = {
  title: 'Form/NumberInput',
  component: NumberInput,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd InputNumber 封装，提供加减按钮。去掉旧库硬编码 #000，统一走 antd ThemeConfig。',
      },
    },
  },
  argTypes: {
    min: { control: 'number' },
    max: { control: 'number' },
    step: { control: 'number' },
    onChange: { action: 'onChange' },
  },
};

export default meta;
type Story = StoryObj<typeof NumberInput>;

export const Default: Story = {
  args: {
    min: 0,
    max: 100,
    defaultValue: 50,
    style: { width: 160 },
  },
};

export const WithStep: Story = {
  args: {
    min: 0,
    max: 100,
    step: 10,
    defaultValue: 50,
    style: { width: 160 },
  },
  parameters: {
    docs: { description: { story: '设置 step=10，每次增减 10。' } },
  },
};

export const Disabled: Story = {
  args: {
    defaultValue: 42,
    disabled: true,
    style: { width: 160 },
  },
};
