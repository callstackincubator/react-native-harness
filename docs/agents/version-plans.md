# Version plans

A version plan is required only for code changes that influence Harness
behavior. Do not create a version plan for documentation-only changes.

## Create the plan

1. Generate the plan with the Nx CLI. While the change is uncommitted, run:

   ```sh
   pnpm exec nx release plan --uncommitted --untracked
   ```

   Otherwise, run `pnpm exec nx release plan`. Follow the prompts to select
   the affected packages or release groups and the appropriate version bump.
2. Review the generated Markdown file under `.nx/version-plans/`. Package and
   release-group names must exactly match those defined by Nx.
3. Write a concise, user-facing summary after the frontmatter. Describe the
   capability, behavior, or fix—not the files or implementation technique.

## Examples

An affected package:

```md
---
@react-native-harness/runtime: patch
---

Harness runs now end cleanly after test execution instead of occasionally
remaining active until they time out.
```

## Check the plan

Run the following when dependencies are installed to verify that affected
projects have a corresponding plan:

```sh
pnpm exec nx release plan:check
```

Existing files in `.nx/version-plans/` are the repository's best examples for
tone and release scope.
