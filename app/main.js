// SPDX-License-Identifier: GPL-2.0-or-later
// 왜: 상단 바 날씨 칸을 누르면 열리는 "기상청 날씨" 앱. 한 화면(기둥형 10일 + 얼굴 이모지 대기질):
//     지금 → 48시간(하늘 띠 + 기온 색 곡선) → 아래 좌우 반(왼쪽 10일 기둥 · 오른쪽 위 대기질 · 아래 기상 소식).
// 불변: 지역 설정은 확장과 같은 gsettings — 앱에서 바꾸면 상단 바도 바뀐다.
// 불변: 호출은 창이 열려 있는 동안만(열 때 · 새로고침 · 10분마다). 창을 닫으면 타이머 · 요청을 모두 멈춘다.
// 불변: 움직이는 것은 지금 큰 아이콘 하나(Meteocons fill), 창이 보일 때만.
// 출처: logic.js · api.js · regions.json 은 확장 폴더의 것을 install.sh 가 함께 복사한다. 아이콘 = tools/build_icons.py.
// 쓰는 법: gjs -m ~/.local/share/kma-weather/app/main.js   (확인 그림: KMA_APP_SNAPSHOT=/경로.png)
import Cairo from 'cairo';
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import {programArgs, programInvocationName} from 'system';

import * as A from './api.js';
import * as L from './logic.js';

const APP_ID = 'io.github.geochinbong_i.KmaWeather';
const SCHEMA = 'org.gnome.shell.extensions.kma-weather';
const EXT_SCHEMAS = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'kma-weather@geochinbong-i.github.io', 'schemas']);
const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const ICONS = GLib.build_filenamev([HERE, 'icons']);
const REFRESH_S = 600;
const TICK_MS = 50;              // 큰 아이콘 장면 바꾸기(20장/초)
const SNAPSHOT = GLib.getenv('KMA_APP_SNAPSHOT');
// 출처: 에어코리아 약관 제7조 — 자료 출처(환경부/한국환경공단) 표기 의무. 창 맨 아래 한 줄로 늘 보이게 둔다.
const SOURCE_LINE = '자료: 기상청, 환경부/한국환경공단(에어코리아) · 대기질 실시간 값은 확정 전 자료입니다.';
// 값: 시간별 한 칸 56px. 높이 166 = 하늘 띠 60(시각 · 아이콘) + 그래프 · 강수확률.
const COL_W = 56;
const TL_H = 166;
const BAND_H = 60;
const DAY_W = 60;                // 10일 한 칸 — 반쪽 폭(약 423px)에 7일이 보이게
// 값: 4시간마다 하늘색(0 · 4 · 8 · 12 · 16 · 20시). 라이트 = 옅게, 다크 = 짙게. 사이는 cairo 선형 그라데이션으로 부드럽게.
const SKY = {
    light: ['#d8dcee', '#e2e0ef', '#e2edf9', '#d9eafb', '#f1ead9', '#e2ddef'],
    dark: ['#23263a', '#2a2a3c', '#24344a', '#203a52', '#3a3426', '#302a40'],
};

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// 기온 → 색(차가움 → 따뜻함). GNOME 팔레트 사이를 섞는다. 영하 파랑 · 6° 청록 · 13° 노랑 · 20° 주황 · 30° 빨강.
const T_STOPS = [[-10, '#1a5fb4'], [0, '#3584e4'], [6, '#26a29e'], [13, '#e5a50a'], [20, '#ff7800'], [30, '#e01b24']];
function tcol(t) {
    if (t <= T_STOPS[0][0])
        return rgb(T_STOPS[0][1]);
    for (let i = 1; i < T_STOPS.length; i++) {
        const [b, cb] = T_STOPS[i];
        const [a, ca] = T_STOPS[i - 1];
        if (t <= b) {
            const r = (t - a) / (b - a);
            const x = rgb(ca);
            const y = rgb(cb);
            return x.map((v, j) => v + (y[j] - v) * r);
        }
    }
    return rgb(T_STOPS[T_STOPS.length - 1][1]);
}

