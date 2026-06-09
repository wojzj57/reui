import type { Meta, StoryObj } from '@storybook/react';
import { Panel } from '@reui/framework';
import { BugOutlined } from '@ant-design/icons';

const meta: Meta<typeof Panel> = {
  title: 'Layout/Panel',
  component: Panel,
  parameters: {
    docs: {
      description: {
        component:
          '面板容器，支持拖拽、缩放、玻璃拟态效果。吸收旧 Content 的 onInit 与 Glass 组件。',
      },
    },
  },
  argTypes: {
    title: { control: 'text' },
    closable: { control: 'boolean' },
    draggable: { control: 'boolean' },
    resizable: { control: 'boolean' },
    glass: { control: 'boolean' },
    glassBlur: { control: { type: 'number', min: 0, max: 32 } },
    glassOpacity: { control: { type: 'number', min: 0, max: 1, step: 0.05 } },
    width: { control: 'text' },
    height: { control: 'text' },
  },
  decorators: [(Story) => <div style={{ width: 600, height: 400, position: 'relative' }}><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof Panel>;

export const Default: Story = {
  args: {
    title: 'Panel',
    closable: false,
    draggable: false,
    resizable: false,
    children: <div style={{ padding: 16 }}>Panel content goes here.</div>,
  },
};

export const Draggable: Story = {
  args: {
    title: 'Draggable Panel',
    draggable: true,
    closable: true,
    children: <div style={{ padding: 16 }}>Drag me by the header.</div>,
  },
  parameters: {
    docs: { description: { story: 'draggable 激活后标题栏可拖拽。' } },
  },
};

export const Glass: Story = {
  args: {
    title: 'Glass Panel',
    glass: true,
    glassBlur: 16,
    glassOpacity: 0.85,
    draggable: true,
    closable: true,
    icon: <BugOutlined />,
    children: <div style={{ padding: 16 }}>Glassmorphism effect.</div>,
  },
  parameters: {
    docs: { description: { story: 'glass 启用玻璃拟态，glassBlur 控制模糊半径。' } },
  },
};

export const Resizable: Story = {
  args: {
    title: 'Resizable Panel',
    resizable: true,
    draggable: true,
    closable: true,
    width: 360,
    height: 240,
    children: <div style={{ padding: 16 }}>Resize from bottom-right corner.</div>,
  },
};
