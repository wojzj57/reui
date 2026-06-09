import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from '@reui/framework';

const meta: Meta<typeof Stack> = {
  title: 'Layout/Stack',
  component: Stack,
  parameters: {
    docs: {
      description: {
        component:
          'Flex 布局辅助组件。吸收旧 Item 行/卡片排布，支持 direction、gap、align、justify。',
      },
    },
  },
  argTypes: {
    direction: { control: 'select', options: ['horizontal', 'vertical'] },
    gap: { control: 'select', options: ['sm', 'md', 'lg', 8, 16, 24, 32] },
    align: { control: 'select', options: ['start', 'center', 'end', 'stretch'] },
    justify: { control: 'select', options: ['start', 'center', 'end', 'between', 'around', 'evenly'] },
    wrap: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Stack>;

const Box = (props: { label: string; color?: string }) => (
  <div
    style={{
      padding: '12px 16px',
      background: props.color ?? 'var(--reui-color-accent, #6366f1)',
      color: '#fff',
      borderRadius: 4,
      fontSize: 12,
    }}
  >
    {props.label}
  </div>
);

export const Vertical: Story = {
  args: {
    direction: 'vertical',
    gap: 'md',
    align: 'stretch',
    children: (
      <>
        <Box label="Item 1" />
        <Box label="Item 2" />
        <Box label="Item 3" />
      </>
    ),
  },
};

export const Horizontal: Story = {
  args: {
    direction: 'horizontal',
    gap: 'md',
    align: 'center',
    children: (
      <>
        <Box label="Left" />
        <Box label="Center" color="#22c55e" />
        <Box label="Right" color="#ef4444" />
      </>
    ),
  },
};

export const JustifyBetween: Story = {
  args: {
    direction: 'horizontal',
    gap: 'md',
    justify: 'between',
    style: { width: '100%' },
    children: (
      <>
        <Box label="Start" />
        <Box label="Middle" color="#22c55e" />
        <Box label="End" color="#ef4444" />
      </>
    ),
  },
  parameters: {
    docs: { description: { story: 'justify="between" 主轴两端对齐。' } },
  },
};

export const Wrap: Story = {
  args: {
    direction: 'horizontal',
    gap: 'sm',
    wrap: true,
    style: { width: 240 },
    children: Array.from({ length: 8 }, (_, i) => (
      <Box key={i} label={`#${i + 1}`} color={`hsl(${i * 45}, 70%, 50%)`} />
    )),
  },
  parameters: {
    docs: { description: { story: 'wrap 超出宽度自动换行。' } },
  },
};
