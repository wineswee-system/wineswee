"""Vercel Serverless Function — POST /api/schedule

Body (JSON):
  {
    "store_id": 31,
    "organization_id": 1,
    "cycle_dates": ["2026-05-29", ..., "2026-06-25"]
  }

Response:
  {
    "success": true,
    "elapsed_ms": 1234,
    "assignments": [...],
    "violations": [...],
    "stats": {...}
  }
"""

import json
import sys
from pathlib import Path

# Vercel runtime 把 /api/*.py 跟 /scheduler/ 平行放，import 路徑要加 ..
sys.path.insert(0, str(Path(__file__).parent.parent))

from scheduler.solver import solve_schedule
from scheduler.data import gather_input


def handler(request):
    """Vercel Python serverless function handler."""
    if request.method == "OPTIONS":
        return _cors_response("", 204)
    if request.method != "POST":
        return _cors_response(json.dumps({"error": "Method not allowed"}), 405)

    try:
        body = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return _cors_response(json.dumps({"error": "Invalid JSON"}), 400)

    store_id = body.get("store_id")
    organization_id = body.get("organization_id")
    cycle_dates = body.get("cycle_dates")

    if not store_id or not cycle_dates or not isinstance(cycle_dates, list):
        return _cors_response(
            json.dumps({"error": "Required: store_id, cycle_dates (array)"}),
            400,
        )

    timeout = float(body.get("timeout_seconds", 25.0))  # Vercel hobby max 60s，留 buffer

    try:
        input_dict = gather_input(store_id, organization_id, cycle_dates)
        result = solve_schedule(input_dict, time_limit_seconds=timeout)
        return _cors_response(json.dumps(result, ensure_ascii=False), 200)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _cors_response(
            json.dumps({"error": str(e), "type": type(e).__name__}),
            500,
        )


def _cors_response(body: str, status: int):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": body,
    }
