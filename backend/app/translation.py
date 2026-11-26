"""
Pattern content translation between Hebrew and English, and the AI call
behind photo reading (transcription.py) -- via Groq
(https://console.groq.com/docs) first when GROQ_API_KEY is set, with
Google's Gemini (https://ai.google.dev/api/generate-content) as the
fallback, or Gemini alone. See _call_model.

Uses `requests` directly against both REST endpoints rather than the
providers' PyPI packages -- same "one POST, not worth a new dependency"
rationale as email.py's Resend integration.

Unlike email.py's "log instead of send when unset" fallback, having no
AI key configured raises immediately: a translation the caller is
actively waiting on (and will persist to the database) has no reasonable
"pretend it worked" no-op, unlike a best-effort notification email.

Two directions, two public entry points -- translate_pattern_to_hebrew
and translate_pattern_to_english -- since a pattern's own primary content
isn't always English (see scraper.py's Hebrew keyword support): a
Hebrew-sourced pattern needs an English overlay the same way an
English-sourced one needs a Hebrew overlay. Both share _call_model (the
provider chain, retries, and response-shape handling, none of which is
direction-specific) and _build_translated_instructions (turning the
model's positional response back into a part-name-keyed dict); only the
prompt text and the target language's field-name suffix differ.
"""

import base64
import json
import logging
import os
import re
import time
from pathlib import Path

import requests

# Hand-maintained corrections, e.g. {"dc": "עמוד כפול"} -- edit this file
# directly (English term -> exact Hebrew translation) whenever a reviewer
# flags a term Gemini got wrong or inconsistent; picked up on the very
# next translate call, no redeploy/restart needed. See
# _build_glossary_section for how it's fed into the prompt. English-
# target translation doesn't use this: standard English crochet/knitting
# abbreviations (sc/dc/hdc/ch/...) are already unambiguous, so there's no
# equivalent terminology-drift risk to hand-correct for that direction.
logger = logging.getLogger(__name__)

GLOSSARY_PATH = Path(__file__).parent / "translation_glossary.json"

GEMINI_API_URL_TEMPLATE = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
# A version-less alias, deliberately -- pinned model names get deprecated
# and start 404ing for new callers on a timeline outside this app's
# control (confirmed directly against the API during development: a
# pinned "gemini-2.5-flash" was already rejected with "no longer
# available to new users"). "-latest" trades a small amount of
# translation-output stability for not silently breaking down the line.
GEMINI_MODEL = "gemini-flash-latest"
# Tried when GEMINI_MODEL is overloaded (503 "high demand"), rate-limited
# (429) or too slow. Seen for days at a time in November 2026: the main
# model answered 503 to nearly every call while the lite model read a
# pattern photo correctly in about 9 s. Lighter, so translations of long
# patterns may be a little rougher -- better than no answer.
GEMINI_FALLBACK_MODEL = "gemini-flash-lite-latest"
# Both can be changed per deployment without a code change (Render env
# vars), e.g. when Google retires one of the aliases.
GEMINI_MODEL_ENV = "GEMINI_MODEL"
GEMINI_FALLBACK_MODEL_ENV = "GEMINI_FALLBACK_MODEL"
REQUEST_TIMEOUT_SECONDS = 60
# The main model's attempt is cut shorter than REQUEST_TIMEOUT_SECONDS so
# a slow one still leaves the fallback enough of TOTAL_BUDGET_SECONDS.
PRIMARY_ATTEMPT_SECONDS = 45
# Gemini often 503s ("high demand") or 429s under load -- both models,
# on and off, seconds apart (seen in November 2026: one call failed,
# the next succeeded in 1.5 s). So a busy answer or a timeout is retried
# on the *other* model, alternating, with a growing pause, until
# TOTAL_BUDGET_SECONDS runs out. Any other 4xx (bad request, invalid key)
# is never retried: it would only fail again.
MAX_RETRIES = 10  # in practice TOTAL_BUDGET_SECONDS ends it first
RETRY_BACKOFF_SECONDS = 2
# All attempts plus backoff must finish inside gunicorn's 90 s worker
# timeout (backend/gunicorn.conf.py), with room left for the rest of the
# request -- otherwise a slow Gemini gets the worker killed and the user
# sees a bare proxy 502 instead of our own error message. Each attempt's
# timeout is cut to what's left, and no attempt starts with less than
# MIN_ATTEMPT_SECONDS remaining (too short to be worth it).
TOTAL_BUDGET_SECONDS = 75
MIN_ATTEMPT_SECONDS = 10
_monotonic = time.monotonic  # patched in tests

