import { Browser } from 'webdriverio';
import { Action, QueryExecutor } from '../types.js';

export type ActionFactoryContext = {
  session: Browser;
  executeQuery: QueryExecutor;
};

export type ActionMap = {
  [TActionType in Action['type']]: (
    action: Extract<Action, { type: TActionType }>['payload']
  ) => Promise<void>;
};

export const getActions = (context: ActionFactoryContext): ActionMap => {
  const { executeQuery, session } = context;

  return {
    async press(action) {
      const element = await executeQuery(action.elementRef.queryBy);

      if (!element) {
        throw new Error('Element not found');
      }

      const rect = await session.getElementRect(element.id);

      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;

      await session.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              x: Math.round(centerX),
              y: Math.round(centerY),
            },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);

      await session.pause(100);
    },
    async longPress(action) {
      const element = await executeQuery(action.elementRef.queryBy);

      if (!element) {
        throw new Error('Element not found');
      }

      const rect = await session.getElementRect(element.id);

      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;

      await session.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              x: Math.round(centerX),
              y: Math.round(centerY),
            },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 1000 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
      await session.pause(50);
    },
    async type(action) {
      await this.press(action);

      const characters = action.text.split('');
      for (const character of characters) {
        await session.keys(character);
        await session.pause(20);
      }
    },
    async clear(action) {
      const element = await executeQuery(action.elementRef.queryBy);

      if (!element) {
        throw new Error('Element not found');
      }

      await session.elementClear(element.id);
      await session.pause(50);
    },
    async wait(action) {
      await session.pause(action.duration);
    },
    async scroll(action) {
      const element = await executeQuery(action.elementRef.queryBy);

      if (!element) {
        throw new Error('Element not found');
      }

      const rect = await session.getElementRect(element.id);

      const centerX = Math.round(rect.x + rect.width / 2);
      const centerY = Math.round(rect.y + rect.height / 2);
      const distance = Math.round(action.distance);

      const diffX = ['left', 'right'].includes(action.direction)
        ? action.direction === 'left'
          ? distance
          : -distance
        : 0;
      const diffY = ['up', 'down'].includes(action.direction)
        ? action.direction === 'up'
          ? action.distance
          : -action.distance
        : 0;

      await session.performActions([
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              x: centerX,
              y: centerY,
            },
            { type: 'pointerDown', button: 0, x: centerX, y: centerY },
            { type: 'pause', duration: 500 },
            {
              type: 'pointerMove',
              duration: 100,
              x: centerX + diffX,
              y: centerY + diffY,
            },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ]);
    },
  };
};
