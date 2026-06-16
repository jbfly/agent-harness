# agent-harness

This repo is the single source of truth for shared agent operating config.

- The global voice and working rules: `profiles/house-style.md`.
- The opt-in terse register for code/systems writing: `profiles/seth-mode.md`.
- How it gets wired into each harness: `install.sh` and `README.md`.

When editing rules, edit the files in `profiles/` — they are symlinked/imported into each
harness, so changes propagate. Don't paste rules into individual harness configs.
