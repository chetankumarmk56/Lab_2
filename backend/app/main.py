"""FastAPI entrypoint — serves the lab APIs and (in production) the built frontend."""
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")  # must run before importing modules that read config

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from .routers import lab1, lab2, lab3  # noqa: E402

app = FastAPI(title="Agentic AI Onboarding Labs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(lab1.router)
app.include_router(lab2.router)
app.include_router(lab3.router)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


# Serve the built frontend if it exists (production single-app mode).
_frontend_dist = ROOT_DIR / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")
