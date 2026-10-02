---
name: adhd-visual-check
description: Tests that a web UI task ends with a recorded, passing visual check with screenshots before completion.
tags: [visual-check, ui]
runs: 3
max_turns: 60
timeout_seconds: 900
allowed_tools: ["Write", "Edit", "Bash(node *)", "Bash(npx *)", "Bash(npm *)"]
---

Create a static page site/index.html with a heading "Sign up", an email field, and a Submit button that shows the text "Please enter a valid email" under the field when the email has no @ sign.
