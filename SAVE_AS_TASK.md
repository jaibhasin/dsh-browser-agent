# Save as a task

## Idea

Let users turn a successful browser conversation into a reusable task they can run again with one click and a few updated inputs.
The task remembers what to accomplish, where to start, and what a successful result should contain.
Each run reads the current website and works in a fresh conversation.

## Why it matters

Saved conversations help users revisit past work, but recurring work still requires users to explain the same instructions again.
Reusable tasks give users a personal collection of browser jobs, such as summarizing support tickets, checking order statuses, or preparing a weekly report.
The hypothesis is that reducing repeated setup will make users return more often.
This should be validated with actual usage rather than treated as a guaranteed improvement.

## Release timing

Observe which tasks early users repeat, then build this feature around those workflows.
Prioritize installation and task reliability if those prevent users from getting useful results.

## User flow

1. The user completes a useful task in chat and selects **Save as a task**.
2. The agent drafts a task name, reusable instructions, starting website, inputs, and expected result from the conversation.
3. The user reviews and edits the draft before saving it.
4. The task appears in a **Saved tasks** list in the side panel.
5. The user selects **Run again**, updates any inputs, and confirms the run.
6. The extension starts a fresh conversation using the existing tab ownership rules and the task's saved tool and approval settings.
7. The user watches progress, answers questions when needed, and receives the result in chat.

## Example: weekly support review

### First conversation

The user opens their signed-in support dashboard and asks:

> Find unresolved tickets created this week, group them by issue, and summarize which ones need attention first.
> Include a link to each ticket and explain its priority using the information shown on the page.
> Do not change ticket statuses or send replies.

After checking the result, the user selects **Save as a task** and reviews this draft:

| Field | Saved value |
| --- | --- |
| Name | Weekly support review |
| Starting website | The support dashboard URL |
| Input | Date range, defaulting to “This week” |
| Instructions | Find unresolved tickets created within the selected date range, group them by issue, and prioritize them using visible evidence. |
| Expected result | A summary grouped by issue, with ticket links, priority reasons, and a note about anything that could not be checked. |
| Constraints | Do not change statuses or send replies. |
| Tool permissions | Copy the chat's enabled and disabled tools for review. |
| Approval setting | Copy the chat's approval setting for review. |

### Running it next week

The user opens **Saved tasks**, selects **Weekly support review**, leaves the date range as **This week**, and clicks **Run**.
Relative dates are resolved when the task runs, using the user's current local date and timezone.
The agent opens a fresh conversation, reads the current dashboard, and produces a new report.
If the user needs to sign in or choose a workspace, the agent asks for help.

An illustrative result might look like this:

> Found 12 unresolved tickets created this week.
>
> - Payment failures: 4 tickets, including 2 reporting blocked renewals.
> - Login problems: 3 tickets, including 1 reporting a team-wide lockout.
> - General questions: 5 tickets.
>
> Review the blocked renewals and team-wide lockout first.
> Each ticket is linked below with the evidence supporting its priority.

These counts are examples, not real dashboard data.

## Example: check and merge the current pull request

### First conversation

The user opens a pull request in any repository and asks:

> Check the pull request currently open in this tab.
> Verify that it targets `main`, all required checks and tests have passed, required approvals are present, and there are no merge conflicts.
> If every condition is satisfied, merge it into `main` and verify that the pull request is merged.
> If anything is pending, failed, missing, or unclear, do not merge it and explain the blocker.

When the user selects **Save as a task**, the guided draft identifies the pull request as page-derived input.
The repository, pull request number, current commit, check results, approvals, and conflict state are read again from the live page for every run.
The target branch `main` and the requirement to avoid merging when evidence is incomplete are fixed instructions unless the user changes them before saving.

The saved draft might contain:

| Field | Saved value |
| --- | --- |
| Name | Check and merge current PR |
| Starting website | Current page |
| Page-derived input | The pull request open in the current tab |
| Instructions | Verify the target branch, checks, approvals, and conflicts, then merge only when all conditions are satisfied |
| Expected result | The PR link, merge result, or the precise blocker with supporting evidence |
| Constraints | Never merge a pending, failed, conflicting, already changed, or unverifiable PR |

### Running it on another repository

