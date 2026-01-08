/**
 * Polyfills for Hermes JavaScript engine compatibility.
 *
 * Hermes (React Native's default JS engine) doesn't support all ES2022+ features.
 * This file provides polyfills for features used by harness dependencies.
 */

/**
 * Object.hasOwn (ES2022)
 * Used by @vitest/expect v4.x for property checking.
 * @see https://github.com/facebook/hermes/issues/1875
 */
if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = (obj: object, prop: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(obj, prop);
}
