# goal-mode pi extension

Session-scoped `/goal` loop for long unattended runs.

## Commands

```text
/goal <condition>
/goal --max-turns 80 --max-minutes 360 <condition>
/goal --no-limit <condition>
/goal                 show status
/goal pause           pause the loop
/goal resume          resume the loop
/goal clear           clear the goal
```

Aliases for `clear`: `stop`, `off`, `reset`, `none`, `cancel`.

## How it works

One goal can be active per session. Setting a goal sends an initial user message.
After every agent turn, a small evaluator model checks whether the transcript
contains evidence that the condition is met. If not, the extension sends a
follow-up message with the evaluator reason and the next step. If yes, it marks
the goal achieved and stops.

The evaluator does not run tools. The working agent must surface evidence in the
conversation: test output, build status, file counts, screenshots, or a clear
blocker.

Defaults are bounded for safety: 50 turns or 240 minutes. Use flags to change
or remove those limits.
