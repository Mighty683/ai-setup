---
name: adb-screenshot
description: Capture an Android screenshot with adb for a bug report or UI review.
---

# Adb Screenshot

Check available devices with `adb devices -l` and select the intended target explicitly when more than one is connected. Capture with `adb -s <device> exec-out screencap -p` to a user-requested location or a suitable temporary file. Return the path. Do not overwrite an existing capture; if the intended device is ambiguous, ask before choosing. If adb is unavailable, report the missing Android platform-tools.
