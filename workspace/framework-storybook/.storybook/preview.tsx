import type { Preview } from '@storybook/react';
import React from 'react';
import { ReUIProvider } from '@reui/framework';

const preview: Preview = {
  decorators: [
    (Story) => (
      <ReUIProvider>
        <Story />
      </ReUIProvider>
    ),
  ],
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: { expanded: true },
  },
};

export default preview;
