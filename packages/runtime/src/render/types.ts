import type React from 'react';

export type RenderResult = {
  rerender: (element: React.ReactElement) => Promise<void>;
  unmount: () => void;
};

export type RenderOptions = {
  /**
   * Timeout in milliseconds to wait for component to be laid out
   * @default 1000
   */
  timeout?: number;
};
