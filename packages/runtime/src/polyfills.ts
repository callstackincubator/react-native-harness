/**
 * Polyfills for ES2022+ features not supported by JSC (JavaScriptCore).
 *
 * JSC, used in React Native when Hermes is disabled, doesn't support
 * Object.hasOwn (ES2022). This causes runtime errors when @vitest/expect
 * v4.x initializes.
 *
 * This polyfill must be loaded before any code that uses Object.hasOwn.
 */

if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = (obj: object, prop: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(obj, prop);
}
