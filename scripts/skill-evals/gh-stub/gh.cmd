@echo off
REM skill-eval gh stub wrapper (cmd/PowerShell resolve this via PATHEXT). Delegates to the
REM Node stub in the same directory. Copied into each sandbox's bin/ by make-sandbox.
node "%~dp0gh-stub.mjs" %*
exit /b %ERRORLEVEL%
