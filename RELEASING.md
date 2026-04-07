# Releasing

Releases are run with `.github/workflows/release.yml`.

The workflow always uses the branch it is dispatched from. There is no manual ref input.

## Stable releases

Run the workflow from `main` with `mode=stable`.

This applies pending version plans, publishes packages with the default npm dist-tag, pushes the release commit and tag, and creates the GitHub release.

## RC releases

Run the workflow from `release/v<version>` branches, for example `release/v1.1` or `release/v1.1.0`, with `mode=rc`.

`rc` mode is intentionally restricted to `release/v<version>` branches and will fail on `main`.

RC releases consume version plans from `.nx/version-plans`, publish packages with the `rc` dist-tag, and create a prerelease on GitHub.

## Canary releases

Run the workflow from any branch with `mode=canary`.

Canary releases publish a unique prerelease version for the current commit with the `canary` dist-tag. They do not create a commit, tag, or GitHub release.

Canary releases do not consume or remove version plans.

## Publishing auth

Publishing is expected to use npm trusted publishing via GitHub Actions OIDC.

No npm access token is required for the release workflow itself.
