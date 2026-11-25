// SPDX-License-Identifier: GPL-2.0-or-later
// 쓰는 법: gjs -m tests/test_logic.js tests/fixture.json
// 기대값: 발표 시각은 sugar_live weather.py 규칙(40·45·10분 빼기, 02:10 전 어제 23시)을 손으로 계산한 값.
import GLib from 'gi://GLib';
import * as L from '../extension/kma-weather@geochinbong-i.github.io/logic.js';
import {programArgs, exit} from 'system';

let fail = 0;
function eq(name, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok)
        fail++;
    print(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${JSON.stringify(got)}${ok ? '' : ` (기대 ${JSON.stringify(want)})`}`);
}
// 한국 시각 → epoch ms
const at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 9, mi);

eq('실황 13:57', L.ncstBase(at(2026, 11, 25, 13, 57)), {date: '20261125', time: '1300'});
eq('실황 14:39', L.ncstBase(at(2026, 11, 25, 14, 39)), {date: '20261125', time: '1300'});
eq('실황 00:20 → 어제 23시', L.ncstBase(at(2026, 11, 25, 0, 20)), {date: '20261124', time: '2300'});
eq('초단기 13:57(13:45부터 13:30 발표분)', L.usfcstBase(at(2026, 11, 25, 13, 57)), {date: '20261125', time: '1330'});
eq('초단기 13:40 → 12:30 발표분', L.usfcstBase(at(2026, 11, 25, 13, 40)), {date: '20261125', time: '1230'});
eq('초단기 14:15', L.usfcstBase(at(2026, 11, 25, 14, 15)), {date: '20261125', time: '1330'});
eq('단기 13:57', L.vilageBase(at(2026, 11, 25, 13, 57)), {date: '20261125', time: '1100'});
eq('단기 14:10', L.vilageBase(at(2026, 11, 25, 14, 10)), {date: '20261125', time: '1400'});
eq('단기 02:05 → 어제 23시', L.vilageBase(at(2026, 11, 25, 2, 5)), {date: '20261124', time: '2300'});
eq('단기 12월 1일 01:00 → 11월 30일', L.vilageBase(at(2026, 12, 1, 1, 0)), {date: '20261130', time: '2300'});
eq('최고최저 13:57', L.extremesBase(at(2026, 11, 25, 13, 57)), {date: '20261125', time: '0200'});
eq('최고최저 01:00', L.extremesBase(at(2026, 11, 25, 1, 0)), {date: '20261124', time: '2300'});

eq('중기 13:57 → 오늘 06시', L.midTmFc(at(2026, 11, 25, 13, 57)), '202611250600');
eq('중기 18:10 → 아직 06시', L.midTmFc(at(2026, 11, 25, 18, 10)), '202611250600');
eq('중기 18:30 → 오늘 18시', L.midTmFc(at(2026, 11, 25, 18, 30)), '202611251800');
eq('중기 05:00 → 어제 18시', L.midTmFc(at(2026, 11, 25, 5, 0)), '202611241800');

eq('비가 구름을 이김', L.condition('3', '1', '0', false).text, '비');
eq('낙뢰가 가장 먼저', L.condition('1', '1', '1', false).text, '뇌우');
eq('밤 맑음 아이콘', L.condition('1', '0', '0', true).icon, 'weather-clear-night-symbolic');
eq('흐림', L.condition('4', '0', undefined, false).icon, 'weather-overcast-symbolic');
eq('kind: 밤 소나기 · 밤 뇌우 · 빗방울', [L.condition('3', '4', '0', true).kind, L.condition('1', '1', '1', true).kind, L.condition('1', '5', '0', false).kind],
    ['partly-cloudy-night-rain', 'thunderstorms-night-rain', 'drizzle']);
eq('kind 는 모두 목록 안', ['1', '3', '4'].flatMap(sk => ['0', '1', '2', '3', '4', '5', '6', '7'].flatMap(pt => [true, false].flatMap(n => [L.condition(sk, pt, '0', n).kind, L.condition(sk, pt, '1', n).kind]))).every(k => L.KINDS.includes(k)), true);
eq('중기 kind', ['흐리고 비', '구름많고 비/눈', '구름많음'].map(L.midKind), ['overcast-rain', 'sleet', 'partly-cloudy-day']);
eq('중기 글 → 아이콘', ['구름많고 비', '흐리고 눈', '맑음', '구름많음', '흐림', '구름많고 소나기'].map(L.midIcon),
    ['weather-showers-symbolic', 'weather-snow-symbolic', 'weather-clear-symbolic', 'weather-few-clouds-symbolic',
        'weather-overcast-symbolic', 'weather-showers-scattered-symbolic']);

// 기대값: 한국천문연구원 출몰시각(서울) — 2026-12-21 일출 07:43 · 일몰 17:17, 2026-06-21 일출 05:11 · 일몰 19:57. 허용 ±3분.
const near = (ms, h, mi) => Math.abs(ms - at(2026, 1, 1, h, mi) - (Math.round((ms - at(2026, 1, 1, h, mi)) / 86400000) * 86400000)) <= 3 * 60000;
const w = L.sunTimes(37.5704, 126.9816, at(2026, 12, 21, 12, 0));
const s = L.sunTimes(37.5704, 126.9816, at(2026, 6, 21, 12, 0));
eq(`동지 서울 일출 ${L.hhmm(w.rise)} · 일몰 ${L.hhmm(w.set)}`, [near(w.rise, 7, 43), near(w.set, 17, 17)], [true, true]);
eq(`하지 서울 일출 ${L.hhmm(s.rise)} · 일몰 ${L.hhmm(s.set)}`, [near(s.rise, 5, 11), near(s.set, 19, 57)], [true, true]);
eq('일몰 뒤는 밤', L.isNight(at(2026, 12, 21, 17, 30), 37.57, 126.98), true);
eq('일몰 앞은 낮', L.isNight(at(2026, 12, 21, 17, 0), 37.57, 126.98), false);

eq('미세 등급 경계', [['pm10', 30], ['pm10', 31], ['pm25', 35], ['pm25', 76]].map(([k, v]) => L.pmGrade(k, v).text),
    ['좋음', '보통', '보통', '매우나쁨']);
const air = [{stationName: '중구', pm10Value: '40', pm25Value: '20'}, {stationName: '종로구', pm10Value: '27', pm25Value: '18'},
    {stationName: '종로', pm10Value: '-', pm25Value: '-'}];
eq('오존 · 통합지수 등급', [L.pmGrade('o3', 0.03).text, L.pmGrade('o3', 0.031).text, L.pmGrade('khai', 251).text], ['좋음', '보통', '매우나쁨']);
eq('개황 줄 나누기', L.newsLines('□ (종합) 비\n○ (오늘) 맑음,\n      서해5도 흐림\n○ (내일) 눈'), ['(종합) 비', '(오늘) 맑음, 서해5도 흐림', '(내일) 눈']);
eq('미세먼지 예보 권역', L.airForecast([{informOverall: '○ 전 권역 좋음', informGrade: '서울 : 좋음,경기북부 : 보통,경기남부 : 좋음'}], '경기'),
    {overall: '전 권역 좋음', mine: ['경기북부 보통', '경기남부 좋음'], cause: ''});
eq('미세먼지 예보는 오늘 것 중 최신', L.airForecast([
    {informData: '2026-11-26', dataTime: '2026-11-25 17시 발표', informOverall: '내일'},
    {informData: '2026-11-25', dataTime: '2026-11-25 05시 발표', informOverall: '오늘 아침'},
    {informData: '2026-11-25', dataTime: '2026-11-25 11시 발표', informOverall: '오늘 낮'}], '서울', '2026-11-25').overall, '오늘 낮');
eq('측정소 이름 같음', L.pickAir(air, '종로구').station, '종로구');
eq('측정소 없으면 평균', [L.pickAir(air, '양주시').average, L.pickAir(air, '양주시').pm10], [true, 34]);

const wl = [{areaCode: 'L1022110', areaName: '속초시평지', warnVar: 1, warnStress: 0, command: '1', cancel: '0', startTime: 202611251300},
    {areaCode: 'L1022120', areaName: '속초시산지', warnVar: 1, warnStress: 0, command: '1', cancel: '0', startTime: 202611251300},
    {areaCode: 'L1022110', areaName: '속초시평지', warnVar: 4, warnStress: 0, command: '2', cancel: '0', startTime: 0}];
eq('특보 거르기 · 해제 빼기 · 구역 합치기', L.warnings(wl, ['L1022110', 'L1022120'], at(2026, 11, 25, 15, 0)).map(x => [x.name, x.areas.length]),
    [['강풍주의보', 2]]);
eq('다른 지역 특보는 안 보임', L.warnings(wl, ['L1100000'], at(2026, 11, 25, 15, 0)), []);

eq('env 읽기', L.parseEnv('# 주석\nKMA_SERVICE_KEY=ab+c/d==\n\nX = 1\n'), {KMA_SERVICE_KEY: 'ab+c/d==', X: '1'});
const regions = [{n: '서울특별시 종로구', x: 60, y: 127}, {n: '부산광역시 해운대구', x: 99, y: 75}];
eq('검색 띄어쓰기 무시', L.searchRegions(regions, '서울 종로').map(r => r.n), ['서울특별시 종로구']);
eq('빈 검색', L.searchRegions(regions, '  '), []);

eq('실황 없으면 null', L.buildView({ncst: [], usfcst: [], vilage: [], extremes: [], now: 0}), null);

if (programArgs[0]) {
    const [, bytes] = GLib.file_get_contents(programArgs[0]);
    const f = JSON.parse(new TextDecoder().decode(bytes));
    for (const k of ['ncst', 'usfcst', 'vilage', 'extremes', 'midTa', 'midLand', 'warn', 'air'])
        eq(`실응답 ${k} 정상 코드`, L.resultCode(f[k]), '00');
    const loc = {lat: 37.5704, lon: 126.9816};
    const v = L.buildView({ncst: L.items(f.ncst), usfcst: L.items(f.usfcst), vilage: L.items(f.vilage),
        extremes: L.items(f.extremes), now: f.now_ms, ...loc});
    print('상단 바 값:', JSON.stringify(v));
    eq('5칸', v?.hours.length, 5);
    eq('최고·최저 있음', [v?.tmx !== null, v?.tmn !== null], [true, true]);
    eq('강수확률 5칸 모두 숫자', v?.hours.every(h => typeof h.pop === 'number'), true);
    const hr = L.buildHourly({usfcst: L.items(f.usfcst), vilage: L.items(f.vilage), now: f.now_ms, ...loc});
    print('시간별:', hr.length, '칸 첫', JSON.stringify(hr[0]), '끝', JSON.stringify(hr.at(-1)));
    eq('시간별 48칸', hr.length, 48);
    const dl = L.buildDaily({vilage: L.items(f.vilage), extremes: L.items(f.extremes), midTa: L.items(f.midTa),
        midLand: L.items(f.midLand), tmFc: f.tmFc, now: f.now_ms});
    for (const d of dl)
        print(`  ${d.label} ${d.date} ${d.mid ? '중기' : '단기'} ${d.tmn}~${d.tmx} ${d.pop}% ${d.amKind}/${d.pmKind}`);
    eq('일별 10일', dl.length, 10);
    eq('날짜 mm/dd', /^\d\d\/\d\d$/.test(dl[0].date), true);
    eq('일별 최저 ≤ 최고', dl.every(d => d.tmn <= d.tmx), true);
    print('특보(서울):', JSON.stringify(L.warnings(L.items(f.warn), ['L1100000', 'L1100100', 'L1100200', 'L1100300', 'L1100400'], f.now_ms)));
    print('특보 전국 건수:', L.items(f.warn).length);
    const a = L.pickAir(L.items(f.air), '종로구');
    print('미세먼지(종로구):', JSON.stringify(a));
    eq('종로구 측정소', a?.station, '종로구');
}

print(fail ? `실패 ${fail}` : '모두 통과');
if (fail)
    exit(1);
