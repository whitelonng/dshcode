# `@deepseek-ai/dsh-file-reference-local`

English | [中文](README.zh.md)

Local-filesystem implementation of `ctx.fileReferences`. It maintains one bounded `WorkspaceFileSearch` per agent, rooted at that session's `cwd` and falling back to the host process cwd. The index ranks direct directory listings for queries containing `/`, otherwise fuzzy-ranks a bounded recursive index; it never follows directory symlinks.

Tool-result events invalidate the addressed agent's reusable index so later completion observes likely workspace mutations. Agent disposal releases that index and its scoped prompt contribution; plugin disposal awaits every prompt fiber and releases all cached searches.

## Configuration

| Key | Default | Contract |
|---|---:|---|
| `maxResults` | `20` | Maximum ranked candidates returned for one query. |
| `maxEntries` | `10000` | Maximum files and directories indexed per agent workspace. |
| `excludedDirectories` | `[".git", "node_modules"]` | Directory basenames omitted from traversal and candidates. |

Every numeric value must be a positive safe integer. Excluded names must be non-empty basenames without `/` or `\`.

## Model Experience

### File-reference guidance when `read` is available

#### What the model sees

When the addressed agent has an effective `read` tool, the provider contributes this stable system-prompt section:

##### File-reference instruction

```markdown
Paths prefixed with @ are files explicitly referenced by the user. Use the read tool when their contents are needed; do not claim to have inspected a file before reading it.
```

#### Token effect

Conditional and fixed: the one sentence is present while `read` is visible to the addressed agent; candidate lookup itself adds no tokens, and a selected path contributes only its ordinary user-message characters.

#### KV Cache effect

The stable sentence joins the system-prompt prefix. Mounting or removing this provider, or changing whether `read` is visible, changes that prefix; queries, candidates, and index invalidations do not.

## Known Limitations and Deferred Work

- **Host-local namespace** — the provider scans the Harness host filesystem, so remote or virtual `read` implementations require a provider whose namespace matches the tool.
- **Bounded advisory index** — very large workspaces may omit paths after `maxEntries`, and excluded or unreadable directories do not appear.
- **No ignore-file semantics** — `.gitignore` and other project ignore files do not influence discovery; only configured directory basenames are excluded.
