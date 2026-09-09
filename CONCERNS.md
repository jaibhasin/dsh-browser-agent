# Current concerns

- Browser approval prompts now cover clicks, typing, and navigation by default.
  Keep testing this behavior on pages that autosave or submit data as fields change.
- The installer lifecycle has failed on macOS and Windows in CI before completing.
  Reproduce the failure on the affected runners before calling the installer stable.
- `main` still needs a GitHub ruleset with the quality and installer checks required before merging.
