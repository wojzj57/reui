import type { Meta, StoryObj } from '@storybook/react';

const meta: Meta = {
  title: 'FiveM/Numpad (Planned)',
  parameters: {
    docs: {
      description: {
        component:
          '数字键盘组件（计划中）。用于 FiveM 场景如 ATM 密码输入、车牌输入等。',
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
      <h3>🔜 Numpad — Planned</h3>
      <p>This component is planned for a future release.</p>
      <p>Expected API: <code>{`Numpad({ onsubmit, length })`}</code></p>
    </div>
  ),
};
