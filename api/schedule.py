"""Vercel Serverless Function — POST /api/schedule

Body (JSON):
  {
    "store_id": 31,
    "organization_id": 1,
    "cycle_dates": ["2026-05-29", ..., "2026-06-25"],
    "timeout_seconds": 25
  }

Response:
  {
    "success": true,
    "elapsed_ms": 1234,
    "assignments": [...],
    "violations": [...],
    "stats": {...}
  }

注：Vercel Python runtime 使用 BaseHTTPRequestHandler subclass named `handler`
參考：https://vercel.com/docs/functions/runtimes/python
"""

import json
import sys
import traceback
from pathlib import Path
from http.server import BaseHTTPRequestHandler

# Vercel 把 /api/*.py 跟 /scheduler/ 平行放，import 路徑要加 ..
sys.path.insert(0, str(Path(__file__).parent.parent))

from scheduler.solver import solve_schedule  # noqa: E402
from scheduler.data import gather_input      # noqa: E402


class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict | str):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False)
        self.wfile.write(body.encode("utf-8"))

    def do_OPTIONS(self):
        self._send(204, "")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            body = json.loads(raw or "{}")
        except (json.JSONDecodeError, ValueError) as e:
            self._send(400, {"error": f"Invalid JSON: {e}"})
            return

        store_id = body.get("store_id")
        organization_id = body.get("organization_id")
        cycle_dates = body.get("cycle_dates")

        if not store_id or not cycle_dates or not isinstance(cycle_dates, list):
            self._send(400, {"error": "Required: store_id, cycle_dates (array)"})
            return

        timeout = float(body.get("timeout_seconds", 25.0))

        try:
            input_dict = gather_input(store_id, organization_id, cycle_dates)
            result = solve_schedule(input_dict, time_limit_seconds=timeout)
            self._send(200, result)
        except Exception as e:
            tb = traceback.format_exc()
            print(f"[/api/schedule] ERROR: {e}\n{tb}", file=sys.stderr)
            self._send(500, {
                "error": str(e),
                "type": type(e).__name__,
                "traceback": tb.splitlines()[-10:],  # 最後 10 行
            })

    def do_GET(self):
        """Health check"""
        self._send(200, {"status": "ok", "service": "scheduler-v2"})
