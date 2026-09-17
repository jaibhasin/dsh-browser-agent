# What happens to memory while the agent works?

Someone on Reddit asked how much memory the agent uses when it is working in another tab.
I had been focused on getting tab switching right, and I did not have a measured answer.
That question stayed with me, so I built this small eval to make the answer easy to see on any machine.

You choose the pages and the number of tabs.
The agent works on them in parallel while the script records Chrome and DSH memory about once a second.

## Try it

With this repo installed and DSH running, run this from the repo root on macOS or Linux:

```sh
pnpm benchmark:memory
```

1. A separate Chrome profile opens for the test, leaving your usual browser alone.
   It can remain open alongside your normal Chrome profiles because the bridge identifies and routes each profile separately.
   In `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the `extension/dist` path printed in the terminal.
   If it is already loaded, click **Reload** in this profile and in any other profile using the agent.
2. Open the extension side panel and click **Memory test**.
   Use the Hacker News, Wikipedia, or Python Docs buttons to open the benchmark pages.
   Blank tabs and `chrome://` pages do not count.
3. Choose the task preset that matches the pages you want to measure.
   The Hacker News preset produces a ranked developer-relevant news briefing.
   The Wikipedia preset produces an Apollo 11 mission briefing.
   The Python Docs preset designs a CSV memory-reporting tool from the official tutorial.
4. Select matching tabs, then click **Run**.
   The prompt runs once per selected tab, all in parallel.
   Use the **Select [site] tabs** action to avoid mixing site presets in one run.
5. When the tasks finish, leave the tabs open for the 60-second cooldown.
   The report saves automatically, and task responses appear in Chat history under `Memory test: [page title]`.

There is no required tab count or set of rounds.
For another measurement, start the command again.
Type `status` for a quick check, `extensions` to reopen setup, or `stop` to save early.

## Reading the results

Open `report.html` in the `memory-reports/` folder printed by the terminal.
You'll also find a short Markdown summary, JSON, and the raw CSV samples.

- **Baseline:** memory recorded before you start the tasks.
- **Peak increase:** the highest total during work, minus the baseline median.
- **Retained:** the cooldown median minus the baseline median, available after the full cooldown.

Retained just means memory still in use while those tabs stay open.
It doesn't, by itself, mean there's a leak.
These numbers include the test Chrome profile's processes and DSH, so the websites themselves contribute too.
The measurement is RSS, an approximate measure of process memory that can count shared memory more than once.

If you share a result, include your machine, tab count, pages, and prompt.
That context helps me understand what you ran and try it myself.
