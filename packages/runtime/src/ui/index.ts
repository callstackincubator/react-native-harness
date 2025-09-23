export const UI = global.RN_HARNESS
  ? require('./ReadyScreen').ReadyScreen
  : require('./WrongEnvironmentScreen').WrongEnvironmentScreen;
