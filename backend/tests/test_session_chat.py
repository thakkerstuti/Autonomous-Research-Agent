"""Session chat (app.session_chat): context building, the single rewrite + search decision call,
web search only when needed, streaming with timeouts and model fallback, and citation checks.

Gemini and Tavily are fakes: no API key, no network.
"""
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors

from app import session_chat as sc

QUESTION = "Does spaced practice improve long-term memory in adults?"


# ───────── fakes ─────────

def api_error(code: int, status: str = "UNAVAILABLE"):
    return errors.APIError(code, {"error": {"code": code, "message": status.lower(), "status": status}})


class FakeModels:
    """Scripted per model: a plan result or exception for generate_content, chunks or exceptions for streams."""

    def __init__(self, plans=None, streams=None):
        self.plans = plans or {}      # model -> response object | Exception | list of these (per attempt)
        self.streams = streams or {}  # model -> list[str | Exception] | Exception
        self.plan_calls: list[tuple[str, object]] = []
        self.stream_calls: list[tuple[str, object]] = []

    def _next(self, table, model):
        value = table.get(model, api_error(404, "NOT_FOUND"))
        if isinstance(value, list) and value and not isinstance(value[0], str):
            return value.pop(0) if len(value) > 1 else value[0]
        return value

    def generate_content(self, model, contents, config):
        self.plan_calls.append((model, config))
        self.last_plan_prompt = contents
        value = self._next(self.plans, model)
        if isinstance(value, Exception):
            raise value
        return value

    def generate_content_stream(self, model, contents, config):
        self.stream_calls.append((model, config))
        script = self.streams.get(model, api_error(404, "NOT_FOUND"))
        if isinstance(script, Exception):
            raise script

        def gen():
            for item in script:
                if isinstance(item, Exception):
                    raise item
                yield SimpleNamespace(text=item)
        return gen()


def client(**kw):
    return SimpleNamespace(models=FakeModels(**kw))


def plan_response(**fields):
    return SimpleNamespace(parsed=sc.QueryPlan(**fields), text=None)


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(sc, "_sleep", lambda s: None)


def evidence(i, quote=True, url=None, title=None, stance="supports", text="spaced practice recall adults"):
    return {
        "id": f"E{i}", "source_url": url or f"https://journal{i}.example.org/study", "source_title": title or f"Study {i} on {text}",
        "quote": f"Quote {i}: {text} improved delayed recall." if quote else "", "snippet": f"Snippet {i}: {text}.",
        "stance": stance if quote else "neutral", "weight": 1.0, "query": f"INTERNAL-QUERY-{i}", "hypothesis_id": "H1",
    }


def session(report="Spacing improves delayed recall in adults [E1][E2].", ev=None, **kw):
    return SimpleNamespace(
        question=QUESTION, report=report, evidence_log=ev if ev is not None else [evidence(1), evidence(2), evidence(3, quote=False)],
        progress={"answer_written": True}, hypotheses=[{"id": "H1", "statement": "SECRET-HYPOTHESIS"}],
        critique={"issues": ["SECRET-CRITIQUE"]}, **kw)


def msg(role, content):
    return SimpleNamespace(role=role, content=content)


def paper(sections, refs=None):
    return {"title": "Spacing and Memory: An Evidence Review", "abstract": "This review examines spacing and recall [1].",
            "sections": sections, "references": refs or [{"n": 1, "title": "Study 1", "url": "https://journal1.example.org/study"}]}


# ───────── A. context ─────────

def test_context_stays_within_budget_for_very_long_sessions():
    huge_ev = [evidence(i, text="spaced practice recall adults " * 20) for i in range(1, 80)]
    sections = [{"heading": f"Section {i}", "level": 1, "body": ("Long paragraph about recall and spacing. " * 120)} for i in range(14)]
    history = [msg("user" if i % 2 == 0 else "assistant", "Long message " * 400) for i in range(30)]
    ctx = sc.build_context(session(report="A very long answer [E1]. " * 1500, ev=huge_ev), paper(sections), history,
                           "And what about older adults? " * 50)
    assert ctx.size() <= sc.TOTAL_BUDGET
    prompt = sc.build_answer_prompt(ctx, sc.QueryPlan(standalone_query="q"), ctx.sources)
    assert len(prompt) <= sc.TOTAL_BUDGET + 3_000  # fixed instructions on top of the trimmed context


