#!/usr/bin/env pwsh
# skill-eval gh stub wrapper for PowerShell. Delegates to the Node stub in the same
# directory. Copied into each sandbox's bin/ by make-sandbox.
node "$PSScriptRoot/gh-stub.mjs" @args
exit $LASTEXITCODE
