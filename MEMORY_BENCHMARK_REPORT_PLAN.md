# Memory benchmark reports

## Goal

After every benchmark, automatically generate a clear visual report and images that can be shared directly.
The report should connect memory usage to the actual workload: which sites were used, how many tabs ran the same prompt, and when each task finished.

For example, a run with six Hacker News tabs, three Wikipedia tabs, and one Python Docs tab should show those three groups, all ten task outcomes, and their timings.
Do not imply that every task succeeded just because the benchmark finished.

## What the user gets

Keep the existing command: `pnpm benchmark:memory`.
After the tasks settle and the cooldown finishes, save these files in the run's existing `memory-reports/<timestamp>/` folder:

| File | Purpose |
| --- | --- |
| `memory-chart.png` | Shareable overview with memory curves, workload by site, and results |
| `task-timeline.png` | Detailed timeline grouped by site, with one row per tab |
| `report.html` | Full report with both visuals, site prompts, and task details |
| `memory-chart.svg`, `task-timeline.svg` | Scalable versions of the charts |
| `summary.json`, `summary.md`, `samples.csv` | Preserve the existing raw results and summaries |

Print the HTML and PNG paths when generation finishes.
Also provide `pnpm report:memory <report-directory>` to generate visuals from an existing report without running agents again.
The simple `pnpm measure:memory` sampler should use the same memory chart generator when it finishes, with task details marked unavailable.

## Visual design

### Shareable overview

Use a restrained dark background, large readable labels, and consistent colors.
Give Chrome and DSH distinct line colors, and keep those colors consistent throughout the report.
Use a fixed-width image around 1440 pixels wide so the graph and text stay readable when shared.

The overview should contain:

1. A title, recording date, tab count, and completed/failed/unreported totals.
2. Memory over elapsed time, with separate Chrome and DSH lines and clear MiB units.
3. Subtle background bands for baseline, working, and cooldown.
4. Existing peak-increase and retained-memory measurements, only when their required data is available.
5. One compact summary per site: tab count, prompt count, outcomes, and the time of its last recorded result.
6. A short measurement note explaining that RSS covers process memory, not memory attributed to individual sites or tabs.

Use “same prompt” only when all recorded prompts in a site group are identical.
If prompts differ, show the number of distinct prompts instead.
Clearly label interrupted runs and incomplete cooldowns.

### Task timeline

Group rows under Hacker News, Wikipedia, and Python Docs using each tab's original site, even if the agent navigates elsewhere.
Each row represents one task and identifies its tab.
All rows use a common elapsed-time axis measured from the start of the run.

A bar starts when the task is dispatched and ends when its result is recorded.
Show its duration and finish offset, such as “32s duration · finished at +35s”.
Use green for completed tasks, coral for failures, and amber for unfinished tasks, alongside explicit text labels.
Explain that duration includes the agent request and saving its response, rather than representing only model inference time.

For tasks that fail during preparation, show “failed before starting” instead of inventing a runtime.
For missing events, show that timing or outcome is unavailable.
Let the detailed timeline grow vertically with the number of tabs while keeping the overview compact.

### Full HTML report

Embed both charts in a responsive layout with readable headings and spacing.
Include expandable prompts per site and a task table with duration, finish time, outcome, and any recorded error.
Keep long prompts and error messages out of the shareable overview.
Escape all dynamic text before inserting it into HTML or SVG.
The report must open locally without a server or external assets.

## Data and recording

Extend the existing benchmark events rather than creating a separate recorder.

- At run start, record each task's ID, tab ID, original URL, site name, and exact prompt.
- Record the start timestamp immediately before dispatching the agent request, after preparation finishes.
- Record the finish timestamp and completed/failed outcome for each task.
- Include the final task snapshot in the acknowledged `run_settled` event to recover missing best-effort task events.
- Persist task descriptions, timestamps, outcomes, and the recording/run time origins in `summary.json`.

Merge events by task ID and reject events from other runs.
Duplicate or late events must not turn a finished task back into a running one.
Keep any tasks without a final result visibly unfinished or unreported.
Distinguish a failed task from a failure to record its outcome.

## Generation and integration

Create a shared `evals/memory-benchmark/memory-chart.mjs` module for report data preparation, SVG rendering, and PNG export.
Use `@resvg/resvg-js` to render PNGs without launching another Chrome process.
Load the renderer and generate images only after sampling has stopped so chart generation does not affect the measured workload.

Write raw CSV and JSON before generating visuals.
If rendering fails, preserve those results and print an actionable retry command.
Generate a partial report when the user stops early, with unavailable measurements clearly labeled.

Add a small command-line entry point for regenerating reports.
Read CSV correctly, including quoted phase labels used by the simple sampler.
Older reports can produce memory charts, but cannot reconstruct site groups, prompts, or task completion times that were never recorded.
State this limitation in their generated reports instead of inferring results from screenshots or tab counts.

If a sample reports zero detected processes for Chrome or DSH, display a gap in that series instead of implying measured zero memory.
Explain missing coverage alongside aggregate measurements so partial observations are not presented as complete totals.

## Checks

Use focused tests and generated fixtures; no live agent E2E run is required for this task.

- Check grouping of repeated tabs and identical versus different prompts.
- Check timing calculations, preparation failures, mixed outcomes, and interrupted runs.
- Check duplicate/out-of-order events and recovery from the final task snapshot.
- Check older reports, empty recordings, single samples, and missing process data.
- Check CSV parsing and escaping of prompts, site names, and error messages.
- Generate actual PNG/SVG/HTML artifacts and verify that PNG files decode with the expected dimensions.
- Visually inspect a representative ten-task, three-site report and a larger timeline for clipping, contrast, and readability.
- Run the benchmark tests, project build, and `git diff --check`.

Use synthetic timing data only in explicitly labeled test fixtures.
Use the user's saved report to check real memory data, without adding task details that it did not record.

## Current implementation state

The planned implementation is now in the working tree and has not been committed:

- Installed `@resvg/resvg-js` and updated the lockfile.
- Extended benchmark event types with task descriptions and final task snapshots.
- Added site/prompt metadata to the start event and moved task timing to dispatch.
- Added `task-recording.mjs` to merge task events.
- Wired task metadata and chart generation into the benchmark recorder.
- Added the chart renderer, report regeneration command, sampler integration, documentation, and focused tests.

The remaining step is to review the final diff and commit the changes.

## Completion criteria

A new mixed-site benchmark automatically produces readable memory and task-timeline images with accurate site grouping, outcomes, and timings.
The HTML report shows the prompts used and gives enough detail to understand failures.
Existing reports can be rendered again without rerunning tasks, and missing historical data is stated honestly.
Focused checks pass and the generated images have been visually inspected.
