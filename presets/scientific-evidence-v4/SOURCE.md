# Design sources

This preset is an original DSH composition informed by:

- K-Dense Scientific Agent Skills, `skills/literature-review/SKILL.md`
  (`github.com/K-Dense-AI/scientific-agent-skills`, MIT)
- PRISMA reporting concepts for transparent search and screening records

The preset does not bundle K-Dense scripts, external CLIs, model keys, or generated-figure dependencies. It expands the portable review workflow into a reusable scientific-evidence role using DSH's built-in web, filesystem, and shell tools: question scoping, paper discovery and comparison, claim and citation verification, evidence matrices, structured reviews, gap mapping, and update briefs.

It produces research assistance, not clinical or medical advice. Database access and full-text availability determine actual coverage.

## Language variant

This package is the English variant of **Scientific Evidence mode**. The language variants use the same Cordis capability composition; only presentation metadata and the model-facing persona language differ.

## Local modification

This copy removes a redundant persona `text` block (the persona schema applies `prefix` only) and adds the standard delegation group (subagent spawn/fork, subagent control, workflow). Everything else is unchanged from the published package.

## Local modification

v3 adds `@deepseek-ai/dsh-time-context` so the agent knows the current date, removes the ignored persona `text` block, and adds the standard delegation group (subagents and workflow). All other content is unchanged from the published package.

## Local modification

v4 keeps the v3 changes (time context, removed ignored persona `text` block, delegation group) and adds a skill-routing section to the persona that delegates manuscript, review, figure, and deliverable work to the profile-level Nature Skills set, while keeping this preset's evidence rules as policy.
