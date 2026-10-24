"""Entry point: ``python -m catpdf --port N [--host 127.0.0.1] [--dev]``.

Reads the API token from the ``CATPDF_TOKEN`` environment variable and prints
``CATPDF_READY <port>`` to stdout once the server is listening.
"""
from __future__ import annotations

import argparse
import logging
import os
import secrets
import sys
import threading

import uvicorn

from .server import create_app

EXIT_PORT_BUSY = 3  # must match app/main.js


class ReadyServer(uvicorn.Server):
    """uvicorn server that announces readiness on stdout (Electron waits for this line)."""

    async def startup(self, sockets=None):
        await super().startup(sockets=sockets)
        if self.should_exit or not getattr(self, "started", True):
            return
        port = self.config.port
        try:
            for server in getattr(self, "servers", []):
                for sock in server.sockets:
                    port = sock.getsockname()[1]
                    break
        except Exception:
            pass
        print(f"CATPDF_READY {port}", flush=True)


def _exit_when_stdin_closes() -> None:
    try:
        while sys.stdin.buffer.read(1024):
            pass
    except Exception:
        pass
    os._exit(0)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="catpdf", description="Cat PDF local backend")
    parser.add_argument("--port", type=int, default=8765, help="port to listen on (0 = any free port)")
    parser.add_argument("--host", default="127.0.0.1", help="interface to bind (default 127.0.0.1)")
    parser.add_argument("--dev", action="store_true", help="disable the token check (manual testing)")
    parser.add_argument("--exit-with-stdin", action="store_true",
                        help="exit when stdin closes (the desktop app keeps a pipe open; if the app "
                             "dies, even without a clean shutdown, the backend follows it)")
    args = parser.parse_args(argv)

    if args.exit_with_stdin:
        threading.Thread(target=_exit_when_stdin_closes, daemon=True, name="parent-watch").start()

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    logging.basicConfig(level=logging.INFO if args.dev else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)

    token = os.environ.get("CATPDF_TOKEN", "")
    if not token and not args.dev:
        token = secrets.token_hex(24)
        print("WARNING: CATPDF_TOKEN is not set; all requests will be rejected. "
              "Set CATPDF_TOKEN or use --dev for manual testing.", file=sys.stderr, flush=True)

    app = create_app(token=token, dev=args.dev)
    config = uvicorn.Config(app, host=args.host, port=args.port,
                            log_level="info" if args.dev else "warning",
                            access_log=args.dev, lifespan="off")
    server = ReadyServer(config)
    try:
        server.run()
        code = 0 if getattr(server, "started", False) else EXIT_PORT_BUSY
    except SystemExit as exc:
        # uvicorn exits with its STARTUP_FAILURE (3) when it can't bind the port; the desktop
        # app treats EXIT_PORT_BUSY as "try another port".
        code = exc.code if isinstance(exc.code, int) else EXIT_PORT_BUSY
    if args.exit_with_stdin:
        # The watcher thread is blocked reading stdin; a normal interpreter shutdown would
        # crash on that lock, so leave immediately with the right exit code.
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(code)
    return code


if __name__ == "__main__":
    sys.exit(main())
