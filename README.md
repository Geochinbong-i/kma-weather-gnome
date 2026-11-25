# 기상청 날씨 — GNOME 확장 + 앱

GNOME 상단 바 캘린더 밑의 날씨 칸을 **기상청 예보**로 바꾸는 GNOME Shell 확장과, 그 칸을 누르면 열리는 GTK4 · libadwaita 앱입니다.

GNOME 기본 날씨는 MET Norway 자료를 쓰고 한국 지역이 몇 곳뿐입니다. 이 프로젝트는 공공데이터포털의 기상청 · 에어코리아 API로 전국 시군구 256곳의 날씨를 보여 줍니다.

## 무엇이 보이나

| 위치 | 내용 |
|---|---|
| 상단 바 날씨 칸 (확장) | 지금 날씨 · 기온 · 최고/최저, 기상특보, 미세먼지, 5시간 기온과 강수확률 |
| 앱 "기상청 날씨" | 48시간 기온 그래프(하늘색 띠 · 기온 색), 10일 예보(최고 · 최저 · 강수확률), 대기질 4종, 기상 개황 · 미세먼지 예보 |

- 밤 아이콘은 지역의 일출 · 일몰 시각에 맞춰 바뀝니다(인터넷 없이 계산).
- 라이트 · 다크 테마를 따라 아이콘과 색이 바뀝니다.
- 상단 바는 날짜 메뉴를 열 때만 자료를 받습니다(10분 안에 다시 열면 받지 않음). 앱은 창이 열려 있는 동안만 받습니다.

## 필요한 것

- GNOME Shell **46** (Ubuntu 24.04에서 확인. 다른 판은 아직 시험하지 않았습니다)
- `gjs` · `gir1.2-gtk-4.0` · `gir1.2-adw-1` · `gir1.2-soup-3.0` · `rsync` · `python3`
- 공공데이터포털 인증키 (아래)

```bash
sudo apt install gjs gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-soup-3.0 rsync python3
```

## 인증키 받기

1. [공공데이터포털](https://www.data.go.kr)에 가입합니다.
2. 아래 다섯 개를 각각 **활용신청**합니다. 보통 바로 또는 하루 안에 승인됩니다.
   - 기상청_단기예보 ((구)_동네예보) 조회서비스
   - 기상청_중기예보 조회서비스
   - 기상청_기상특보 조회서비스
   - 기상청_단기예보 통보문 조회서비스
   - 한국환경공단_에어코리아_대기오염정보
3. 마이페이지의 **일반 인증키(Encoding)** 를 복사해 파일 하나에 넣습니다. 키 하나로 다섯 서비스를 모두 씁니다.

```bash
mkdir -p ~/.config/kma-weather && chmod 700 ~/.config/kma-weather
printf 'KMA_SERVICE_KEY_ENCODED=%s\n' '여기에-인코딩-키' > ~/.config/kma-weather/kma.env
chmod 600 ~/.config/kma-weather/kma.env
```

키 파일이 없거나 키가 거부되면 원래 GNOME 날씨 칸이 그대로 보입니다. 키는 이 파일에서만 읽고 로그에 남기지 않습니다.

## 설치

```bash
git clone https://github.com/Geochinbong-i/kma-weather-gnome
cd kma-weather-gnome
./install.sh
```

그다음 **로그아웃 → 로그인** 한 번 합니다(Wayland에서는 새 확장을 로그인할 때 읽습니다).

- 확장: `~/.local/share/gnome-shell/extensions/kma-weather@geochinbong-i.github.io/`
- 앱: `~/.local/share/kma-weather/app/` (앱 목록에 "기상청 날씨")
- 지역 바꾸기: 앱 제목줄의 지역 버튼에서 시군구를 검색합니다. 상단 바도 같이 바뀝니다.

## 지우기

```bash
gnome-extensions disable kma-weather@geochinbong-i.github.io
rm -r ~/.local/share/gnome-shell/extensions/kma-weather@geochinbong-i.github.io \
      ~/.local/share/kma-weather \
      ~/.local/share/applications/io.github.geochinbong_i.KmaWeather.desktop
```

## 개발

| 파일 | 하는 일 |
|---|---|
| `extension/…/logic.js` | 응답 → 화면 값, 발표 시각, 일출 · 일몰 (확장과 앱이 함께 씀, GNOME 모듈 없음) |
| `extension/…/api.js` | 기상청 · 에어코리아 호출 |
| `extension/…/extension.js` | 상단 바 날씨 칸 |
| `app/main.js` | 앱 |
| `tools/make_regions.py` | 기상청 활용 가이드 엑셀 → `regions.json`(시군구 256곳 · 격자 · 예보 구역 코드) |
| `tools/build_icons.py` | Meteocons · Fluent Emoji 받아 아이콘 · 움직이는 장면 그림 만들기(크로미움 필요) |
| `tools/fetch_fixture.py` | 시험용 실제 응답 저장(서울 종로구) |

```bash
gjs -m tests/test_logic.js tests/fixture.json   # 계산 시험
```

## 출처와 라이선스

- 이 저장소의 코드: **GPL-2.0-or-later** ([LICENSE](LICENSE))
- 날씨 자료: **기상청** (공공데이터포털)
- 대기질 자료: **환경부/한국환경공단** (에어코리아, 공공데이터포털). 실시간 측정값은 확정되지 않은 자료입니다.
- 날씨 아이콘: [Meteocons](https://github.com/basmilius/meteocons) — Bas Milius, MIT ([원문](app/icons/LICENSE-meteocons.txt))
- 대기질 얼굴: [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) — Microsoft, MIT ([원문](app/icons/air/LICENSE-fluentui-emoji.txt))

이 프로젝트는 개인이 만든 것이며 기상청 · 한국환경공단과 관계가 없습니다.

## AI가 한 일

이 프로젝트의 코드 · 도구 · 문서는 Anthropic의 **Claude**(Claude Code)가 작성했습니다. 저장소 주인은 무엇을 만들지 정하고, 화면 디자인과 아이콘을 고르고, 시안과 결과를 검토하고, 실제 데스크톱에서 써 보며 확인했습니다.
