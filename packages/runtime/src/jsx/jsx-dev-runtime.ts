import * as ReactJSXRuntimeDev from 'react/jsx-dev-runtime';

export const Fragment = ReactJSXRuntimeDev.Fragment;

export function jsxDEV(...args: Parameters<typeof ReactJSXRuntimeDev.jsxDEV>) {
  const [type, props, key, isStaticChildren, source, self] = args;
  const nextProps =
    type &&
    (type.displayName === 'View' || type.name === 'View') &&
    props &&
    props.collapsable === undefined
      ? { ...props, collapsable: true }
      : props;

  if (
    type &&
    (type.displayName === 'View' || type.name === 'View') &&
    props &&
    props.collapsable === undefined
  ) {
    return ReactJSXRuntimeDev.jsxDEV(
      type,
      nextProps,
      key,
      isStaticChildren,
      source,
      self
    );
  }
  return ReactJSXRuntimeDev.jsxDEV(
    type,
    nextProps,
    key,
    isStaticChildren,
    source,
    self
  );
}
