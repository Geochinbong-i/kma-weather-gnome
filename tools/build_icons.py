# SPDX-License-Identifier: GPL-2.0-or-later
"""Meteocons 공식 아이콘으로 확장 · 앱 아이콘 파일을 만든다.

결정: 상단 바 작은 아이콘 = monochrome(멈춤) · 상단 바 큰 아이콘 = flat 움직임 ·
     앱 목록(시간별 · 10일) = flat(멈춤) · 앱 큰 아이콘 = fill 움직임 · 라이트 테마에서 앱 아이콘 뒤에 옅은 바탕.
출처: npm @meteocons/svg(움직임) · @meteocons/svg-static(멈춘 그림, 빗방울 등이 다 보이게 따로 그린 판) 0.1.0, MIT, Bas Milius.
왜(움직임 방식): GTK · GNOME Shell 은 SVG 안 애니메이션(SMIL)을 재생하지 않는다 → 크로미움 헤드리스로 장면을 그려 둔다.
     확장 = 장면마다 PNG(icons/now/<kind>/NNN.png, 메뉴가 열린 동안만 바꿔 끼움) · 앱 = 스프라이트 한 장(icons/now/<kind>.png).
함정: monochrome 은 currentColor 로 칠해져 있다. 상단 바는 테마에 따라 밝거나 어둡다('늘 어둡다'는 틀린 가정)
     → small-on-dark(#f6f5f4) · small-on-light(#2e3436) 두 판을 만들고 확장이 데스크톱 color-scheme 설정으로 고른다.
대기질 얼굴: Fluent Emoji Flat(Microsoft · MIT) 4장 — 좋음 · 보통 · 나쁨 · 매우나쁨(앱 icons/air/0~3.svg).
함정: 한 페이지에 같은 SVG 를 여러 벌 넣으면 id 가 겹친다 → 벌마다 id 앞에 f<번호>- 를 붙인다.
값: 앱 큰 아이콘 96px · 20장/초, 상단 바 큰 아이콘 48px · 15장/초, 한 바퀴 = SVG 안 dur 값들의 최소공배수.
쓰는 법: python3 -I tools/build_icons.py   (내려받기 · 크로미움 사용, 약 1분)
     크로미움 위치: 환경 변수 KMA_CHROME, 없으면 PATH 의 chromium · chromium-browser · google-chrome.
"""
import base64
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.parse
import urllib.request
from fractions import Fraction
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
EXT = HERE / 'extension/kma-weather@geochinbong-i.github.io'
APP = HERE / 'app'
CHROME = os.environ.get('KMA_CHROME') or next(
    (p for p in map(shutil.which, ('chromium', 'chromium-browser', 'google-chrome')) if p), None)
VERSION = '0.1.0'
COLS = 10
APP_BIG = (96, 20)
EXT_BIG = (48, 15)
SHELL_FG = {'small-on-dark': '#f6f5f4', 'small-on-light': '#2e3436'}
FLUENT = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/'
FACES = ['Grinning face/Flat/grinning_face_flat.svg', 'Slightly smiling face/Flat/slightly_smiling_face_flat.svg',
         'Face with medical mask/Flat/face_with_medical_mask_flat.svg', 'Tired face/Flat/tired_face_flat.svg']
APP_BG = '#3584e4'   # 앱 · 독 아이콘 바탕(GNOME Blue 3)
LICENSE_URL = 'https://raw.githubusercontent.com/basmilius/meteocons/main/LICENSE'


def kinds():
    src = (EXT / 'logic.js').read_text(encoding='utf-8')
    return re.findall(r"'([a-z-]+)'", re.search(r'export const KINDS = \[(.*?)\];', src, re.S).group(1))


def fetch_pkg(name, dest):
    meta = json.loads(urllib.request.urlopen(f'https://registry.npmjs.org/@meteocons/{name}/{VERSION}', timeout=30).read())
    data = urllib.request.urlopen(meta['dist']['tarball'], timeout=60).read()
    algo, want = meta['dist']['integrity'].split('-', 1)
    assert base64.b64encode(hashlib.new(algo, data).digest()).decode() == want, f'{name} 무결성 불일치'
    with tarfile.open(fileobj=io.BytesIO(data)) as t:
        t.extractall(dest / name, filter='data')
    return dest / name / 'package'


def loop_seconds(svg):
    durs = [Fraction(d).limit_denominator(10) for d in re.findall(r'dur="([\d.]+)s"', svg)] or [Fraction(3)]
    lcm = durs[0]
    for d in durs[1:]:
        lcm = Fraction(math.lcm(lcm.numerator * d.denominator, d.numerator * lcm.denominator), lcm.denominator * d.denominator)
    return float(lcm)


def uniq(svg, n):
    p = f'f{n}-'
    svg = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{p}{m.group(1)}"', svg)
    svg = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{p}{m.group(1)})', svg)
    return re.sub(r'href="#([^"]+)"', lambda m: f'href="#{p}{m.group(1)}"', svg)


