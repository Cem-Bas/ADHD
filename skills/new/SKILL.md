---
name: new
description: Close the current ADHD task without calling it complete and start a replacement task from the supplied request. The user invokes it as /adhd:new [request].
argument-hint: "[request]"
disable-model-invocation: true
---

# New task

The ADHD hook has already closed the previous task (recorded as replaced, not complete) and, when a request was supplied, started the new task and injected its contract.

Request: $ARGUMENTS

- If a request was supplied: begin with the TASK LOCK block for the new request and start working in this turn. Do not carry deliverables over from the previous task unless the new request names them.
- If no request was supplied: ask the user for the new request in one line and stop. The next ordinary prompt starts the new task.
