import type React from 'react';

export type RenderResult = {
  rerender: (element: React.ReactElement) => Promise<void>;
  unmount: () => void;
};

export type RenderOptions = {
  timeout?: number;
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
};
