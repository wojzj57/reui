import type { Meta, StoryObj } from '@storybook/react';
import { Radio } from '@reui/framework';

const meta: Meta<typeof Radio> = {
  title: 'Form/Radio',
  component: Radio,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Radio 封装。支持 Radio.Group（单选组）和 Radio.Button（按钮样式）。',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Radio>;

export const Default: Story = {
  render: () => (
    <Radio.Group defaultValue={1}>
      <Radio value={1}>Option A</Radio>
      <Radio value={2}>Option B</Radio>
      <Radio value={3} disabled>Option C (disabled)</Radio>
    </Radio.Group>
  ),
};

export const ButtonStyle: Story = {
  render: () => (
    <Radio.Group defaultValue={1} optionType="button">
      <Radio.Button value={1}>Yes</Radio.Button>
      <Radio.Button value={2}>No</Radio.Button>
      <Radio.Button value={3} disabled>Maybe</Radio.Button>
    </Radio.Group>
  ),
  parameters: {
    docs: { description: { story: '按钮样式 Radio，使用 Radio.Button 子组件。' } },
  },
};

export const VerticalGroup: Story = {
  render: () => (
    <Radio.Group defaultValue="a">
      <Radio value="a">Apple</Radio>
      <Radio value="b">Banana</Radio>
      <Radio value="c">Cherry</Radio>
    </Radio.Group>
  ),
};
