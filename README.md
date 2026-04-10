# PromptIQ

Prompt analytics CLI for Claude Code. Silently captures every prompt you send, analyzes them on demand using the Anthropic Claude API, and builds up a time-based Decaying-Resolution Memory (DRM) of your prompting patterns over time.

## Install

\
## Setup

1. Export your Anthropic API key:
   \
2. Add the hook to your Claude Code  ():
   \
3. Start using Claude Code. Prompts are logged silently.

## Commands

| Command | Description |
|---|---|
|  | Analyze today's prompts, update memory, print rich output |
|  | Show today's prompt count and memory summary |
|  | Show patterns from weekly and monthly memory |
|  | Print the last N logged prompts (default: 10) |
|  | Open your rubric in  |

## How It Works

- **Logging**: Every prompt is appended to - **Analysis**: Claude scores each prompt against your rubric, identifies patterns, and suggests improvements
- **Memory**: A Decaying-Resolution Memory (DRM) compresses old data — daily → weekly → monthly — preserving trends without unbounded storage growth

## Rubric

Your rubric lives at . Edit it freely. Changes take effect on the next  run. The default criteria are: Clarity, Context, Output Format, Scope, and Examples.
