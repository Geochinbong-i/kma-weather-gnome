// SPDX-License-Identifier: GPL-2.0-or-later
// 왜: GNOME 46 캘린더 밑 날씨 칸을 기상청 예보로 보이게 한다+ 특보 · 미세먼지 · 일출일몰 밤 아이콘.
// 불변: GNOME 원래 날씨 칸(MET Norway)은 고치지 않는다. 옆에 우리 칸을 넣고, 우리 값이 있을 때만 원래 칸을 숨긴다.
// 불변: 호출은 날짜 메뉴를 열 때만. 마지막 받기가 10분 안이면 다시 받지 않는다.
// 함정: 11-19 gnome-shell 로그 폭주(46만 줄) — 로그는 상태가 바뀔 때만 한 줄.
// 함정: 원래 칸은 날씨 앱 신호마다 스스로 visible 을 다시 켠다 → notify::visible 을 받아 다시 숨긴다.
// 불변: 아이콘 = Meteocons. 작은 칸 monochrome 멈춤(icons/small) · 지금 큰 아이콘 flat 움직임(icons/now, 장면 PNG 바꿔 끼우기).
//       움직임은 날짜 메뉴가 열려 있는 동안만.
// 함정: 상단 바 메뉴는 테마에 따라 밝거나 어둡다(Yaru 라이트 · 다크) — '늘 어둡다'고 가정했다가 라이트에서 아이콘이 안 보였다.
//       → 데스크톱 색 구성(org.gnome.desktop.interface color-scheme)으로 라이트를 판단해 한 색 아이콘 판
//         (small-on-light · small-on-dark)과 큰 아이콘 바탕 · 특보 알약 색을 바꾼다.
// 함정: 처음엔 메뉴 글자색 밝기로 판단했는데 라이트에서도 다크 판이 나왔다 — 설정값을 직접 본다.
//       Yaru 는 color-scheme 이 'prefer-dark' 일 때만 상단 바 메뉴가 어둡다('default' · 'prefer-light' = 밝음).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as A from './api.js';
import * as L from './logic.js';

const APP_ID = 'io.github.geochinbong_i.KmaWeather.desktop';
// 값: 다시 받기 간격 10분. 마지막 성공이 3시간보다 오래됐고 지금 받기도 실패하면 원래 칸으로. 20분 넘은 값엔 "n분 전".
const FRESH_MS = 10 * 60000;
const STALE_MS = 3 * 3600000;
const AGE_NOTE_MS = 20 * 60000;

// 값: 장면 바꾸기 66ms(15장/초 — icons/now/frames.json 의 fps 와 같음).
const TICK_MS = 66;

// 큰 아이콘 장면 묶음. 파일 아이콘은 한 번 만들어 둔다.
class Frames {
    constructor(dir) {
        this._dir = dir;
        this._cache = new Map();
        try {
            const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, 'frames.json']));
            this._meta = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            this._meta = {};
        }
    }

    has(kind) {
        return Boolean(kind && this._meta[kind]);
    }

    icon(kind, ms) {
        const m = this._meta[kind];
        const i = ms === null ? 0 : Math.floor(ms / 1000 * m.fps) % m.frames;
        const key = `${kind}/${i}`;
        let g = this._cache.get(key);
        if (!g) {
            g = Gio.FileIcon.new(Gio.File.new_for_path(
                GLib.build_filenamev([this._dir, kind, `${String(i).padStart(3, '0')}.png`])));
            this._cache.set(key, g);
        }
        return g;
    }
}

