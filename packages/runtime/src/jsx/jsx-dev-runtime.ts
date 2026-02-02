import * as ReactJSXRuntimeDev from 'react/jsx-dev-runtime';

export const Fragment = ReactJSXRuntimeDev.Fragment;

export function jsxDEV(
  type: any,
  props: any,
  key: any,
  isStaticChildren: any,
  source: any,
  self: any
) {
  if (
    type &&
    (type.displayName === 'View' || type.name === 'View') &&
    props &&
    props.collapsable === undefined
  ) {
    props = { ...props, collapsable: true };
  }
  return ReactJSXRuntimeDev.jsxDEV(
    type,
    props,
    key,
    isStaticChildren,
    source,
    self
  );
}