// 라이트 테마에서만 아이콘 뒤 옅은 하늘 바탕(흰 구름이 밝은 창에 묻히지 않게). 대기질 색 = 에어코리아 4단계, 글자 대비 5:1 이상.
const CSS = `
.light .wx { background-color: #dde7f2; border-radius: 11px; padding: 2px; }
.light .wx-big { border-radius: 24px; padding: 6px; }
.now-temp { font-size: 52px; font-weight: 300; }
.cond { font-size: 18px; }
.wpill { background-color: #fbe9a8; color: #5c4500; border-radius: 999px; padding: 0 8px; font-size: 12.5px; font-weight: bold; }
window:not(.light) .wpill { background-color: #5c4500; color: #f8e45c; }
.d-day { font-size: 15px; font-weight: bold; }
.d-date { font-size: 12.5px; }
.d-tx { font-size: 15px; font-weight: bold; }
.d-tn { font-size: 15px; }
.d-pop { font-size: 14px; font-weight: bold; color: #1a5fb4; }
window:not(.light) .d-pop { color: #78aeed; }
.aq { border-radius: 12px; padding: 8px 12px; }
.light .aq-0 { background-color: #dcebfb; } .light .aq-1 { background-color: #dcf3e4; }
.light .aq-2 { background-color: #fde6d6; } .light .aq-3 { background-color: #fbdcdc; }
window:not(.light) .aq-0 { background-color: alpha(#3584e4, 0.22); } window:not(.light) .aq-1 { background-color: alpha(#26a269, 0.22); }
window:not(.light) .aq-2 { background-color: alpha(#e66100, 0.22); } window:not(.light) .aq-3 { background-color: alpha(#c01c28, 0.25); }
.aq-name { font-size: 13.5px; }
.aq-grade { font-size: 19px; font-weight: bold; }
.light .aq-g0 { color: #1a5fb4; } .light .aq-g1 { color: #17663a; } .light .aq-g2 { color: #9c3a00; } .light .aq-g3 { color: #a51d2d; }
window:not(.light) .aq-g0 { color: #99c1f1; } window:not(.light) .aq-g1 { color: #8ff0a4; }
window:not(.light) .aq-g2 { color: #ffbe6f; } window:not(.light) .aq-g3 { color: #f66151; }
.news { font-size: 15px; }
.sec-note { font-size: 12.5px; }
/* 출처 글자: 흐린 설명(dim-label, 대비 약 2.9:1)보다 진하게 — 약 5.8:1 */
.src-note { opacity: .8; }
`;

function settings() {
    const src = Gio.SettingsSchemaSource.new_from_directory(EXT_SCHEMAS, Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({settings_schema: src.lookup(SCHEMA, false)});
}

// 마우스로 끌어서 스크롤(터치 화면처럼). 누른 채 끄는 만큼 반대로 움직인다.
function dragScroll(sc, horizontal) {
    const g = new Gtk.GestureDrag({button: Gdk.BUTTON_PRIMARY});
    const adj = () => (horizontal ? sc.get_hadjustment() : sc.get_vadjustment());
    let start = 0;
    g.connect('drag-begin', () => {
        start = adj().get_value();
        sc.set_cursor_from_name('grabbing');
    });
    g.connect('drag-update', (_g, dx, dy) => adj().set_value(start - (horizontal ? dx : dy)));
    g.connect('drag-end', () => sc.set_cursor_from_name('grab'));
    sc.set_cursor_from_name('grab');
    sc.add_controller(g);
}

const label = (text, classes = [], opts = {}) => new Gtk.Label({label: text, css_classes: classes, xalign: 0, ...opts});
const clear = box => {
    let c;
    while ((c = box.get_first_child()))
        box.remove(c);
};

// Meteocons fill 움직임 스프라이트(icons/now/<kind>.png + sprites.json) → 장면 텍스처. 종류마다 처음 쓸 때 한 번 자른다.
class Sprites {
    constructor(dir) {
        this.dir = dir;
        this.cache = new Map();
        try {
            const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, 'sprites.json']));
            this.meta = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            this.meta = {};
        }
    }

    has(kind) {
        return Boolean(kind && this.meta[kind]);
    }

    texture(kind, ms) {
        const m = this.meta[kind];
        let list = this.cache.get(kind);
        if (!list) {
            const sheet = GdkPixbuf.Pixbuf.new_from_file(GLib.build_filenamev([this.dir, `${kind}.png`]));
            list = [];
            for (let i = 0; i < m.frames; i++) {
                const sub = sheet.new_subpixbuf((i % m.cols) * m.size, Math.floor(i / m.cols) * m.size, m.size, m.size);
                list.push(Gdk.Texture.new_for_pixbuf(sub));
            }
            this.cache.set(kind, list);
        }
        return list[ms === null ? 0 : Math.floor(ms / 1000 * m.fps) % m.frames];
    }
}

