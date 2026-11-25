# SPDX-License-Identifier: GPL-2.0-or-later
"""기상청 표 셋을 합쳐 확장 · 앱이 쓰는 시군구 목록(regions.json)을 만든다.

왜: 지역 하나를 고르면 단기(격자) · 중기(기온 · 육상 코드) · 특보(구역 코드) · 미세먼지(시도 · 측정소) · 일출일몰(위경도)을 모두 알아야 한다.
출처: reference/기상청41_…/격자_위경도(2610).xlsx — C 1단계 · D 2단계 · E 3단계 · F,G 격자 · N 경도 · O 위도(도 단위)
      reference/기상청28_…/중기기온예보구역코드_2025.12.xlsx — A 코드 · B 이름 · C 구분(A 육상 · C 도시 · H 해양)
      reference/기상청21_…/특보구역코드안내(261125).xlsx — B 코드 · C 이름 · E 종료일
함정: 중기 도시 이름이 겹친다(광주: 경기 · 전남, 고성: 강원 · 경남) → 시도마다 허용 코드 앞자리로 가른다.
함정: 특보 '광주'도 경기(L101…) · 전남광주(L118…) 둘 — 시도 특보 코드 앞 4자로 가른다.
함정: 서울 구는 특보구역이 4개 권역인데 어느 구가 어느 권역인지 표에 없다 → 서울 권역 넷을 모두 후보로 두고 화면에 구역 이름을 그대로 보인다.
함정: openpyxl 이 없어 zip+XML 로 직접 읽는다. 빈 칸은 <c …/> 라 정규식이 다음 칸을 삼키지 않게 한다(빠뜨리면 256곳 중 219곳만 나온다).
쓰는 법: python3 -I tools/make_regions.py <가이드 폴더> extension/kma-weather@geochinbong-i.github.io/regions.json
     가이드 폴더 = 공공데이터포털에서 받은 기상청 단기예보 · 중기예보 · 기상특보 활용 가이드(엑셀 포함)를 풀어 둔 곳.
"""
import glob
import json
import re
import sys
import zipfile

# 시도: (중기 코드 허용 앞자리, 중기 기본 도시, 에어코리아 시도, 특보 시도 코드)
SIDO = {
    '서울특별시': (('11B',), '서울', '서울', 'L1100000'),
    '인천광역시': (('11B', '11A'), '인천', '인천', 'L1110000'),
    '경기도': (('11B',), '수원', '경기', 'L1010000'),
    '강원특별자치도': (('11D',), '춘천', '강원', 'L1020000'),
    '충청북도': (('11C1',), '청주', '충북', 'L1040000'),
    '충청남도': (('11C2',), '홍성', '충남', 'L1030000'),
    '대전광역시': (('11C2',), '대전', '대전', 'L1120000'),
    '세종특별자치시': (('11C2',), '세종', '세종', 'L1170000'),
    '전북특별자치도': (('11F1', '21F1'), '전주', '전북', 'L1060000'),
    '전남광주통합특별시': (('11F2', '21F2'), '광주', '전남광주', 'L1180000'),
    '경상북도': (('11H1', '11E'), '안동', '경북', 'L1070000'),
    '대구광역시': (('11H1',), '대구', '대구', 'L1140000'),
    '경상남도': (('11H2',), '창원', '경남', 'L1080000'),
    '부산광역시': (('11H2',), '부산', '부산', 'L1150000'),
    '울산광역시': (('11H2',), '울산', '울산', 'L1160000'),
    '제주특별자치도': (('11G',), '제주', '제주', 'L1090000'),
}
# 기상 개황(통보문) 발표 지점 — 시도별. 2026-11-25 아홉 곳 모두 호출 확인(resultCode 00)
STN = {'서울특별시': 109, '인천광역시': 109, '경기도': 109, '강원특별자치도': 105, '충청북도': 131, '충청남도': 133, '대전광역시': 133, '세종특별자치시': 133, '전북특별자치도': 146, '전남광주통합특별시': 156, '경상북도': 143, '대구광역시': 143, '경상남도': 159, '부산광역시': 159, '울산광역시': 159, '제주특별자치도': 184}
METRO = {'서울특별시', '인천광역시', '대전광역시', '대구광역시', '부산광역시', '울산광역시', '세종특별자치시'}
# 중기 육상 코드 = 도시 코드 앞자리로
LAND = [('11A', '11B00000'), ('11B', '11B00000'), ('11D1', '11D10000'), ('11D2', '11D20000'),
        ('11C1', '11C10000'), ('11C2', '11C20000'), ('11F1', '11F10000'), ('21F1', '11F10000'),
        ('11F2', '11F20000'), ('21F2', '11F20000'), ('11H1', '11H10000'), ('11E', '11H10000'),
        ('11H2', '11H20000'), ('11G', '11G00000')]


