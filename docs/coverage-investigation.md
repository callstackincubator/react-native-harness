# Coverage Investigation

## The Real Issue: Monorepo/create-react-native-library Projects

Coverage reports 0% in create-react-native-library projects because:

1. Tests run from `example/` directory (`process.cwd()`)
2. Source files are in `../src/`
3. `babel-plugin-istanbul` uses `cwd` as its root
4. Istanbul's `test-exclude` **skips files outside cwd**
5. Files in `../src/` get skipped → **0% coverage**

```
[istanbul] shouldSkip(/project/src/index.tsx) = true
           cwd=/project/example
           include=[]
```

## The Fix

Added `coverage.root` config option to specify where source files live.

### Usage

```javascript
// rn-harness.config.mjs
export default {
  entryPoint: './src/App.tsx',
  appRegistryComponentName: 'main',
  coverage: {
    root: '..', // Point to parent where library src/ lives
  },
  runners: [/* ... */],
};
```

### Implementation

1. **`packages/config/src/types.ts`** - Added `coverage.root` to config schema
2. **`packages/babel-preset/src/preset.ts`** - Pass `cwd` option to babel-plugin-istanbul when `RN_HARNESS_COVERAGE_ROOT` is set
3. **`packages/jest/src/setup.ts`** - Pass `coverage.root` from config to env var

---

## Ruled Out: Env Var Timing Issue

We initially suspected `rnHarnessPlugins` was evaluated before `RN_HARNESS_COLLECT_COVERAGE` was set.

**Investigation with file-based logging proved this is NOT the issue:**

```
PID 54120 (Jest main process):
  05:43:37.331Z - babel-preset loaded, env var = undefined
  05:43:37.348Z - setup() sets RN_HARNESS_COLLECT_COVERAGE = true

PID 54299 (Metro worker - spawned ~5s later):
  05:43:42.055Z - babel-preset loaded, env var = true  ← Inherited from parent!
```

Metro workers **inherit** env vars from the parent process. By the time Metro forks workers, the env var is already set.

---

## How to Troubleshoot Coverage Issues

If you encounter 0% coverage:

### 1. Check if it's a monorepo/cwd issue

Add logging to see what istanbul is doing:

```typescript
// In babel-preset, temporarily add:
console.log('[istanbul] cwd:', process.cwd());
console.log('[istanbul] file being transformed:', filename);
```

If files are outside `cwd`, that's the issue → use `coverageRoot` config.

### 2. Check env var timing (unlikely to be the issue)

Add to `packages/babel-preset/src/preset.ts`:
```typescript
import { appendFileSync } from 'fs';
const log = (msg: string) => {
  try { appendFileSync('/tmp/harness-debug.log', `${new Date().toISOString()} ${msg}\n`); } catch {}
};
log(`[babel-preset] PID=${process.pid}, RN_HARNESS_COLLECT_COVERAGE=${process.env.RN_HARNESS_COLLECT_COVERAGE}`);
```

Run tests and check:
```bash
rm -f /tmp/harness-debug.log
pnpm test:harness --coverage
cat /tmp/harness-debug.log
```

Metro workers (different PIDs) should see `RN_HARNESS_COLLECT_COVERAGE=true`.
