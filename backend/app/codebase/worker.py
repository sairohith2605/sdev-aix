import logging
import time

from app.codebase.models import RepositoryConnectRequest
from app.codebase.store import RepositoryStore
from app.config import Settings, get_settings
from app.errors import RepositoryError
from app.services.repositories import RepositoryService

logger = logging.getLogger(__name__)


class RepositoryWorker:
    def __init__(self, settings: Settings) -> None:
        self.store = RepositoryStore(settings.sqlite_path)
        self.service = RepositoryService(settings, self.store)

    def process_one(self) -> bool:
        job = self.store.claim()
        if job is None:
            return False
        try:
            index = self.service.inspect(
                RepositoryConnectRequest(
                    path=job["path"],
                    includeUncommitted=bool(job["include_uncommitted"]),
                ),
                progress=lambda completed, total: self.store.progress(
                    job["id"], completed, total
                ),
            )
            self.store.save_index(index, job["id"])
        except RepositoryError as error:
            self.store.fail(job["id"], error.code)
            logger.warning("Repository indexing failed: %s", error.code)
        except Exception as error:
            self.store.fail(job["id"], "REPOSITORY_INDEX_FAILED")
            logger.error("Repository indexing failed (%s)", type(error).__name__)
        return True

    def run(self) -> None:
        self.store.recover()
        while True:
            if not self.process_one():
                time.sleep(1)


if __name__ == "__main__":
    try:
        RepositoryWorker(get_settings()).run()
    except KeyboardInterrupt:
        pass