# Groq (https://console.groq.com/docs) is tried first when GROQ_API_KEY is
# set: its free plan needs no card and allows about 30 requests a minute
# and 1,000 a day per model (November 2026), and it doesn't have Gemini's
# days-long "high demand" spells. Gemini stays as the fallback. The order
# can be changed per deployment, e.g. AI_PROVIDERS=gemini to switch Groq
# off without a deploy.
AI_PROVIDERS_ENV = "AI_PROVIDERS"
DEFAULT_AI_PROVIDERS = "groq,gemini"
PROVIDER_KEYS = {"groq": "GROQ_API_KEY", "gemini": "GEMINI_API_KEY"}
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
# Translation: one of Groq's models with strict JSON Schema output.
GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_MODEL_ENV = "GROQ_MODEL"
# Photo reading: Groq's vision model (a Preview model in November 2026 --
# Groq may retire it at short notice; set GROQ_VISION_MODEL to its
# successor, and Gemini covers the gap meanwhile).
GROQ_VISION_MODEL = "qwen/qwen3.8-27b"
GROQ_VISION_MODEL_ENV = "GROQ_VISION_MODEL"
# Images Groq's vision model takes in one request; more photos than this
# go straight to the next provider.
GROQ_MAX_IMAGES = 3
GROQ_MAX_IMAGES_ENV = "GROQ_MAX_IMAGES"
# Groq usually answers in seconds; capping its one attempt leaves Gemini
# most of TOTAL_BUDGET_SECONDS when it does stall.
GROQ_ATTEMPT_SECONDS = 25

# Schema Gemini must respond in -- one instructions entry per input part,
# in the same order, so _build_translated_instructions can re-associate
# each translated entry with the part name it came from purely by
# position within this one response (see that function for why the
# *returned* structure is then re-keyed by the original part name rather
# than trusting anything Gemini calls it).
_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "materials": {"type": "STRING"},
        "abbreviations": {"type": "STRING"},
        "instructions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "heading": {"type": "STRING"},
                    "steps": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
                "required": ["heading", "steps"],
            },
        },
    },
    "required": ["title", "materials", "abbreviations", "instructions"],
}

_PROMPT_TEMPLATE_TO_HEBREW = """\
You are translating a crochet/knitting pattern from English to Hebrew for \
Israeli crafters. Translate every field below into natural, correct \
Hebrew. Use standard Israeli crochet/knitting terminology for stitch \
names and abbreviations (e.g. single crochet, double crochet, chain, \
slip stitch) -- do not leave English abbreviations like 'sc'/'dc'/'ch' \
untranslated, and do not invent terminology that isn't standard. \
Preserve the exact structure: return exactly the same number of \
instruction entries, in the same order, with exactly the same number of \
steps in each entry as given below -- only translate the text itself.
{glossary_section}
Pattern JSON:
{pattern_json}
"""

_PROMPT_TEMPLATE_TO_ENGLISH = """\
You are translating a crochet/knitting pattern from Hebrew to English. \
Translate every field below into natural, correct English. Use standard \
English crochet/knitting stitch abbreviations (e.g. sc, dc, hdc, ch, sl \
st) rather than spelling out or transliterating the Hebrew stitch names. \
Preserve the exact structure: return exactly the same number of \
instruction entries, in the same order, with exactly the same number of \
steps in each entry as given below -- only translate the text itself.

Pattern JSON:
{pattern_json}
"""


class TranslationError(Exception):
    """Raised when a pattern couldn't be translated: missing API key, a
    failed API call, malformed glossary file, or a response that doesn't
    match the input structure (wrong part/step counts) -- see
    translate_pattern_to_hebrew/translate_pattern_to_english."""


