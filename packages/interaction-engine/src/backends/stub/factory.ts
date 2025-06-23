import { TestRunnerConfig } from '@react-native-harness/config';
import { InteractionEngine } from '../../types.js';
import { UIBackendFactory } from '../types.js';
import { createStubInteractionEngine } from './engine.js';

const getStubInteractionEngine = async (
    runner: TestRunnerConfig
): Promise<InteractionEngine> => {
    return createStubInteractionEngine(runner);
};

export const stubBackend: UIBackendFactory = {
    getInteractionEngine: getStubInteractionEngine,
    getName: () => 'stub',
}; 