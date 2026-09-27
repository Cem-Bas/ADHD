---
name: cancel
description: Cancel the active ADHD task immediately, with no cleanup or follow-on changes. The user invokes it as /adhd:cancel.
disable-model-invocation: true
---

# Cancel

The ADHD hook has already marked the active task CANCELLED (or reported that none was active). Reply with one short line acknowledging the cancellation. Perform no cleanup, deletion, extra revision, or follow-on action, and do not summarize unfinished work unless the user asks. Cancellation does not delete stored data; `/adhd:data` does.
