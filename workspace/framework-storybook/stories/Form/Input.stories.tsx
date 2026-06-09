import type { Meta, StoryObj } from '@storybook/react';
import { Input } from '@reui/framework';
import { SearchOutlined } from '@ant-design/icons';

const meta: Meta<typeof Input> = {
  title: 'Form/Input',
  component: Input,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Input 封装，吸收旧 ex-framework 的 editable 行内编辑模式。支持 Input.TextArea、Input.Password、Input.Search 子组件。',
      },
    },
  },
  argTypes: {
    editable: { control: 'boolean' },
    onEditSubmit: { action: 'onEditSubmit' },
    onEditCancel: { action: 'onEditCancel' },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    allowClear: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text',
  },
};

export const WithClearButton: Story = {
  args: {
    placeholder: 'Type something...',
    allowClear: true,
  },
};

export const Editable: Story = {
  args: {
    editable: true,
    defaultValue: 'Click to edit',
    onEditSubmit: (val: string) => console.log('submit', val),
  },
  parameters: {
    docs: {
      description: {
        story: '启用 editable 模式后，点击文本区域可进入行内编辑状态，按 Enter 提交，失焦取消。',
      },
    },
  },
};

export const WithPrefixIcon: Story = {
  args: {
    placeholder: 'Search...',
    prefix: <SearchOutlined />,
    allowClear: true,
  },
};
