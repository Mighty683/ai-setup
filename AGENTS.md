# Shared AI Harness Configuration

This repository contains shared, reusable harness configuration for OpenCode and Codex. Keep root-level configuration portable and aligned across those harnesses where their capabilities permit.

## Pi Isolation

`pi/` has independent configuration and workflow infrastructure. Do not update, migrate, or derive `pi/` configuration from root-level OpenCode or Codex changes. Modify `pi/` only when a task explicitly scopes work there.
