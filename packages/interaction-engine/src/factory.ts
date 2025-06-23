import { TestRunnerConfig } from '@react-native-harness/config';
import { InteractionEngine } from './types.js';
import { appiumBackend } from './backends/appium/index.js';
import { stubBackend } from './backends/stub/index.js';

export const getInteractionEngine = async (
    runner: TestRunnerConfig
): Promise<InteractionEngine> => {
    if (!runner.withUI) {
        return stubBackend.getInteractionEngine(runner);
    }

    return appiumBackend.getInteractionEngine(runner);
}; 