import { useRunnerStatus } from './state.js';
import { TestComponentOverlay } from '../render/TestComponentOverlay.js';
import { RunnerScreen } from './RunnerScreen.js';

require('../initialize.js');

export const ReadyScreen = () => {
  const status = useRunnerStatus();
  const statusText =
    status === 'loading'
      ? 'Loading...'
      : status === 'idle'
      ? 'Idle'
      : 'Running...';

  return (
    <>
      <RunnerScreen title="Harness" statusText={statusText} />
      <TestComponentOverlay />
    </>
  );
};
