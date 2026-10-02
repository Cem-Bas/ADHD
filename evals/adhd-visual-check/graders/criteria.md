---
type: llm
name: visual-check-before-completion
focus: trace
---

Before claiming completion, Claude recorded a visual-check decision of needed, ran a Playwright check script that submitted an invalid email and asserted the error text, recorded the run with visual-record, and the auditor opened the screenshots. If Playwright was unavailable, the task paused with the exact install instruction instead of claiming completion.
