import type { Meta, StoryObj } from '@storybook/react';
import { dialog, DialogHost } from '@reui/framework';

const meta: Meta = {
  title: 'Feedback/Dialog',
  component: () => null,
  parameters: {
    docs: {
      description: {
        component:
          '命令式 Dialog，通过 dialog.confirm(...)、dialog.alert(...)、dialog.prompt(...) 调用。需用 <DialogHost /> 挂载渲染宿主。',
      },
    },
  },
  decorators: [
    (Story) => (
      <>
        <DialogHost />
        <Story />
      </>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const Confirm: Story = {
  play: async () => {
    const result = await dialog.confirm({
      title: 'Confirm Action',
      content: 'Are you sure you want to proceed?',
    });
    console.log('Confirm result:', result);
  },
  parameters: {
    docs: { description: { story: 'dialog.confirm() 返回 Promise<boolean>。' } },
  },
};

export const Alert: Story = {
  play: async () => {
    await dialog.alert({
      title: 'Alert',
      content: 'This is an alert message.',
    });
  },
};

export const Prompt: Story = {
  play: async () => {
    const result = await dialog.prompt({
      title: 'Enter Value',
      label: 'Your name',
      placeholder: 'Type here...',
      defaultValue: 'Grimes_Z',
    });
    console.log('Prompt result:', result);
  },
};

export const DangerConfirm: Story = {
  play: async () => {
    await dialog.confirm({
      title: 'Delete Item',
      content: 'This action cannot be undone.',
      danger: true,
      okText: 'Delete',
    });
  },
  parameters: {
    docs: { description: { story: 'danger: true 显示危险样式（红色确认按钮）。' } },
  },
};
