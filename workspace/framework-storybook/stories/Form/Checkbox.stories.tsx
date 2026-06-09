import type { Meta, StoryObj } from '@storybook/react';
import { Checkbox } from '@reui/framework';

const meta: Meta<typeof Checkbox> = {
  title: 'Form/Checkbox',
  component: Checkbox,
  parameters: {
    docs: {
      description: {
        component:
          '基于 antd Checkbox 封装，保留 indeterminate 半选状态。支持 Checkbox.Group 子组件。',
      },
    },
  },
  argTypes: {
    indeterminate: { control: 'boolean' },
    checked: { control: 'boolean' },
    disabled: { control: 'boolean' },
    onChange: { action: 'onChange' },
  },
};

export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Default: Story = {
  args: {
    children: 'Checkbox Label',
  },
};

export const Indeterminate: Story = {
  render: () => {
    const [checked, setChecked] = React.useState(false);
    const [indeterminate, setIndeterminate] = React.useState(true);

    const toggle = () => {
      setChecked((v) => !v);
      setIndeterminate(false);
    };

    return (
      <>
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          onChange={toggle}
        >
          Parent Checkbox
        </Checkbox>
        <div style={{ marginLeft: 24 }}>
          <Checkbox checked={checked} onChange={toggle} children="Child Checkbox" />
        </div>
      </>
    );
  },
  parameters: {
    docs: { description: { story: 'indeterminate 半选状态，常见于父子 checkbox 联动。' } },
  },
};

export const Disabled: Story = {
  args: {
    children: 'Disabled Checkbox',
    disabled: true,
  },
};
