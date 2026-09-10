1. Allow the browser agent to run sub-agents controlling and running multiple tabs.
(done)
2. Store past sessions with website links so that we can reopened later, or switched while doing other tasks (allowing paralle work, but not on the same tab)(done)
3. The tool calls should be displayed as a nice thread. (imrpove the ui ) (done)
4. Suggest actions in chat.
5. Disable some actions in chat (done)
6. Mutli-tab mode toggle (some people may want it simple)
7. Voice mode
8. Render REACT components in chat to nicely show information
9. Add image handling capabilites(png , jpeg etc.), pdfs, md , csv, word files etc.
10. create tool which allows agent to ask question from user. (done)
11. compare with dsh-browser benchmark
12. Measure memory usage while the agent runs in a background tab and the user switches to other tabs.
    Compare idle, active, and long-running tasks, and check whether memory is released after tasks finish or sessions close.
    Memory usage has not been benchmarked yet.
13. Add a sound notification when a session running in the background pauses and requires user input.
    Make the sound optional and show which session needs attention.
14. Recheck the current page and action details before acting, especially before submitting a form or performing an irreversible action.
    If changes invalidate the user's earlier approval, pause and request confirmation again.
15. Enforce retry limits in code so the agent cannot repeatedly click, reload, or submit when an action fails.
    Pause and explain the failure when the retry limit is reached.
    Verify whether a submission succeeded before retrying to avoid duplicate actions.
