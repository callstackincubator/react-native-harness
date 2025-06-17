import {
  ElementRef,
  QueryOptions,
  LocationStrategy,
} from '@react-native-harness/interaction-engine';
import { getClient } from './client.js';

const getFindByQuery = <TMultiple extends boolean>(
  locationStrategy: LocationStrategy,
  multiple: TMultiple
) => {
  return <TOptions extends QueryOptions>(
    query: string,
    options?: TOptions
  ): Promise<
    TMultiple extends true
      ? TOptions extends { strict: true }
        ? [ElementRef, ...ElementRef[]]
        : ElementRef[]
      : TOptions extends { strict: true }
      ? ElementRef
      : ElementRef | null
  > => {
    // TODO: Fix this
    // @ts-expect-error Fix this
    return getClient().rpc.executeQuery(
      { locationStrategy, value: query },
      { ...options, multiple }
    );
  };
};

const readyScreen = {
  findByTestId: getFindByQuery('id', false),
  findAllByTestId: getFindByQuery('id', true),
  findByLabel: getFindByQuery('accessibility id', false),
  findAllByLabel: getFindByQuery('accessibility id', true),
  findByText: getFindByQuery('text', false),
  findAllByText: getFindByQuery('text', true),
} as const;

export type Screen = typeof readyScreen;

const notImplemented = (): never => {
  throw new Error(
    "The 'render' method must be called before accessing screen methods. Please ensure you've initialized the component under test."
  );
};

const defaultScreen: Screen = {
  findByTestId: notImplemented,
  findAllByTestId: notImplemented,
  findByLabel: notImplemented,
  findAllByLabel: notImplemented,
  findByText: notImplemented,
  findAllByText: notImplemented,
};

export let screen = defaultScreen;

export const toggleScreenAccessibility = (accessible: boolean): void => {
  screen = accessible ? readyScreen : defaultScreen;
};