def sprite(svg, out_png, tmp, size, fps):
    frames = round(loop_seconds(svg) * fps)
    rows = math.ceil(frames / COLS)
    cells = ''.join(f'<div class="c">{uniq(svg, i)}</div>' for i in range(frames))
    page = tmp / f'{out_png.stem}-{size}.html'
    page.write_text(
        f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}'
        f'.g{{display:grid;grid-template-columns:repeat({COLS},{size}px)}}.c{{width:{size}px;height:{size}px}}'
        f'.c svg{{width:{size}px;height:{size}px;display:block}}</style><div class="g">{cells}</div>'
        f'<script>document.querySelectorAll(".c > svg").forEach((s,i)=>{{s.pauseAnimations();s.setCurrentTime(i/{fps});}});</script>',
        encoding='utf-8')
    if not CHROME:
        raise SystemExit('크로미움을 찾지 못했습니다 — 환경 변수 KMA_CHROME 에 실행 파일 경로를 넣으십시오')
    subprocess.run([str(CHROME), '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
                    '--default-background-color=00000000', '--force-device-scale-factor=1',
                    f'--window-size={COLS * size},{rows * size}', '--virtual-time-budget=3000',
                    f'--screenshot={out_png}', page.as_uri()], check=True, capture_output=True, timeout=120)
    return {'frames': frames, 'fps': fps, 'size': size, 'cols': COLS}


def split(sheet, info, out_dir):
    from PIL import Image
    out_dir.mkdir(parents=True, exist_ok=True)
    s = info['size']
    with Image.open(sheet) as im:
        for i in range(info['frames']):
            x, y = (i % info['cols']) * s, (i // info['cols']) * s
            im.crop((x, y, x + s, y + s)).save(out_dir / f'{i:03d}.png', optimize=True)


def main():
    ks = kinds()
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        anim = fetch_pkg('svg', tmp)
        static = fetch_pkg('svg-static', tmp)
        for d in (EXT / 'icons', APP / 'icons'):
            if d.exists():
                shutil.rmtree(d)
        flat, now_app, air = APP / 'icons/flat', APP / 'icons/now', APP / 'icons/air'
        for d in (flat, now_app, air, *(EXT / 'icons' / v for v in SHELL_FG)):
            d.mkdir(parents=True)
        app_meta, ext_meta = {}, {}
        for k in ks:
            mono = (static / 'monochrome' / f'{k}.svg').read_text(encoding='utf-8')
            for v, col in SHELL_FG.items():
                (EXT / 'icons' / v / f'{k}.svg').write_text(mono.replace('currentColor', col), encoding='utf-8')
            shutil.copy(static / 'flat' / f'{k}.svg', flat / f'{k}.svg')
            app_meta[k] = sprite((anim / 'fill' / f'{k}.svg').read_text(encoding='utf-8'), now_app / f'{k}.png', tmp, *APP_BIG)
            sheet = tmp / f'{k}-ext.png'
            ext_meta[k] = sprite((anim / 'flat' / f'{k}.svg').read_text(encoding='utf-8'), sheet, tmp, *EXT_BIG)
            split(sheet, ext_meta[k], EXT / 'icons/now' / k)
            print(k, '앱', app_meta[k]['frames'], '장 · 상단 바', ext_meta[k]['frames'], '장')
        (now_app / 'sprites.json').write_text(json.dumps(app_meta), encoding='utf-8')
        (EXT / 'icons/now/frames.json').write_text(json.dumps(ext_meta), encoding='utf-8')
        inner = (static / 'flat' / 'partly-cloudy-day.svg').read_text(encoding='utf-8')
        inner = re.sub(r'<svg\b[^>]*>', '<svg x="12" y="12" width="104" height="104" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">', inner, count=1)
        (APP / 'icons/app.svg').write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
            f'<rect x="8" y="8" width="112" height="112" rx="26" fill="{APP_BG}"/>{inner}</svg>', encoding='utf-8')
    for i, f in enumerate(FACES):
        (air / f'{i}.svg').write_bytes(urllib.request.urlopen(FLUENT + 'assets/' + urllib.parse.quote(f), timeout=30).read())
    (air / 'LICENSE-fluentui-emoji.txt').write_bytes(urllib.request.urlopen(FLUENT + 'LICENSE', timeout=30).read())
    lic = urllib.request.urlopen(LICENSE_URL, timeout=30).read().decode()
    note = f'Meteocons (npm @meteocons/svg · @meteocons/svg-static {VERSION}) — https://github.com/basmilius/meteocons\n\n'
    for d in (EXT / 'icons', APP / 'icons'):
        (d / 'LICENSE-meteocons.txt').write_text(note + lic, encoding='utf-8')
    print('끝:', len(ks), '종')


if __name__ == '__main__':
    main()
