import type { Meta, StoryObj } from '@storybook/react';
import { toast, ToastHost } from '@reui/framework';

const meta: Meta = {
  title: 'Feedback/Toast',
  component: () => null,
  parameters: {
    docs: {
      description: {
        component:
          '命令式 Toast，通过 toast.success(...)、toast.error(...) 等调用。需用 <ToastHost /> 挂载渲染宿主。',
      },
    },
  },
  decorators: [
    (Story) => (
      <>
        <ToastHost />
        <Story />
      </>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const Success: Story = {
  play: async () => {
    toast.success('Operation succeeded!');
  },
  parameters: {
    docs: { description: { story: '调用 toast.success(content) 触发成功提示。' } },
  },
};

export const Error: Story = {
  play: async () => {
    toast.error('Something went wrong.');
  },
};

export const Warning: Story = {
  play: async () => {
    toast.warning('Please check your input.');
  },
};

export const Info: Story = {
  play: async () => {
    toast.info('New message received.');
  },
};

export const Loading: Story = {
  play: async () => {
    const id = toast.loading('Processing...');
    // 3 秒后自动 dismiss（模拟）
    setTimeout(() => toast.dismiss(id), 3000);
  },
  parameters: {
    docs: { description: { story: 'loading 类型不会自动消失，需手动 dismiss。' } },
  },
};

export const WithOnClose: Story = {
  play: async () => {
    toast.success('With callback', {
      duration: 2000,
      onClose: () => console.log('Toast closed'),
    });
  },
};