def test_original_question_and_message_are_always_kept():
    ctx = sc.build_context(session(report="x " * 20_000), None, [], "Is the effect larger for older adults?")
    assert ctx.question == QUESTION and ctx.message == "Is the effect larger for older adults?"
    prompt = sc.build_answer_prompt(ctx, sc.QueryPlan(standalone_query="Is spacing's effect larger in older adults?"), ctx.sources)
    assert f"Research question: {QUESTION}" in prompt and "LATEST MESSAGE: Is the effect larger for older adults?" in prompt


def test_only_the_last_ten_messages_are_used():
    history = [msg("user" if i % 2 == 0 else "assistant", f"message number {i:02d}") for i in range(25)]
    ctx = sc.build_context(session(), None, history, "next question please")
    for i in range(15, 25):
        assert f"message number {i:02d}" in ctx.history
    assert "message number 14" not in ctx.history and "message number 00" not in ctx.history
    assert ctx.history.index("message number 15") < ctx.history.index("message number 24")  # oldest first


def test_relevant_paper_sections_are_included_and_internal_data_is_not():
    filler = "Unrelated discussion of methodology and sampling frames. " * 60
    sections = [
        {"heading": "Methodology", "level": 1, "body": filler},
        {"heading": "Sleep and Consolidation", "level": 1, "body": "Sleep deprivation weakened consolidation after spaced practice [1]. " * 30},
        {"heading": "Funding Landscape", "level": 1, "body": filler},
        {"heading": "Classroom Implementation", "level": 1, "body": filler},
        {"heading": "Policy Notes", "level": 1, "body": filler},
    ]
    ctx = sc.build_context(session(), paper(sections), [], "How does sleep deprivation affect consolidation?")
    assert "Abstract: This review examines spacing and recall" in ctx.paper
    assert "## Sleep and Consolidation" in ctx.paper
    assert len(ctx.paper) <= sc.PAPER_MAX
    everything = ctx.paper + ctx.report + ctx.sources_text() + ctx.history
    for secret in ("SECRET-HYPOTHESIS", "SECRET-CRITIQUE", "INTERNAL-QUERY", "hypothesis_id"):
        assert secret not in everything
    # the paper's own reference [1] and the answer's [E#] use this chat's numbering
    paper_ref_n = next(s.n for s in ctx.sources if s.url == "https://journal1.example.org/study")
    assert f"[{paper_ref_n}]" in ctx.paper and "[E1]" not in ctx.report and "[E" not in ctx.report


def test_missing_paper_and_sparse_sessions_still_build():
    ctx = sc.build_context(session(), None, [], "What did the research find?")
    assert ctx.paper == "" and ctx.report and ctx.sources
    empty = SimpleNamespace(question=QUESTION, report=None, evidence_log=None, progress=None)
    ctx2 = sc.build_context(empty, None, [], "Anything?")
    assert ctx2.report == "" and ctx2.sources == [] and ctx2.question == QUESTION


# ───────── B. one structured call: rewrite + decide ─────────

def test_one_gemini_call_rewrites_and_decides():
    c = client(plans={"m1": plan_response(standalone_query="Does spacing help older adults remember?",
                                          needs_web_search=True, search_query="spacing effect older adults trial", reason="Not covered")})
    ctx = sc.build_context(session(), None, [msg("user", "Does spacing help?"), msg("assistant", "Yes [1].")], "what about older people?")
    plan = sc.plan_query(ctx, client=c, models=["m1", "m2"])
    assert len(c.models.plan_calls) == 1 and c.models.stream_calls == []
    assert plan.standalone_query == "Does spacing help older adults remember?"
    assert plan.needs_web_search is True and plan.search_query == "spacing effect older adults trial"
    config = c.models.plan_calls[0][1]
    assert config.response_mime_type == "application/json" and config.response_schema is sc.QueryPlan
    assert config.http_options.timeout == sc.REQUEST_TIMEOUT_MS


