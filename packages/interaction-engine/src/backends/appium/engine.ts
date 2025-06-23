import { Browser } from 'webdriverio';
import {
  Action,
  InteractionEngine,
  QueryExecutor,
  QueryBy,
  QueryOptions,
  ElementRef,
  MatcherType,
} from '../../types.js';
import { getActions } from './actions.js';
import * as matchers from './matchers.js';
import { getInteractionEngineQueryError } from './errors.js';

export const createAppiumInteractionEngine = (
  session: Browser
): InteractionEngine => {
  const executeQuery: QueryExecutor = async <T extends QueryOptions>(
    queryBy: QueryBy,
    options?: T
  ) => {
    const { multiple, strict } = options ?? { multiple: false, strict: false };

    if (queryBy.locationStrategy === 'text') {
      if (session.capabilities.platformName === 'Android') {
        queryBy.locationStrategy = '-android uiautomator' as any;
        queryBy.value = `new UiSelector().text("${queryBy.value}")`;
      } else {
        queryBy.locationStrategy = '-ios predicate string' as any;
        queryBy.value = `label == "${queryBy.value}"`;
      }
    }

    if (multiple) {
      const elements = await session.findElements(
        queryBy.locationStrategy,
        queryBy.value
      );

      const elementRefs = elements.map((element) => ({
        id: element['element-6066-11e4-a52e-4f735466cecf'],
        queryBy,
      }));

      if (strict && elementRefs.length === 0) {
        throw await getInteractionEngineQueryError(session, queryBy, multiple);
      }

      return elementRefs as any;
    }

    try {
      const element = await session.findElement(
        queryBy.locationStrategy,
        queryBy.value
      );

      // TODO: Why findElement returns an object with an error property?
      if ('error' in element && 'message' in element) {
        throw new Error(element.message as string);
      }

      return {
        id: element['element-6066-11e4-a52e-4f735466cecf'],
        queryBy,
      } as any;
    } catch (error) {
      if (strict) {
        throw await getInteractionEngineQueryError(session, queryBy, false);
      }
      return null as any;
    }
  };
  const actions = getActions({ session, executeQuery });
  const executeAction = async <TAction extends Action>(action: TAction) => {
    const actionFn = actions[action.type];

    if (!actionFn) {
      throw new Error(`Action ${action.type} not found`);
    }

    // TODO: Type this
    // @ts-expect-error
    await actionFn.call(actions, action.payload);
  };
  const executeMatcher = async (
    elementRef: ElementRef,
    matcher: MatcherType
  ) => {
    const matcherFn =
      matchers[
      `is${matcher.charAt(0).toUpperCase() + matcher.slice(1)
      }` as keyof typeof matchers
      ];

    if (!matcherFn) {
      throw new Error(`Matcher ${matcher} not found`);
    }

    const result = await matcherFn(session, elementRef);
    return result;
  };

  return {
    executeQuery,
    executeAction,
    executeMatcher,
    close: async () => {
      await session.deleteSession();
    },
  };
};
