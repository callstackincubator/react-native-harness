// Metro assigns numeric ids by default; custom id factories may use strings.
export type ModuleId = number | string;
export type Require = {
  (moduleId: ModuleId): unknown;
};

export type ModuleFactory = () => unknown;
