# THROWAWAY — merge-confirmation gate test fixture

This file is a disposable test fixture. It exists only to give a human a harmless
PR to use when testing whether the `/ship` merge-confirmation gate
(`"ask": ["Bash(gh pr merge *)", "PowerShell(gh pr merge *)"]` in
`.claude/settings.json`) actually prompts a human on the FIRST `gh pr merge`
of a brand-new Claude Code session.

It touches no application, server, or schema code. If it is ever accidentally
merged, delete this file — that is the entire revert.

Do not build anything on top of this file. Throwaway.
