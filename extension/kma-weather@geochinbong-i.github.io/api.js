// SPDX-License-Identifier: GPL-2.0-or-later
// 왜: 기상청 · 에어코리아 호출을 확장(상단 바)과 앱이 함께 쓴다. GNOME Shell 모듈을 쓰지 않는다(앱에서도 불러오기 위해).
// 불변: 인증키는 ~/.config/kma-weather/kma.env 에서만 읽고(이전 판 위치 ~/.config/sugar-weather/ 도 봄), 로그 · 오류 글에 키를 넣지 않는다.
// 함정: 인코딩 키는 이미 URL 인코딩돼 있어 그대로 붙인다(다시 인코딩하면 거부). 키 오류는 JSON 이 아니라 XML 로 온다.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import * as L from './logic.js';

// 값: 인증키 파일 위치 — 앞의 것부터 찾는다. 둘째는 이전 판의 위치(호환).
const KEY_PATHS = [
    GLib.build_filenamev([GLib.get_user_config_dir(), 'kma-weather', 'kma.env']),
    GLib.build_filenamev([GLib.get_user_config_dir(), 'sugar-weather', 'kma.env']),
];
export const keyPath = () => KEY_PATHS.find(p => GLib.file_test(p, GLib.FileTest.EXISTS)) ?? KEY_PATHS[0];
const VIL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/';
const MID = 'https://apis.data.go.kr/1360000/MidFcstInfoService/';
const WRN = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/';
const AIR = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/';
const MSG = 'https://apis.data.go.kr/1360000/VilageFcstMsgService/';

export function readKey() {
    try {
        const [ok, bytes] = GLib.file_get_contents(keyPath());
        if (!ok)
            return null;
        return L.parseEnv(new TextDecoder().decode(bytes)).KMA_SERVICE_KEY_ENCODED || null;
    } catch (e) {
        return null;
    }
}

export const isCancelled = e => Boolean(e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED));

export class Client {
    constructor(userAgent) {
        this._session = new Soup.Session({timeout: 15, user_agent: userAgent});
        this._cancel = new Gio.Cancellable();
    }

    close() {
        this._cancel.cancel();
        this._session.abort();
    }

    _get(url, key) {
        const msg = Soup.Message.new('GET', `${url}&serviceKey=${key}`);
        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancel, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (msg.get_status() !== Soup.Status.OK)
                        throw new Error(`HTTP ${msg.get_status()}`);
                    const text = new TextDecoder().decode(bytes.get_data());
                    let body;
                    try {
                        body = JSON.parse(text);
                    } catch (e) {
                        const m = text.match(/<returnAuthMsg>([^<]*)</);
                        throw new Error(m ? `인증 ${m[1]}` : 'JSON 아님');
                    }
                    const code = L.resultCode(body);
                    // 값: 03 = 자료 없음(빈 결과, 오류 아님)
                    if (code !== '00' && code !== '03')
                        throw new Error(`결과 코드 ${code}`);
                    resolve(L.items(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _vil(op, rows, base, r, key) {
        return this._get(`${VIL}${op}?dataType=JSON&pageNo=1&numOfRows=${rows}` +
            `&base_date=${base.date}&base_time=${base.time}&nx=${r.x}&ny=${r.y}`, key);
    }

    ncst(r, now, key) {
        return this._vil('getUltraSrtNcst', 20, L.ncstBase(now), r, key);
    }

    usfcst(r, now, key) {
        return this._vil('getUltraSrtFcst', 60, L.usfcstBase(now), r, key);
    }

    // 값: 1200줄 ≈ 3일 × 24시간 × 항목 12종 + 여유
    vilage(r, base, key) {
        return this._vil('getVilageFcst', 1200, base, r, key);
    }

    midTa(r, tmFc, key) {
        return this._get(`${MID}getMidTa?dataType=JSON&pageNo=1&numOfRows=10&regId=${r.ta}&tmFc=${tmFc}`, key);
    }

    midLand(r, tmFc, key) {
        return this._get(`${MID}getMidLandFcst?dataType=JSON&pageNo=1&numOfRows=10&regId=${r.land}&tmFc=${tmFc}`, key);
    }

    // 전국 현재 특보 한 번에(약 80줄) — 우리 구역은 L.warnings 로 거른다.
    warnings(key) {
        return this._get(`${WRN}getPwnCd?dataType=JSON&pageNo=1&numOfRows=1000`, key);
    }

    // 기상 개황(통보문) — 시도별 발표 지점(r.stn). 최근 발표 1건.
    situation(r, key) {
        return this._get(`${MSG}getWthrSituation?dataType=JSON&pageNo=1&numOfRows=1&stnId=${r.stn}`, key);
    }

    // 에어코리아 미세먼지 예보 통보(오늘, 미세먼지). date = 'YYYY-MM-DD'
    airForecast(date, key) {
        return this._get(`${AIR}getMinuDustFrcstDspth?returnType=json&numOfRows=5&pageNo=1&informCode=PM10&searchDate=${date}`, key);
    }

    air(r, key) {
        return this._get(`${AIR}getCtprvnRltmMesureDnsty?returnType=json&numOfRows=300&pageNo=1&ver=1.3` +
            `&sidoName=${encodeURIComponent(r.air)}`, key);
    }
}

// 지역 목록(regions.json)과 설정의 지역 이름 → 지역 하나. 없으면 첫 지역(서울 종로구 기본값과 같은 이름이 있으면 그것).
export function loadRegions(dir) {
    const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([dir, 'regions.json']));
    return JSON.parse(new TextDecoder().decode(bytes));
}

export function findRegion(regions, name) {
    return regions.find(r => r.n === name) ?? regions.find(r => r.n === '서울특별시 종로구') ?? regions[0];
}
