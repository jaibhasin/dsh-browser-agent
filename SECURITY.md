# Security policy

This project is an early beta that can read and interact with websites in your signed-in Chrome tabs.
Please do not disclose security issues in a public issue or discussion.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository if it is available.
If that option is not available, open a minimal issue asking for a private reporting channel without including exploit details, credentials, or personal data.

Include the affected revision, the smallest reproducible example, the expected and observed behavior, and any relevant logs with secrets removed.
Please allow reasonable time for investigation before public disclosure.

## What to report

Report authentication or bridge-token bypasses, unintended browser actions, cross-origin access, credential or page-data exposure, malicious installer behavior, and vulnerabilities in shipped dependencies.

The bridge is intended to listen only on localhost and uses a generated token.
Never post that token, API keys, browser cookies, or private page content in a report.
