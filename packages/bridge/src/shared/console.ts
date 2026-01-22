export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

export type ConsoleEvent = {
  type: 'console';
  level: ConsoleLevel;
  args: string[];
  timestamp: number;
};
