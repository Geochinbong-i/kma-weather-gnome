// SPDX-License-Identifier: GPL-2.0-or-later
// 왜: 기상청 · 에어코리아 응답 → 화면 값 변환, 발표 시각 계산, 일출 · 일몰 계산. 확장과 앱이 함께 쓴다.
//     GNOME 모듈을 쓰지 않아 gjs 단독으로 시험한다(tests/test_logic.js).
// 출처: 단기 규칙 = 앞선 구현(2026-08 실측으로 확인)에서 옮김.
//       중기 · 특보 칸 이름 = 공공데이터포털의 기상청 활용 가이드(중기예보 · 기상특보 조회서비스). 미세먼지 등급 = 환경부 4단계.
// 불변: 시각은 늘 한국 시간(UTC+9, 서머타임 없음)으로 계산한다 — 보드 시간대 설정과 무관.

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

const pad = n => String(n).padStart(2, '0');

export function kst(ms) {
    const d = new Date(ms + KST_MS);
    return {
        date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        dow: d.getUTCDay(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
    };
}

// 'YYYYMMDD' + 'HHMM' (한국 시각) → epoch ms
export function kstMs(date, time = '0000') {
    return Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8),
        +time.slice(0, 2), +time.slice(2, 4)) - KST_MS;
}

// ── 발표 시각 ──────────────────────────────────────────

// 실황: 매시 정시 발표, 40분 뒤 조회 가능.
export function ncstBase(ms) {
    const t = kst(ms - 40 * 60000);
    return {date: t.date, time: `${pad(t.hour)}00`};
}

// 초단기예보: 매시 30분 발표, 45분 뒤 조회 가능.
export function usfcstBase(ms) {
    const t = kst(ms - 45 * 60000);
    return {date: t.date, time: `${pad(t.hour)}30`};
}

// 단기예보: 02·05·…·23시 발표, 10분 뒤 조회 가능. 02:10 이전이면 어제 23시.
export function vilageBase(ms) {
    const t = kst(ms - 10 * 60000);
    for (const h of [23, 20, 17, 14, 11, 8, 5, 2]) {
        if (t.hour >= h)
            return {date: t.date, time: `${pad(h)}00`};
    }
    return {date: kst(ms - 10 * 60000 - DAY_MS).date, time: '2300'};
}

// 오늘 최고·최저가 모두 들어 있는 발표: 그날 02시(02:10 이후) 또는 어제 23시.
// 함정: 늦은 발표본은 지나간 TMN·TMX를 뺀다(2026-08-08 실측) — 그래서 이른 발표본을 따로 받는다.
export function extremesBase(ms) {
    const t = kst(ms - 10 * 60000);
    if (t.hour >= 2)
        return {date: t.date, time: '0200'};
    return {date: kst(ms - 10 * 60000 - DAY_MS).date, time: '2300'};
}

// 중기예보: 06 · 18시 발표(조회는 발표 뒤 몇 분 — 20분 여유). 06:20 이전이면 어제 18시.
export function midTmFc(ms) {
    const t = kst(ms - 20 * 60000);
    if (t.hour >= 18)
        return `${t.date}1800`;
    if (t.hour >= 6)
        return `${t.date}0600`;
    return `${kst(ms - 20 * 60000 - DAY_MS).date}1800`;
}

// ── 해 · 밤 ────────────────────────────────────────────

// 일출 · 일몰(epoch ms). NOAA 태양 위치 근사식, 대기 굴절 포함 천정각 90.833°. 오차 약 ±1분.
// 출처: NOAA Global Monitoring Laboratory "General Solar Position Calculations".
export function sunTimes(lat, lon, ms) {
    const t = kst(ms);
    const base = Date.UTC(+t.date.slice(0, 4), +t.date.slice(4, 6) - 1, +t.date.slice(6, 8));
    const doy = Math.round((base - Date.UTC(+t.date.slice(0, 4), 0, 1)) / DAY_MS) + 1;
    const g = 2 * Math.PI / 365 * (doy - 1 + 0.5);
    const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
        0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
        0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const r = Math.PI / 180;
    const cosH = Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl);
    const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) / r;
    // 남중 시각(UTC, 분). base = 한국 날짜의 UTC 0시. 일출은 음수 분(전날 UTC)이 되지만 ms로 더하면 그대로 맞다.
    const noonUtcMin = 720 - 4 * lon - eqt;
    return {rise: base + (noonUtcMin - 4 * ha) * 60000, set: base + (noonUtcMin + 4 * ha) * 60000};
}

