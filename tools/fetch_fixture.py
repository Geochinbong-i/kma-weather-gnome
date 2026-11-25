# SPDX-License-Identifier: GPL-2.0-or-later
"""기상청 · 에어코리아 실제 응답을 시험용 파일로 저장한다(키는 저장하지 않는다).

왜: tests/test_logic.js 가 실제 응답 모양으로 화면 값 만들기를 시험하기 위해.
값: 예시 지역 = 서울 종로구(격자 60,127 · 중기 11B10101 / 11B00000 · 측정소 종로구).
쓰는 법: python3 -I tools/fetch_fixture.py tests/fixture.json
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
KEY_FILE = next((p for p in (Path.home() / '.config/kma-weather/kma.env', Path.home() / '.config/sugar-weather/kma.env')
                 if p.exists()), Path.home() / '.config/kma-weather/kma.env')
env = dict(l.split('=', 1) for l in KEY_FILE.read_text().splitlines()
           if '=' in l and not l.startswith('#'))
KEY = env['KMA_SERVICE_KEY_ENCODED']


def get(url, **q):
    q = urllib.parse.urlencode(q)
    with urllib.request.urlopen(f'{url}?serviceKey={KEY}&{q}', timeout=20) as r:
        return json.loads(r.read())


F = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/'
M = 'https://apis.data.go.kr/1360000/MidFcstInfoService/'
now = time.time()
n = datetime.fromtimestamp(now, KST)
a, b, c, m = (n - timedelta(minutes=x) for x in (40, 45, 10, 20))
vh = max([h for h in [2, 5, 8, 11, 14, 17, 20, 23] if h <= c.hour] or [2])
tmfc = m.strftime('%Y%m%d') + ('1800' if m.hour >= 18 else '0600')
g = {'dataType': 'JSON', 'pageNo': 1, 'nx': 60, 'ny': 127}
out = {
    'now_ms': int(now * 1000), 'tmFc': tmfc,
    'ncst': get(F + 'getUltraSrtNcst', numOfRows=20, base_date=f'{a:%Y%m%d}', base_time=f'{a:%H}00', **g),
    'usfcst': get(F + 'getUltraSrtFcst', numOfRows=60, base_date=f'{b:%Y%m%d}', base_time=f'{b:%H}30', **g),
    'vilage': get(F + 'getVilageFcst', numOfRows=1200, base_date=f'{c:%Y%m%d}', base_time=f'{vh:02d}00', **g),
    'extremes': get(F + 'getVilageFcst', numOfRows=1200, base_date=f'{n:%Y%m%d}', base_time='0200', **g),
    'midTa': get(M + 'getMidTa', dataType='JSON', pageNo=1, numOfRows=10, regId='11B10101', tmFc=tmfc),
    'midLand': get(M + 'getMidLandFcst', dataType='JSON', pageNo=1, numOfRows=10, regId='11B00000', tmFc=tmfc),
    'warn': get('https://apis.data.go.kr/1360000/WthrWrnInfoService/getPwnCd', dataType='JSON', pageNo=1, numOfRows=1000),
    'air': get('https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty',
               returnType='json', numOfRows=300, pageNo=1, ver='1.3', sidoName='서울'),
}
Path(sys.argv[1]).write_text(json.dumps(out, ensure_ascii=False))
print('저장', sys.argv[1], n.strftime('%H:%M'), 'tmFc', tmfc)