@pytest.mark.parametrize("response", [
    SimpleNamespace(parsed=None, text=""),
    SimpleNamespace(parsed=None, text="not json at all"),
    SimpleNamespace(parsed=None, text='["a", "list"]'),
    SimpleNamespace(parsed={"needs_web_search": "definitely maybe"}, text=None),
    SimpleNamespace(parsed=None, text=None),
])
def test_malformed_or_empty_plan_falls_back_safely(response):
    c = client(plans={"m1": response})
    ctx = sc.build_context(session(), None, [], "what about older people?")
    plan = sc.plan_query(ctx, client=c, models=["m1"])
    assert plan.standalone_query == "what about older people?" and plan.needs_web_search is False and plan.search_query == ""


def test_plan_json_in_text_and_missing_search_query_are_handled():
    c = client(plans={"m1": SimpleNamespace(parsed=None, text='```json\n{"standalone_query": "Q?", "needs_web_search": true}\n```')})
    plan = sc.plan_query(sc.build_context(session(), None, [], "q"), client=c, models=["m1"])
    assert plan.needs_web_search is True and plan.search_query == "Q?"  # falls back to the standalone question


def test_plan_falls_back_to_the_next_model_and_fails_clearly_when_all_fail():
    c = client(plans={"m1": api_error(503), "m2": plan_response(standalone_query="Q2", needs_web_search=False)})
    ctx = sc.build_context(session(), None, [], "q")
    assert sc.plan_query(ctx, client=c, models=["m1", "m2"]).standalone_query == "Q2"
    assert [m for m, _ in c.models.plan_calls] == ["m1", "m1", "m2"]  # one retry on 503, then the next model

    quota = client(plans={"m1": api_error(429, "RESOURCE_EXHAUSTED"), "m2": api_error(429, "RESOURCE_EXHAUSTED")})
    with pytest.raises(sc.ChatError) as e:
        sc.plan_query(ctx, client=quota, models=["m1", "m2"])
    assert e.value.status_code == 429


# ───────── C. web search only when needed ─────────

class FakeSearch:
    def __init__(self, results=None, fail=False):
        self.calls = []
        self.results = results if results is not None else [
            {"title": "Older adults trial", "url": "https://news.example.com/older", "content": "Spacing helped adults over 65."},
            {"title": "Duplicate", "url": "https://news.example.com/older/", "content": "dup"},
            {"title": "Not a web page", "url": "ftp://files.example.com/x", "content": "x"},
            {"title": "Meta-analysis", "url": "https://journal9.example.org/meta", "content": "Pooled effect across ages."},
        ]
        self.fail = fail

    def __call__(self, query, max_results=5):
        self.calls.append((query, max_results))
        if self.fail:
            raise RuntimeError("tavily down")
        return self.results


def test_tavily_is_called_when_web_search_is_needed():
    search = FakeSearch()
    ctx = sc.build_context(session(), None, [], "older adults?")
    plan = sc.QueryPlan(standalone_query="Does spacing help older adults?", needs_web_search=True, search_query="spacing older adults")
    sources = sc.answer_sources(ctx, plan, search=search)
    assert search.calls == [("spacing older adults", sc.WEB_RESULTS)]
    web = [s for s in sources if s.origin == "web"]
    assert [s.url for s in web] == ["https://news.example.com/older", "https://journal9.example.org/meta"]  # dedupe, http(s) only


def test_tavily_is_not_called_when_the_session_is_enough():
    search = FakeSearch()
    ctx = sc.build_context(session(), None, [], "summarise that")
    sources = sc.answer_sources(ctx, sc.QueryPlan(standalone_query="Summarise", needs_web_search=False), search=search)
    assert search.calls == [] and all(s.origin == "research" for s in sources)


