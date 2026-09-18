# What happens to memory while the agent works?

Someone on Reddit asked how much memory the agent uses when it is working in another tab.
I had been focused on getting tab switching right, and I did not have a measured answer.
That question stayed with me, so I built this small eval to make the answer easy to see on any machine.

You choose the pages and the number of tabs.
The agent works on them in parallel while the script records Chrome and DSH memory about once a second.

## Try it

Start with the [development setup](../../README.md#development), and keep DSH running with a model configured.
Then run this from the repo root on macOS or Linux:

```sh
pnpm benchmark:memory
```

The command builds the extension before opening Chrome.
Keep the terminal open while you run the test.
On Linux, you'll also need `lsof` so the script can find DSH.

1. A separate Chrome profile opens for the test, leaving your usual browser alone.
   You can keep your normal Chrome profiles open too, but let their agent tasks finish first so they don't add to DSH's memory use during the measurement.
   In `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/dist` path printed in the terminal.
   If it is already loaded, click **Reload** in this profile and in any other profile using the agent.
2. Open the extension side panel and click **Memory test**.
   Blank tabs and `chrome://` pages do not count.
3. Choose or edit the task prompt for each site you want to measure.
   The Hacker News preset produces a ranked developer-relevant news briefing.
   The Wikipedia preset produces an Apollo 11 mission briefing.
   The Python Docs preset designs a CSV memory-reporting tool from the official tutorial.
4. Enter a tab count beside any site and click its **Create tabs** button.
   You can create different quantities for each site, and repeat this for multiple sites.
5. Select the supported tabs you want to include, then click **Run all agents in parallel**.
   Each selected tab receives the prompt for its matching site, so Hacker News, Wikipedia, and Python Docs tabs can run together.
   Benchmark tasks can run for up to five minutes each because multi-step browser work may take longer than a normal chat.
6. When the tasks finish, leave the tabs open for the 60-second cooldown.
   The report saves automatically, and task responses appear in Chat history under `Memory test: [page title]`.

There is no required tab count or set of rounds.
For another measurement, start the command again.
Type `status` for a quick check, `extensions` to reopen setup, or `stop` to save early.

If **Memory test** is missing, check that the command is still running, then reopen the side panel.
The button only appears while the benchmark recorder is available.
The test profile is reused between runs, so you won't need to load the extension from scratch each time.

## Reading the results

Open `report.html` in the `memory-reports/` folder printed by the terminal.
The same folder also contains `memory-chart.png` and `task-timeline.png`, which are useful for sharing a run.
You'll also find a short Markdown summary, JSON, and the raw CSV samples.

The overview chart shows Chrome and DSH memory over time, the baseline/working/cooldown phases, and a card for each site.
The task timeline groups every tab under its original site and shows when it started, finished, or failed.
Open `report.html` when you want to inspect the exact prompts and task errors.
For an older report, regenerate these files with `pnpm report:memory memory-reports/<timestamp>`.

- **Baseline:** memory recorded before you start the tasks.
- **Peak increase:** the highest total during work, minus the baseline median.
- **Retained:** the cooldown median minus the baseline median, available after the full cooldown.

Retained just means memory still in use while those tabs stay open.
It doesn't, by itself, mean there's a leak.
These numbers include the test Chrome profile's processes and DSH, so the websites themselves contribute too.
They don't tell you how much memory a single tab or the extension alone uses.
The measurement is RSS, an approximate measure of process memory that can count shared memory more than once.

If you share a result, include your machine, tab count, pages, and prompt.
That context helps me understand what you ran and try it myself.