const KmaSection = GObject.registerClass(
class KmaSection extends St.Button {
    _init(onClick, iconDir) {
        this._iconDir = iconDir;
        this._frames = new Frames(GLib.build_filenamev([iconDir, 'now']));
        this._bigKind = null;
        // 출처: GNOME 46 dateMenu.js WeatherSection 과 같은 스타일 클래스 — 테마가 그대로 적용된다.
        super._init({style_class: 'weather-button', can_focus: true, x_expand: true});
        const box = new St.BoxLayout({style_class: 'weather-box', vertical: true, x_expand: true});
        this.child = box;

        const titleBox = new St.BoxLayout({style_class: 'weather-header-box'});
        const title = new St.Label({
            text: '날씨', style_class: 'weather-header',
            x_align: Clutter.ActorAlign.START, x_expand: true, y_align: Clutter.ActorAlign.END,
        });
        this.labelActor = title;
        this._location = new St.Label({
            style_class: 'weather-header location',
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.END,
        });
        titleBox.add_child(title);
        titleBox.add_child(this._location);
        box.add_child(titleBox);

        const sum = new St.BoxLayout({style_class: 'kma-summary'});
        this._sumIcon = new St.Icon({style_class: 'kma-summary-icon'});
        const chip = new St.Bin({style_class: 'kma-big-chip', y_align: Clutter.ActorAlign.CENTER, child: this._sumIcon});
        this._sumTemp = new St.Label({style_class: 'kma-summary-temp', y_align: Clutter.ActorAlign.CENTER});
        const right = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER});
        // 특보: 날씨 문구 오른쪽 알약(검토 2차)
        const condBox = new St.BoxLayout({style_class: 'kma-cond-box'});
        this._sumText = new St.Label({style_class: 'kma-summary-text', y_align: Clutter.ActorAlign.CENTER});
        this._warn = new St.Label({style_class: 'kma-pill', visible: false, y_align: Clutter.ActorAlign.CENTER});
        condBox.add_child(this._sumText);
        condBox.add_child(this._warn);
        this._sumMinMax = new St.Label({style_class: 'kma-summary-minmax'});
        this._sumAir = new St.Label({style_class: 'kma-summary-minmax'});
        right.add_child(condBox);
        right.add_child(this._sumMinMax);
        right.add_child(this._sumAir);
        for (const a of [chip, this._sumTemp, right])
            sum.add_child(a);
        box.add_child(sum);

        const layout = new Clutter.GridLayout({orientation: Clutter.Orientation.VERTICAL});
        this._grid = new St.Widget({style_class: 'weather-grid kma-grid', layout_manager: layout});
        layout.hookup_style(this._grid);
        box.add_child(this._grid);
        // 출처: 에어코리아 약관 제7조 — 자료 출처(환경부/한국환경공단) 표기 의무. 늘 보이게 둔다.
        box.add_child(new St.Label({style_class: 'kma-src', text: '자료: 기상청 · 환경부/한국환경공단'}));

        this.connect('clicked', onClick);
        // 테마가 바뀌면(라이트 ↔ 다크) 한 색 아이콘 판을 다시 고른다
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._ifaceId = this._iface.connect('changed::color-scheme', () => {
            if (this._lastArgs)
                this.show_view(...this._lastArgs);
        });
        this.connect('destroy', () => this._iface.disconnect(this._ifaceId));
    }

    loading(region) {
        this._location.text = region;
        this._warn.hide();
        this._bigKind = null;
        this._sumIcon.gicon = null;
        this._sumIcon.icon_name = 'content-loading-symbolic';
        this._sumTemp.text = '';
        this._sumText.text = '기상청 날씨 받는 중…';
        this._sumMinMax.text = '';
        this._sumAir.text = '';
        this._grid.destroy_all_children();
    }

    // 메뉴 글자색이 어두우면 라이트 테마(밝은 메뉴). 아직 스타일이 없으면(그려지기 전) 다크로 본다.
    _isLight() {
        return this._iface.get_string('color-scheme') !== 'prefer-dark';
    }

    show_view(d, region, ageMs) {
        this._lastArgs = [d, region, ageMs];
        const v = d.view;
        this._light = this._isLight();
        if (this._light)
            this.add_style_class_name('kma-light');
        else
            this.remove_style_class_name('kma-light');
        const age = ageMs > AGE_NOTE_MS ? ` (${Math.round(ageMs / 60000)}분 전)` : '';
        this._location.text = `${region}${age}`;

        const w = d.warnings ?? [];
        this._warn.visible = w.length > 0;
        if (w.length)
            this._warn.text = `⚠ ${w[0].name}${w[0].pending ? ' 예정' : ''}${w.length > 1 ? ` 외 ${w.length - 1}` : ''}`;

        this._bigKind = this._frames.has(v.kind) ? v.kind : null;
        if (this._bigKind)
            this._sumIcon.gicon = this._frames.icon(this._bigKind, null);
        else
            this._setIcon(this._sumIcon, v.kind, v.icon);
        this._sumTemp.text = `${v.temp}°`;
        const mx = v.tmx === null ? '–' : `${v.tmx}°`;
        const mn = v.tmn === null ? '–' : `${v.tmn}°`;
        this._sumText.text = v.text;
        this._sumMinMax.text = `최고 ${mx} · 최저 ${mn}`;
        const a = d.air;
        this._sumAir.text = a ? `미세 ${a.g10?.text ?? '–'} · 초미세 ${a.g25?.text ?? '–'}` : '';

        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        v.hours.forEach((h, col) => {
            const mk = (style, text) => new St.Label({style_class: style, text, x_align: Clutter.ActorAlign.CENTER});
            layout.attach(mk('weather-forecast-time', h.label), col, 0, 1, 1);
            const ic = new St.Icon({style_class: 'weather-forecast-icon kma-small-icon',
                x_align: Clutter.ActorAlign.CENTER, x_expand: true});
            this._setIcon(ic, h.kind, h.icon);
            layout.attach(ic, col, 1, 1, 1);
            layout.attach(mk('weather-forecast-temp', `${h.temp}°`), col, 2, 1, 1);
            const pop = h.pop === null ? '–' : `${h.pop}%`;
            layout.attach(mk(h.pop ? 'kma-pop' : 'kma-pop kma-pop-zero', pop), col, 3, 1, 1);
        });
    }

    tick(ms) {
        if (this._bigKind)
            this._sumIcon.gicon = this._frames.icon(this._bigKind, ms);
    }

    // Meteocons monochrome 파일이 있으면 그것, 없으면 GNOME 기본 아이콘.
    _setIcon(actor, kind, fallback) {
        const variant = this._light ? 'small-on-light' : 'small-on-dark';
        const path = kind ? GLib.build_filenamev([this._iconDir, variant, `${kind}.svg`]) : null;
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) {
            actor.gicon = Gio.FileIcon.new(Gio.File.new_for_path(path));
        } else {
            actor.gicon = null;
            actor.icon_name = fallback;
        }
    }
});

