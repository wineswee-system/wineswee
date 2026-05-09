"""掃 src/ 找含 await confirm 的 function，自動加 async 關鍵字

Heuristic：對每個含 'await confirm' 的行，往上找最近的：
  - `const NAME = (...) => {` / `const NAME = arg => {` -> 'const NAME = async (...) => {'
  - `let NAME = ... => {`
  - `function NAME(...) {` -> 'async function NAME(...) {'
  - `NAME(...) {` (class method) -> 'async NAME(...) {'
  - 有些 onClick={() => { ... }} 內聯 arrow，也要處理

只處理還沒 async 的函式。
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

# 開頭有 'async' 就跳過
PATTERNS = [
    # const NAME = (...) => {
    re.compile(r"^(\s*)(const|let|var)\s+(\w+)\s*=\s*(\(.*?\)|\w+)\s*=>\s*\{"),
    # NAME = (...) => {  (class field)
    re.compile(r"^(\s*)(\w+)\s*=\s*(\(.*?\)|\w+)\s*=>\s*\{"),
    # function NAME(...)
    re.compile(r"^(\s*)function\s+(\w+)\s*\("),
    # NAME(...) { (object/class method)
    re.compile(r"^(\s*)(\w+)\s*\([^)]*\)\s*\{"),
    # onClick={() => { ... }} 內聯
    re.compile(r"=\s*\{\s*\(\s*\)\s*=>\s*\{"),
]


def find_files():
    out = []
    for root, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "__tests__")]
        for f in files:
            if f.endswith((".jsx", ".js", ".tsx", ".ts", ".mjs")):
                out.append(Path(root) / f)
    return out


def add_async_to_file(path: Path) -> int:
    content = path.read_text(encoding="utf-8")
    if "await confirm(" not in content:
        return 0

    lines = content.split("\n")
    n = len(lines)

    # 對每個含 'await confirm(' 的行，往上找最近的 function 開頭
    changes = []
    for i, line in enumerate(lines):
        if "await confirm(" not in line:
            continue
        # 往上找
        for j in range(i, -1, -1):
            up = lines[j]
            # const/let/var = (...) => { 模式
            m = re.match(r"^(\s*)(const|let|var)\s+(\w+)\s*=\s*(\(.*?\)|\w+)\s*=>\s*\{", up)
            if m:
                indent, kw, name, params = m.group(1), m.group(2), m.group(3), m.group(4)
                # 已是 async 跳過
                full = up
                if re.search(r"=\s*async\s*", full):
                    break
                # insert async after =
                new = re.sub(r"=\s*", "= async ", full, count=1)
                # 但這會把 'name =' 變成 'name = async '，正確
                # 重新檢查：避免 'const a = b' 也被改
                # 因為我們有 '=> {' 確認，所以是 arrow function
                changes.append((j, full, new))
                break
            # function declaration
            m = re.match(r"^(\s*)function\s+(\w+)", up)
            if m and "async function" not in up:
                new = re.sub(r"\bfunction\b", "async function", up, count=1)
                changes.append((j, up, new))
                break
            # NAME(...) { class/object method
            m = re.match(r"^(\s*)(\w+)\s*\([^)]*\)\s*\{\s*$", up)
            if m:
                kw = m.group(2)
                # 跳過 if/while/for/switch
                if kw in ("if", "while", "for", "switch", "catch", "do"):
                    continue
                # 檢查是不是已經 async
                if re.match(r"^\s*async\s+", up):
                    break
                new = re.sub(r"^(\s*)", r"\1async ", up, count=1)
                changes.append((j, up, new))
                break
            # arrow without const: => { (e.g. .then(() => {...await confirm}))
            m = re.match(r"^(.*?)(\(.*?\)|\w+)\s*=>\s*\{", up)
            if m:
                # 檢查是否 async
                if re.search(r"async\s*(\(.*?\)|\w+)\s*=>", up):
                    break
                # insert async before parameters
                new = re.sub(r"((?:\([^)]*\)|\w+)\s*=>\s*\{)", r"async \1", up, count=1)
                changes.append((j, up, new))
                break

    if not changes:
        return 0

    # 去重 + apply
    seen = set()
    for j, old, new in changes:
        if j in seen:
            continue
        seen.add(j)
        lines[j] = new

    path.write_text("\n".join(lines), encoding="utf-8")
    return len(seen)


total = 0
for f in find_files():
    n = add_async_to_file(f)
    if n:
        rel = f.relative_to(ROOT).as_posix()
        print(f"OK {rel}  ({n})")
        total += n

print(f"\nDone. {total} functions made async.")
