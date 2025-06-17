import { ReactNode } from 'react';
import { state } from '../state.js';
import { toggleScreenAccessibility } from './screen.js';

export const render = async (
  node: ReactNode,
  options?: unknown
): Promise<void> => {
  const renderResult = await state.getState().render(node, options ?? {});
  toggleScreenAccessibility(true);
  return renderResult;
};

export const cleanup = async (): Promise<void> => {
  await state.getState().cleanup();
  toggleScreenAccessibility(false);
};
