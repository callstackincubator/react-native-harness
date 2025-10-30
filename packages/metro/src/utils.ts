export type NotReadOnly<T> = {
  -readonly [K in keyof T]: T[K];
};
