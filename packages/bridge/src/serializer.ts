export const serialize = (data: unknown): string => {
  if (!!data && typeof data === 'object' && 'e' in data && !!data.e) {
    // Serialize error by hand (include message, stack and cause).
    const error = data.e as Error;

    return JSON.stringify({
      ...data,
      e: {
        ...error,
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause,
      },
    });
  }

  return JSON.stringify(data);
};

export const deserialize = (data: string): unknown => {
  return JSON.parse(data);
};
