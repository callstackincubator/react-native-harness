# Contributing to React Native Harness

## Before you start any work

Please open an issue before starting to work on a new feature or a fix to a bug you encountered. This will prevent you from wasting your time on a feature that's not going to be merged, because for instance it's out of scope. If there is an existing issue present for the matter you want to work on, make sure to post a comment saying you are going to work on it. This will make sure there will be only one person working on a given issue.

## Development process

All work on React Native Harness happens directly on GitHub. Contributors send pull requests which go through the review process.

> **Working on your first pull request?** You can learn how from this _free_ series: [How to Contribute to an Open Source Project on GitHub](https://egghead.io/series/how-to-contribute-to-an-open-source-project-on-github).

1. Fork the repo and create your branch from `main` (a guide on [how to fork a repository](https://help.github.com/articles/fork-a-repo/)).
2. Run `pnpm i` to install all required dependencies.
3. Run `pnpm build:all` to build all packages
4. Now you are ready to make the changes.

This repository uses Nx to maintain the monorepository. I strongly advise you to briefly go through the [Nx documentation](https://nx.dev/docs/getting-started/intro) to make sure you understand basic rules of working with this technology.

## Testing your changes

You'll find a playground app present in the repository in the 'apps' directory. You can use it to easily test your changes, without the need to link the project to your custom app, living outside of the monorepository. See [README.md](/apps/playground/README.md) file for additional details on the app itself.

You should also run the following checks before opening a pull request:

1. linting via `pnpm lint:all`
2. testing via `pnpm test:all`
3. typechecking via `pnpm typecheck:all`

All checks are also run in CI, but by running them locally you can quickly fix any outstanding issues.

## Creating a pull request

When you are ready to have your changes incorporated into the main codebase, open a pull request.

This repository follows [the Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/#summary). Please follow this pattern in your pull requests. Keep in mind your commits will be squashed before merging and the title will be used as a commit title, so the pull request title should match this convention. Generally, if you cannot describe your changes by a single type of commit (your pull request not only adds a new feature, but also refactors another one), consider splitting your pull request into two.

Make sure to keep an eye out for any necessary updates to the documentation. If you add a new feature, you'll probably need to mention it in the documentation and describe what it is and how to use it. It's less common for fixes, but sometimes also needed.

This project uses GitHub Actions to run validation checks on your pull requests. Keep an eye out for any failures and fix them promptly.

## Release process

Currently, releases are published by maintainers when they determine it's time to do so. Usually, there is at least one release per week as long as there are changes waiting to be published.

Version bumps use [Nx release](https://nx.dev/docs/features/manage-releases) with files under `.nx/version-plans/`. The top-level `nx release` command expects `release.git` in `nx.json`; this repo uses **`nx release version`** and **`nx release changelog`** instead, with git settings under `release.version.git` and `release.changelog.git` (Nx 22).

### Releasing with GitHub Actions

Maintainers release by running the [Release workflow](.github/workflows/release.yml) from the Actions tab on `main`. It:

1. Applies the pending version plans and writes the changelog with the commands described below, then packs every package on macOS so `@react-native-harness/platform-apple` ships its prebuilt XCTest agent artifacts. In parallel, it typechecks, lints, and tests every package.
2. Waits for approval through the `npm` environment, then pushes the `chore: release vX.Y.Z` commit and the `vX.Y.Z` tag to `main`.
3. Publishes the packed tarballs to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers), with provenance, to the `latest` dist-tag, or to the prerelease identifier's dist-tag, such as `rc`.
4. Creates the GitHub release from the new changelog section.

Check **Dry run** to see the version, publish order, and release notes in the run summary without pushing or publishing. If a run fails after pushing the tag, re-run it: it skips steps already done, including packages already on npm. If `main` moves while a release runs, the push fails before anything is published; start a new run.

The workflow restores no caches and the job that pushes and publishes installs no dependencies, so cache poisoning and dependency scripts cannot reach the published packages.

One-time setup:

- Create a GitHub environment named `npm` that requires a reviewer and allows deployments from `main` only.
- On npmjs.com, add a trusted publisher to each package with organization `callstackincubator`, repository `react-native-harness`, workflow `release.yml`, and environment `npm`, and allow it to publish with `npm publish`. Once publishing works, set each package to require two-factor authentication and disallow tokens.
- The workflow pushes to `main` with its `GITHUB_TOKEN`. If `main` gets branch protection or a ruleset, give the workflow a way through, such as a bypass or a GitHub App token.

### Releasing locally

Typical flow **without publishing to npm**:

1. `pnpm exec nx release version` — runs the configured `preVersionCommand` (full package build), applies version plans, bumps `packages/*/package.json`, updates the lockfile if needed, and stages changes.
2. `pnpm exec nx release changelog <version>` — prepends that version to the root `CHANGELOG.md`. With the default `nx.json`, this does **not** create a GitHub release or push (set `release.changelog.workspaceChangelog.createRelease` to `"github"` only when you intentionally want an automated GitHub release from your machine).

Publishing to the registry is a separate step: `pnpm exec nx release publish` (requires registry credentials). It is **not** part of the commands above.

## License

By contributing to React Native Harness, you agree that your contributions will be licensed under its MIT license.
