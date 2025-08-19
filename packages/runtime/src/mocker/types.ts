export type ModuleId = number;
export type Require = {
  (moduleId: number): unknown;
};

export type ModuleFactory = () => unknown;