def test_sources_are_numbered_once_research_first_then_web():
    ctx = sc.build_context(session(), None, [], "older adults?")
    sources = sc.answer_sources(ctx, sc.QueryPlan(standalone_query="q", needs_web_search=True, search_query="q"), search=FakeSearch())
    assert [s.n for s in sources] == list(range(1, len(sources) + 1))
    first_web = next(i for i, s in enumerate(sources) if s.origin == "web")
    assert all(s.origin == "research" for s in sources[:first_web]) and all(s.origin == "web" for s in sources[first_web:])
    assert "(web search)" in sc.format_sources(sources) and "(from this research)" in sc.format_sources(sources)


def test_a_failing_search_does_not_break_the_answer():
    ctx = sc.build_context(session(), None, [], "q")
    sources = sc.answer_sources(ctx, sc.QueryPlan(standalone_query="q", needs_web_search=True, search_query="q"), search=FakeSearch(fail=True))
    assert sources == ctx.sources


# ───────── D. streaming, timeouts, fallback ─────────

def test_answer_is_streamed_in_pieces():
    c = client(streams={"m1": ["Spacing ", "helps older ", "adults [1]", " too."]})
    pieces = list(sc.stream_answer("prompt", {1}, client=c, models=["m1"]))
    assert len(pieces) >= 3 and "".join(pieces) == "Spacing helps older adults [1] too."
    assert c.models.stream_calls[0][1].http_options.timeout == sc.REQUEST_TIMEOUT_MS


def test_timeout_moves_on_to_the_next_model():
    c = client(streams={"m1": [httpx.ReadTimeout("timed out")], "m2": ["Answer from the fallback model [1]."]})
    assert "".join(sc.stream_answer("p", {1}, client=c, models=["m1", "m2"])) == "Answer from the fallback model [1]."
    assert [m for m, _ in c.models.stream_calls] == ["m1", "m1", "m2"]  # one retry on timeout, then the next model


def test_all_models_failing_raises_a_clear_error_and_yields_nothing():
    c = client(streams={"m1": api_error(503), "m2": [httpx.ReadTimeout("t")], "m3": []})
    received = []
    with pytest.raises(sc.ChatError) as e:
        for piece in sc.stream_answer("p", {1}, client=c, models=["m1", "m2", "m3"]):
            received.append(piece)
    assert received == [] and e.value.status_code == 503 and "isn't responding" in str(e.value)


def test_a_failure_after_the_answer_started_is_not_restarted_silently():
    c = client(streams={"m1": ["The first part ", api_error(503)], "m2": ["A different answer."]})
    received = []
    with pytest.raises(sc.ChatError) as e:
        for piece in sc.stream_answer("p", set(), client=c, models=["m1", "m2"]):
            received.append(piece)
    assert received == ["The first part"] and "interrupted" in str(e.value)  # (a trailing space waits for what follows)
    assert [m for m, _ in c.models.stream_calls] == ["m1"]


# ───────── E. citations ─────────

def test_invalid_citation_numbers_are_removed_and_valid_ones_kept():
    text, removed = sc.validate_citations("A [1]. B [7]. C [1, 9] and [2][3]. See [note] and [ 2 ].", {1, 2})
    assert text == "A [1]. B. C [1] and [2]. See [note] and [2]."
    assert removed == [3, 7, 9]


def test_citations_are_checked_while_streaming_even_across_chunks():
    c = client(streams={"m1": ["Claim one [", "1", "]. Claim two [9", "]. Claim three [1, ", "4", "]. Array [x] ok."]})
    pieces = list(sc.stream_answer("p", {1}, client=c, models=["m1"]))
    assert all("9" not in p and "4" not in p for p in pieces)  # an invalid number is never shown, even briefly
    assert "".join(pieces) == "Claim one [1]. Claim two. Claim three [1]. Array [x] ok."


def test_finalize_keeps_only_cited_sources_for_saving():
    sources = [sc.Source(1, "A", "https://a.org", "", "research"), sc.Source(2, "B", "https://b.org", "", "research"),
               sc.Source(3, "C", "https://c.org", "", "web")]
    text, saved = sc.finalize_answer("Point [1].\n\n\n\nOther point [3] and bad [8].", sources)
    assert text == "Point [1].\n\nOther point [3] and bad."
    assert [s["n"] for s in saved] == [1, 3] and saved[1]["origin"] == "web"