def _load_glossary() -> dict[str, str]:
    """Re-read translation_glossary.json on every call (rather than once
    at import time) so edits to it take effect on the next translate
    request without a server restart."""
    if not GLOSSARY_PATH.exists():
        return {}
    try:
        with GLOSSARY_PATH.open(encoding="utf-8") as f:
            glossary = json.load(f)
    except (OSError, ValueError) as exc:
        raise TranslationError(f"translation_glossary.json is invalid: {exc}") from exc
    if not isinstance(glossary, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in glossary.items()
    ):
        raise TranslationError("translation_glossary.json must be a flat object of string: string")
    return glossary


def _build_glossary_section(glossary: dict[str, str]) -> str:
    if not glossary:
        return ""
    lines = "\n".join(f'- "{term}" -> "{hebrew}"' for term, hebrew in glossary.items())
    return (
        "\nUse exactly these Hebrew translations for the following terms "
        "whenever they appear, overriding your own judgment -- these are "
        f"confirmed corrections from a native-speaker review:\n{lines}\n"
    )


def _providers() -> list[str]:
    """The AI providers to try, in order: AI_PROVIDERS (default
    "groq,gemini"), keeping only the ones whose API key is set."""
    order = (os.environ.get(AI_PROVIDERS_ENV) or DEFAULT_AI_PROVIDERS).lower().split(",")
    names = dict.fromkeys(name.strip() for name in order)
    return [name for name in names if name in PROVIDER_KEYS and os.environ.get(PROVIDER_KEYS[name])]


def _call_model(prompt: str, *, images: list[bytes] | None = None, schema: dict | None = None) -> dict:
    """
    Send `prompt` (plus `images`, JPEG bytes, for photo reading) to the
    configured AI providers in order and return the parsed JSON response
    object ({title, materials, abbreviations, instructions} unless another
    `schema` is given). Shared by both translation directions and by photo
    transcription (transcription.py).

    Groq goes first when GROQ_API_KEY is set. Any Groq failure -- busy,
    rate-limited, over its free daily quota, too slow, a rejected request,
    an unusable answer -- moves on to Gemini, which then gets whatever is
    left of the same TOTAL_BUDGET_SECONDS. The chain works the same in any
    AI_PROVIDERS order: a failing provider hands over to the next, and one
    that isn't last leaves the next one time for an attempt. Raises
    TranslationError when no provider is configured or the last one fails.
    """
    providers = _providers()
    if not providers:
        raise TranslationError(
            "No AI provider is configured -- set GROQ_API_KEY and/or GEMINI_API_KEY. See README for setup."
        )
    deadline = _monotonic() + TOTAL_BUDGET_SECONDS
    for index, provider in enumerate(providers):
        later = providers[index + 1:]
        if provider == "gemini":
            # Followed by another provider: stop early enough for it to
            # get one attempt.
            own_deadline = deadline - GROQ_ATTEMPT_SECONDS if later else deadline
            try:
                return _call_gemini(prompt, images=images, schema=schema, deadline=own_deadline)
            except TranslationError as exc:
                if not later:
                    raise
                logger.warning("Gemini failed (%s); trying %s", exc, later[0])
                continue
        if images and len(images) > _groq_max_images():
            if not later:
                raise TranslationError(
                    f"Groq reads up to {_groq_max_images()} photos at a time and no other AI provider is "
                    f"configured -- got {len(images)}. Set GEMINI_API_KEY to read more at once."
                )
            logger.info("Groq takes up to %d photos, got %d; using %s", _groq_max_images(), len(images), later[0])
            continue
        try:
            return _call_groq(prompt, images=images, schema=schema, deadline=deadline, last=not later)
        except _ProviderFailed as exc:
            logger.warning("Groq %s failed (%s); trying %s", exc.model, exc.reason, later[0])
    raise TranslationError("No AI provider could take this request.")  # unreachable in practice


class _ProviderFailed(Exception):
    """A provider other than the last one in the chain failed; _call_model
    moves on to the next one."""

    def __init__(self, message: str, *, model: str, reason: str):
        super().__init__(message)
        self.model = model
        self.reason = reason


def _groq_max_images() -> int:
    try:
        return max(1, int(os.environ.get(GROQ_MAX_IMAGES_ENV) or GROQ_MAX_IMAGES))
    except ValueError:
        return GROQ_MAX_IMAGES


