import asyncio
import json
import re
from pathlib import Path
from typing import Any

from copilot import CopilotClient
from copilot.rpc import PermissionDecisionReject
from copilot.session_events import AssistantMessageData
from pydantic import ValidationError

from app.planning.analysis import StoryAnalysis, analysis_prompt


class CopilotAnalysisError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _deny_tools(request: Any, invocation: dict) -> PermissionDecisionReject:
    return PermissionDecisionReject(
        feedback="Tools are not available in story analysis."
    )


_JSON_FENCE = re.compile(r"^```(?:json)?\s*\n([\s\S]*?)\n```$", re.IGNORECASE)


def _parse_analysis(content: str) -> StoryAnalysis:
    text = content.strip()
    match = _JSON_FENCE.fullmatch(text)
    if match:
        text = match.group(1).strip()
    return StoryAnalysis.model_validate(json.loads(text))


def _safe_validation_reason(error: ValidationError) -> str:
    first = error.errors()[0]
    field = first["loc"][0] if first["loc"] else "root"
    if field not in {"root", "goal", "facts", "gaps", "assumptions", "questions"}:
        field = "schema"
    return f"schema {field}: {first['type']}"


class CopilotAnalysisProvider:
    def __init__(self, model: str, timeout: float, data_path: Path) -> None:
        self.model = model
        self.timeout = timeout
        self.data_path = data_path

    async def analyze(self, work_item: dict, pat: str) -> StoryAnalysis:
        if not pat.strip():
            raise CopilotAnalysisError(
                "COPILOT_PAT_REQUIRED", "Set COPILOT_GITHUB_TOKEN to run the probe."
            )

        try:
            self.data_path.mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError:
            raise CopilotAnalysisError(
                "COPILOT_STORAGE_UNAVAILABLE",
                "The backend cannot write its private Copilot runtime directory.",
            ) from None
        prompt = analysis_prompt(work_item)
        try:
            async with asyncio.timeout(self.timeout * 2 + 30):
                async with CopilotClient(
                    github_token=pat,
                    use_logged_in_user=False,
                    mode="empty",
                    log_level="error",
                    working_directory=str(self.data_path),
                    base_directory=str(self.data_path),
                ) as client:
                    async with await client.create_session(
                        model=self.model,
                        available_tools=[],
                        on_permission_request=_deny_tools,
                        enable_skills=False,
                        enable_session_store=False,
                        infinite_sessions={"enabled": False},
                        skip_custom_instructions=True,
                    ) as session:
                        reason = "no assistant message"
                        for attempt in range(2):
                            response = await session.send_and_wait(
                                prompt, timeout=self.timeout
                            )
                            if response and isinstance(
                                response.data, AssistantMessageData
                            ):
                                try:
                                    return _parse_analysis(response.data.content)
                                except json.JSONDecodeError:
                                    reason = "invalid JSON"
                                except ValidationError as error:
                                    reason = _safe_validation_reason(error)
                            if attempt == 0:
                                prompt = (
                                    "The previous response was not valid JSON matching "
                                    "the requested schema. Return ONLY the corrected "
                                    "JSON object. Do not add any other text."
                                )
        except TimeoutError:
            raise CopilotAnalysisError(
                "COPILOT_TIMEOUT", "Copilot did not finish within the time limit."
            ) from None
        except CopilotAnalysisError:
            raise
        except Exception as error:
            detail = str(error).lower()
            if re.search(r"\b401\b|unauthorized|invalid token", detail):
                raise CopilotAnalysisError(
                    "COPILOT_UNAUTHORIZED",
                    "GitHub rejected the Copilot PAT. Check that it is valid and has "
                    "the Copilot Requests permission.",
                ) from None
            if re.search(r"\b403\b|forbidden|policy", detail):
                raise CopilotAnalysisError(
                    "COPILOT_FORBIDDEN",
                    "GitHub denied Copilot access. Check your Copilot entitlement "
                    "and organization policy.",
                ) from None
            raise CopilotAnalysisError(
                "COPILOT_REQUEST_FAILED",
                "Copilot could not complete the analysis. Check the PAT's Copilot "
                "Requests permission, your Copilot access, and organization policy.",
            ) from None

        raise CopilotAnalysisError(
            "COPILOT_INVALID_OUTPUT",
            "Copilot did not return a valid story analysis after two attempts "
            f"({reason}).",
        )