class WeatherWindow {
    constructor(app) {
        this.settings = settings();
        this.regions = A.loadRegions(HERE);
        this.client = new A.Client('kma-weather-app');
        this.busy = false;
        this.big = new Sprites(GLib.build_filenamev([ICONS, 'now']));
        this.bigKind = null;
        this.hours = [];
        this.pixbufs = new Map();

        this.win = new Adw.ApplicationWindow({application: app, title: '기상청 날씨', default_width: 900, default_height: 820});
        const view = new Adw.ToolbarView();
        this.win.set_content(view);

        const head = new Adw.HeaderBar();
        this.locBtn = new Gtk.MenuButton({always_show_arrow: true, tooltip_text: '지역 바꾸기'});
        const locBox = new Gtk.Box({spacing: 6});
        locBox.append(new Gtk.Image({icon_name: 'find-location-symbolic'}));
        this.locLabel = new Gtk.Label();
        locBox.append(this.locLabel);
        this.locBtn.set_child(locBox);
        this.locBtn.set_popover(this._searchPopover());
        head.pack_start(this.locBtn);
        this.spinner = new Gtk.Spinner();
        const refresh = new Gtk.Button({icon_name: 'view-refresh-symbolic', tooltip_text: '새로고침'});
        refresh.connect('clicked', () => this.refresh());
        head.pack_end(refresh);
        head.pack_end(this.spinner);
        view.add_top_bar(head);
        this.keyBanner = new Adw.Banner({revealed: false, title: `인증키 파일이 없습니다 — ${A.keyPath()}`});
        view.add_top_bar(this.keyBanner);

        // 한 화면: 바깥은 스크롤하지 않고, 시간별 · 10일은 옆으로, 기상 소식은 아래로 스크롤.
        const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10,
            margin_top: 12, margin_bottom: 14, margin_start: 18, margin_end: 18});
        view.set_content(page);
        page.append(this._nowRow());
        page.append(this._heading('시간별', '옆으로 밀어 48시간')[0]);
        page.append(this._timeline());
        const split = new Gtk.Box({spacing: 18, homogeneous: true, vexpand: true});
        split.append(this._dailyPane());
        split.append(this._rightPane());
        page.append(split);
        this.note = label('', ['dim-label', 'caption'], {wrap: true});
        page.append(this.note);
        page.append(label(SOURCE_LINE, ['src-note', 'caption'], {xalign: 0, wrap: true}));

        this.settingsId = this.settings.connect('changed::region-name', () => this.refresh());
        this.timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_S, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
        const sm = Adw.StyleManager.get_default();
        const theme = () => {
            if (sm.dark)
                this.win.remove_css_class('light');
            else
                this.win.add_css_class('light');
            this.graph?.queue_draw();
        };
        this.themeId = sm.connect('notify::dark', theme);
        theme();
        const t0 = GLib.get_monotonic_time();
        let last = null;
        this.anim = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            if (this.bigKind && this.win.get_visible() && !this.win.suspended) {
                const tex = this.big.texture(this.bigKind, (GLib.get_monotonic_time() - t0) / 1000);
                if (tex !== last) {
                    last = tex;
                    this.nowIcon.set_from_paintable(tex);
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
        this.win.connect('close-request', () => {
            GLib.Source.remove(this.anim);
            GLib.Source.remove(this.timer);
            sm.disconnect(this.themeId);
            this.settings.disconnect(this.settingsId);
            this.client.close();
            this.closed = true;
            return false;
        });
        this.win.present();
        this.refresh();
    }

    region() {
        return A.findRegion(this.regions, this.settings.get_string('region-name'));
    }

    // 제목 줄. [상자, 옆 설명 글] 을 돌려준다 — 설명 글은 부른 쪽이 필드로 들고 있는다.
    _heading(title, note = '') {
        const box = new Gtk.Box({spacing: 8});
        box.append(label(title, ['heading']));
        const sub = label(note, ['dim-label', 'sec-note'], {valign: Gtk.Align.BASELINE});
        box.append(sub);
        return [box, sub];
    }

    _searchPopover() {
        const pop = new Gtk.Popover();
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, width_request: 300,
            margin_top: 8, margin_bottom: 8, margin_start: 8, margin_end: 8});
        const entry = new Gtk.SearchEntry({placeholder_text: '시 · 군 · 구 이름 (예: 종로, 수원)'});
        const list = new Gtk.ListBox({css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE});
        const sc = new Gtk.ScrolledWindow({max_content_height: 320, propagate_natural_height: true});
        sc.set_child(list);
        box.append(entry);
        box.append(sc);
        pop.set_child(box);
        const fill = () => {
            clear(list);
            const hits = L.searchRegions(this.regions, entry.text);
            sc.visible = hits.length > 0;
            for (const r of hits) {
                const row = new Adw.ActionRow({title: r.n, activatable: true});
                row.connect('activated', () => {
                    this.settings.set_int('nx', r.x);
                    this.settings.set_int('ny', r.y);
                    this.settings.set_string('region-name', r.n);
                    entry.text = '';
                    pop.popdown();
                });
                list.append(row);
            }
        };
        entry.connect('search-changed', fill);
        pop.connect('show', () => entry.grab_focus());
        fill();
        return pop;
    }

    _nowRow() {
        const row = new Gtk.Box({spacing: 16});
        this.nowIcon = new Gtk.Image({pixel_size: 88, icon_name: 'content-loading-symbolic', css_classes: ['wx', 'wx-big']});
        this.nowTemp = label('', ['now-temp']);
        const col = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, valign: Gtk.Align.CENTER, hexpand: true});
        const condBox = new Gtk.Box({spacing: 8});
        this.nowText = label('받는 중…', ['cond']);
        // 특보: 날씨 문구 오른쪽 알약(검토 2차)
        this.warnPill = label('', ['wpill'], {visible: false, valign: Gtk.Align.CENTER});
        condBox.append(this.nowText);
        condBox.append(this.warnPill);
        this.nowDetail = label('', ['dim-label']);
        this.sunLabel = label('', ['dim-label']);
        col.append(condBox);
        col.append(this.nowDetail);
        col.append(this.sunLabel);
        this.issued = label('', ['dim-label', 'caption'], {valign: Gtk.Align.START, xalign: 1, justify: Gtk.Justification.RIGHT});
        for (const w of [this.nowIcon, this.nowTemp, col, this.issued])
            row.append(w);
        return row;
    }

    // 시간별 48칸: 위 하늘 띠(시각 · 아이콘, 4시간마다 색) + 아래 그래프(기온 색 곡선 · 채움 · 숫자 · 강수확률).
    // 불변: 스크롤 창 폭 = 화면 안쪽 폭, 그림 폭 = 칸 수 × 56 → 끝까지 밀면 마지막 칸이 오른쪽 여백(18px)에 딱 맞는다(검토 3차).
    _timeline() {
        const card = new Gtk.Box({css_classes: ['card'], overflow: Gtk.Overflow.HIDDEN});
        const sc = new Gtk.ScrolledWindow({vscrollbar_policy: Gtk.PolicyType.NEVER, hexpand: true,
            min_content_height: TL_H, max_content_height: TL_H});
        this.graph = new Gtk.DrawingArea({content_height: TL_H, content_width: COL_W});
        this.graph.set_draw_func((area, cr) => this._drawTimeline(area, cr));
        sc.set_child(this.graph);
        dragScroll(sc, true);
        card.append(sc);
        return card;
    }

    _pixbuf(kind, size) {
        const key = `${kind}/${size}`;
        if (!this.pixbufs.has(key)) {
            const path = GLib.build_filenamev([ICONS, 'flat', `${kind}.svg`]);
            this.pixbufs.set(key, GLib.file_test(path, GLib.FileTest.EXISTS)
                ? GdkPixbuf.Pixbuf.new_from_file_at_size(path, size, size) : null);
        }
        return this.pixbufs.get(key);
    }

    _drawTimeline(area, cr) {
        const pts = this.hours;
        if (!pts.length)
            return;
        const n = pts.length;
        const w = n * COL_W;
        const fg = area.get_color();
        const ink = [fg.red, fg.green, fg.blue];
        const x = i => i * COL_W + COL_W / 2;
        const sky = SKY[this.win.has_css_class('light') ? 'light' : 'dark'];
        // 하늘 띠
        const band = new Cairo.LinearGradient(0, 0, w, 0);
        pts.forEach((p, i) => {
            if (p.hour % 4 === 0 || i === 0 || i === n - 1)
                band.addColorStopRGB(x(i) / w, ...rgb(sky[Math.floor(p.hour / 4)]));
        });
        cr.setSource(band);
        cr.rectangle(0, 0, w, BAND_H);
        cr.fill();
        // 그래프
        const temps = pts.map(p => p.temp);
        const lo = Math.min(...temps) - 1;
        const hi = Math.max(...temps) + 1;
        const TOP = 86;
        const BOT = 134;
        const y = t => BOT - (t - lo) / Math.max(1, hi - lo) * (BOT - TOP);
        const grad = alpha => {
            const g = new Cairo.LinearGradient(0, 0, w, 0);
            pts.forEach((p, i) => g.addColorStopRGBA(x(i) / w, ...tcol(p.temp), alpha));
            return g;
        };
        cr.moveTo(x(0), BOT + 8);
        pts.forEach((p, i) => cr.lineTo(x(i), y(p.temp)));
        cr.lineTo(x(n - 1), BOT + 8);
        cr.closePath();
        cr.setSource(grad(0.16));
        cr.fill();
        pts.forEach((p, i) => (i ? cr.lineTo(x(i), y(p.temp)) : cr.moveTo(x(i), y(p.temp))));
        cr.setSource(grad(1));
        cr.setLineWidth(2.6);
        cr.setLineJoin(Cairo.LineJoin.ROUND);
        cr.stroke();

        const layout = PangoCairo.create_layout(cr);
        const text = (s, cx, cy, rgba, font) => {
            layout.set_font_description(Pango.FontDescription.from_string(font));
            layout.set_text(s, -1);
            const [, ext] = layout.get_pixel_extents();
            cr.setSourceRGBA(...rgba);
            cr.moveTo(cx - ext.width / 2, cy);
            PangoCairo.show_layout(cr, layout);
        };
        let midnight = 0;
        const blue = this.win.has_css_class('light') ? [0.10, 0.37, 0.71, 1] : [0.47, 0.68, 0.93, 1];
        pts.forEach((p, i) => {
            let lab = `${String(p.hour).padStart(2, '0')}시`;
            if (p.hour === 0)
                lab = ['내일', '모레', '글피'][midnight++] ?? lab;
            text(lab, x(i), 4, [...ink, p.hour === 0 ? 1 : 0.75], p.hour === 0 ? 'Sans Bold 9' : 'Sans 9');
            const pb = this._pixbuf(p.kind, 38);
            if (pb) {
                Gdk.cairo_set_source_pixbuf(cr, pb, x(i) - 19, 20);
                cr.paint();
            }
            cr.setSourceRGB(...tcol(p.temp));
            cr.arc(x(i), y(p.temp), 3.2, 0, 2 * Math.PI);
            cr.fill();
            text(`${p.temp}°`, x(i), y(p.temp) - 22, [...ink, 1], 'Sans Bold 9.5');
            const pop = p.pop ?? 0;
            text(`${pop}%`, x(i), TL_H - 20, pop >= 30 ? blue : [...ink, 0.6], pop >= 30 ? 'Sans Bold 8.5' : 'Sans 8.5');
        });
    }

    _dailyPane() {
        const pane = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        pane.append(this._heading('10일', '옆으로 밀어 10일')[0]);
        const sc = new Gtk.ScrolledWindow({vscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true});
        this.daily = new Gtk.Box({spacing: 0});
        sc.set_child(this.daily);
        dragScroll(sc, true);
        pane.append(sc);
        return pane;
    }

    _fillDaily(days) {
        clear(this.daily);
        if (!days.length)
            return;
        const lo = Math.min(...days.map(d => d.tmn));
        const hi = Math.max(...days.map(d => d.tmx));
        for (const d of days) {
            const col = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, width_request: DAY_W});
            col.append(label(d.label, ['d-day'], {xalign: 0.5}));
            col.append(label(d.date, ['d-date', 'dim-label'], {xalign: 0.5}));
            const icon = this._flatIcon(d.pmKind, 42);
            icon.halign = Gtk.Align.CENTER;
            icon.tooltip_text = `오전 ${d.wfAm ?? ''} ${d.amPop ?? '–'}% · 오후 ${d.wfPm ?? ''} ${d.pmPop ?? '–'}%`;
            col.append(icon);
            col.append(label(`${d.tmx}°`, ['d-tx'], {xalign: 0.5}));
            // 기둥: 10일 전체 최저 ~ 최고 위에 그날 최저 ~ 최고, 색은 기온(검토 2차: 기둥 길이 = 일교차)
            const bar = new Gtk.DrawingArea({vexpand: true, content_width: 12, halign: Gtk.Align.CENTER});
            bar.set_draw_func((area, cr, bw, bh) => {
                const fg = area.get_color();
                const rr = (y0, y1) => {
                    const r = bw / 2;
                    cr.newPath();
                    cr.arc(r, y0 + r, r, Math.PI, 0);
                    cr.arc(r, Math.max(y0 + r, y1 - r), r, 0, Math.PI);
                    cr.closePath();
                };
                cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.12);
                rr(0, bh);
                cr.fill();
                const yy = t => (hi - t) / Math.max(1, hi - lo) * bh;
                const g = new Cairo.LinearGradient(0, yy(d.tmx), 0, yy(d.tmn));
                g.addColorStopRGB(0, ...tcol(d.tmx));
                g.addColorStopRGB(1, ...tcol(d.tmn));
                cr.setSource(g);
                rr(yy(d.tmx), Math.max(yy(d.tmx) + bw, yy(d.tmn)));
                cr.fill();
            });
            col.append(bar);
            col.append(label(`${d.tmn}°`, ['d-tn', 'dim-label'], {xalign: 0.5}));
            col.append(label(d.pop === null ? '–' : `${d.pop}%`, ['d-pop'], {xalign: 0.5}));
            if (d.mid)
                col.tooltip_text = '중기예보';
            this.daily.append(col);
        }
    }

    _flatIcon(kind, size) {
        const img = new Gtk.Image({pixel_size: size, css_classes: ['wx']});
        const path = kind ? GLib.build_filenamev([ICONS, 'flat', `${kind}.svg`]) : null;
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS))
            img.set_from_gicon(Gio.FileIcon.new(Gio.File.new_for_path(path)));
        else
            img.icon_name = L.gnomeIcon(kind);
        return img;
    }

    // 오른쪽: 위 대기질 · 아래 기상 소식을 반씩(검토 3차)
    _rightPane() {
        const pane = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, homogeneous: true});
        const air = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        const [airHead, airNote] = this._heading('대기질');
        this.airNote = airNote;
        air.append(airHead);
        this.airGrid = new Gtk.Grid({row_spacing: 8, column_spacing: 8, row_homogeneous: true, column_homogeneous: true, vexpand: true});
        air.append(this.airGrid);
        pane.append(air);
        const news = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        const [newsHead, newsNote] = this._heading('기상 소식');
        this.newsNote = newsNote;
        news.append(newsHead);
        const sc = new Gtk.ScrolledWindow({hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true});
        this.newsLabel = label('', ['news'], {wrap: true, valign: Gtk.Align.START, selectable: false});
        sc.set_child(this.newsLabel);
        dragScroll(sc, false);
        news.append(sc);
        pane.append(news);
        return pane;
    }

    _fillAir(a, r) {
        clear(this.airGrid);
        if (!a)
            return;
        const items = [['미세먼지', a.pm10, 'µg/m³', a.g_pm10], ['초미세먼지', a.pm25, 'µg/m³', a.g_pm25],
            ['오존', a.o3, 'ppm', a.g_o3], ['통합지수', a.khai, '', a.g_khai]];
        items.forEach(([name, v, unit, g], i) => {
            const lv = g?.level ?? null;
            const tile = new Gtk.Box({spacing: 10, css_classes: lv === null ? ['aq'] : ['aq', `aq-${lv}`]});
            const face = GLib.build_filenamev([ICONS, 'air', `${lv ?? 1}.svg`]);
            const img = new Gtk.Image({pixel_size: 50, valign: Gtk.Align.CENTER, opacity: lv === null ? 0.3 : 1});
            img.set_from_gicon(Gio.FileIcon.new(Gio.File.new_for_path(face)));
            tile.append(img);
            const col = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER});
            col.append(label(name, ['aq-name']));
            col.append(label(g?.text ?? '–', lv === null ? ['aq-grade'] : ['aq-grade', `aq-g${lv}`]));
            col.append(label(v === null ? '' : `${v} ${unit}`.trim(), ['dim-label', 'caption']));
            tile.append(col);
            this.airGrid.attach(tile, i % 2, Math.floor(i / 2), 1, 1);
        });
        this.airNote.label = a.average ? `${r.air} 평균 · ${a.time?.slice(11) ?? ''}` : `측정소 ${a.station} · ${a.time?.slice(11) ?? ''}`;
    }

    _fillNews(sit, af) {
        const lines = sit ? L.newsLines(sit.wfSv1) : [];
        let t = lines.map(l => `• ${l}`).join('\n');
        if (af) {
            t += `${t ? '\n\n' : ''}미세먼지 예보(에어코리아)\n${af.overall}`;
            if (af.mine.length)
                t += `\n${af.mine.join(' · ')}`;
        }
        this.newsLabel.label = t || '받지 못함 — 새로고침을 눌러 보십시오.';
        const tm = sit ? String(sit.tmFc) : '';
        this.newsNote.label = tm ? `기상청 ${tm.slice(8, 10)}:${tm.slice(10, 12)} 발표` : '';
    }

    async refresh() {
        if (this.closed)
            return;
        // 코드 리뷰: 받는 중에 지역을 바꾸면 끝난 뒤 한 번 더(예전엔 그냥 버려 10분 동안 옛 지역이 보였다)
        if (this.busy) {
            this.pending = true;
            return;
        }
        const key = A.readKey();
        this.keyBanner.revealed = !key;
        if (!key)
            return;
        this.busy = true;
        this.spinner.start();
        const r = this.region();
        this.locLabel.label = r.n;
        const now = Date.now();
        const tmFc = L.midTmFc(now);
        const t = L.kst(now);
        const today = `${t.date.slice(0, 4)}-${t.date.slice(4, 6)}-${t.date.slice(6, 8)}`;
        const missing = [];
        const soft = (name, p) => p.catch(e => {
            if (!A.isCancelled(e))
                missing.push(`${name}(${e.message})`);
            return null;
        });
        try {
            const vb = L.vilageBase(now);
            const eb = L.extremesBase(now);
            const [ncst, usfcst, vil, ext, ta, land, warn, air, sit, af] = await Promise.all([
                soft('실황', this.client.ncst(r, now, key)),
                soft('초단기', this.client.usfcst(r, now, key)),
                soft('단기', this.client.vilage(r, vb, key)),
                soft('오늘 최고 · 최저', this.client.vilage(r, eb, key)),
                this._cached('midTa', `${r.ta}/${tmFc}`, 12 * 3600000, () => soft('중기 기온', this.client.midTa(r, tmFc, key))),
                this._cached('midLand', `${r.land}/${tmFc}`, 12 * 3600000, () => soft('중기 날씨', this.client.midLand(r, tmFc, key))),
                soft('특보', this.client.warnings(key)),
                soft('대기질', this.client.air(r, key)),
                this._cached('situation', `${r.stn}`, 3600000, () => soft('기상 개황', this.client.situation(r, key))),
                this._cached('airForecast', today, 3600000, () => soft('미세먼지 예보', this.client.airForecast(today, key))),
            ]);
            if (this.closed)
                return;
            const v = L.buildView({ncst: ncst ?? [], usfcst: usfcst ?? [], vilage: vil ?? [], extremes: ext ?? [],
                now, lat: r.lat, lon: r.lon});
            if (v) {
                this.bigKind = this.big.has(v.kind) ? v.kind : null;
                if (this.bigKind)
                    this.nowIcon.set_from_paintable(this.big.texture(this.bigKind, null));
                else
                    this.nowIcon.icon_name = v.icon;
                this.nowTemp.label = `${v.temp}°`;
                this.nowText.label = v.text;
                const parts = [`최고 ${v.tmx ?? '–'}° · 최저 ${v.tmn ?? '–'}°`];
                if (v.reh !== null)
                    parts.push(`습도 ${v.reh}%`);
                if (v.wsd !== null)
                    parts.push(`바람 ${v.wsd} m/s`);
                this.nowDetail.label = parts.join(' · ');
            }
            const sun = L.sunTimes(r.lat, r.lon, now);
            this.sunLabel.label = `일출 ${L.hhmm(sun.rise)} · 일몰 ${L.hhmm(sun.set)}`;

            const w = warn ? L.warnings(warn, r.warn, now) : [];
            this.warnPill.visible = w.length > 0;
            if (w.length) {
                this.warnPill.label = `⚠ ${w[0].name}${w[0].pending ? ' 예정' : ''}${w.length > 1 ? ` 외 ${w.length - 1}` : ''}`;
                this.warnPill.tooltip_text = w.map(x => `${x.name}${x.pending ? `(${L.hhmm(x.start)} 발효)` : ''} — ${x.areas.join(', ')}`).join('\n');
            }

            this.hours = L.buildHourly({usfcst: usfcst ?? [], vilage: vil ?? [], now, lat: r.lat, lon: r.lon});
            this.graph.content_width = Math.max(COL_W, this.hours.length * COL_W);
            this.graph.queue_draw();
            this._fillDaily(L.buildDaily({vilage: vil ?? [], extremes: ext ?? [], midTa: ta ?? [], midLand: land ?? [], tmFc, now}));
            this._fillAir(air ? L.pickAir(air, r.st) : null, r);
            this._fillNews(sit?.[0] ?? null, af ? L.airForecast(af, r.air, today) : null);
            const nb = L.ncstBase(now);
            this.issued.label = `${nb.time.slice(0, 2)}:00 실황\n${vb.time.slice(0, 2)}시 단기 · ${tmFc.slice(8, 10)}시 중기`;
            this.note.label = missing.length ? `받지 못함: ${missing.join(', ')} — 새로고침을 눌러 보십시오.` : '';
            this.note.visible = missing.length > 0;
            if (SNAPSHOT)
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => this._snapshotSoon());
        } finally {
            this.busy = false;
            this.spinner.stop();
            if (this.pending && !this.closed) {
                this.pending = false;
                this.refresh();
            }
        }
    }

    // 코드 리뷰: 하루 두 번(06 · 18시)만 바뀌는 중기예보, 몇 시간 간격인 기상 개황 · 미세먼지 예보는 10분마다 다시 받지 않는다.
    // 값: 중기 = 같은 지역 · 같은 발표(tmFc)면 그대로, 개황 · 미세먼지 예보 = 같은 지역이면 1시간.
    _cached(name, key, ttlMs, fetch) {
        this.cache ??= new Map();
        const c = this.cache.get(name);
        if (c && c.key === key && Date.now() - c.at < ttlMs)
            return Promise.resolve(c.data);
        return fetch().then(data => {
            if (data)
                this.cache.set(name, {key, at: Date.now(), data});
            return data;
        });
    }

    // 함정: Wayland 화면 캡처는 다른 프로그램이 못 한다 → 확인용으로 앱이 자기 창을 PNG로 그리고 끝난다.
    //       다시 그려진 직후에만 그림이 나오므로 다시 그리기를 요청하고 after-paint 에서 받는다(화면이 잠겨 있으면 오지 않는다).
    _snapshotSoon() {
        const fc = this.win.get_frame_clock();
        const id = fc.connect('after-paint', () => {
            fc.disconnect(id);
            const snap = new Gtk.Snapshot();
            new Gtk.WidgetPaintable({widget: this.win}).snapshot(snap, this.win.get_width(), this.win.get_height());
            const node = snap.to_node();
            if (node)
                this.win.get_renderer().render_texture(node, null).save_to_png(SNAPSHOT);
            this.win.close();
        });
        this.win.queue_draw();
        this.graph.queue_draw();
        return GLib.SOURCE_REMOVE;
    }
}

const app = new Adw.Application({application_id: SNAPSHOT ? `${APP_ID}.Snapshot` : APP_ID,
    flags: SNAPSHOT ? Gio.ApplicationFlags.NON_UNIQUE : Gio.ApplicationFlags.DEFAULT_FLAGS});
app.connect('startup', () => {
    const css = new Gtk.CssProvider();
    css.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
});
app.connect('activate', () => {
    const w = app.get_active_window();
    if (w)
        w.present();
    else
        new WeatherWindow(app);
});
app.run([programInvocationName, ...programArgs]);
