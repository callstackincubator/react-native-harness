import {
  Action,
  ActionType,
  ElementRef,
} from '@react-native-harness/interaction-engine';
import { getClient } from './client.js';

const getUserEventAction = <T extends ActionType>(actionType: T) => {
  return (
    elementRef: ElementRef,
    options?: Omit<Extract<Action, { type: T }>['payload'], 'elementRef'>
  ) => {
    return getClient().rpc.executeAction({
      type: actionType,
      payload: {
        elementRef,
        ...(options || {}),
      },
    } as Action);
  };
};

export const userEvent = {
  press: getUserEventAction('press'),
  longPress: getUserEventAction('longPress'),
  type: getUserEventAction('type'),
  clear: getUserEventAction('clear'),
  scroll: getUserEventAction('scroll'),
};
