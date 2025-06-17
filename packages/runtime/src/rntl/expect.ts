import { use, Assertion } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';
import { getClient } from './client.js';

use(chaiAsPromised);
use(sinonChai);

export { expect } from 'chai';

Assertion.addMethod('toBeDisplayed', async function () {
  const result = await getClient().rpc.executeMatcher(this._obj, 'displayed');

  this.assert(
    result,
    'expected element to be displayed',
    'expected element not to be displayed',
    true,
    result
  );
});

Assertion.addMethod('toBeDisabled', async function () {
  const result = await getClient().rpc.executeMatcher(this._obj, 'disabled');

  this.assert(
    result,
    'expected element to be disabled',
    'expected element not to be disabled',
    true,
    result
  );
});

Assertion.addMethod('toBeEnabled', async function () {
  const result = await getClient().rpc.executeMatcher(this._obj, 'enabled');

  this.assert(
    result,
    'expected element to be enabled',
    'expected element not to be enabled',
    true,
    result
  );
});

declare global {
  // This is the only way to extend the Chai Assertion interface.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Chai {
    interface Assertion {
      toBeDisplayed(): Promise<void>;
      toBeDisabled(): Promise<void>;
      toBeEnabled(): Promise<void>;
    }
  }
}