def test_the_whole_pipeline_with_fakes():
    c = client(plans={"m1": plan_response(standalone_query="Does spacing help older adults?", needs_web_search=True,
                                          search_query="spacing older adults")},
               streams={"m1": ["Older adults also benefit ", "[4]", ", consistent with the research [1]. Bogus [99]."]})
    search = FakeSearch()
    ctx = sc.build_context(session(), None, [msg("user", "Does spacing help?"), msg("assistant", "Yes [1].")], "what about older adults?")
    plan = sc.plan_query(ctx, client=c, models=["m1"])
    sources = sc.answer_sources(ctx, plan, search=search)
    prompt = sc.build_answer_prompt(ctx, plan, sources)
    streamed = "".join(sc.stream_answer(prompt, {s.n for s in sources}, client=c, models=["m1"]))
    final, saved = sc.finalize_answer(streamed, sources)
    web_n = next(s.n for s in sources if s.origin == "web")
    assert web_n == 4 and "[99]" not in final and final.startswith("Older adults also benefit [4]")
    assert {s["n"] for s in saved} == {1, 4}
    assert len(c.models.plan_calls) == 1 and len(search.calls) == 1


# ───────── one continuous conversation: follow-ups, references, topic changes ─────────

AI_TALK = [msg("user", "Explain multi-agent AI systems."),
           msg("assistant", "Multi-agent AI systems use several cooperating agents, each with a role [1]."),
           msg("user", "How is this different from autonomous AI?"),
           msg("assistant", "A single autonomous agent acts alone; multi-agent systems coordinate several [2].")]


def test_the_planner_sees_the_conversation_first_and_the_research_only_as_background():
    c = client(plans={"m1": plan_response(relation="follow_up", standalone_query="Give a practical example of a multi-agent AI system.")})
    ctx = sc.build_context(session(), None, AI_TALK, "Give me a practical example.")
    sc.plan_query(ctx, client=c, models=["m1"])
    prompt = c.models.last_plan_prompt
    assert prompt.index("RECENT CONVERSATION") < prompt.index("LATEST MESSAGE") < prompt.index("BACKGROUND")
    assert "User: How is this different from autonomous AI?" in prompt
    assert '"follow_up"' in prompt and '"new_topic"' in prompt  # the planner is asked to tell them apart


def test_a_follow_up_resolves_references_and_keeps_the_research_as_background():
    plan = sc.QueryPlan(relation="follow_up", standalone_query="What are the real-world applications of multi-agent AI systems?")
    ctx = sc.build_context(session(), None, AI_TALK, "What about its applications?")
    sources = sc.answer_sources(ctx, plan, search=FakeSearch())
    prompt = sc.build_answer_prompt(ctx, plan, sources)
    assert "(Standalone meaning: What are the real-world applications of multi-agent AI systems?)" in prompt
    assert "Continues the conversation" in prompt and "Research answer:" in prompt
    assert any(s.origin == "research" for s in sources)  # the research can still be cited
    assert prompt.index("RECENT CONVERSATION") < prompt.index("BACKGROUND")


def test_a_topic_change_is_answered_on_its_own_with_web_sources_only():
    search = FakeSearch(results=[{"title": "Quantum computing basics", "url": "https://physics.example.org/qc",
                                  "content": "Quantum computers use qubits."}])
    plan = sc._clean_plan(sc.QueryPlan(relation="new_topic", standalone_query="Explain quantum computing.",
                                       needs_web_search=True, search_query="quantum computing explained"), None)
    ctx = sc.build_context(session(), None, AI_TALK, "Okay, let's change the topic. Explain quantum computing.")
    sources = sc.answer_sources(ctx, plan, search=search)
    assert search.calls == [("quantum computing explained", sc.WEB_RESULTS)]
    assert [(s.n, s.origin) for s in sources] == [(1, "web")]  # numbered from 1, no research sources
    prompt = sc.build_answer_prompt(ctx, plan, sources)
    assert "A new topic" in prompt and "the conversation is now about a different subject" in prompt
    assert "Research answer:" not in prompt and "Spacing improves delayed recall" not in prompt  # not forced into the old topic
    assert "User: Explain multi-agent AI systems." in prompt  # the conversation itself is still visible


