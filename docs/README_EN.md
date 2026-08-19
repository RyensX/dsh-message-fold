# dsh-message-fold

[中文](../README.md) | **English**

Codex-style conversation message folding for DeepSeek Harness.

> This plugin only changes presentation and does not modify any data.

## Display Rules

- Two or more consecutive tool calls are combined into a single expandable summary; a single tool call continues to use DSH's original renderer.
- Once a turn has a reliable final answer, intermediate assistant messages, context, commands, compactions, retries, tools, and workflows are collapsed under "Worked for {duration}" by default.
- The final answer, errors, turn-closing nodes, failed workflows, and any content after the final answer always remain visible.
- Failed tool calls before the final answer are still considered intermediate activity. After expanding the turn, you can view the failure count and details in the tool-group summary.
- A running tool or workflow keeps the turn expanded by default, though users can still collapse it manually.
- Unknown nodes, missing history, or structures that cannot be verified all fail open and are passed directly to DSH's original renderer.
- Non-empty reasoning in the final answer is hidden in the collapsed state only, using a temporary shallow copy. Empty reasoning is always filtered out of the presentation projection; the original node references and values remain unchanged.

Turn folding and tool-group folding are independent. Expanding hidden content remounts the original renderer, so the renderer's own transient UI state is recreated, but the conversation data remains unaffected.

## Installation

After building, add the current directory to the Web profile:

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
```

To uninstall:

```sh
dsh plugin --profile web remove dsh-message-fold
```

## Compatibility Boundaries

The current version is pinned to DSH `0.1.0-rc.7`, Cordis `4.0.1`, and React 18. DSH does not yet provide an official renderer decorator API, so the only temporary compatibility layer is isolated in `src/client/adapter/dsh-slot-renderer-decorator.ts`. Business components depend only on `RendererDecoratorPort`, allowing the adapter to be replaced directly in the future.

The adapter uses a revocable lease and fails open as a whole when incompatible. If an external decorator is later wrapped around this plugin, uninstalling the plugin will not overwrite it; the internal wrapper immediately degrades into a transparent pass-through to the original renderer.

Fold selections are stored only in the plugin's in-page memory and are not written to `localStorage`. Deleting a conversation or uninstalling the plugin clears the corresponding state.

## Development Verification

```sh
pnpm verify
npm pack --dry-run
```

`verify` runs type checking, unit and React tests, Node and Web entry builds, and the lazy-CJS handoff check in sequence.
