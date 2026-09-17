import openpyxl
import json
import os

excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '가계부_카드별_지출정리.xlsx'))
wb = openpyxl.load_workbook(excel_path, data_only=True)
ws = wb['지출_카드별정리']

records = []
for r in range(2, 263):
    vals = [ws.cell(r, c).value for c in range(1, 15)]
    if vals[0] is None and vals[1] is None:
        continue
    no, date, time, month, cat_main, cat_sub, merchant, amount, orig_pay, actual_card, installment, billing_amt, exclude, memo = vals
    date_str = str(date)[:10] if date else ''
    
    # Filter only 2026-09-01 ~ 2026-09-10
    if '2026-09-01' <= date_str <= '2026-09-10':
        records.append({
            'id': len(records) + 1,
            'origId': int(no) if no is not None else len(records) + 1,
            'date': date_str,
            'time': str(time) if time else '',
            'month': '9월',
            'category': str(cat_main).strip() if cat_main else '기타',
            'subCategory': str(cat_sub).strip() if cat_sub else '',
            'merchant': str(merchant).strip() if merchant else '',
            'amount': int(amount) if amount is not None else 0,
            'origPay': str(orig_pay).strip() if orig_pay else '',
            'actualCard': str(actual_card).strip() if actual_card else '기타 카드',
            'installment': str(installment).strip() if installment else '일시불',
            'billingAmount': int(billing_amt) if billing_amt is not None else (int(amount) if amount else 0),
            'exclude': 'Y' if str(exclude).strip().upper() == 'Y' else 'N',
            'memo': str(memo).strip() if memo else ''
        })

print(f"Loaded {len(records)} records (2026-09-01 ~ 2026-09-10).")

# Summary statistics
cards = {}
categories = {}

for rec in records:
    amt = rec['amount']
    card = rec['actualCard']
    cat = rec['category']
    cards[card] = cards.get(card, 0) + amt
    categories[cat] = categories.get(cat, 0) + amt

summary = {
    'title': '카드별 지출 현황 및 가계부 대시보드',
    'subtitle': '뱅크샐러드 데이터 기반 (2026-09-01 ~ 2026-09-10)',
    'period': '2026-09-01 ~ 2026-09-10',
    'physicalCards': [
        "신한은행 The More",
        "KT Plus 우리카드",
        "MG+ S 하나카드",
        "KB국민 톡톡 my point카드",
        "다드림 LOVE",
        "아시아나 KB국민플래티늄카드",
        "기타 카드"
    ],
    'payAndAccounts': [
        "[간편결제] 네이버페이",
        "[간편결제] 네이버페이(포인트)",
        "[간편결제] 카카오페이",
        "[간편결제] 페이코",
        "[간편결제] 토스",
        "계좌/현금"
    ],
    'allCards': [
        "신한은행 The More",
        "KT Plus 우리카드",
        "MG+ S 하나카드",
        "KB국민 톡톡 my point카드",
        "다드림 LOVE",
        "아시아나 KB국민플래티늄카드",
        "기타 카드",
        "[간편결제] 네이버페이",
        "[간편결제] 네이버페이(포인트)",
        "[간편결제] 카카오페이",
        "[간편결제] 페이코",
        "[간편결제] 토스",
        "계좌/현금"
    ],
    'totalRecords': len(records),
    'totalAmount': sum(r['amount'] for r in records),
    'cards': sorted([{'name': k, 'amount': v} for k, v in cards.items()], key=lambda x: -x['amount']),
    'categories': sorted([{'name': k, 'amount': v} for k, v in categories.items()], key=lambda x: -x['amount']),
    'records': records
}

with open('data.js', 'w', encoding='utf-8') as f:
    f.write('window.INITIAL_DATA = ')
    json.dump(summary, f, ensure_ascii=False, indent=2)
    f.write(';\n')

print("Saved to data.js successfully!")
