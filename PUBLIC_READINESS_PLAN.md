# Public readiness plan

The repo is already public and can remain available as an early beta.
Before promoting it more widely, make installation dependable, close gaps in safety controls, and make the project's checks and documentation trustworthy.
This plan authorizes no implementation or GitHub settings changes by itself.

## Starting evidence

- Local functional tests and the production build passed during the review.
- A credential-pattern scan of 79 locally available Git commits found no matches; this was not an exhaustive secret scan.
- Package-registry audits reported no known vulnerabilities in the checked dependencies.
- The browser bridge listens on localhost and authenticates with a generated token.
- Installer CI run `34326150508` failed on macOS and Windows after roughly ten minutes; Linux passed.
- The newer CI runs were still pending when checked, so recheck their results before diagnosing the current revision.
- `main` had no branch protection at review time.

## 1. Diagnose and repair cross-platform installation

Files: `scripts/install.mjs`, `scripts/install.sh`, `scripts/install.ps1`, `tests/install-e2e.test.mjs`, `.github/workflows/install.yml`.

Start by reproducing the failed lifecycle through the same installer a user runs, using an isolated temporary DSH home on the affected operating systems.
Read the latest CI logs and compare failing and successful revisions before changing code.
The existing test kills each installer subprocess after 600 seconds, but currently reports only its output and exit status.
A timeout explains the observed failure shape; it does not establish why installation stalled.

- Capture subprocess errors, exit signals, and elapsed time per installation stage, with credentials redacted.
- Identify whether dependency downloads, builds, runtime installation, browser launching, or another stage causes the stall.
- Fix the confirmed cause and ensure failed installs leave settings and prior installations recoverable.
- Keep browser opening out of unattended tests through an explicit option if reproduction shows it contributes to the failure.
- Adjust time budgets only when measured installation times justify the change.

Done when a fresh install, startup, update, and recoverable uninstall pass on macOS, Windows, and Linux for the same revision.
Keep the test path containing spaces and the checks that updates preserve tokens and custom settings.

## 2. Make the bridge test reliable

Files: `dsh-plugin/scripts/bridge-test.mjs`, `shared/protocol.ts`, `dsh-plugin/websocket/server.ts`, package test scripts.

Reproduce the current false success by running the smoke test against an isolated bridge.
Its chat request omits required `sessionId` and `resume` fields, and its close handler returns success even when the bridge rejects the request.

- Use the shared protocol version and send valid message shapes.
- Make the default smoke test verify authenticated session creation without requiring an AI provider or spending API credits.
- Keep a model-backed chat check as a separate opt-in test if useful.
- Exit successfully only after receiving the expected matching response without an error.
- Fail on rejected authentication, malformed responses, premature closure, or timeout.
- Add automated coverage for correct and incorrect tokens, rejected website origins, and malformed messages.

Done when valid connections pass and every tested failure returns a nonzero exit code without printing secrets.

## 3. Prevent accidental secret publication

Files: `.gitignore`, a secret-scanner configuration if needed, and a dedicated CI workflow.

- Ignore `.env` and `.env.*` throughout the repo while allowing intentionally sanitized example and template files.
- Exclude bridge-token files and private key files using narrowly scoped patterns that preserve legitimate fixtures.
- Run an established secret scanner over all locally available branches, tags, and history with redacted output.
- Add secret scanning to pull requests and pushes, with sufficient history available for the selected scan mode.
- Verify ignore behavior with `git check-ignore` and verify scanner behavior against an isolated synthetic fixture.
- If a real credential is found, stop publication of that credential and plan revocation and rotation before any history cleanup.

Done when the full scan has no unresolved real credentials and the automated check detects a synthetic secret.
Do not rewrite Git history or rotate credentials without explicit authorization.

## 4. Make approval mode cover meaningful writes

Files: `extension/sidepanel/src/App.tsx`, `extension/sidepanel/src/chat-history.ts`, `extension/background/bridge.ts`, `shared/protocol.ts`, `dsh-plugin/tools/browser-snapshot.ts`, and relevant tests.

