import type { Meta, StoryObj } from '@storybook/react';
import { Loading } from '@reui/framework';

const meta: Meta<typeof Loading> = {
  title: 'DataDisplay/Loading',
  component: Loading,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Spin 封装。去掉旧库硬编码 "CAEP" 与中文文案，tip 可配置。',
      },
    },
  },
  argTypes: {
    tip: { control: 'text' },
    fullscreen: { control: 'boolean' },
    size: { control: 'select', options: ['small', 'default', 'large'] },
    spinning: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Loading>;

export const Default: Story = {
  args: {
    tip: 'Loading...',
    spinning: true,
  },
};

export const Fullscreen: Story = {
  args: {
    tip: 'Please wait...',
    fullscreen: true,
    spinning: true,
  },
  parameters: {
    docs: { description: { story: '全屏遮罩加载，覆盖整个视口。' } },
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
      <Loading size="small" tip="Small" spinning />
      <Loading size="default" tip="Default" spinning />
      <Loading size="large" tip="Large" spinning />
    </div>
  ),
};