export function isNight(ms, lat, lon) {
    if (lat === undefined || lon === undefined) {
        const h = kst(ms).hour;
        return h < 6 || h >= 18;
    }
    const s = sunTimes(lat, lon, ms);
    return ms < s.rise || ms >= s.set;
}

export const hhmm = ms => {
    const t = kst(ms);
    return `${pad(t.hour)}:${pad(t.minute)}`;
};

// ── 하늘 · 강수 → 글 · 아이콘 ─────────────────────────

// 값: SKY 1 맑음 · 3 구름많음 · 4 흐림 / PTY 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 4 소나기 · 5 빗방울 · 6 빗방울눈날림 · 7 눈날림
const PTY_TEXT = {1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림'};
const SKY_TEXT = {1: '맑음', 3: '구름많음', 4: '흐림'};

// kind = Meteocons 파일 이름(상단 바 monochrome · 앱 flat · 지금 큰 아이콘 fill 움직임).
// 출처: npm @meteocons/svg 0.1.0. 아래 14종만 쓰고 tools/build_icons.py 가 이 목록대로 파일을 만든다.
export const KINDS = ['clear-day', 'clear-night', 'partly-cloudy-day', 'partly-cloudy-night', 'overcast',
    'overcast-rain', 'rain', 'sleet', 'snow', 'drizzle', 'partly-cloudy-day-rain', 'partly-cloudy-night-rain',
    'thunderstorms-day-rain', 'thunderstorms-night-rain'];

// kind → GNOME 기본 아이콘(색 아이콘 파일이 없을 때 대신)
const GNOME = {
    'clear-day': 'weather-clear-symbolic', 'clear-night': 'weather-clear-night-symbolic',
    'partly-cloudy-day': 'weather-few-clouds-symbolic', 'partly-cloudy-night': 'weather-few-clouds-night-symbolic',
    'overcast': 'weather-overcast-symbolic', 'overcast-rain': 'weather-showers-symbolic', 'rain': 'weather-showers-symbolic',
    'sleet': 'weather-snow-symbolic', 'snow': 'weather-snow-symbolic', 'drizzle': 'weather-showers-scattered-symbolic',
    'partly-cloudy-day-rain': 'weather-showers-scattered-symbolic',
    'partly-cloudy-night-rain': 'weather-showers-scattered-symbolic',
    'thunderstorms-day-rain': 'weather-storm-symbolic', 'thunderstorms-night-rain': 'weather-storm-symbolic',
};
export const gnomeIcon = kind => GNOME[kind] ?? 'weather-severe-alert-symbolic';

const PTY_KIND = {1: 'rain', 2: 'sleet', 3: 'snow', 5: 'drizzle', 6: 'sleet', 7: 'snow'};

// 불변: 낙뢰(LGT) > 강수(PTY) > 하늘(SKY). night 가 참이면 밤 아이콘.
export function condition(sky, pty, lgt, night) {
    const dn = night ? 'night' : 'day';
    const done = (text, kind) => ({text, kind, icon: gnomeIcon(kind)});
    if (Number(lgt) > 0)
        return done('뇌우', `thunderstorms-${dn}-rain`);
    const p = String(pty ?? '0');
    if (p !== '0' && PTY_TEXT[p])
        return done(PTY_TEXT[p], p === '4' ? `partly-cloudy-${dn}-rain` : PTY_KIND[p]);
    const s = String(sky ?? '');
    if (s === '1')
        return done(SKY_TEXT[s], `clear-${dn}`);
    if (s === '3')
        return done(SKY_TEXT[s], `partly-cloudy-${dn}`);
    if (s === '4')
        return done(SKY_TEXT[s], 'overcast');
    return {text: '', kind: null, icon: 'weather-severe-alert-symbolic'};
}

// 중기 하늘 글("구름많고 비/눈" 등) → kind. 낮 아이콘만(일별 목록용).
export function midKind(wf) {
    const s = wf ?? '';
    if (s.includes('비/눈') || s.includes('눈/비'))
        return 'sleet';
    if (s.includes('눈'))
        return 'snow';
    if (s.includes('소나기'))
        return 'partly-cloudy-day-rain';
    if (s.includes('비'))
        return s.includes('흐') ? 'overcast-rain' : 'rain';
    if (s.includes('흐'))
        return 'overcast';
    if (s.includes('구름'))
        return 'partly-cloudy-day';
    if (s.includes('맑'))
        return 'clear-day';
    return null;
}

export const midIcon = wf => gnomeIcon(midKind(wf));

// ── 응답 다루기 ────────────────────────────────────────

// 응답 본문에서 항목 배열만. 형태가 다르면 빈 배열. (기상청 · 에어코리아 공통)
export function items(body) {
    const it = body?.response?.body?.items?.item ?? body?.response?.body?.items;
    if (!it)
        return [];
    return Array.isArray(it) ? it : [it];
}

// 결과 코드. '00'이 정상, '03'은 자료 없음.
export function resultCode(body) {
    return body?.response?.header?.resultCode ?? null;
}

// 예보 항목 → {'YYYYMMDDHHMM': {CAT: 값}}
function byTime(list) {
    const m = {};
    for (const i of list) {
        const k = `${i.fcstDate}${i.fcstTime}`;
        (m[k] ??= {})[i.category] = i.fcstValue;
    }
    return m;
}

export function pickExtreme(list, category, date) {
    const hit = list.find(i => i.category === category && i.fcstDate === date);
    const v = hit ? Number(hit.fcstValue) : NaN;
    return Number.isFinite(v) ? v : null;
}

const num = v => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// ── 화면 값 ───────────────────────────────────────────

// 지금 + 5시간(상단 바). 실황이 없으면 null(0°로 보이면 안 된다).
// 5칸 = 지금 다음 정시부터 5시간. 기온·하늘은 초단기예보 우선, 없으면 단기예보. 강수확률은 단기예보에만 있다.
export function buildView({ncst, usfcst, vilage, extremes, now, lat, lon}) {
    const obs = {};
    for (const i of ncst)
        obs[i.category] = i.obsrValue;
    if (obs.T1H === undefined)
        return null;
    const us = byTime(usfcst);
    const vil = byTime(vilage);
    const n = kst(now);

    const usKeys = Object.keys(us).sort();
    const first = usKeys.length ? us[usKeys[0]] : {};
    const cur = condition(first.SKY, obs.PTY, first.LGT, isNight(now, lat, lon));

    const today = n.date;
    const ext = extremes ?? [];
    const tmx = pickExtreme(vilage, 'TMX', today) ?? pickExtreme(ext, 'TMX', today);
    const tmn = pickExtreme(vilage, 'TMN', today) ?? pickExtreme(ext, 'TMN', today);

    const hours = [];
    for (let i = 1; hours.length < 5 && i <= 8; i++) {
        const at = now + i * 3600000;
        const t = kst(at);
        const key = `${t.date}${pad(t.hour)}00`;
        const u = us[key] ?? {};
        const v = vil[key] ?? {};
        const temp = u.T1H ?? v.TMP;
        if (temp === undefined)
            continue;
        const slotMs = kstMs(t.date, `${pad(t.hour)}00`);
        const c = condition(u.SKY ?? v.SKY, u.PTY ?? v.PTY, u.LGT, isNight(slotMs, lat, lon));
        hours.push({label: `${pad(t.hour)}:00`, temp: Math.round(Number(temp)), icon: c.icon, kind: c.kind, pop: num(v.POP)});
    }

    return {
        temp: Math.round(Number(obs.T1H)),
        text: cur.text,
        icon: cur.icon,
        kind: cur.kind,
        tmx: tmx === null ? null : Math.round(tmx),
        tmn: tmn === null ? null : Math.round(tmn),
        reh: num(obs.REH),
        wsd: num(obs.WSD),
        hours,
    };
}

// 시간별(앱 그래프): 지금 다음 정시부터 최대 count 칸.
export function buildHourly({usfcst, vilage, now, lat, lon, count = 48}) {
    const us = byTime(usfcst);
    const vil = byTime(vilage);
    const out = [];
    for (let i = 1; out.length < count && i <= count + 12; i++) {
        const t = kst(now + i * 3600000);
        const key = `${t.date}${pad(t.hour)}00`;
        const u = us[key] ?? {};
        const v = vil[key] ?? {};
        const temp = num(u.T1H ?? v.TMP);
        if (temp === null)
            continue;
        const slotMs = kstMs(t.date, `${pad(t.hour)}00`);
        const c = condition(u.SKY ?? v.SKY, u.PTY ?? v.PTY, u.LGT, isNight(slotMs, lat, lon));
        out.push({ms: slotMs, hour: t.hour, newDay: t.hour === 0, temp: Math.round(temp), icon: c.icon, kind: c.kind,
            pop: num(v.POP), wsd: num(u.WSD ?? v.WSD), reh: num(u.REH ?? v.REH)});
    }
    return out;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// 일별(앱 목록): 오늘부터 days 일. 단기예보로 채울 수 있는 날은 단기(오전 = 9시 · 오후 = 15시, 강수확률 = 반나절 최대),
// 나머지는 중기(오전 · 오후 글, 8일 뒤부터는 하루 하나). 어느 쪽도 없으면 그날은 뺀다.
export function buildDaily({vilage, extremes, midTa, midLand, tmFc, now, days = 10}) {
    // 함정: 늦은 발표본(예: 20시)은 오늘 지난 시각을 빼서 오늘이 6시간 미만이 된다 → 그날 02시 발표본(extremes)을 밑에 깔고 최신으로 덮는다
    const vil = byTime([...(extremes ?? []), ...vilage]);
    const ext = extremes ?? [];
    const ta = midTa?.[0] ?? {};
    const land = midLand?.[0] ?? {};
    const out = [];
    const today = kst(now);
    for (let d = 0; d < days + 1 && out.length < days; d++) {
        const t = kst(kstMs(today.date, '1200') + d * DAY_MS);
        const hours = Object.keys(vil).filter(k => k.startsWith(t.date));
        const label = d === 0 ? '오늘' : DOW[t.dow];
        const date = `${pad(t.month)}/${pad(t.day)}`;   // 검토 2차: 요일 밑 mm/dd
        if (hours.length >= 6) {
            const slot = (h, def) => vil[`${t.date}${h}`] ?? vil[hours.find(k => k >= `${t.date}${h}`) ?? hours[0]] ?? def;
            const am = slot('0900', {});
            const pm = slot('1500', {});
            const pops = hours.map(k => num(vil[k].POP)).filter(v => v !== null);
            const amPop = hours.filter(k => k.slice(8) < '1200').map(k => num(vil[k].POP)).filter(v => v !== null);
            const pmPop = hours.filter(k => k.slice(8) >= '1200').map(k => num(vil[k].POP)).filter(v => v !== null);
            const temps = hours.map(k => num(vil[k].TMP)).filter(v => v !== null);
            const tmn = pickExtreme(vilage, 'TMN', t.date) ?? pickExtreme(ext, 'TMN', t.date) ?? Math.min(...temps);
            const tmx = pickExtreme(vilage, 'TMX', t.date) ?? pickExtreme(ext, 'TMX', t.date) ?? Math.max(...temps);
            out.push({label, date, mid: false,
                amKind: condition(am.SKY, am.PTY, undefined, false).kind,
                pmKind: condition(pm.SKY, pm.PTY, undefined, false).kind,
                pop: pops.length ? Math.max(...pops) : null,
                amPop: amPop.length ? Math.max(...amPop) : null,
                pmPop: pmPop.length ? Math.max(...pmPop) : null,
                tmn: Math.round(tmn), tmx: Math.round(tmx)});
            continue;
        }
        if (!tmFc)
            continue;
        const n = Math.round((kstMs(t.date) - kstMs(tmFc.slice(0, 8))) / DAY_MS);
        const tmn = num(ta[`taMin${n}`]);
        const tmx = num(ta[`taMax${n}`]);
        if (tmn === null || tmx === null)
            continue;
        const wfAm = land[`wf${n}Am`] ?? land[`wf${n}`];
        const wfPm = land[`wf${n}Pm`] ?? land[`wf${n}`];
        const amPop = num(land[`rnSt${n}Am`] ?? land[`rnSt${n}`]);
        const pmPop = num(land[`rnSt${n}Pm`] ?? land[`rnSt${n}`]);
        const pops = [amPop, pmPop].filter(v => v !== null);
        out.push({label, date, mid: true, amKind: midKind(wfAm), pmKind: midKind(wfPm),
            wfAm, wfPm, amPop, pmPop, pop: pops.length ? Math.max(...pops) : null, tmn, tmx});
    }
    return out;
}

// ── 특보 ──────────────────────────────────────────────

const WARN_VAR = {1: '강풍', 2: '호우', 3: '한파', 4: '건조', 5: '폭풍해일', 6: '풍랑', 7: '태풍', 8: '대설',
    9: '황사', 12: '폭염', 13: '열대야'};
const WARN_STRESS = {0: '주의보', 1: '경보', 2: '중대경보'};

// getPwnCd 전체 목록 → 우리 지역 코드에 해당하는 것만. 해제(2 · 8) · 취소는 뺀다. 같은 특보는 하나로.
// 값: startTime 이 지금보다 뒤면 "발효 예정"(예비특보가 아니라 발효 시각이 앞으로 잡힌 발표).
export function warnings(list, codes, now) {
    const set = new Set(codes ?? []);
    const seen = new Map();
    for (const w of list) {
        if (!set.has(w.areaCode) || ['2', '8'].includes(String(w.command)) || String(w.cancel) === '1')
            continue;
        const name = `${WARN_VAR[w.warnVar] ?? '기타'}${WARN_STRESS[w.warnStress] ?? '특보'}`;
        const start = w.startTime ? kstMs(String(w.startTime).slice(0, 8), String(w.startTime).slice(8, 12)) : null;
        const prev = seen.get(name);
        const areas = new Set(prev?.areas ?? []);
        areas.add(w.areaName);
        seen.set(name, {name, severe: Number(w.warnStress) >= 1, areas: [...areas],
            pending: start !== null && start > now, start});
    }
    return [...seen.values()].sort((a, b) => Number(b.severe) - Number(a.severe));
}

// ── 미세먼지 ──────────────────────────────────────────

// 값: 4단계 기준. 미세먼지 · 초미세먼지(µg/m³)는 환경부, 오존(ppm, 1시간)과 통합대기환경지수(CAI)는 에어코리아 기준.
//     PM10 ≤30 좋음 · ≤80 보통 · ≤150 나쁨 / PM2.5 ≤15 · ≤35 · ≤75 / O3 ≤0.030 · ≤0.090 · ≤0.150 / CAI ≤50 · ≤100 · ≤250
const PM_LEVELS = ['좋음', '보통', '나쁨', '매우나쁨'];
const CUTS = {pm10: [30, 80, 150], pm25: [15, 35, 75], o3: [0.03, 0.09, 0.15], khai: [50, 100, 250]};
export function pmGrade(kind, v) {
    if (v === null || v === undefined)
        return null;
    const i = CUTS[kind].findIndex(c => v <= c);
    return {level: i < 0 ? 3 : i, text: PM_LEVELS[i < 0 ? 3 : i]};
}

const stemOf = s => (s.length > 2 && /[시군구]$/.test(s) ? s.slice(0, -1) : s);

function airOf(src, round) {
    const out = {};
    for (const [k, key] of [['pm10', 'pm10Value'], ['pm25', 'pm25Value'], ['o3', 'o3Value'], ['khai', 'khaiValue']]) {
        const v = src(key);
        out[k] = v === null ? null : (round && k !== 'o3' ? Math.round(v) : v);
        out[`g_${k}`] = pmGrade(k, out[k]);
    }
    // 앞 판과 같은 이름도 남긴다(상단 바가 g10 · g25 를 쓴다)
    out.g10 = out.g_pm10;
    out.g25 = out.g_pm25;
    return out;
}

// 시도 실시간 목록 → 우리 지역 측정소(이름 같음 · 앞부분 같음), 없으면 시도 평균.
export function pickAir(list, st) {
    const valid = list.filter(i => num(i.pm10Value) !== null || num(i.pm25Value) !== null);
    let hit = st ? valid.find(i => i.stationName === st) : null;
    if (!hit && st)
        hit = valid.find(i => i.stationName.startsWith(stemOf(st)));
    if (hit)
        return {...airOf(k => num(hit[k]), false), station: hit.stationName, average: false, time: hit.dataTime};
    const avg = k => {
        const v = valid.map(i => num(i[k])).filter(x => x !== null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const out = airOf(avg, true);
    if (out.pm10 === null && out.pm25 === null)
        return null;
    if (out.o3 !== null)
        out.o3 = Math.round(out.o3 * 1000) / 1000;
    return {...out, station: null, average: true, time: valid[0]?.dataTime ?? null};
}

// 기상 개황(통보문 wfSv1) → 줄 목록. □ · ○ 로 시작하는 줄이 새 항목, 들여쓴 줄은 앞 항목에 붙인다.
export function newsLines(text) {
    const out = [];
    for (const raw of (text ?? '').split('\n')) {
        const line = raw.trim();
        if (!line)
            continue;
        if (/^[□○]/.test(line) || !out.length)
            out.push(line.replace(/^[□○]\s*/, ''));
        else
            out[out.length - 1] += ` ${line}`;
    }
    return out;
}

// 에어코리아 미세먼지 예보(오늘 발표분) → {overall, mine}. informGrade 는 "서울 : 좋음,경기북부 : 보통,…".
// 함정: 경기 · 강원은 예보 권역이 둘(경기북부 · 경기남부, 영서 · 영동) — 둘 다 보인다.
const AIR_ZONES = {경기: ['경기북부', '경기남부'], 강원: ['영서', '영동'], 전남광주: ['광주', '전남']};
// 함정: 응답에는 오늘 · 내일 · 모레 예보가 섞여 온다 → informData 가 오늘인 것 중 dataTime 이 가장 늦은 것.
export function airForecast(items, sido, today) {
    const it = (items ?? []).filter(i => !today || i.informData === today)
        .sort((a, b) => String(b.dataTime ?? '').localeCompare(String(a.dataTime ?? '')))[0];
    if (!it)
        return null;
    const grades = Object.fromEntries((it.informGrade ?? '').split(',').map(x => x.split(':').map(y => y.trim())).filter(x => x.length === 2));
    const zones = AIR_ZONES[sido] ?? [sido];
    const mine = zones.filter(z => grades[z]).map(z => `${z} ${grades[z]}`);
    return {overall: (it.informOverall ?? '').replace(/^○\s*/, '').trim(), mine, cause: (it.informCause ?? '').replace(/^○\s*/, '').trim()};
}

// ── 그 밖 ─────────────────────────────────────────────

// kma.env 내용 → {KEY: 값}. 주석 줄과 빈 줄은 건너뛴다.
export function parseEnv(text) {
    const out = {};
    for (const line of text.split('\n')) {
        const s = line.trim();
        if (!s || s.startsWith('#') || !s.includes('='))
            continue;
        const at = s.indexOf('=');
        out[s.slice(0, at).trim()] = s.slice(at + 1).trim();
    }
    return out;
}

// 시군구 검색: 띄어 쓴 낱말이 모두 들어 있으면 일치("서울 종로" → 서울특별시 종로구).
export function searchRegions(regions, query, limit = 30) {
    const words = query.split(/\s+/).filter(Boolean);
    if (!words.length)
        return [];
    return regions.filter(r => words.every(w => r.n.replace(/\s+/g, '').includes(w) || r.n.includes(w))).slice(0, limit);
}
