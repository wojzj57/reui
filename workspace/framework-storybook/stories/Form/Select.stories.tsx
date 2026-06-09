import type { Meta, StoryObj } from '@storybook/react';
import { Select } from '@reui/framework';

const mockOptions = [
  { label: 'Option A', value: 'a' },
  { label: 'Option B', value: 'b' },
  { label: 'Option C (disabled)', value: 'c', disabled: true },
  { label: 'Option D', value: 'd' },
];

const meta: Meta<typeof Select> = {
  title: 'Form/Select',
  component: Select,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Select 封装，吸收旧 SelectInput 的多选模式。修复旧库 onChange 恒传 value[1] 的 bug——多选时回传完整数组。',
      },
    },
  },
  argTypes: {
    multi: { control: 'boolean' },
    searchable: { control: 'boolean' },
    onChange: { action: 'onChange' },
  },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    options: mockOptions,
    placeholder: 'Select an option',
    style: { width: 240 },
  },
};

export const Searchable: Story = {
  args: {
    options: mockOptions,
    searchable: true,
    placeholder: 'Search and select',
    style: { width: 240 },
  },
};

export const MultiSelect: Story = {
  args: {
    options: mockOptions,
    multi: true,
    placeholder: 'Select multiple',
    style: { width: 240 },
  },
};
