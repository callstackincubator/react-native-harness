import * as ReactJSXRuntimeDev from 'react/jsx-dev-runtime';

type NamedElementType = {
  displayName?: string;
  name?: string;
};

const isNamedElementType = (value: unknown): value is NamedElementType =>
  (typeof value === 'function' ||
    (typeof value === 'object' && value !== null)) &&
  ('displayName' in value || 'name' in value);

const isPropsObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const Fragment = ReactJSXRuntimeDev.Fragment;

export function jsxDEV(...args: Parameters<typeof ReactJSXRuntimeDev.jsxDEV>) {
  const [type, props, key, isStaticChildren, source, self] = args;
  const isViewType =
    isNamedElementType(type) &&
    (type.displayName === 'View' || type.name === 'View');
  const nextProps =
    isViewType &&
    isPropsObject(props) &&
    props.collapsable === undefined
      ? { ...props, collapsable: true }
      : props;

  if (isViewType && isPropsObject(props) && props.collapsable === undefined) {
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
