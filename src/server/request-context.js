let AsyncLocalStorageImpl = null;

try {
  ({ AsyncLocalStorage: AsyncLocalStorageImpl } = require("async_hooks"));
} catch (error) {
  AsyncLocalStorageImpl = null;
}

const requestContextStorage = AsyncLocalStorageImpl ? new AsyncLocalStorageImpl() : null;
const fallbackContextStack = [];

function runWithRequestContext(context, handler) {
  if (requestContextStorage) {
    return requestContextStorage.run(context, handler);
  }

  fallbackContextStack.push(context);
  try {
    return handler();
  } finally {
    fallbackContextStack.pop();
  }
}

function getRequestContext() {
  if (requestContextStorage) {
    return requestContextStorage.getStore() || {};
  }
  return fallbackContextStack[fallbackContextStack.length - 1] || {};
}

module.exports = {
  runWithRequestContext,
  getRequestContext
};
