# Throwaway — /ship merge-gate test (#463)

PR A adds this file; PR B deletes it. It exists only to test whether the harness `gh pr merge`
confirmation prompt fires on a **2nd same-session merge**. Net change to `main` is zero. Safe to
remove.