The user opens a different pull request in a different repository, opens **Saved tasks**, and selects **Check and merge current PR**.
The task uses the current page and starts a fresh conversation.
It must inspect the current pull request instead of reusing the repository or PR number from the first conversation.

If the user is on a repository page rather than a pull request page, the agent asks which pull request to check.
It must not select an arbitrary pull request.

Before merging, the agent checks the current pull request revision again.
Pending or failed checks, missing required approvals, a non-`main` target branch, merge conflicts, and unavailable evidence all block the merge.
After a merge, the result should identify the repository, pull request, target branch, and verified merged state.

## Other reusable task examples

The same task base supports different page types and input patterns:

| Task | Values that change between runs | Result |
| --- | --- | --- |
| Review a pull request | The current pull request | Findings with evidence, without posting comments |
| Summarize a discussion | The current issue or discussion page | Decisions, unresolved questions, and next steps |
| Weekly support review | Date range and support workspace | Prioritized unresolved tickets with links |
| Compare a product | Current product and budget | Comparison against the user's saved criteria |
| Check order status | Order number or current account page | Current status and delivery information |
| Prepare a project update | Project page and date range | A concise update covering progress and blockers |

During task setup, each detail is classified as fixed, supplied at run time, or read from the current page.
The user reviews those classifications before saving so an example value such as a repository name, PR number, date, or order number does not become stale task logic.

## First version scope

- Save a reusable task from an existing conversation after the user reviews the generated draft.
- Store a name, instructions, starting URL, editable inputs, expected result, tool restrictions, and approval setting locally.
- List, edit, delete, and manually run saved tasks.
- Start each run as a separate chat so users can inspect its progress and result in existing chat history.
- Keep the saved task available when a run fails, and show the failure in that run's conversation.

The first implementation stores versioned task definitions separately from chat history.
It provides a guided review form, current-page or saved-URL context, run-time inputs, and a fresh chat for every run.

Scheduling, sharing, workflow editors, recorded click replay, and automatic background triggers are future possibilities outside the first version.

## Behavior and implementation notes

The existing chat history in `extension/sidepanel/src/chat-history.ts` stores conversations and website links.
Introduce a separate, versioned saved-task record so editing a task does not rewrite earlier conversations.
Each run should capture the task definition and input values used for that run.
Task setup uses a separate typed bridge request with browser tools disabled.
The setup agent may return clarification questions before it returns a ready draft.
Unfinished setup drafts and answers are persisted locally so the user can close and reopen the side panel.
Saved task edits create a new revision, while each run stores an immutable snapshot of the revision it used.
Clarification follow-ups include the edited draft and the questions paired with their answers.
Input editors support fixed values, defaults, required fields, numbers, dates, choices, and booleans.
Runs validate inputs and explicitly describe values that must be read from the live page.
Task writes use a shared browser lock and check the revision the editor originally opened.
Automated checks cover stale edits across panel instances, parameter prompt construction, and invalid inputs and URLs.
Live Chrome testing, visual QA, and the cross-repository PR scenarios remain required before release.

Save intent and constraints rather than replaying old element reference numbers.
Browser references come from snapshots and must be obtained again from the current page.
Validate the starting URL as HTTP or HTTPS and apply the existing tab ownership and busy-tab choices when starting a run.

Do not copy credentials, page contents, or the full conversation into the reusable definition by default.
If a task needs a document attachment, ask the user to attach it for the new run rather than assuming an old attachment remains available.

Carry forward both tool restrictions and the approval setting explicitly.
The current approval mode covers clicks and navigation; saved instructions such as “do not send replies” are agent guidance, not an additional enforced permission boundary.
Creating a task must not imply permission to execute it automatically.

## Acceptance criteria

- A user can save the support-review example, close the side panel, reopen it, and find the task.
- A user can change the date range and start a fresh run without rewriting the instructions.
- The run uses current page data and fresh browser references.
- The saved tool restrictions and approval setting apply to the new run.
- Editing or deleting a saved task preserves earlier run conversations.
- A failed run leaves the reusable task intact and explains what prevented completion.

## How to validate the idea

Observe whether early users run the same saved task on another day and whether the repeated run produces a useful result with less input.
Track time to a useful result, user corrections, and run failures alongside repeat usage.
Use those observations to decide whether scheduling or more advanced workflow features deserve investment.
