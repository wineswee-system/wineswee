"""Local CLI — 用 JSON fixture 驗證 solver。

用法：
    python -m scheduler.cli fixtures/cycle_b.json
    python -m scheduler.cli fixtures/cycle_b.json --output out.json
"""

import json
import sys
import argparse
from pathlib import Path
from .solver import solve_schedule


def main():
    parser = argparse.ArgumentParser(description="排班 solver CLI")
    parser.add_argument("input", help="JSON fixture path")
    parser.add_argument("--output", "-o", help="輸出 JSON 路徑 (預設 stdout)")
    parser.add_argument("--timeout", type=float, default=30.0, help="解題時限（秒）")
    parser.add_argument("--pretty", action="store_true", help="格式化 stdout 顯示")
    args = parser.parse_args()

    in_path = Path(args.input)
    if not in_path.exists():
        print(f"❌ Input not found: {in_path}", file=sys.stderr)
        sys.exit(1)

    with open(in_path, "r", encoding="utf-8") as f:
        input_dict = json.load(f)

    print(f"▶ Solving {in_path.name}... (timeout={args.timeout}s)", file=sys.stderr)
    result = solve_schedule(input_dict, time_limit_seconds=args.timeout)

    # Console summary
    success = result["success"]
    elapsed = result["elapsed_ms"]
    assigns = result["assignments"]
    violations = result["violations"]
    stats = result["stats"]

    print(f"\n{'✓' if success else '✗'} success={success}  elapsed={elapsed}ms", file=sys.stderr)
    print(f"  assignments: {len(assigns)} 筆", file=sys.stderr)
    print(f"  violations:  {len(violations)} 筆", file=sys.stderr)

    if args.pretty and violations:
        print("\n--- Violations ---", file=sys.stderr)
        for v in violations:
            print(f"  [{v['constraint']}] emp_id={v['employee_id']}  {v['message']}", file=sys.stderr)

    if args.pretty:
        print("\n--- Stats ---", file=sys.stderr)
        print(f"  cycle target: FT={stats['ft_cycle_target']} / PT={stats['pt_cycle_target']}", file=sys.stderr)
        print(f"  rest count by emp:", file=sys.stderr)
        for name, cnt in stats["rest_count_by_emp"].items():
            print(f"    {name}: {cnt} 天", file=sys.stderr)
        print(f"  work hours by emp:", file=sys.stderr)
        for name, h in stats["work_hours_by_emp"].items():
            print(f"    {name}: {h:.1f}h", file=sys.stderr)

    # Output to file or stdout
    json_out = json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None)
    if args.output:
        Path(args.output).write_text(json_out, encoding="utf-8")
        print(f"\n→ {args.output}", file=sys.stderr)
    else:
        print(json_out)


if __name__ == "__main__":
    main()
