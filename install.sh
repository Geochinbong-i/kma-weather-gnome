#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# 왜: 이 저장소의 확장 · 앱을 GNOME 사용자 확장 폴더 + 앱 폴더로 복사하고, 확장 켜기 목록 · 앱 목록에 등록한다.
# 함정: Wayland 에서는 바뀐 확장을 Shell 이 바로 못 읽는다 — 확장이 바뀌면 로그아웃 · 로그인 한 번 필요(앱은 바로 됨).
# 되돌리기: gnome-extensions disable kma-weather@geochinbong-i.github.io · rm -r ~/.local/share/kma-weather ~/.local/share/gnome-shell/extensions/kma-weather@geochinbong-i.github.io ~/.local/share/applications/io.github.geochinbong_i.KmaWeather.desktop
set -eu
UUID=kma-weather@geochinbong-i.github.io
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/extension/$UUID"
DST="$HOME/.local/share/gnome-shell/extensions/$UUID"
APP="$HOME/.local/share/kma-weather/app"
DESK="$HOME/.local/share/applications/io.github.geochinbong_i.KmaWeather.desktop"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/$(id -u)/bus}"

mkdir -p "$DST" "$APP" "$(dirname "$DESK")"
# Meteocons 아이콘 · 장면 그림(약 900개)은 저장소에 들어 있다. 없을 때만 다시 만든다(크로미움 필요, 약 1분)
if [ ! -f "$SRC/icons/now/frames.json" ] || [ ! -f "$SRC/icons/small-on-light/clear-day.svg" ] \
   || [ ! -f "$HERE/app/icons/now/sprites.json" ] || [ ! -f "$HERE/app/icons/air/0.svg" ]; then
  python3 -I "$HERE/tools/build_icons.py" | tail -1
fi
rsync -a --delete --exclude 'schemas/gschemas.compiled' "$SRC/" "$DST/"
glib-compile-schemas "$DST/schemas"
echo "확장 복사: $DST ($(find "$DST" -type f | wc -l)개 파일)"

# 앱 = app/main.js + 확장과 같은 logic.js · api.js · regions.json
rsync -a --delete "$HERE/app/main.js" "$SRC/logic.js" "$SRC/api.js" "$SRC/regions.json" "$APP/"
rsync -a --delete "$HERE/app/icons/" "$APP/icons/"
sed "s|@APPDIR@|$APP|g" "$HERE/app/io.github.geochinbong_i.KmaWeather.desktop" > "$DESK"
update-desktop-database "$(dirname "$DESK")" 2>/dev/null || true
echo "앱 복사: $APP ($(find "$APP" -type f | wc -l)개 파일) · 앱 목록: $DESK"

CUR=$(gsettings get org.gnome.shell enabled-extensions)
if echo "$CUR" | grep -q "'$UUID'"; then
  echo "켜기 목록: 이미 있음"
else
  NEW=$(python3 -I -c "import ast,sys; l=ast.literal_eval(sys.argv[1].replace('@as ','')); l.append(sys.argv[2]); print(str(l))" "$CUR" "$UUID")
  gsettings set org.gnome.shell enabled-extensions "$NEW"
  echo "켜기 목록: 추가"
fi
if [ -f "$HOME/.config/kma-weather/kma.env" ] || [ -f "$HOME/.config/sugar-weather/kma.env" ]; then
  echo "인증키 파일: 있음"
else
  echo "인증키 파일: 없음 — ~/.config/kma-weather/kma.env 를 만드십시오(README 참고). 그 전에는 원래 GNOME 날씨가 보입니다"
fi
echo "다음: 확장이 바뀌었으면 로그아웃 → 로그인. 앱은 앱 목록 '기상청 날씨' 또는 날씨 칸 누르기"
