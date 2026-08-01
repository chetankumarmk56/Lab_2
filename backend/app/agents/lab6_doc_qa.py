"""Lab 6 — grounded Policy Q&A agent (the *generation* stage of RAG).

The agent gets NO tools: the retrieved chunks pasted into its prompt are its
entire knowledge of the world. That is the whole point of the lab's safety
story — the model cannot answer beyond what retrieval handed it, must cite
which chunk each claim came from, and must refuse (with a visible sentinel)
when the corpus doesn't cover the question.
"""
from claude_agent_sdk import ClaudeAgentOptions

from ..agent_runtime import run_agent
from ..config import CLAUDE_MODEL

# Prefixed onto a refusal; the UI hides it and shows a "not in corpus" badge.
NOT_IN_CONTEXT_SENTINEL = "[[NOT_IN_CONTEXT]]"

SYSTEM_PROMPT = f"""You are a policy assistant for Riverbend County Building Services.
You answer questions using ONLY the numbered SOURCES provided in the user message.

Rules:
- Every factual claim must come from the SOURCES. Cite the source of each claim
  inline, immediately after it, like [1] or [2][4]. Use only source numbers that
  exist in the SOURCES.
- Quote figures exactly as written — fees, day counts, deadlines, form numbers.
- If the SOURCES do not contain what is needed to answer, reply with exactly
  {NOT_IN_CONTEXT_SENTINEL} followed by one short sentence saying the policy
  corpus does not cover this. Never answer from general knowledge, never guess.
- If the SOURCES only partially cover the question, answer the covered part and
  say plainly which part is not covered.
- Be concise: 2-6 sentences of plain language. No preamble, no headings, no
  bullet lists unless the answer is genuinely a list.
"""


def build_user_prompt(question: str, context: list[dict]) -> str:
    """Assemble the augmented prompt: numbered sources, then the question.

    `context` blocks carry n / title / heading / text (built by the router from
    the fused retrieval selection).
    """
    blocks = [
        f"[{b['n']}] {b['title']} — {b['heading']}\n{b['text']}" for b in context
    ]
    return "SOURCES:\n\n" + "\n\n---\n\n".join(blocks) + f"\n\nQUESTION: {question}"


def _options() -> ClaudeAgentOptions:
    return ClaudeAgentOptions(
        system_prompt=SYSTEM_PROMPT,
        model=CLAUDE_MODEL,
        tools=[],                 # grounding by construction: context in, text out
        allowed_tools=[],
        permission_mode="bypassPermissions",
        setting_sources=[],
    )


async def answer_from_sources(question: str, context: list[dict]) -> dict:
    """Run one grounded generation turn. Returns the run_agent dict."""
    return await run_agent(build_user_prompt(question, context), _options())
