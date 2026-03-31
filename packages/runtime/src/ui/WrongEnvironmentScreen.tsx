import { RunnerScreen } from './RunnerScreen.js';

export const WrongEnvironmentScreen = () => {
  return (
    <RunnerScreen
      title="Harness"
      statusText="Environment Error"
      message="Please double-check that you followed the installation documentation carefully."
    />
  );
};