def _to_json_schema(schema: dict) -> dict:
    """Gemini's schema dialect ("OBJECT", "STRING", ...) as standard JSON
    Schema for Groq's strict mode: lowercase types, every property
    required and no extra ones (strict mode demands both)."""
    out = {"type": schema["type"].lower()}
    if "properties" in schema:
        out["properties"] = {name: _to_json_schema(sub) for name, sub in schema["properties"].items()}
        out["required"] = list(schema["properties"])
        out["additionalProperties"] = False
    if "items" in schema:
        out["items"] = _to_json_schema(schema["items"])
    return out


def _matches_schema(value, schema: dict) -> bool:
    """Whether `value` has the shape `schema` (Gemini's dialect) describes:
    the right types, and every required property present. Groq's JSON
    mode, used for photos, doesn't enforce the schema the way Gemini's
    responseSchema and Groq's strict mode do, so its answers are checked
    here -- a wrong shape counts as a provider failure and the next
    provider gets the request."""
    kind = schema["type"].upper()
    if kind == "OBJECT":
        properties = schema.get("properties", {})
        return isinstance(value, dict) and all(
            name in value and _matches_schema(value[name], properties[name])
            for name in schema.get("required", [])
        )
    if kind == "ARRAY":
        return isinstance(value, list) and all(_matches_schema(item, schema["items"]) for item in value)
    if kind == "STRING":
        return isinstance(value, str)
    return True


_THINKING = re.compile(r"<think>.*?</think>", re.DOTALL)


def _parse_json_answer(text: str) -> dict:
    """The JSON object in a chat answer. Reasoning models may wrap it in
    <think>...</think> or a code fence, so fall back to the outermost
    {...} when the whole text doesn't parse."""
    text = _THINKING.sub("", text).strip()
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start:end + 1])


