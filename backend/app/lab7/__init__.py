"""Lab 7 — Deep Research: multi-agent orchestration, visible end to end.

The pattern this lab demonstrates is planner → approval gate → parallel
workers → synthesis → adversarial verification, with the harness (plain
Python) owning the control flow. The model plans; code executes the plan.

    runner.py        → streaming agent runner (live tool events per worker)
    pipeline.py      → pure helpers: JSON parsing, plan validation, source dedupe
    orchestrator.py  → the event-emitting pipeline (research → synth → verify)

Prompts and role options live in app/agents/lab7_research.py; the HTTP surface
(plan endpoint + NDJSON run stream) in app/routers/lab7.py.

Deliberate limits, each a safety/cost lesson: nothing runs until the human
approves the plan; breadth, per-worker turns, and subprocess concurrency are
capped; researchers get read-only web tools and nothing else; delegation depth
is exactly one (workers cannot spawn workers).
"""
