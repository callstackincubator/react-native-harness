import {Browser} from 'webdriverio';

export type LocationStrategy = 'id' | 'accessibility id' | 'text';
export type MatcherType = 'displayed' | 'disabled' | 'enabled';

// TODO: Implement this type
// It should follow the WebDriver protocol response.
export type ElementRef = {
  id: string;
  queryBy: QueryBy;
};

export type QueryOptions = {
  multiple?: boolean;
  strict?: boolean;
};

export type Matcher = (
  session: Browser,
  executeQuery: QueryExecutor,
  elementRef: ElementRef,
) => Promise<boolean>;

export type PressAction = {
  type: 'press';
  payload: {
    elementRef: ElementRef;
  };
};

export type LongPressAction = {
  type: 'longPress';
  payload: {
    elementRef: ElementRef;
  };
};

export type TypeAction = {
  type: 'type';
  payload: {
    elementRef: ElementRef;
    text: string;
  };
};

export type ClearAction = {
  type: 'clear';
  payload: {
    elementRef: ElementRef;
  };
};

export type WaitAction = {
  type: 'wait';
  payload: {
    duration: number;
  };
};

export type QueryBy = {
  locationStrategy: LocationStrategy;
  value: string;
};

export type QueryExecutor = <T extends QueryOptions>(
  queryBy: QueryBy,
  options?: T,
) => Promise<
  T extends {multiple: true}
    ? T extends {strict: true}
      ? [ElementRef, ...ElementRef[]]
      : ElementRef[]
    : T extends {strict: true}
    ? ElementRef
    : ElementRef | null
>;

export type MatcherExecutor = (
  elementRef: ElementRef,
  matcher: MatcherType,
) => Promise<boolean>;

export type ScrollAction = {
  type: 'scroll';
  payload: {
    elementRef: ElementRef;
    direction: 'up' | 'down' | 'left' | 'right';
    distance: number;
  };
};

export type Action =
  | PressAction
  | LongPressAction
  | TypeAction
  | ClearAction
  | WaitAction
  | ScrollAction;

export type ActionExecutor = (action: Action) => Promise<void>;

export type ActionType = Action['type'];

export type InteractionEngine = {
  executeQuery: QueryExecutor;
  executeAction: ActionExecutor;
  executeMatcher: MatcherExecutor;
  close: () => Promise<void>;
};
