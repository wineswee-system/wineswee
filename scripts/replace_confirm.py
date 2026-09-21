"""一次性 script：把 src/ 下所有 confirm(...) 換成 (await confirm({ message: ... }))
並自動加 import { confirm } from '<rel>/lib/confirm'

跳過：
- src/lib/confirm.js（自己 export 的）
- src/components/ConfirmDialog.jsx（這個檔本來就是 confirm 對話框）
- 'window.confirm(' 不替換（保留原生 confirm 給特殊情況用）

不會把外層 function 自動加 async — build 會 catch 沒 async 的，逐一補。
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
SKIP = {SRC / "lib" / "confirm.js", SRC / "components" / "ConfirmDialog.jsx"}


def find_files():
    out = []
    for root, dirs, files in os.walk(SRC):
        # 跳過 node_modules / __tests__
        dirs[:] = [d for d in dirs if d not in ("node_modules", "__tests__")]
        for f in files:
            if not f.endswith((".jsx", ".js", ".tsx", ".ts", ".mjs")):
                continue
            full = Path(root) / f
            if full in SKIP:
                continue
            out.append(full)
    return out


def relative_to_confirm(file_path: Path) -> str:
    confirm_dir = SRC / "lib"
    rel = os.path.relpath(confirm_dir, file_path.parent)
    rel = rel.replace("\\", "/")
    if not rel.startswith("."):
        rel = "./" + rel
    return rel + "/confirm"


def find_confirm_calls(text: str):
    """yield (start_idx, end_idx, arg_text) for each `confirm(...)` 不含 'window.confirm(' """
    i = 0
    n = len(text)
    while i < n:
        idx = text.find("confirm(", i)
        if idx < 0:
            return
        # 排除 'window.confirm(' / '.confirm(' (object method) / 'confirm(' literal
        if idx >= 1:
            prev = text[idx - 1]
            if prev == ".":
                # 是 method call (e.g. window.confirm)
                i = idx + 1
                continue
            # 排除 part of identifier (e.g. unconfirm)
            if prev.isalnum() or prev == "_":
                i = idx + 1
                continue
        # 排除 import { confirm } from / export function confirm — 用簡單匹配
        # 看前 30 字元有沒有 import / export / function 關鍵字
        ctx = text[max(0, idx - 30):idx]
        if re.search(r"\bimport\b", ctx) or re.search(r"\bfunction\s+$", ctx):
            i = idx + 1
            continue

        # 找匹配的 )
        depth = 0
        j = idx + len("confirm(")
        # 進入 depth=1
        depth = 1
        in_str = None  # ''', '"', '`'
        escape = False
        while j < n and depth > 0:
            ch = text[j]
            if escape:
                escape = False
            elif in_str:
                if ch == "\\":
                    escape = True
                elif ch == in_str:
                    in_str = None
            else:
                if ch in ('"', "'", "`"):
                    in_str = ch
                elif ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        if depth != 0:
            # 配對失敗，跳過
            i = idx + 1
            continue
        arg = text[idx + len("confirm("):j]
        yield (idx, j + 1, arg)
        i = j + 1


def transform(text: str):
    matches = list(find_confirm_calls(text))
    if not matches:
        return text, 0
    # 從後往前替換以免 index 失效
    for start, end, arg in reversed(matches):
        replacement = f"(await confirm({{ message: {arg.strip()} }}))"
        text = text[:start] + replacement + text[end:]
    return text, len(matches)


def add_import(text: str, import_path: str) -> str:
    if re.search(r"from ['\"][^'\"]*\/lib\/confirm['\"]", text):
        return text
    stmt = f"import {{ confirm }} from '{import_path}'\n"
    # 找最後一行 import
    m = list(re.finditer(r"^(import\s.+?from\s+['\"][^'\"]+['\"];?)\s*\n", text, flags=re.M))
    if m:
        last = m[-1]
        return text[:last.end()] + stmt + text[last.end():]
    return stmt + text


total_files = 0
total_replacements = 0

for f in find_files():
    src = f.read_text(encoding="utf-8")
    if "confirm(" not in src:
        continue
    new, count = transform(src)
    if count == 0:
        continue
    new = add_import(new, relative_to_confirm(f))
    f.write_text(new, encoding="utf-8")
    total_files += 1
    total_replacements += count
    rel = f.relative_to(ROOT).as_posix()
    print(f"OK {rel}  ({count})")

print(f"\nDone. {total_replacements} confirm calls replaced across {total_files} files.")
