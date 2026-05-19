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
};
