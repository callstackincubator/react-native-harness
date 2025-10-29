// Inspirted by https://github.com/facebook/metro/blob/3911b49b7477995e0cbbd7b969ffe34d4e63c1cf/packages/metro/src/lib/JsonReporter.js
const fs = require('node:fs');

class HarnessReporter {
  _stream;
  constructor() {
    // Pass via a custom pipe
    this._stream = fs.createWriteStream('', { fd: 3 });
  }
  update(event) {
    if (event.error instanceof Error) {
      const { message, stack } = event.error;
      event = Object.assign(event, {
        error: serializeError(event.error),
        message,
        stack,
      });
    }
    this._stream.write(JSON.stringify(event) + '\n');
  }
}

const serializeError = (e, seen = new Set()) => {
  if (seen.has(e)) {
    return { message: '[circular]: ' + e.message, stack: e.stack };
  }
  seen.add(e);
  const { message, stack, cause } = e;
  const serialized = { message, stack };
  if (e instanceof AggregateError) {
    serialized.errors = [...e.errors]
      .map((innerError) =>
        innerError instanceof Error ? serializeError(innerError, seen) : null
      )
      .filter(Boolean);
  }
  if (cause instanceof Error) {
    serialized.cause = serializeError(cause, seen);
  }
  return serialized;
};

module.exports = HarnessReporter;