Proposed product policy: require approval for clicks, navigation, and typing by default, with an explicit per-chat opt-out.
Typing belongs in this group because websites can autosave or transmit input without a submit click.
Snapshot reads and screenshots retain their existing behavior; this is an action-approval policy, not a promise to approve every data transfer.

- First demonstrate the current behavior on a local browser test page whose input handler records changes immediately.
- Persist the approval preference with each saved chat instead of keeping it only in the side panel's in-memory set.
- Treat missing preferences in new or older saved chats as approval enabled; preserve explicit opt-outs once the setting exists.
- Make omitted protocol flags default to approval enabled at the receiving boundary as well as in the UI.
- Extend the plugin approval gate to `browser_type` and enforce the decision before dispatching the action.
- Show the site, target action, and available element context in approval prompts without exposing passwords or other sensitive input.
- Make deny, cancel, timeout, and task termination prevent the pending action.
- Preserve separate approval decisions across concurrent chats and explain when setting changes take effect.
- Update the slash-command description, visible setting, and README together.

Done when browser tests prove no click, navigation, or input mutation occurs before approval, rejected actions never run, and preferences survive reopening chats.
Also verify that explicit opt-out works and one chat cannot approve another chat's action.

## 5. Make CI a dependable release gate

Files: `.github/workflows/install.yml`, additional check workflows, package test scripts, and dependency-update configuration.

- Add fast checks for the full functional suite, plugin compilation, and extension build using the pinned package manager and frozen lockfile.
- Keep the three-platform installer lifecycle matrix separate so failures are easy to identify.
- Include the repaired bridge tests and secret scan without requiring real API credentials.
- Give checks stable names and minimum required GitHub permissions.
- Pin action dependencies to reviewed commit SHAs and configure automated update proposals for actions and package dependencies.
- Check both the pnpm workspace and the separately locked runtime for dependency advisories.
- Diagnose any repeat failures before enabling required checks; do not hide them with blanket retries or ignored exits.

After these checks pass, configure a main-branch ruleset requiring pull requests and the relevant passing checks, and blocking force pushes and deletion.
For a solo-maintained repo, do not require another person's review unless that is an intentional collaboration choice.
GitHub settings changes are a separate final step after the exact rules and check names are reviewable.

Done when a deliberately failing check blocks a test pull request and the complete check set passes on the release revision.

## 6. Groom the public repository

Files: `CONCERNS.md`, `Future.md`, `SAVE_AS_TASK.md`, `README.md`, new `SECURITY.md`, and optionally `CONTRIBUTING.md`.

- Consolidate the rough future-feature list into one short roadmap with accurate implemented and planned statuses.
- Update the concerns note to match the final approval behavior, then retire duplicate notes after preserving useful information.
- Keep the saved-task proposal clearly labeled as an unimplemented design, preferably under `docs/`.
- Add a security policy with a verified private reporting route and no response-time promise the maintainer cannot support.
- Check whether GitHub private vulnerability reporting is available and enabled before directing people there.
- Add concise contributor instructions for setup, testing, and pull requests if the README is insufficient.
- Describe the project as an early beta and retain its concrete limitations and data-sharing explanation.
- Check relative links and command examples after moving documentation.

Done when documentation agrees with the product and readers can distinguish shipped features, known limitations, and future plans.
Do not manually modify generated files or changelogs.

## Execution and release order

1. Resolve installer failures and repair the bridge smoke test.
2. Add secret protection and implement the approval policy.
3. Run the expanded CI checks and complete the documentation cleanup.
4. Review the final diff, then configure the agreed GitHub protections.
5. Verify the exact release revision and report results and remaining limitations.

Keep these as focused, independently reviewable changes and preserve unrelated work in progress.
Do not add benchmark claims as part of this work; benchmarks are a separate project requiring measured results.

The release gate is passing cross-platform installation, functional and build checks, bridge security checks, approval browser tests, and a redacted secret scan, with accurate public documentation.
Passing these checks improves confidence but does not replace a professional security assessment.
