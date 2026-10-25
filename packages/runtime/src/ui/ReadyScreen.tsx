import { useContext, useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import { useRunnerStatus } from './state.js';
import { TestComponentOverlay } from '../render/TestComponentOverlay.js';
import { RunnerScreen } from './RunnerScreen.js';
import { observeTestHostSurface } from '../host-surface.js';

require('../initialize.js');

const NativeHostSurfaceObserver = () => {
  const { RootTagContext }: Pick<typeof import('react-native'), 'RootTagContext'> =
    require('react-native');
  const rootTag = useContext(RootTagContext);
  useLayoutEffect(() => {
    observeTestHostSurface(rootTag);
  }, [rootTag]);
  return null;
};

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
      {Platform.OS === 'android' || Platform.OS === 'ios' ? (
        <NativeHostSurfaceObserver />
      ) : null}
      <RunnerScreen title="Harness" statusText={statusText} />
      <TestComponentOverlay />
    </>
  );
};
