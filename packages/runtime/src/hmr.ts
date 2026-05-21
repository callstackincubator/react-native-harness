/**
 * HMRClient is not on the react-native public API; keep the deep import here only.
 */
type HMRClientShape = {
  disable: () => void;
};

export const disableHMR = (): void => {
  const module = require('react-native/Libraries/Utilities/HMRClient') as
    | { default: HMRClientShape }
    | HMRClientShape;
  const client = 'default' in module ? module.default : module;
  client.disable();
};
