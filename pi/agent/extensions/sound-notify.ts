/**
 * Pi Sound Notify Extension
 *
 * Plays a local attention sound after the parent Pi session has fully settled
 * and is waiting for the next user prompt. The `agent_settled` event is
 * deliberately used instead of `agent_end`, which may be followed by retries,
 * compaction, or queued work. Subagent sessions never notify: their completion
 * is delivered back to the parent, which is the session that can need the user.
 *
 * Set PI_SOUND_DISABLED=1 to disable sounds.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WINDOWS_BEEP = "[console]::beep(880, 160)";
const IS_WSL = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
const IS_SUBAGENT_CHILD = process.env.PI_SUBAGENT_CHILD === "1";

function ringTerminalBell(): void {
  process.stdout.write("\x07");
}

function startSound(
  command: string,
  args: string[],
  fallback: () => void,
): void {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", fallback);
    child.unref();
  } catch {
    fallback();
  }
}

function playSound(): void {
  if (process.env.PI_SOUND_DISABLED === "1") return;

  if (process.platform === "darwin") {
    startSound(
      "afplay",
      ["/System/Library/Sounds/Glass.aiff"],
      ringTerminalBell,
    );
    return;
  }

  // WSL processes are reported as Linux, but can invoke the Windows host's
  // PowerShell to play the sound through the host audio device.
  if (process.platform === "win32" || IS_WSL) {
    startSound(
      "powershell.exe",
      ["-NoProfile", "-Command", WINDOWS_BEEP],
      ringTerminalBell,
    );
    return;
  }

  // canberra-gtk-play resolves the system sound theme, avoiding a hard-coded
  // audio-file path on Linux distributions.
  startSound("canberra-gtk-play", ["--id=complete"], ringTerminalBell);
}

export default function (pi: ExtensionAPI) {
  if (IS_SUBAGENT_CHILD) return;

  pi.on("agent_settled", () => {
    playSound();
  });
}