export default class KmaWeatherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._regions = A.loadRegions(this.path);
        this._client = new A.Client('kma-weather-gnome-extension');
        this._last = null;        // {view, warnings, air, at}
        this._vilage = null;      // {base, at, items}
        this._extremes = null;    // {base, at, items}
        this._state = '';
        this._lastTry = 0;
        this._busy = false;
        this._failed = false;
        this._applying = false;

        const dateMenu = Main.panel.statusArea.dateMenu;
        this._orig = dateMenu._weatherItem;
        this._section = new KmaSection(() => this._openApp(), GLib.build_filenamev([this.path, 'icons']));
        this._section.hide();
        this._orig.get_parent().insert_child_above(this._section, this._orig);

        this._origVisId = this._orig.connect('notify::visible', () => this._apply());
        this._tick = 0;
        this._menuId = dateMenu.menu.connect('open-state-changed', (_m, open) => {
            this._animate(open);
            if (!open)
                return;
            if (Date.now() - this._lastTry > FRESH_MS)
                this._refresh();
            else
                this._apply();
        });
        this._settingsId = this._settings.connect('changed::region-name', () => {
            this._last = this._vilage = this._extremes = null;
            this._lastTry = 0;
            this._apply();
        });
        this._apply();
    }

    disable() {
        this._animate(false);
        this._client.close();
        this._client = null;
        this._settings.disconnect(this._settingsId);
        Main.panel.statusArea.dateMenu.menu.disconnect(this._menuId);
        this._orig.disconnect(this._origVisId);
        this._section.destroy();
        this._section = null;
        // 원래 칸의 보이기 여부는 원래 코드가 다시 정하게 한다(날씨 앱 유무에 따라).
        this._orig._sync?.();
        this._orig = null;
        this._settings = null;
        this._regions = null;
        this._last = this._vilage = this._extremes = null;
    }

    _animate(on) {
        if (this._tick) {
            GLib.Source.remove(this._tick);
            this._tick = 0;
        }
        if (!on)
            return;
        const t0 = GLib.get_monotonic_time();
        this._tick = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            if (this._section?.visible)
                this._section.tick((GLib.get_monotonic_time() - t0) / 1000);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _region() {
        return A.findRegion(this._regions, this._settings.get_string('region-name'));
    }

    _openApp() {
        Main.panel.closeCalendar();
        const app = Gio.DesktopAppInfo.new(APP_ID);
        if (app)
            app.launch([], null);
        else
            this.openPreferences();
    }

    _setState(state, detail = '') {
        if (state === this._state)
            return;
        this._state = state;
        console.log(`[kma-weather] ${state}${detail ? `: ${detail}` : ''}`);
    }

    // 보이기 규칙: 값이 있으면 우리 칸. 받는 중이고 값이 없으면 "받는 중". 받기 실패 + 값이 3시간 넘음(또는 없음)이면 원래 칸.
    _apply() {
        if (this._applying || !this._section)
            return;
        this._applying = true;
        try {
            const now = Date.now();
            const region = this._region().n;
            const alive = this._last && (now - this._last.at < STALE_MS || !this._failed);
            if (alive) {
                // 코드 리뷰: 원래 칸의 visible 신호마다 다시 그리지 않는다 — 메뉴가 열려 있거나 새 값일 때만
                const open = Main.panel.statusArea.dateMenu.menu.isOpen;
                if (open || this._drawnAt !== this._last.at) {
                    this._section.show_view(this._last, region, now - this._last.at);
                    this._drawnAt = this._last.at;
                }
            } else if (this._busy || (!this._failed && !this._last)) {
                this._section.loading(region);
            } else {
                this._section.hide();
                this._orig._sync?.();
                return;
            }
            this._section.show();
            if (this._orig.visible)
                this._orig.hide();
        } finally {
            this._applying = false;
        }
    }

    async _refresh() {
        if (this._busy || !this._client)
            return;
        this._busy = true;
        this._lastTry = Date.now();
        this._apply();
        try {
            const key = A.readKey();
            if (!key) {
                this._setState('키 없음', A.keyPath());
                this._failed = true;
                return;
            }
            const r = this._region();
            const now = Date.now();
            const soft = p => p.catch(e => {
                if (A.isCancelled(e))
                    throw e;
                return null;
            });
            const vb = L.vilageBase(now);
            const vbKey = `${vb.date}${vb.time}`;
            const needVil = !this._vilage || this._vilage.base !== vbKey;
            const eb = L.extremesBase(now);
            const ebKey = `${eb.date}${eb.time}`;
            const needExt = !this._extremes || this._extremes.base !== ebKey || !this._extremes.items.length;
            const [ncst, usfcst, vil, ext, warn, air] = await Promise.all([
                this._client.ncst(r, now, key),
                this._client.usfcst(r, now, key),
                needVil ? soft(this._client.vilage(r, vb, key)) : Promise.resolve(undefined),
                needExt ? soft(this._client.vilage(r, eb, key)) : Promise.resolve(undefined),
                soft(this._client.warnings(key)),
                soft(this._client.air(r, key)),
            ]);
            if (vil)
                this._vilage = {base: vbKey, at: now, items: vil};
            if (ext)
                this._extremes = {base: ebKey, at: now, items: ext};

            const view = L.buildView({
                ncst, usfcst, now, lat: r.lat, lon: r.lon,
                vilage: this._vilage?.items ?? [],
                extremes: this._extremes?.items ?? [],
            });
            if (!view)
                throw new Error('실황 기온 없음');
            this._last = {
                view, at: now,
                warnings: warn ? L.warnings(warn, r.warn, now) : this._last?.warnings ?? [],
                air: air ? L.pickAir(air, r.st) : this._last?.air ?? null,
            };
            this._failed = false;
            this._setState('정상');
        } catch (e) {
            if (A.isCancelled(e))
                return;
            this._failed = true;
            this._setState('받기 실패', e.message);
        } finally {
            this._busy = false;
            this._apply();
        }
    }
}