def read_rows(path):
    z = zipfile.ZipFile(path)
    ss = re.findall(r'<si>(.*?)</si>', z.read('xl/sharedStrings.xml').decode(), re.S)
    ss = [''.join(re.findall(r'<t[^>]*>([^<]*)</t>', s)) for s in ss]
    sheet = z.read('xl/worksheets/sheet1.xml').decode()
    rows = []
    for r in re.findall(r'<row[^>]*>(.*?)</row>', sheet, re.S):
        cells = {}
        for ref, attrs, body in re.findall(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', r, re.S):
            v = re.search(r'<v>([^<]*)</v>', body)
            v = v.group(1) if v else ''
            if 't="s"' in attrs and v:
                v = ss[int(v)]
            cells[ref] = v.strip()
        rows.append(cells)
    return rows[1:]


def stem(name):
    return name[:-1] if len(name) > 2 and name[-1] in '시군구' else name


def main(ref, out):
    grid = read_rows(glob.glob(f'{ref}/기상청41_*/*격자_위경도*.xlsx')[0])
    mid = [r for r in read_rows(glob.glob(f'{ref}/기상청28_*/*.xlsx')[0]) if r.get('C') == 'C']
    warn = [r for r in read_rows(glob.glob(f'{ref}/기상청21_*/*특보구역코드*.xlsx')[0])
            if r.get('B', '').startswith('L') and r.get('E', '') >= '2026']

    sido_with_children = {r['C'] for r in grid if r.get('D')}
    regions, misses = [], []
    for r in grid:
        if r.get('E') or r.get('C') == '이어도':
            continue
        sido = r.get('C')
        if r.get('D') == sido or (sido and not r.get('D') and sido not in sido_with_children):
            name, second = sido, ''
        elif r.get('D'):
            name, second = f"{sido} {r['D']}", r['D']
        else:
            continue
        prefixes, default_city, air_sido, warn_sido = SIDO[sido]
        first_word = second.split()[0] if second else ''
        # 함정: 시 안의 구는 띄어쓰기 없이 "수원시장안구"로 온다 → 앞의 "수원시"만 쓴다
        m = re.match(r'(.+?시)(.+구)$', first_word)
        if m:
            first_word = m.group(1)
        key = stem(first_word) if first_word else ''
        key = {'울릉': '울릉도'}.get(key, key)

        cities = [m for m in mid if m['A'].startswith(prefixes)]
        ta = None
        if key and not (sido in METRO and first_word.endswith('구')):
            ta = next((m for m in cities if m['B'] in (key, first_word)), None)
        if ta is None:
            ta = next((m for m in cities if m['B'] == default_city), None)
            if key and not (sido in METRO and first_word.endswith('구')) and sido not in ('세종특별자치시',):
                misses.append(name)
        land = next(code for p, code in LAND if ta['A'].startswith(p))

        wp = warn_sido[:4]
        cands = [w for w in warn if w['B'].startswith(wp)]
        if sido == '서울특별시':
            wcodes = [w['B'] for w in cands]
        else:
            wcodes = [warn_sido] + [w['B'] for w in cands if key and w['C'].startswith(key)]
        air = air_sido   # 출처: 에어코리아 대기오염정보 기술문서 v1.4 — 시도 이름에 '전남광주'가 있다
        regions.append({
            'n': name, 'x': int(r['F']), 'y': int(r['G']),
            'lat': round(float(r['O']), 4), 'lon': round(float(r['N']), 4),
            'ta': ta['A'], 'land': land, 'warn': sorted(set(wcodes)),
            'air': air, 'st': first_word, 'stn': STN[sido],
        })
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(regions, f, ensure_ascii=False, separators=(',', ':'))
    print(len(regions), '곳 →', out)
    print('중기 도시를 이름으로 못 찾아 시도 기본 도시로 둔 곳', len(misses), misses)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
