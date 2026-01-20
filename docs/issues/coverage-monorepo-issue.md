# Bug Report: `--coverage` reports 0% in create-react-native-library monorepo setups

## Describe the bug

When running harness tests with `--coverage` in a create-react-native-library project, coverage always reports 0% for library source files even though tests pass and execute the code.

**What I expect:** Coverage should show actual percentages for files in `../src/`

**What actually happens:** Coverage shows 0% for all files

```
# Expected
File          | % Stmts |
src/index.tsx |   47.36 |

# Actual
All files     |       0 |
```

**Root cause:** `babel-plugin-istanbul` uses `process.cwd()` as its working directory. In create-react-native-library projects, tests run from `example/` but source files are in `../src/`. Istanbul's `test-exclude` skips files outside `cwd`, so all library source files are excluded from coverage.

## System Info

```
(Any create-react-native-library project)
```

## React Native Harness Version

1.0.0-alpha.23

## Reproduction

https://github.com/rive-app/rive-nitro-react-native

(Or any project created with create-react-native-library)

## Steps to reproduce

1. Create a library with `npx create-react-native-library`
2. Set up react-native-harness in the `example/` directory
3. Add harness tests that import and use library code from `../src/`
4. Run `yarn test:harness:ios --coverage`
5. Observe coverage shows 0% for all library files

**Debug output confirming the issue:**
```
[istanbul] shouldSkip(/project/src/index.tsx) = true
           cwd=/project/example
           include=[]
```

Files outside `cwd` with empty `include` are always skipped by istanbul's `test-exclude`.
