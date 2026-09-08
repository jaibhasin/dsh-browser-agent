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

Ship the current public beta first.
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

## First version scope

- Save a reusable task from an existing conversation after the user reviews the generated draft.
- Store a name, instructions, starting URL, editable inputs, expected result, tool restrictions, and approval setting locally.
- List, edit, delete, and manually run saved tasks.
- Start each run as a separate chat so users can inspect its progress and result in existing chat history.
- Keep the saved task available when a run fails, and show the failure in that run's conversation.

Scheduling, sharing, workflow editors, recorded click replay, and automatic background triggers are future possibilities outside the first version.

## Behavior and implementation notes

The existing chat history in `extension/sidepanel/src/chat-history.ts` stores conversations and website links.
Introduce a separate, versioned saved-task record so editing a task does not rewrite earlier conversations.
Each run should capture the task definition and input values used for that run.

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
