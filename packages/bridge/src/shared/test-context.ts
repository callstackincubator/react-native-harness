export type HarnessTaskContext = {
  name: string;
  type: 'test';
  mode: 'run' | 'skip' | 'todo';
  file: {
    name: string;
  };
  suite: {
    name: string;
  };
};

export type HarnessTestContext = {
  task: HarnessTaskContext;
  skip: {
    (note?: string): never;
    (condition: boolean, note?: string): void;
  };
};
