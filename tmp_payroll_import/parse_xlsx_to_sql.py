"""
從 xlsx 排班總表 → 乾淨 SQL。
解決原 CSV parser 的 cell-內換行 bug。
"""
import openpyxl, re, os
from collections import Counter

SRC = 'tmp_payroll_import/source_schedule_202604.xlsx'
OUT_DIR = 'tmp_payroll_import'
ORG_ID = 1
BATCH = 400

# 部門 → source_store (餐廳對應店；非餐廳 = None)
DEPT_TO_STORE = {
    '中信南港門市': '南港',
    '中山國小門市': '中山',
    '台中英才門市': '英才',
    '台中文心門市': '文心',
    '台北永春門市': '永春',
    '微風百貨門市': '微風',
    '南京建國門市': '南京',
    '高雄中正門市': '高雄',
    '天母門市': '天母',
    '松江長安門市': '松江',
    '六張犁門市': '六張犁',
}

REST_MAP = {
    '例假日': '例假',
    '休息日': '休',
    '國定假日': '國定',
    '補完休日': '補休',
}

TIME_PAT = re.compile(r'(\d{1,2})[:.]?(\d{0,2})[~\-](\d{1,2})[:.]?(\d{0,2})')

def fmt_hm(h, m):
    h = int(h)
    m = int(m) if m else 0
    if m == 0:
        return str(h)
    return f'{h:02d}{m:02d}'

def normalize_shift(cell):
    """cell → (shift_str, is_rest)；空 cell 回 (None, False)"""
    if cell is None: return (None, False)
    s = str(cell).strip()
    if not s: return (None, False)

    # 純休假類（可能跟其他文字混合，例如 "休息日\n15:00~17:00"）
    # 找到第一個非休假 token
    parts = [p.strip() for p in re.split(r'[\n\r]+', s) if p.strip()]
    rest_part = None
    time_parts = []
    for p in parts:
        matched_rest = False
        for k, v in REST_MAP.items():
            if k in p:
                rest_part = v
                matched_rest = True
                break
        if not matched_rest:
            time_parts.append(p)

    # 抽時間：所有 segment 取最早開始 + 最晚結束
    spans = []
    for tp in time_parts:
        for m in TIME_PAT.finditer(tp):
            spans.append((int(m.group(1)) * 60 + (int(m.group(2)) if m.group(2) else 0),
                          int(m.group(3)) * 60 + (int(m.group(4)) if m.group(4) else 0),
                          m.groups()))
    if spans:
        # 取 earliest start, latest end
        earliest = min(spans, key=lambda x: x[0])
        latest = max(spans, key=lambda x: x[1])
        h1, m1, h2, m2 = earliest[2][0], earliest[2][1], latest[2][2], latest[2][3]
        return (f'{fmt_hm(h1, m1)}-{fmt_hm(h2, m2)}', False)

    # 沒時間也沒 rest → 用原字串清乾淨（去 \n）
    if rest_part:
        return (rest_part, True)
    cleaned = ' '.join(parts)
    return (cleaned, False)


def sql_str(s):
    if s is None: return 'NULL'
    return "'" + str(s).replace("'", "''") + "'"


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    header = rows[5]  # row index 5 = file row 6

    # 抓日期欄 index (從 col 4 開始，header 形如 '04/01(三)')
    date_cols = []
    for i, h in enumerate(header):
        if h and re.match(r'\d{2}/\d{2}', str(h)):
            mm, dd = str(h).split('(')[0].split('/')
            date_cols.append((i, f'2026-{mm}-{dd}'))

    print(f'日期欄: {len(date_cols)} 天')

    inserts = []
    skipped = Counter()
    seen = set()  # (emp, date) 去重
    for row in rows[6:]:
        if not row or not row[1]: continue
        name = str(row[1]).strip()
        dept = str(row[2]).strip() if row[2] else ''
        store = DEPT_TO_STORE.get(dept)

        for col_idx, date in date_cols:
            cell = row[col_idx] if col_idx < len(row) else None
            shift, is_rest = normalize_shift(cell)
            if shift is None:
                continue
            key = (name, date)
            if key in seen:
                skipped[f'dup_{name}'] += 1
                continue
            seen.add(key)

            src_store = None if is_rest else store
            inserts.append(
                f"INSERT INTO schedules (employee, date, shift, source_store, organization_id) "
                f"VALUES ({sql_str(name)}, '{date}', {sql_str(shift)}, {sql_str(src_store)}, {ORG_ID}) "
                f"ON CONFLICT (employee, date) DO UPDATE SET shift=EXCLUDED.shift, source_store=EXCLUDED.source_store;\n"
            )

    print(f'總 INSERT: {len(inserts)}')
    if skipped:
        print(f'跳過: {dict(skipped)}')

    # 統計每員工天數
    per_emp = Counter()
    for ins in inserts:
        m = re.search(r"VALUES \('([^']+)'", ins)
        per_emp[m.group(1)] += 1
    print(f'員工數: {len(per_emp)}')
    incomplete = [(e, c) for e, c in per_emp.items() if c < 30]
    if incomplete:
        print(f'不滿 30 天的員工 ({len(incomplete)} 人):')
        for e, c in sorted(incomplete, key=lambda x: x[1]):
            print(f'  {e}: {c} 天')
    else:
        print('全部員工都 30 天')

    # 拆成 BATCH/檔
    num_files = (len(inserts) + BATCH - 1) // BATCH
    print(f'\n寫 {num_files} 個檔，每檔 ~{BATCH} 行')
    for i in range(num_files):
        start = i * BATCH
        end = min(start + BATCH, len(inserts))
        path = os.path.join(OUT_DIR, f'import_schedules_202604_v2_part{i+1}of{num_files}.sql')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(f'-- v2 Part {i+1}/{num_files} (rows {start+1}-{end} of {len(inserts)})\n')
            f.write('BEGIN;\n\n')
            f.writelines(inserts[start:end])
            f.write('\nCOMMIT;\n')
        print(f'  {path}: {end-start} 行')


if __name__ == '__main__':
    main()
