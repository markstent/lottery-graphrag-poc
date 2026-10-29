"""Answer generation through the model gateway (ADR-003).

- FakeAnswerGenerator: deterministic template generator for CI and tests.
  It never fabricates content beyond the retrieved context titles, so tests
  can assert exact outputs.
- LiteLLMAnswerGenerator: the real gateway call (local Ollama or hosted
  OpenRouter through configuration).

Every pipeline shares one prompt (PROMPT_VERSION), one generator, one
parser (`parse_answer`) and one citation builder (`citations_for`), and
hands the generator one list of selected evidence in prompt order, so the
same selected evidence in the same order gives the same prompt in A, B and C
(docs/reference/retrieval/retrieval-fairness.md), apart from one declared
addition: a graph record reached by a walk shows its "reached from" path line
in B and C (D-085). The model is asked for a JSON object
with a verdict and a prose answer citing numbered sources as [n]; the parser
keeps only citations that point at a block actually shown to the model.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Protocol

from app.config import DEFAULT_GENERATION_MAX_TOKENS
from app.evidence import AnswerForm, Citation, EvidenceChunk, RagAnswer
from app.models.gateway import CompletionRequest, GatewayError, complete

PROMPT_VERSION = "3.0.0"

SYSTEM_PROMPT = (
    "You are an enterprise analyst. Answer using only the numbered context "
    "sources; do not use outside knowledge. Respond with exactly one JSON object "
    'and nothing else: {"verdict": "<the answer itself in one line, such as a name, '
    "an id, a number, a date or yes or no; 'unknown' when the sources do not "
    'answer>", "answer": "<prose with [n] citations>"}. The verdict is never a '
    "status word such as 'success' or 'ok'. Cite every claim as [n] matching the "
    "source numbers given. A source line that starts with 'reached from' shows how "
    "that record connects to an entity named in the question. If the sources do not "
    'answer the question, set verdict to "unknown" and say so plainly in the answer.'
)

# How model outputs are read (D-096); recorded with every run, so runs read by
# different parsers are never compared or resumed as one experiment. A run
# recorded before the field existed was read by parser 1.0.0 (strict JSON,
# then fenced JSON, then plain text). 2.1.0 (review of 2.0.0): unknown
# escapes kept as written, "unclosed" in place of "cut_off", a second object
# or text after a closed object is plain, a verdict needs its comma, a final
# bare quote is kept, and a high surrogate cut from its pair is left out.
ANSWER_PARSER_VERSION = "2.1.0"

FENCED_JSON = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_DECODER = json.JSONDecoder(strict=False)
# The prompted object read field by field: its opening up to the verdict's
# string, and the answer key after the verdict (a cut-off output may end
# inside it, so it is also matched as a prefix with whitespace removed).
_OPEN = re.compile(r'\{\s*"verdict"\s*:\s*"')
_ANSWER_KEY = re.compile(r'\s*,\s*"answer"\s*:\s*"')
_ANSWER_KEY_COMPACT = ',"answer":"'
# An escape sequence, or a bare double quote, inside a JSON string's body.
_ESCAPE_OR_QUOTE = re.compile(r'(\\.)|"', re.DOTALL)
# For decoding a body: an escape JSON knows, any other backslash pair (such as
# LaTeX's \exists, kept as written), or a bare double quote.
_DECODABLE = re.compile(r'(\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt]))|(\\.)|"', re.DOTALL)
# An escape cut short at the end of the output: a lone backslash, or \u with
# fewer than four hex digits, after any whole escaped backslashes.
_PARTIAL_ESCAPE = re.compile(r"(?<!\\)((?:\\\\)*)\\(?:u[0-9a-fA-F]{0,3})?\Z")
# A high surrogate escape at the end of the output, whose pair was cut off.
_HALF_PAIR = re.compile(r"(?<!\\)((?:\\\\)*)\\u[dD][89abAB][0-9a-fA-F]{2}\Z")
# Another object opening inside the answer: the model began a second reply.
_SECOND_OBJECT = re.compile(r'\{\s*"verdict"\s*:')
# A bare quote followed by the closing brace, then whatever follows the brace.
_CLOSE = re.compile(r"\s*\}(.*)", re.DOTALL)


class GenerationError(RuntimeError):
    """Raised when the model gateway fails or returns unusable output."""


@dataclass(frozen=True, slots=True)
class GenerationOutput:
    """Verbatim model output, its latency and token usage when reported, and
    how it ended: the provider's stop reason, whether it stopped at the output
    cap, and that cap (``app.models.gateway.Completion``). The fake generator
    has no cap and reports none of them."""

    raw_text: str
    latency_ms: float
    usage: dict[str, int] | None = None
    finish_reason: str | None = None
    token_limit_reached: bool | None = None
    max_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class ParsedAnswer:
    """The structured reading of one model output."""

    verdict: str
    answer: str
    cited_blocks: list[int]
    form: AnswerForm


class AnswerGenerator(Protocol):
    model_name: str

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        """Return the model output grounded in the given contexts.

        ``contexts`` is the pipeline's selected evidence in prompt order:
        document chunks, record blocks and graph nodes alike.
        """
        ...


def context_block(chunk: EvidenceChunk) -> str:
    """One context block, rendered the same way in every pipeline (D-085).

    A record, whether a record block or a graph node with one, is its facts
    heading with its source, then one "- name: value" line per fact. A
    document chunk is a title line, "{title} ({market}, {language})" without
    empty parts, then its text. A graph node without a record block is its
    heading "<Label> <id>", then its text when the text says more (a
    concept's ontology text in C); a bare node's text is that heading. A
    graph node reached by a walk (B and C, hops > 0) adds
    "- reached from <seed id>: <path>" (``PROMPT_EXTRAS["path_line"]``).
    """
    if chunk.facts_heading is not None:
        lines = [
            f"{chunk.facts_heading} (source: {chunk.source_system}.{chunk.record_table},"
            f" record {chunk.document_id})",
            *(f"- {name}: {value}" for name, value in chunk.facts),
        ]
    elif chunk.kind == "record":
        raise ValueError(f"record block {chunk.chunk_id} has no facts to show")
    elif chunk.kind == "node":
        heading = f"{chunk.document_type} {chunk.document_id}"
        lines = [heading] if chunk.text == heading else [heading, chunk.text]
    else:
        scope = ", ".join(part for part in (chunk.market_id, chunk.language_code) if part)
        lines = [f"{chunk.title} ({scope})" if scope else chunk.title, chunk.text]
    if chunk.graph_path is not None:
        # EvidenceChunk validates the pair when built; model_copy does not.
        if chunk.graph_seed is None:
            raise ValueError(f"graph node {chunk.chunk_id} has a path but no seed")
        lines.append(f"- reached from {chunk.graph_seed}: {chunk.graph_path}")
    return "\n".join(lines)


def build_user_prompt(question: str, contexts: list[EvidenceChunk]) -> str:
    """Numbered context in the order given (prompt order); [n] in answers
    maps to the n-th block."""
    blocks = [f"[{index}] {context_block(chunk)}" for index, chunk in enumerate(contexts, start=1)]
    joined = "\n\n".join(blocks) if blocks else "(no context retrieved)"
    return f"Context sources:\n{joined}\n\nQuestion: {question}"


def citations_for(contexts: list[EvidenceChunk]) -> list[Citation]:
    """One citation per prompt block, in prompt order: cited block n is
    ``citations[n - 1]``. A graph node carries its source table and record
    id through the same provenance fields as a record block."""
    return [
        Citation(
            chunk_id=chunk.chunk_id,
            document_id=chunk.document_id,
            title=chunk.title,
            source_system=chunk.source_system,
            source_record_id=chunk.document_id,
            record_table=chunk.record_table,
            market_id=chunk.market_id,
            language_code=chunk.language_code,
        )
        for chunk in contexts
    ]


def _structured(text: str) -> tuple[str, str] | None:
    """(verdict, answer) when text is the prompted JSON object, else None.
    Control characters inside its strings are accepted (D-096)."""
    try:
        payload = json.loads(text, strict=False)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    verdict, answer = payload.get("verdict"), payload.get("answer")
    if not isinstance(verdict, str) or not isinstance(answer, str):
        return None
    return verdict.strip(), answer.strip()


def _bare_quotes(text: str) -> list[int]:
    """Positions of the double quotes in ``text`` that no backslash escapes."""
    return [match.start() for match in _ESCAPE_OR_QUOTE.finditer(text) if match.group(1) is None]


def _escaped(match: re.Match[str]) -> str:
    known, unknown = match.group(1), match.group(2)
    if known:
        return known
    return "\\" + unknown if unknown else '\\"'


def _string_body(body: str) -> str:
    """A JSON string's body decoded: a bare double quote is a quote
    character, and an escape JSON does not know (``\\e``, or ``\\u`` without
    four hex digits) is kept as written, backslash and all."""
    decoded = json.loads(f'"{_DECODABLE.sub(_escaped, body)}"', strict=False)
    if not isinstance(decoded, str):
        raise TypeError("a JSON string body decoded to a non-string")
    return decoded


def _read_fields(text: str) -> tuple[AnswerForm, str, str] | None:
    """(form, verdict, answer) for an output that opens the prompted object
    but that no JSON reader accepts, read field by field; None for anything
    else (D-096, parser 2.1.0).

    The object must open with the verdict and follow it with the answer, as
    the prompt asks. The verdict is its string up to the first bare quote,
    and counts only when a comma follows that quote. An answer string whose
    first bare quote followed by a closing brace ends the output is
    "repaired": every bare quote before it is the model's text. An output
    that ends before any such brace is "unclosed": the answer runs to where
    the output ends, less an escape or half a surrogate pair the end cut
    short. These stay plain text, so no text the model wrote is dropped and
    no retracted verdict is taken: a complete JSON value followed by more
    text, a closed object followed by more text, and an answer holding a
    second ``{"verdict":`` object.
    """
    try:
        _DECODER.raw_decode(text)
    except json.JSONDecodeError:
        pass
    else:
        return None
    opening = _OPEN.match(text)
    if opening is None:
        return None
    after_open = text[opening.end() :]
    quotes = _bare_quotes(after_open)
    rest = after_open[quotes[0] + 1 :] if quotes else ""
    compact = "".join(rest.split())
    if not compact.startswith(","):
        # The output ends inside the verdict, or right after a quote that may
        # be inside it; anything else after the verdict is not the shape.
        return ("unclosed", "", "") if compact == "" else None
    verdict = _string_body(after_open[: quotes[0]]).strip()
    key = _ANSWER_KEY.match(rest)
    if key is None:
        return ("unclosed", verdict, "") if _ANSWER_KEY_COMPACT.startswith(compact) else None
    body = rest[key.end() :]
    if _SECOND_OBJECT.search(body):
        return None
    for quote in _bare_quotes(body):
        closing = _CLOSE.match(body, quote + 1)
        if closing is not None:
            if closing.group(1).strip():
                return None
            return "repaired", verdict, _string_body(body[:quote]).strip()
    body = _HALF_PAIR.sub(r"\1", _PARTIAL_ESCAPE.sub(r"\1", body))
    return "unclosed", verdict, _string_body(body).strip()


def parse_answer(raw: str, block_count: int) -> ParsedAnswer:
    """Read a model output, the same way for A, B and C (parser
    ``ANSWER_PARSER_VERSION``, D-096): the JSON object, then the object in a
    code fence, then the object read field by field (`_read_fields`), then
    plain text with an empty verdict.

    Citations are the [n] markers in the answer that point at one of the
    `block_count` blocks shown to the model, deduplicated in first-seen order.
    A bracket may group comma-separated numbers ([1, 2]); ranges such as [1-3]
    are not supported and cite nothing.
    """
    text = raw.strip()
    structured = _structured(text) or next(
        (found for block in FENCED_JSON.finditer(text) if (found := _structured(block.group(1)))),
        None,
    )
    form: AnswerForm
    if structured:
        form, (verdict, answer) = "json", structured
    elif read := _read_fields(text):
        form, verdict, answer = read
    else:
        form, verdict, answer = "plain", "", raw
    cited: list[int] = []
    for match in CITATION.finditer(answer):
        for part in match.group(1).split(","):
            number = int(part)
            if 1 <= number <= block_count and number not in cited:
                cited.append(number)
    return ParsedAnswer(verdict=verdict, answer=answer, cited_blocks=cited, form=form)


def is_cut_off(form: AnswerForm, token_limit_reached: bool | None) -> bool:
    """Whether an answer stops before the model finished it (D-096): its
    output stopped at the token cap, or its object never closed and nothing
    says whether the cap stopped it. An unclosed object that stopped below
    the cap is the model's own ending, not a cut."""
    return token_limit_reached is True or (form == "unclosed" and token_limit_reached is None)


def answer_from(
    output: GenerationOutput, contexts: list[EvidenceChunk], model: str, context_tokens: int
) -> RagAnswer:
    """The recorded answer for ``output`` over ``contexts`` (prompt order),
    built the same way by A, B and C."""
    parsed = parse_answer(output.raw_text, block_count=len(contexts))
    return RagAnswer(
        text=parsed.answer,
        verdict=parsed.verdict,
        cited_blocks=parsed.cited_blocks,
        raw_text=output.raw_text,
        model=model,
        latency_ms=round(output.latency_ms, 1),
        context_tokens=context_tokens,
        citations=citations_for(contexts),
        usage=output.usage,
        answer_form=parsed.form,
        finish_reason=output.finish_reason,
        token_limit_reached=output.token_limit_reached,
        max_tokens=output.max_tokens,
        cut_off=is_cut_off(parsed.form, output.token_limit_reached),
    )


class FakeAnswerGenerator:
    """Deterministic template generator (CI and tests)."""

    def __init__(self) -> None:
        self.model_name = "fake-answer-v1"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        started = time.perf_counter()
        del question  # deterministic output: context titles only
        if contexts:
            titles = ", ".join(chunk.title for chunk in contexts[:2])
            verdict = "[fake-model] answered from the retrieved sources"
            answer = (
                f"[fake-model] Based on {len(contexts)} retrieved source(s), the strongest "
                f"evidence for the question is in: {titles} [1]."
            )
        else:
            verdict = "unknown"
            answer = "[fake-model] No context was retrieved for this question."
        raw_text = json.dumps({"verdict": verdict, "answer": answer})
        return GenerationOutput(raw_text, (time.perf_counter() - started) * 1000)


class LiteLLMAnswerGenerator:
    """Provider-neutral completion through the LiteLLM gateway."""

    def __init__(
        self,
        model: str,
        temperature: float = 0.0,
        api_base: str | None = None,
        max_tokens: int = DEFAULT_GENERATION_MAX_TOKENS,
        timeout_s: float = 120.0,
        reasoning: str = "default",
    ) -> None:
        self.model_name = model
        self._reasoning = reasoning
        self._temperature = temperature
        self._api_base = api_base
        self._max_tokens = max_tokens
        self._timeout_s = timeout_s

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        request = CompletionRequest(
            model=self.model_name,
            system=SYSTEM_PROMPT,
            user=build_user_prompt(question, contexts),
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            api_base=self._api_base,
            timeout_s=self._timeout_s,
            reasoning=self._reasoning,
        )
        try:
            completion = complete(request)
        except GatewayError as error:
            raise GenerationError(str(error)) from error
        return GenerationOutput(
            completion.text,
            completion.latency_ms,
            completion.usage,
            completion.finish_reason,
            completion.token_limit_reached,
            self._max_tokens,
        )
