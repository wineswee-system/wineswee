# SME Ops System — Claude Code Agents Guide

> This document describes how Claude Code agents and subagents are used in this project.

## Overview

This project uses [Claude Code](https://claude.com/claude-code) as the primary AI development tool. Claude Code supports specialized agents (subagents) that can be launched to handle specific tasks autonomously.

---

## Available Agent Types

### Explore Agent
**Purpose**: Codebase exploration and research  
**When to use**: Finding files, searching for patterns, understanding architecture  
```
subagent_type: Explore
```

### Plan Agent
**Purpose**: Designing implementation strategies  
**When to use**: Planning complex features, identifying critical files, evaluating trade-offs  
```
subagent_type: Plan
```

### General-Purpose Agent
**Purpose**: Multi-step tasks, complex searches, code execution  
**When to use**: Tasks that require multiple tool calls, file modifications, or shell commands  
```
subagent_type: general-purpose
```

---

## Custom Agents

Custom agents can be created in `.claude/agents/` as markdown files with frontmatter. To add a project-specific agent:

### Creating a Custom Agent

Create a file at `.claude/agents/<agent-name>.md`:

```markdown
---
name: agent-name
description: Short description of what this agent does
tools:
  - Read
  - Grep
  - Glob
  - Bash
---

## Instructions

Describe the agent's purpose and behavior here.
```

### Recommended Agents for This Project

Below are agents that would be useful for this project. Create them as needed:

#### 1. `test-runner` — Run and validate tests
```markdown
---
name: test-runner
description: Run unit and e2e tests, report failures with context
tools:
  - Bash
  - Read
  - Grep
  - Glob
---

Run tests for the SME-OPS project and report results.

- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- Coverage: `npm run test:coverage`

When tests fail, read the failing test file and the source file to understand the failure.
Report: total tests, passed, failed, and failure details with file paths.
```

#### 2. `db-schema` — Database schema assistant
```markdown
---
name: db-schema
description: Analyze and modify the Supabase database schema
tools:
  - Read
  - Grep
  - Glob
  - Edit
---

You are a database schema assistant for SME-OPS.

The schema is defined in `supabase-schema.sql`. Migrations are in `supabase/migrations/`.
The database is Supabase (PostgreSQL). The app uses `@supabase/supabase-js` client.

Key files:
- `supabase-schema.sql` — Full schema definition
- `src/lib/db.js` — Database operations layer
- `src/lib/supabase.js` — Supabase client initialization

When modifying schema, always check for:
- Foreign key references
- RLS (Row Level Security) policies
- Existing migration files
- Code in `src/lib/` that queries the affected tables
```

#### 3. `module-builder` — Scaffold new module pages
```markdown
---
name: module-builder
description: Scaffold new pages following project conventions
tools:
  - Read
  - Write
  - Glob
  - Grep
---

You scaffold new pages and components for SME-OPS modules.

Conventions:
- Pages go in `src/pages/<module>/`
- Module route bundles go in `src/modules/<Module>Module.jsx`
- Use Tailwind CSS 4 for styling
- Use lucide-react for icons
- Use Supabase via `src/lib/db.js` for data operations
- UI text should be in Traditional Chinese (zh-TW)
- Components use JSX (not TypeScript)

Reference existing pages for patterns:
- Simple CRUD: `src/pages/crm/Customers.jsx`
- Complex form: `src/pages/hr/Salary.jsx`
- Dashboard: `src/pages/Dashboard.jsx`
```

#### 4. `gap-analyzer` — Audit features against ERP standards
```markdown
---
name: gap-analyzer
description: Compare implementation against ERP standards and gap analysis docs
tools:
  - Read
  - Grep
  - Glob
---

You audit SME-OPS features against industry-standard ERP systems.

Reference documents:
- `ERP_GAP_ANALYSIS.md` — Detailed gap analysis vs SAP/NetSuite/Odoo
- `gap_v1.md` — Gap analysis vs 鼎新/文中/Odoo
- `PLAN.md` — Project roadmap and priorities

For each feature area, check:
1. What the code actually implements (read the source)
2. What the gap analysis says is missing
3. Whether any gaps have been closed since the analysis was written
```

---

## Usage Patterns

### Parallel Research
Launch multiple Explore agents to research different modules simultaneously:
```
Agent 1: "Explore the HR module structure and list all pages"
Agent 2: "Explore the Finance module and identify all Supabase queries"
```

### Plan Then Execute
Use a Plan agent before implementing complex features:
```
Step 1: Plan agent → design the approach
Step 2: General-purpose agent → implement the changes
Step 3: Test-runner agent → validate the implementation
```

### Background Agents
Run non-blocking tasks (like tests) in the background while continuing other work:
```
Agent (background): "Run the full test suite and report results"
Meanwhile: Continue implementing features in the main conversation
```

---

## Project-Specific Context for Agents

When launching agents for this project, include relevant context:

- **Language**: JSX (not TypeScript)
- **UI Language**: Traditional Chinese (zh-TW)
- **Database**: Supabase (PostgreSQL)
- **Styling**: Tailwind CSS 4
- **State management**: React context (AuthContext, TenantContext)
- **Routing**: React Router 7 with lazy-loaded module bundles
- **Key lib files**: `db.js`, `supabase.js`, `payroll.js`, `posEngine.js`, `crmEngine.js`, `salesEngine.js`, `laborLaw.js`, `gemini.js`
