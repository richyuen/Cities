# Blox Skylines — working rules

Module contract: `ARCHITECTURE.md`. Improvement loop and gates: `docs/LOOP.md`. Dev server: `http://127.0.0.1:5188`
(`CITY_PORT` overrides it). Screenshot harness: `node tools/shot.mjs`.

## Git workflow (owner decision, 2026-10-11)

- **Work directly on `main`.** Do not create feature or task branches.
- **Push right after every commit:** `git push origin main`. A commit that has not been pushed is not done.
  This adds the push; it does not change *when* to commit — commit when the owner asks or when the loop banks
  a cycle (LOOP.md E5).
- **Every push deploys.** `.github/workflows/deploy.yml` publishes `main` to GitHub Pages on push, so a commit
  goes live. Run the check scripts the change touches before committing (`node tools/check-playtest.mjs`,
  `check-detail.mjs`, `check-transit.mjs`, `check-disasters.mjs`, `road-audit.mjs`) and gate the commit on
  them with `&&`, never `;`.
