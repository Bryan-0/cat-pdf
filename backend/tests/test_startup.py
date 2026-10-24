"""Process-level startup behaviour the desktop app relies on."""
import os
import socket
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ENV = {**os.environ, "CATPDF_TOKEN": "t"}


def start(*args, **kw):
    return subprocess.Popen([sys.executable, "-m", "catpdf", *args], cwd=BACKEND_DIR, env=ENV,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **kw)


def test_port_zero_reports_the_real_port():
    p = start("--port", "0", "--exit-with-stdin", stdin=subprocess.PIPE)
    try:
        line = p.stdout.readline().strip()
        assert line.startswith("CATPDF_READY ")
        assert int(line.split()[1]) > 0
    finally:
        p.stdin.close()
        p.wait(timeout=10)


def test_busy_port_exits_with_code_3():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        p = start("--port", str(s.getsockname()[1]))
        out, err = p.communicate(timeout=30)
    assert p.returncode == 3
    assert "CATPDF_READY" not in out
    assert "bind" in err.lower()


def test_exits_when_parent_closes_stdin():
    p = start("--port", "0", "--exit-with-stdin", stdin=subprocess.PIPE)
    assert p.stdout.readline().startswith("CATPDF_READY")
    p.stdin.close()
    assert p.wait(timeout=10) == 0


def test_busy_port_with_parent_watch_exits_cleanly_with_code_3():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        p = start("--port", str(s.getsockname()[1]), "--exit-with-stdin", stdin=subprocess.PIPE)
        code = p.wait(timeout=30)  # stdin stays open, as it does under the desktop app
    err = p.stderr.read()
    p.stdin.close()
    assert code == 3
    assert "Fatal Python error" not in err