def test_a_follow_up_about_the_new_topic_does_not_bring_back_the_old_research():
    """After "Explain quantum computing", "What are its applications?" follows the conversation, not the research."""
    talk = AI_TALK + [msg("user", "Okay, let's change the topic. Explain quantum computing."),
                      msg("assistant", "Quantum computers use qubits [1].")]
    plan = sc._clean_plan(sc.QueryPlan(relation="follow_up", research_relevant=False, needs_web_search=True,
                                       standalone_query="What are the real-world applications of quantum computing?",
                                       search_query="quantum computing applications"), None)
    ctx = sc.build_context(session(), None, talk, "What are its real-world applications?")
    search = FakeSearch(results=[{"title": "Quantum applications", "url": "https://physics.example.org/apps", "content": "Drug discovery."}])
    sources = sc.answer_sources(ctx, plan, search=search)
    assert [(s.n, s.origin) for s in sources] == [(1, "web")]  # the multi-agent research can't be cited for quantum computing
    prompt = sc.build_answer_prompt(ctx, plan, sources)
    assert "Continues the conversation" in prompt and "Research answer:" not in prompt
    assert "User: Okay, let's change the topic. Explain quantum computing." in prompt


def test_a_new_topic_never_uses_the_old_research():
    plan = sc._clean_plan(sc.QueryPlan(relation="new_topic", research_relevant=True, standalone_query="x"), None)
    assert plan.research_relevant is False and plan.uses_research is False
    assert sc._clean_plan(None, sc.build_context(session(), None, [], "q")).uses_research is True  # unreadable plan: keep the research


def test_relation_values_are_normalised_and_unknown_ones_treated_as_follow_ups():
    ctx = sc.build_context(session(), None, [], "q")
    for raw, expected in (("new topic", "new_topic"), ("New-Topic", "new_topic"), ("FOLLOW_UP", "follow_up"),
                          ("something else", "follow_up"), ("", "follow_up")):
        assert sc._clean_plan(sc.QueryPlan(relation=raw, standalone_query="x"), ctx).relation == expected


def test_long_conversations_keep_recent_messages_and_earlier_topics_over_background():
    long_talk = [msg("user" if i % 2 == 0 else "assistant", f"turn {i:02d} " + "detail " * 400) for i in range(10)]
    ctx = sc.build_context(session(report="Background research answer. " * 1_000), None, long_talk, "And the last point?",
                           earlier_topics=["Explain multi-agent AI systems.", "What is quantum computing?"])
    assert ctx.size() <= sc.TOTAL_BUDGET
    assert "turn 09" in ctx.history and "turn 08" in ctx.history  # the newest messages survive
    assert len(ctx.report) < 5_000  # background was trimmed first
    prompt = sc.build_answer_prompt(ctx, sc.QueryPlan(standalone_query="q"), ctx.sources)
    assert "turn 09" in prompt


def test_earlier_topics_list_questions_beyond_the_recent_messages():
    ctx = sc.build_context(session(), None, AI_TALK, "Back to the first topic: what were the agents' roles?",
                           earlier_topics=["What is the history of the internet?", "Tell me about climate change."])
    assert "- What is the history of the internet?" in ctx.earlier_topics
    prompt = sc.build_answer_prompt(ctx, sc.QueryPlan(standalone_query="q"), ctx.sources)
    assert "EARLIER QUESTIONS IN THIS CONVERSATION:\n- What is the history of the internet?" in prompt


def test_earlier_answers_lose_their_own_citation_numbers_in_the_history():
    ctx = sc.build_context(session(), None, AI_TALK, "q")
    assert "[1]" not in ctx.history and "[2]" not in ctx.history
    assert "Assistant: Multi-agent AI systems use several cooperating agents, each with a role." in ctx.history
