# Working with Claude Code on Voyagr

How this repository is set up for Claude Code, and how to get useful work out of it.

---

## What is configured

| File                    | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `CLAUDE.md`             | Project instructions, loaded automatically every session |
| `.claude/settings.json` | Shared permissions — allowed commands, denied paths      |
| `.claude/agents/*.md`   | Eleven specialised subagents                             |
| `.mcp.json`             | Playwright MCP server for browser interaction            |

`.claude/settings.local.json` is gitignored for personal overrides.

---

## The instruction that matters most

`CLAUDE.md` states it, and it is worth repeating because it is the rule most easily eroded one
convenient exception at a time:

> **Deterministic software owns every number. The model owns language.**

If an agent is about to let a model produce, adjust or "sanity check" a figure a user will see, the
work belongs in `src/core/` instead. See `architecture.md` section 1.

---

## The agents

Invoke with `@agent-name` or by describing the task; Claude selects based on the descriptions.

| Agent               | Use it for                                                                 |
| ------------------- | -------------------------------------------------------------------------- |
| `architect`         | Multi-subsystem changes, new providers, anything touching the AI boundary  |
| `implementer`       | Building a feature or fixing a defect once the approach is clear           |
| `ui-designer`       | Screens and components, within the Radix + Tailwind system                 |
| `test-engineer`     | Unit and component coverage, especially the deterministic core             |
| `e2e-tester`        | Playwright specs and debugging browser-level failures                      |
| `security-engineer` | Credentials, auth, user data, headers, security review                     |
| `security-redteam`  | Adversarial probing of this codebase — injection, exfiltration, cost abuse |
| `code-reviewer`     | Reviewing a diff before it lands                                           |
| `debugger`          | A failure whose cause is not obvious                                       |
| `qa-lead`           | Deciding whether something is genuinely ready                              |
| `devops`            | CI, build config, environment plumbing, bringing up Postgres or Redis      |

Each agent carries this project's specific rules, not generic advice — the debugger knows where
bugs live in this codebase, the reviewer knows that a float touching a price is a defect.

### Choosing one

- Changing more than one subsystem, or unsure of the shape → `architect` first.
- Clear task, known shape → `implementer`.
- Something is broken and you do not know why → `debugger`, not `implementer`.
- Before merging → `code-reviewer`, then `qa-lead` for a ship/no-ship call.

You do not need an agent for small, local changes. A single-file fix is usually faster handled
directly.

---

## Playwright MCP

`.mcp.json` registers `@playwright/mcp`, which lets Claude drive a real browser — navigate, click,
fill forms, read the accessibility tree, capture screenshots, read console output.

Approve the server when prompted; project MCP servers are not enabled automatically.

**MCP is for exploration; the test suite is for verification.** Use MCP to see what a page actually
does, then encode the finding as a Playwright spec in `tests/e2e/`. A bug confirmed through MCP and
not written down is a bug that returns.

The MCP browser and the test runner are independent. MCP needs its own Chromium via
`npx playwright install chromium`.

---

## Permissions

`.claude/settings.json` pre-approves the routine loop — build, lint, typecheck, test, format, and
read-only git — so ordinary work does not stop for prompts.

Denied outright:

- Reading `.env`, `.env.*`, `*.pem`, `*.key`. Claude never needs a real credential, and this
  removes the possibility of one reaching a transcript.
- `git push`, `git reset --hard`, `git clean`, `npm publish`. Destructive or outward-facing actions
  stay a human decision.

---

## Getting good results

**Point at the source of truth.** "Per specification section 31.4, add X" beats "add usable time
tracking". `docs/PRODUCT-SPECIFICATION.md` is the product's authority; `docs/architecture.md` is the
engineering one.

**Ask for the verification, not just the change.** "Implement X and run `npm run verify`" produces
work that is actually finished.

**Let failing tests stand.** If a test fails, the test is usually right. An agent that proposes
loosening an assertion to get green is doing the wrong thing — say so.

**Watch for the boundary eroding.** The most likely long-term failure is a model gradually acquiring
authority over numbers, one reasonable-looking exception at a time. When a change routes a figure
through `src/ai/`, ask why.

---

## Conventions Claude is expected to follow

From `CLAUDE.md`:

- `@/*` imports, not deep relative paths.
- `getEnv()`, never `process.env` outside `src/lib/env.ts`.
- `getLogger()`, never `console.log`.
- `AppError` with a code; client output through `toProblemDetails()`.
- Adapters return `Result`; they do not throw.
- Parameterised SQL, always.
- Deterministic mocks — no `Math.random()`, no `new Date()`.

---

## Useful commands

```bash
npm run verify          # format, lint, typecheck, test, build — run before calling work done
npm test                # unit and component tests
npm run test:e2e        # Playwright against a production build
npm run dev             # development server

PLAYWRIGHT_CHANNEL=chrome npm run test:e2e   # use local Chrome if the browser download is blocked
```
