"""Lab 8 — Eval Harness: the labs become systems under test.

The question this lab answers is the one every serious team asks: *how do you
know it works, and how do you catch a regression before users do?*

    suites.py    → golden cases loaded from data/lab8/suites/*.json
    adapters.py  → run one case against the REAL lab (production options,
                   optional model override applied to the options object —
                   no lab's code is modified to be evaluated)
    graders.py   → deterministic checks (SQL execution-match, containment,
                   citation validity, bounds) + an LLM-as-judge for faithfulness
    results.py   → stored run summaries: history, regression diff, model matrix
    runner.py    → sequential case runner streaming NDJSON progress

Design rules: prefer deterministic graders (free, unarguable); when a judge is
used, its reasoning is displayed, never just its verdict; every case reports
its real dollar cost; and a run always ends with a comparison against the
previous run — evals without regression tracking are just screenshots.
"""
