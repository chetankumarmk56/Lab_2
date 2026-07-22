"""FastAPI entrypoint — serves the lab APIs and (in production) the built frontend."""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")  # must run before importing modules that read config

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from .routers import lab1, lab2, lab3, lab4  # noqa: E402

log = logging.getLogger("agentic_labs")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Auto-seed the database on startup (idempotent — never drops existing data).
    try:
        from db.seed import ensure_seeded  # top-level `db` package on PYTHONPATH

        await asyncio.to_thread(ensure_seeded)
        log.info("Database bootstrap complete.")
    except Exception:
        log.exception("Database auto-seed failed on startup; continuing to boot.")
    yield


app = FastAPI(title="Agentic AI Onboarding Labs", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lab1.router)
app.include_router(lab2.router)
app.include_router(lab3.router)
app.include_router(lab4.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


# Serve the built frontend if it exists (production single-app mode).
_frontend_dist = ROOT_DIR / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
