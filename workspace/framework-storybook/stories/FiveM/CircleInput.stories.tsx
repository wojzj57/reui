import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'FiveM/CircleInput (Planned)',
  parameters: {
    docs: {
      description: {
        component:
          '圆形输入组件（计划中）。用于 FiveM 场景如无线电频率调节、圆形菜单选择等。',
      },
    },
    status: 'planned',
  },
};

export default meta;
type Story = StoryObj;

export const Planned: Story = {
  render: () => (
    <div style={{ padding: 32, color: '#888', textAlign: 'center' }}>
      <h3>🔜 CircleInput — Planned</h3>
      <p>This component is planned for a future release.</p>
      <p>Expected API: <code>{`CircleInput({ value, onChange, max })`}</code></p>
    </div>
  ),
};
