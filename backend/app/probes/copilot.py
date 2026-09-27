import argparse
import asyncio
import os
import sys

from app.config import get_settings
from app.dependencies import get_connection_service
from app.errors import ConnectorError
from app.providers.copilot import CopilotAnalysisError, CopilotAnalysisProvider
from app.services.work_items import WorkItemService


async def probe(work_item_id: int) -> int:
    token = os.environ.get("COPILOT_GITHUB_TOKEN", "")
    if not token.strip():
        print(
            "COPILOT_PAT_REQUIRED: Set COPILOT_GITHUB_TOKEN "
            "in the backend environment.",
            file=sys.stderr,
        )
        return 2

    settings = get_settings()
    try:
        record, ado_client = get_connection_service(settings).active()
        story = await WorkItemService(
            ado_client,
            record["project_id"],
            record["project_name"],
            record["team_id"],
        ).get(work_item_id)
        result = await CopilotAnalysisProvider(
            settings.copilot_model,
            settings.copilot_timeout_seconds,
            settings.copilot_home,
        ).analyze(story, token)
    except (ConnectorError, CopilotAnalysisError) as error:
        code = error.code
        print(f"{code}: {error}", file=sys.stderr)
        return 1

    print(result.model_dump_json(indent=2))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze one ADO story with Copilot")
    parser.add_argument("--work-item-id", type=int, required=True)
    args = parser.parse_args()
    if args.work_item_id < 1:
        parser.error("--work-item-id must be a positive integer")
    raise SystemExit(asyncio.run(probe(args.work_item_id)))


if __name__ == "__main__":
    main()
