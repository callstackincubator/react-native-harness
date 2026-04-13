import * as React from 'react';
import { View } from 'react-native';
import * as ReactJSXRuntime from 'react/jsx-runtime';
import { getHarnessGlobal } from '../globals.js';

export const Fragment = ReactJSXRuntime.Fragment;

function wrap(
  type: React.ElementType,
  props: unknown,
  key: React.Key | undefined,
  isStatic: boolean,
): React.ReactElement {
  const disableViewFlattening = getHarnessGlobal().disableViewFlattening;

  if (disableViewFlattening && type === View) {
    props = { ...(props as Record<string, unknown>), collapsable: false };
  }

  return isStatic
    ? ReactJSXRuntime.jsxs(type, props, key)
    : ReactJSXRuntime.jsx(type, props, key);
}

export function jsx(
  type: React.ElementType,
  props: unknown,
  key?: React.Key,
): React.ReactElement {
  return wrap(type, props, key, false);
}

export function jsxs(
  type: React.ElementType,
  props: unknown,
  key?: React.Key,
): React.ReactElement {
  return wrap(type, props, key, true);
}

export function createElement(
  type: React.ElementType,
  props?: Record<string, unknown> | null,
  ...children: React.ReactNode[]
): React.ReactElement {
  const disableViewFlattening = getHarnessGlobal().disableViewFlattening;

  if (disableViewFlattening && type === View) {
    props = { ...props, collapsable: false };
  }

  return React.createElement(type, props, ...children);
}
