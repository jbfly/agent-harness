# tmux-dashboard pi extension

Global pi extension for the shared `alpha` tmux workspace.

## Commands

- `/tmux` opens the tmux control menu.
- `/tmux-pane <command>` creates a pi-managed split pane in the current project.
- `/tmux-window [name] :: [command]` creates a pi-managed tmux window.
- `/tmux-refresh` refreshes the footer status and managed-pane widget.

The footer status, managed-pane widget, `/tmux` managed-pane actions, and
`tmux_list` with `scope="managed"` show only managed panes in the tmux window
that contains the current pi pane. They do not scan every window in the session.

Shortcut: `Ctrl+Alt+t` opens `/tmux`.

## Tools

- `tmux_list` lists sessions, windows, panes, and pi-managed panes. Managed-pane listings are current-window scoped.
- `tmux_capture` captures recent text from a pane.
- `tmux_new_pane` creates a pi-managed split pane.
- `tmux_new_window` creates a pi-managed window.
- `tmux_send_keys` sends text or key names to a pane.
- `tmux_kill_pane` kills a pane.

Panes created by the extension get `@pi_managed=1` and `@pi_label=<label>`.
`tmux_send_keys` and `tmux_kill_pane` require confirmation before touching an
unmanaged pane.

## Reload

Run `/reload` in pi after editing the extension.
