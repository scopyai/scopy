from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import uvicorn
from ddgs import DDGS
from ddgs.exceptions import DDGSException
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from loguru import logger


DEFAULT_ADDR = "127.0.0.1:8080"
HEARTBEAT_SECONDS = 5
app = FastAPI()
heartbeat_task: asyncio.Task[None] | None = None


@dataclass
class RequestState:
    in_flight: int = 0
    total_started: int = 0
    total_finished: int = 0
    last_activity_at: float = time.monotonic()


request_state = RequestState()


@dataclass(slots=True)
class SearchRequest:
    query: str
    backend: str = "google"
    profile: str = ""
    proxy_url: str = ""
    region: str = "us-en"
    safesearch: str = "moderate"
    timelimit: str = ""
    page: int = 1
    max_results: int = 10

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SearchRequest":
        return cls(
            query=str(payload.get("query") or "").strip(),
            backend=normalize_backend(payload.get("backend")),
            profile=str(payload.get("profile") or "").strip(),
            proxy_url=str(payload.get("proxyUrl") or "").strip(),
            region=str(payload.get("region") or "us-en").strip().lower(),
            safesearch=str(payload.get("safesearch") or "moderate").strip().lower(),
            timelimit=str(payload.get("timelimit") or "").strip().lower(),
            page=positive_int(payload.get("page"), 1),
            max_results=positive_int(payload.get("maxResults"), 10),
        )


def positive_int(value: Any, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if parsed > 0 else fallback


def normalize_backend(value: Any) -> str:
    backend = str(value or "").strip().lower()
    if not backend or backend == "auto":
        return "google"
    return backend


def search_text(req: SearchRequest) -> list[dict[str, Any]]:
    client_kwargs: dict[str, Any] = {"timeout": 20}
    if req.proxy_url:
        client_kwargs["proxy"] = req.proxy_url

    try:
        results = DDGS(**client_kwargs).text(
            req.query,
            region=req.region,
            safesearch=req.safesearch,
            timelimit=req.timelimit or None,
            max_results=req.max_results,
            page=req.page,
            backend=req.backend,
        )
    except DDGSException as exc:
        if str(exc).strip() == "No results found.":
            logger.warning("search no_results query={!r} backend={}", req.query, req.backend)
            return []
        raise

    output: list[dict[str, Any]] = []
    for item in results or []:
        output.append(
            {
                "title": str(item.get("title") or ""),
                "href": str(item.get("href") or item.get("url") or ""),
                "body": str(item.get("body") or ""),
                "engine": str(item.get("engine") or item.get("provider") or item.get("source") or ""),
                "provider": str(item.get("provider") or item.get("source") or item.get("engine") or ""),
            }
        )
    return output


async def read_json(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise ValueError(str(exc)) from exc
    except UnicodeDecodeError as exc:
        raise ValueError(str(exc)) from exc

    if not isinstance(payload, dict):
        raise ValueError("request body must be a JSON object")
    return payload


@app.middleware("http")
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    request_state.in_flight += 1
    request_state.total_started += 1
    request_state.last_activity_at = time.monotonic()
    request_id = request_state.total_started

    logger.info(
        "request started id={} method={} path={} pending={}",
        request_id,
        request.method,
        request.url.path,
        request_state.in_flight,
    )

    try:
        response = await call_next(request)
    except Exception:
        request_state.in_flight -= 1
        request_state.total_finished += 1
        request_state.last_activity_at = time.monotonic()
        logger.exception(
            "request failed id={} method={} path={} pending={}",
            request_id,
            request.method,
            request.url.path,
            request_state.in_flight,
        )
        raise

    request_state.in_flight -= 1
    request_state.total_finished += 1
    request_state.last_activity_at = time.monotonic()
    logger.info(
        "request finished id={} method={} path={} status={} pending={}",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        request_state.in_flight,
    )
    return response


@app.on_event("startup")
async def log_startup() -> None:
    global heartbeat_task
    logger.info("starting server addr={}", os.getenv("SCRAPER_ADDR", DEFAULT_ADDR))
    heartbeat_task = asyncio.create_task(log_heartbeat())


@app.on_event("shutdown")
async def log_shutdown() -> None:
    global heartbeat_task
    if heartbeat_task is not None:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        heartbeat_task = None
    logger.info(
        "shutting down pending={} started={} finished={}",
        request_state.in_flight,
        request_state.total_started,
        request_state.total_finished,
    )


@app.get("/healthz")
async def healthz() -> JSONResponse:
    return JSONResponse({"ok": True})


@app.post("/search")
async def search(request: Request):  # type: ignore[no-untyped-def]
    try:
        payload = await read_json(request)
    except ValueError as exc:
        return PlainTextResponse(str(exc), status_code=400)

    req = SearchRequest.from_payload(payload)
    if not req.query:
        return PlainTextResponse("query is required", status_code=400)

    logger.info(
        "search query={!r} backend={} region={} safesearch={} timelimit={} page={} max_results={}",
        req.query,
        req.backend,
        req.region,
        req.safesearch,
        req.timelimit or "-",
        req.page,
        req.max_results,
    )

    try:
        results = search_text(req)
    except DDGSException as exc:
        logger.warning("search ddgs_error query={!r} error={}", req.query, exc)
        return PlainTextResponse(str(exc), status_code=502)
    except Exception as exc:  # noqa: BLE001
        logger.exception("search failed")
        return PlainTextResponse(str(exc), status_code=502)

    logger.info("search results={}", len(results))
    return JSONResponse({"status": 200, "results": results})


async def log_heartbeat() -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        idle_for = round(time.monotonic() - request_state.last_activity_at, 1)
        if request_state.in_flight == 0:
            logger.info(
                "heartbeat state=idle pending=0 started={} finished={} idle_for={}s",
                request_state.total_started,
                request_state.total_finished,
                idle_for,
            )
        else:
            logger.info(
                "heartbeat state=busy pending={} started={} finished={} active_for={}s",
                request_state.in_flight,
                request_state.total_started,
                request_state.total_finished,
                idle_for,
            )


def parse_addr(value: str) -> tuple[str, int]:
    addr = (value or DEFAULT_ADDR).strip()
    if ":" not in addr:
        return "127.0.0.1", int(addr)
    host, port = addr.rsplit(":", 1)
    return host or "127.0.0.1", int(port)


def main() -> None:
    logger.remove()
    logger.add(
        os.sys.stderr,
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="{time:YYYY-MM-DD HH:mm:ss} {level} {message}",
    )

    host, port = parse_addr(os.getenv("SCRAPER_ADDR", DEFAULT_ADDR))
    uvicorn.run(app, host=host, port=port, log_config=None)


if __name__ == "__main__":
    main()
