import { TestRunnerConfig } from '@react-native-harness/config';
import {
    InteractionEngine,
    QueryExecutor,
    ActionExecutor,
    MatcherExecutor,
} from '../../types.js';
import { UIInteractionDisabledError } from './errors.js';

export const createStubInteractionEngine = (
    runner: TestRunnerConfig
): InteractionEngine => {
    const executeQuery: QueryExecutor = async () => {
        throw new UIInteractionDisabledError('element query');
    };

    const executeAction: ActionExecutor = async (action) => {
        throw new UIInteractionDisabledError(`action "${action.type}"`);
    };

    const executeMatcher: MatcherExecutor = async (elementRef, matcher) => {
        throw new UIInteractionDisabledError(`matcher "${matcher}"`);
    };

    return {
        executeQuery,
        executeAction,
        executeMatcher,
        close: async () => {
            // No-op for stub implementation
        },
    };
}; 