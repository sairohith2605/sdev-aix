from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.connections import router as connections_router
from app.api.work_items import router as work_items_router
from app.config import get_settings

settings = get_settings()

app = FastAPI(title="sdev-aix API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)
app.include_router(connections_router, prefix="/api")
app.include_router(work_items_router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
