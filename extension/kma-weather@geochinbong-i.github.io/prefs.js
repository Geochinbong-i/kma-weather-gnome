// SPDX-License-Identifier: GPL-2.0-or-later
// 왜: 기상청 날씨 칸의 지역(시군구) 고르기 창. 날씨 칸을 누르면 열린다.
// 출처: regions.json = tools/make_regions.py 가 기상청 격자 엑셀(2026-10판)에서 뽑은 시군구 256곳.
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as A from './api.js';
import * as L from './logic.js';

export default class KmaWeatherPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([this.path, 'regions.json']));
        const regions = JSON.parse(new TextDecoder().decode(bytes));

        const page = new Adw.PreferencesPage({title: '기상청 날씨', icon_name: 'weather-few-clouds-symbolic'});
        window.add(page);
        window.set_default_size(460, 640);

        const cur = new Adw.PreferencesGroup({title: '지금 지역'});
        const curRow = new Adw.ActionRow({title: settings.get_string('region-name')});
        const showGrid = () => {
            curRow.title = settings.get_string('region-name');
            curRow.subtitle = `기상청 격자 ${settings.get_int('nx')}, ${settings.get_int('ny')}`;
        };
        showGrid();
        cur.add(curRow);
        page.add(cur);

        const find = new Adw.PreferencesGroup({
            title: '지역 바꾸기',
            description: '시 · 군 · 구 이름으로 찾습니다. 예: 종로, 수원 장안, 제주',
        });
        const entry = new Gtk.SearchEntry({placeholder_text: '지역 이름', margin_bottom: 8});
        const list = new Gtk.ListBox({css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE});
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        box.append(entry);
        box.append(list);
        find.add(box);
        page.add(find);

        const fill = () => {
            let child;
            while ((child = list.get_first_child()))
                list.remove(child);
            const hits = L.searchRegions(regions, entry.text);
            list.visible = hits.length > 0;
            for (const r of hits) {
                const row = new Adw.ActionRow({title: r.n, activatable: true});
                row.connect('activated', () => {
                    settings.set_int('nx', r.x);
                    settings.set_int('ny', r.y);
                    settings.set_string('region-name', r.n);
                    showGrid();
                    entry.text = '';
                });
                list.append(row);
            }
        };
        entry.connect('search-changed', fill);
        fill();

        const keyPath = A.keyPath();
        const info = new Adw.PreferencesGroup({title: '인증키'});
        info.add(new Adw.ActionRow({
            title: GLib.file_test(keyPath, GLib.FileTest.EXISTS) ? '있음' : '없음 — 날씨 칸이 원래 GNOME 날씨로 보입니다',
            subtitle: keyPath,
        }));
        page.add(info);
    }
}
