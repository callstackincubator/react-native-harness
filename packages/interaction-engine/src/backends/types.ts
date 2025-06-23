import { TestRunnerConfig } from '@react-native-harness/config';
import { InteractionEngine } from '../types.js';

export interface UIBackendFactory {
    getInteractionEngine(runner: TestRunnerConfig): Promise<InteractionEngine>;
    getName(): string;
} 