def _call_groq(prompt: str, *, images: list[bytes] | None, schema: dict | None, deadline: float, last: bool) -> dict:
    """
    One provider in _call_model's chain: Groq's OpenAI-compatible chat
    API. When another provider follows (`last` false), Groq gets a single
    attempt capped at GROQ_ATTEMPT_SECONDS and any failure is handed back
    as _ProviderFailed, so the fallback keeps most of the time budget.
    As the only provider, a busy answer is retried until the deadline,
    and failures raise TranslationError.

    Translations ask for strict JSON Schema output; photo reading uses
    plain JSON mode, which is what Groq's vision models offer (the prompt
    spells out the {"text": ...} shape).
    """
    api_key = os.environ[PROVIDER_KEYS["groq"]]
    model = (os.environ.get(GROQ_VISION_MODEL_ENV) or GROQ_VISION_MODEL) if images else (
        os.environ.get(GROQ_MODEL_ENV) or GROQ_MODEL
    )
    if images:
        content = [{"type": "text", "text": prompt}] + [
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")}}
            for image in images
        ]
        response_format = {"type": "json_object"}
    else:
        content = prompt
        response_format = {
            "type": "json_schema",
            "json_schema": {"name": "answer", "strict": True, "schema": _to_json_schema(schema or _RESPONSE_SCHEMA)},
        }
    body = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "response_format": response_format,
        "temperature": 0.2,
    }
    if model.startswith("openai/gpt-oss"):
        # Less hidden reasoning, fewer tokens: the free plan counts tokens
        # per minute, and translation needs care, not deep thought.
        body["reasoning_effort"] = "low"

    def fail(reason: str, detail: str, cause: Exception | None = None):
        message = f"Groq API request failed ({model}): {detail.replace(api_key, '<redacted>')}"
        if last:
            raise TranslationError(message) from cause
        raise _ProviderFailed(message, model=model, reason=reason) from cause

    for attempt in range(MAX_RETRIES + 1):
        remaining = deadline - _monotonic()
        try:
            response = requests.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
                timeout=min(REQUEST_TIMEOUT_SECONDS if last else GROQ_ATTEMPT_SECONDS, remaining),
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            status = exc.response.status_code if exc.response is not None else None
            busy = status is None or status == 429 or status >= 500
            backoff = RETRY_BACKOFF_SECONDS * (attempt + 1)
            if not last or not busy or attempt == MAX_RETRIES or deadline - _monotonic() - backoff < MIN_ATTEMPT_SECONDS:
                fail(str(status or type(exc).__name__), str(exc), exc)
            time.sleep(backoff)
            continue
        try:
            answer = _parse_json_answer(response.json()["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            fail("unexpected response", f"unexpected response shape: {exc}", exc)
        if not _matches_schema(answer, schema or _RESPONSE_SCHEMA):
            fail("unexpected response", "the answer doesn't match the requested JSON shape")
        return answer
    fail("out of retries", "every retry failed")  # unreachable: the loop returns or fails


def _call_gemini(
    prompt: str, *, images: list[bytes] | None = None, schema: dict | None = None, deadline: float | None = None
) -> dict:
    """
    One provider in _call_model's chain (and the whole chain when Groq
    isn't configured): Gemini, alternating between its main and lite
    models on busy answers until `deadline` (default: a fresh
    TOTAL_BUDGET_SECONDS). Raises TranslationError if GEMINI_API_KEY isn't
    set, every retry is exhausted, or the response doesn't parse into the
    expected shape.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise TranslationError(
            "GEMINI_API_KEY is not set -- cannot translate. See README for setup."
        )

    image_parts = [
        {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode("ascii")}}
        for image in images or []
    ]
    primary = os.environ.get(GEMINI_MODEL_ENV) or GEMINI_MODEL
    fallback = os.environ.get(GEMINI_FALLBACK_MODEL_ENV) or GEMINI_FALLBACK_MODEL
    model = primary
    if deadline is None:
        deadline = _monotonic() + TOTAL_BUDGET_SECONDS
    response = None
    for attempt in range(MAX_RETRIES + 1):
        remaining = deadline - _monotonic()
        if model == primary and fallback != primary:
            # Leave the lite model at least one attempt's worth of time,
            # however much an earlier provider already used.
            limit = max(MIN_ATTEMPT_SECONDS, min(PRIMARY_ATTEMPT_SECONDS, remaining - MIN_ATTEMPT_SECONDS))
        else:
            limit = REQUEST_TIMEOUT_SECONDS
        try:
            response = requests.post(
                GEMINI_API_URL_TEMPLATE.format(model=model),
                # In a header, not the URL's ?key=: request URLs end up in
                # exception messages and tracebacks, headers don't.
                headers={"x-goog-api-key": api_key},
                json={
                    "contents": [{"parts": [{"text": prompt}, *image_parts]}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseSchema": schema or _RESPONSE_SCHEMA,
                    },
                },
                timeout=min(limit, remaining),
            )
            response.raise_for_status()
            break
        except requests.RequestException as exc:
            status = exc.response.status_code if exc.response is not None else None
            busy = status is None or status == 429 or status >= 500
            other = fallback if model == primary else primary
            switch = busy and other != model
            # The first switch needs no pause: the other model isn't the
            # one that just said it's overloaded. After that, both have
            # been busy, so wait a little longer each time.
            backoff = 0 if switch and attempt == 0 else RETRY_BACKOFF_SECONDS * (attempt if switch else attempt + 1)
            out_of_time = deadline - _monotonic() - backoff < MIN_ATTEMPT_SECONDS
            if not busy or attempt == MAX_RETRIES or out_of_time:
                raise TranslationError(
                    f"Gemini API request failed ({model}): {str(exc).replace(api_key, '<redacted>')}"
                ) from exc
            if switch:
                logger.warning("Gemini %s failed (%s); trying %s", model, status or type(exc).__name__, other)
                model = other
            time.sleep(backoff)

    try:
        raw_text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(raw_text)
    except (KeyError, IndexError, ValueError) as exc:
        raise TranslationError(f"Gemini returned an unexpected response shape: {exc}") from exc


def _build_translated_instructions(
    parts: list[tuple[str, list[str]]], translated_parts: list[dict], field_suffix: str
) -> dict:
    """
    Zip Gemini's positional `instructions` response back onto the
    original part names, validating part/step counts match along the way
    (a mismatch is a translation bug worth failing loudly on, not
    something to silently paper over -- see instructions_he/instructions_en's
    docstrings in models.py for why the key-preservation contract matters
    at all: checklist progress is keyed by the pattern's own primary part
    names, regardless of which language is displayed).

    `field_suffix` is "he" or "en" -- picks between {"heading_he":
    "steps_he": ...} and {"heading_en": "steps_en": ...} in the output,
    matching whichever of Pattern.instructions_he/instructions_en this
    call is populating.
    """
    if len(translated_parts) != len(parts):
        raise TranslationError(
            f"Translation returned {len(translated_parts)} instruction parts, "
            f"expected {len(parts)}."
        )

    result = {}
    for (part_name, steps), translated_part in zip(parts, translated_parts):
        translated_steps = translated_part.get("steps") or []
        if len(translated_steps) != len(steps):
            raise TranslationError(
                f"Translation returned {len(translated_steps)} steps for "
                f"'{part_name}', expected {len(steps)}."
            )
        result[part_name] = {
            f"heading_{field_suffix}": translated_part.get("heading") or part_name,
            f"steps_{field_suffix}": translated_steps,
        }
    return result


def translate_pattern_to_hebrew(
    title: str, materials: str | None, abbreviations: str | None, instructions: dict
) -> tuple[str, str | None, str | None, dict]:
    """
    Translate a pattern's (primary, presumed-English) content to Hebrew
    in a single API call -- one call rather than one per field, so stitch
    terminology stays consistent across the whole pattern and the
    part/step structure can be mirrored back exactly instead of
    translated piecemeal.

    `instructions` is the same {part_name: [step, ...]} shape stored on
    Pattern.instructions. Returns (title_he, materials_he,
    abbreviations_he, instructions_he), where instructions_he is keyed by
    the *same* part_name strings passed in -- never Gemini's own Hebrew
    heading text -- see Pattern.instructions_he's docstring in models.py.
    """
    parts = list(instructions.items())
    pattern_for_model = {
        "title": title or "",
        "materials": materials or "",
        "abbreviations": abbreviations or "",
        "instructions": [{"heading": name, "steps": steps} for name, steps in parts],
    }
    glossary_section = _build_glossary_section(_load_glossary())
    prompt = _PROMPT_TEMPLATE_TO_HEBREW.format(
        glossary_section=glossary_section,
        pattern_json=json.dumps(pattern_for_model, ensure_ascii=False, indent=2),
    )

    translated = _call_model(prompt)
    try:
        translated_parts = translated["instructions"]
    except KeyError as exc:
        raise TranslationError(f"Gemini returned an unexpected response shape: {exc}") from exc

    instructions_he = _build_translated_instructions(parts, translated_parts, "he")
    return (
        translated.get("title") or title,
        translated.get("materials") or materials,
        translated.get("abbreviations") or abbreviations,
        instructions_he,
    )


def translate_pattern_to_english(
    title: str, materials: str | None, abbreviations: str | None, instructions: dict
) -> tuple[str, str | None, str | None, dict]:
    """
    The reverse of translate_pattern_to_hebrew: translates a pattern's
    (primary, presumed-Hebrew) content to English in a single API call --
    for a pattern scraped from a Hebrew-language source page (see
    scraper.py's Hebrew keyword support), which needs an English overlay
    the same way an English-sourced pattern needs a Hebrew one.

    Returns (title_en, materials_en, abbreviations_en, instructions_en),
    with the same part-name-key-preservation contract as the Hebrew
    direction -- see Pattern.instructions_en's docstring in models.py.
    Doesn't use translation_glossary.json (see that file's docstring for
    why the English direction doesn't need one).
    """
    parts = list(instructions.items())
    pattern_for_model = {
        "title": title or "",
        "materials": materials or "",
        "abbreviations": abbreviations or "",
        "instructions": [{"heading": name, "steps": steps} for name, steps in parts],
    }
    prompt = _PROMPT_TEMPLATE_TO_ENGLISH.format(
        pattern_json=json.dumps(pattern_for_model, ensure_ascii=False, indent=2),
    )

    translated = _call_model(prompt)
    try:
        translated_parts = translated["instructions"]
    except KeyError as exc:
        raise TranslationError(f"Gemini returned an unexpected response shape: {exc}") from exc

    instructions_en = _build_translated_instructions(parts, translated_parts, "en")
    return (
        translated.get("title") or title,
        translated.get("materials") or materials,
        translated.get("abbreviations") or abbreviations,
        instructions_en,
    )
