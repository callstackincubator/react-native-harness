export type MetroInstance = {
  dispose: () => Promise<void>;
};

export type MetroFactory = (isExpo: boolean) => Promise<MetroInstance>;
