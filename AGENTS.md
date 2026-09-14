- This is a pnpm and Nx monorepo. Publishable packages are under `packages/`.
- The user-facing documentation website is maintained in `website/`.
- Read `CONTRIBUTING.md` and the relevant source, tests, and agent guide before
  making a change.
- For version plans, see @./docs/agents/version-plans.md.
- Before preparing or opening a pull request, see @./docs/agents/pull-requests.md.
- Architecture decisions are recorded under `docs/internal/adr/`; read the
  relevant ADR before implementing a change it covers.
- Preserve unrelated work already present in the working tree.
- Keep changes focused; do not make opportunistic refactors.
- Never commit credentials, secrets, generated build output, or local
  environment files.
- Run validation proportionate to the change and report what was run.
