// =====================================================================
// PLAYBACK ERROR TEST HARNESS
// Baseline = Q1 jaisa saaf Chrome. Har test mein Q2 ki sirf EK cheez add hoti hai.
// Run:  TEST_URL="https://..." node playback_test.js
// Optional: ONLY="BASELINE,A_script_block"  (sirf kuch tests chalane ke liye)
// =====================================================================
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const { OBSWebSocket } = require('obs-websocket-js');

// =====================================================================
// OK.RU HARDCODED (test ko live dekhne ke liye OBS isi par stream karega)
// Channel badalna ho to sirf STREAM_CHANNEL ki value badlein (e.g. '1.3', 's1.1')
// =====================================================================
const RTMP_SERVER = 'rtmp://vsu.okcdn.ru/input/';
const STREAM_CHANNEL = '1';
const STREAM_KEYS = {
    '1': '15254238731883_15281627925099_najspfkgne', '1.1': '15254260751979_15281671637611_2plrcfqzze',
    '1.2': '15254285524587_15281717840491_7e6qdknzsu', '1.3': '16983200374379_18360218880619_efmw4fchxm',
    '1.4': '16983242579563_18360288741995_t2kh2jvcym', '1.5': '16983247822443_18360297982571_3zs5ml7gua',
    '1.6': '16983254834795_18360310237803_xrz3pf4uea', '1.7': '16983259553387_18360317971051_6khoe5efge',
    '1.8': '16983264468587_18360327342699_wsn7zgr7ee', '1.9': '16983269514859_18360335075947_363qzjlbte',
    '1.10': '16983277641323_18360347921003_rpf6hkqpdm', '1.11': '16983286554219_18360360503915_lrqraxbz3y',
    '2': '15254299352683_15281743071851_7dvz3h5d7q', '2.1': '15254308986475_15281761618539_3xca7oij3u',
    '2.2': '15254328122987_15281795566187_zjqa6bqzoq', '3': '15254341885547_15281821059691_hhlpb5vicy',
    '3.1': '15254357089899_15281848322667_sxeexgvzl4', '3.2': '15254367510123_15281868180075_pc4jrytfgm',
    '3.3': '17485986405995_19233134873195_iw63xjblny', '3.4': '17485996039787_19233150929515_d3yeoweuam',
    '3.5': '17486002789995_19233161611883_mbg22slybe', '3.6': '17486007770731_19233169934955_teme2zt4fm',
    '4': '15255022345835_15283095800427_vwrupxzstm', '4.1': '15255038074475_15283122080363_ai5qqp2we4',
    '4.2': '15255045480043_15283135842923_tldl4bhmii', '4.3': '15255208599147_15283449629291_abltofuc7m',
    '4.4': '15255217708651_15283466603115_bojrrqtlmu', '4.5': '15255227670123_15283486263915_jpntt54mve',
    '5': '17135767461483_18625099401835_4gpytlxk4a', '5.1': '15273713933931_15317494860395_avj47smmim',
    '5.2': '15273722257003_15317510195819_6edjluvdqi', '5.3': '15273739624043_15317541653099_ii4bxpvabe',
    '5.4': '15273750175339_15317561707115_csel26ku5a', '5.5': '15273760071275_15317579467371_cnewcj54me',
    '5.6': '15273767935595_15317595851371_3q43tk7tvm', '5.7': '15273778683499_15317616560747_4piekvs4wu',
    's1.1': '14204232736303_14846150314543_37jq4ryehq', 's1.2': '14204288179759_14846247373359_tnsknmapva',
    's1.3': '14204319768111_14846302489135_sr4ht4ccwq', 's1.4': '14204331957807_14846326147631_dji2acqcze',
    's1.5': '14204346572335_14846351641135_7gvns4o5ue', 's1.6': '14204361252399_14846376479279_cjajhf4d3y',
    's1.7': '14204370492975_14846393649711_6fduhdqite', 's1.8': '14204395527727_14846438017583_s2jlti7lsm',
    's1.9': '14204411387439_14846464887343_f5lxgcqj5y', 's1.10': '14204424691247_14846487562799_xmbvntt6wa',
    's2.1': '14204490948143_14846603495983_kzevn36tii', 's2.2': '14204506742319_14846634494511_ta2rxyg2oy',
    's2.3': '14204523322927_14846661233199_foqb3q7zb4', 's2.4': '14204540034607_14846689085999_gjejdie4uy',
    's2.5': '14204555304495_14846715497007_zdanghuxzu', 's2.6': '14204565200431_14846734371375_ap3bqpabpu',
    's2.7': '14204577259055_14846756194863_3ecad2535u', 's2.8': '14204592528943_14846785227311_4hjl46y62e',
    's2.9': '14204602621487_14846802594351_ilnp6lxekq', 's2.10': '14206184136239_14849618610735_ihnbx7hkoi'
};
const ACTIVE_STREAM_KEY = STREAM_KEYS[STREAM_CHANNEL];

const obs = new OBSWebSocket();
let obsProcess = null;

function setupOBSConfig() {
    const obsDir = path.join(os.homedir(), '.config', 'obs-studio');
    const profilesDir = path.join(obsDir, 'basic', 'profiles', 'Untitled');
    const scenesDir = path.join(obsDir, 'basic', 'scenes');
    const wsDir = path.join(obsDir, 'plugin_config', 'obs-websocket');
    [profilesDir, scenesDir, wsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

    fs.writeFileSync(path.join(obsDir, 'global.ini'), `[General]\nLicenseAccepted=true\nFirstRun=true\n[BasicWindow]\nShowAutoConfig=false\nWarned=true\n[OBSWebSocket]\nServerEnabled=true\nServerPort=4455\nServerPassword=secret\n`);
    fs.writeFileSync(path.join(wsDir, 'config.json'), JSON.stringify({
        alerts_enabled: false, auth_required: true, first_load: false,
        server_enabled: true, server_password: 'secret', server_port: 4455
    }, null, 2));
    fs.writeFileSync(path.join(profilesDir, 'basic.ini'), `[General]\nName=Untitled\n[Video]\nBaseCX=${W}\nBaseCY=${H}\nOutputCX=${W}\nOutputCY=${H}\nFPSCommon=30\n[Output]\nMode=Advanced\n[AdvOut]\nTrackIndex=1\nRecType=Standard\nEncoder=obs_x264\n[obs_x264]\nbitrate=3000\nkeyint_sec=2\npreset=ultrafast\nprofile=main\ntune=zerolatency\n`);
    fs.writeFileSync(path.join(profilesDir, 'service.json'), JSON.stringify({
        settings: { server: RTMP_SERVER, key: ACTIVE_STREAM_KEY.trim() }, type: 'rtmp_custom'
    }, null, 2));
    fs.writeFileSync(path.join(scenesDir, 'Untitled.json'), JSON.stringify({
        current_scene: 'MainScene', current_program_scene: 'MainScene', name: 'Untitled',
        scene_order: [{ name: 'MainScene' }],
        sources: [
            { id: 'xshm_input', name: 'Screen', settings: { show_cursor: false } },
            { id: 'pulse_output_capture', name: 'Audio', settings: {} },
            { id: 'scene', name: 'MainScene', settings: { items: [{ name: 'Screen', id: 1, visible: true }, { name: 'Audio', id: 2, visible: true }] } }
        ]
    }, null, 2));
}

async function startOBS() {
    console.log(`[OBS] Starting stream to ${RTMP_SERVER} (channel ${STREAM_CHANNEL})`);
    setupOBSConfig();
    obsProcess = spawn('obs', ['--startstreaming', '--minimize-to-tray', '--disable-updater']);
    obsProcess.stderr.on('data', d => { const m = d.toString(); if (/error|fail/i.test(m)) console.log(`[OBS Error]: ${m.trim()}`); });
    await new Promise(r => setTimeout(r, 6000));
    for (let i = 0; i < 12; i++) {
        try { await obs.connect('ws://127.0.0.1:4455', 'secret'); console.log('[OBS] WebSocket connected'); break; }
        catch (e) { await new Promise(r => setTimeout(r, 2000)); }
    }
    try { await obs.call('StartStream'); } catch (e) {}
    try { execSync('xdotool search --name "OBS" windowmove 5000 5000 windowminimize || true', { stdio: 'ignore' }); } catch (e) {}
}

async function stopOBS() {
    try { await obs.call('StopStream'); } catch (e) {}
    try { await obs.disconnect(); } catch (e) {}
    if (obsProcess) { try { obsProcess.kill('SIGKILL'); } catch (e) {} }
}

const W = 1280, H = 720;
const TEST_URL = (process.env.TEST_URL || process.env.TARGET_URLS || 'https://dadocric.st/player.php?id=starsp3&v=m').split(/[,|]/)[0].trim().replace(/^!/, '');
const WATCH_SEC = parseInt(process.env.WATCH_SEC || '20', 10);
const USE_PROXY = (process.env.PROXY_ENGINE || 'Cloudflare WARP (Recommended)').includes('Cloudflare');

const ERROR_WORDS = ['playback error', 'protected content', 'domain is blocked', 'error loading media', 'stream unavailable'];

const ALL = ['script_block', 'shadow', 'flags', 'websec', 'junk', 'ublock'];
const TESTS = [
    { name: 'BASELINE',            t: [] },
    { name: 'A_script_block',      t: ['script_block'] },
    { name: 'B_shadow_override',   t: ['shadow'] },
    { name: 'C1_extra_flags',      t: ['flags'] },
    { name: 'C2_web_security_off', t: ['websec'] },
    { name: 'D_junk_remove',       t: ['junk'] },
    { name: 'E_ublock',            t: ['ublock'] },
    { name: 'ALL_Q2_OLD_MODE',     t: ALL }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildArgs(t) {
    // Q1 ke base flags
    const a = [
        '--no-sandbox', '--disable-setuid-sandbox', `--window-size=${W},${H}`, '--window-position=0,0',
        '--kiosk', '--start-fullscreen', '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--use-gl=egl'
    ];
    if (t.includes('flags')) {
        a.push('--ignore-certificate-errors', '--ignore-gpu-blocklist',
            '--disable-accelerated-video-decode', '--disable-accelerated-video-encode',
            '--disable-smooth-scrolling',
            '--disable-features=Translate,BlinkGenPropertyTrees,CalculateNativeWinOcclusion,NetworkServiceInProcess2',
            '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding', '--alsa-output-device=default');
    }
    if (t.includes('websec')) a.push('--disable-web-security', '--allow-running-insecure-content');
    if (t.includes('ublock')) {
        const p = path.join(process.cwd(), 'ublock-lite');
        if (fs.existsSync(path.join(p, 'manifest.json'))) {
            a.push(`--disable-extensions-except=${p}`, `--load-extension=${p}`);
        } else console.log('   [!] ublock-lite folder nahi mila, E test baseline jaisa hoga');
    }
    if (USE_PROXY) a.push('--proxy-server=socks5://127.0.0.1:40000');
    return a;
}

async function setupPage(page, t) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url().toLowerCase();
        const type = req.resourceType();
        // Baseline (Q1) rule
        const bad = ['popads', 'exoclick', 'adsterra', 'onclickads', 'doubleclick', 'adexchangerapid', 'bet365', '1xbet'];
        if (bad.some(w => url.includes(w))) return req.abort().catch(() => {});
        // Test A: Q2 ka script blocking rule
        if (t.includes('script_block') && type === 'script' &&
            (url.includes('analytics') || url.includes('tracking') || url.includes('ad-delivery') || url.includes('pop') || url.includes('zone'))) {
            console.log(`   [A blocked script] ${url.substring(0, 90)}`);
            return req.abort().catch(() => {});
        }
        req.continue().catch(() => {});
    });
    page.on('dialog', d => d.dismiss().catch(() => {}));

    await page.evaluateOnNewDocument((useShadow) => {
        window.open = () => null; window.alert = () => {}; window.confirm = () => true; window.prompt = () => null;
        if (useShadow) {
            // Test B: Q2 ka attachShadow override
            const orig = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function (init) {
                if (init && init.mode === 'closed') init.mode = 'open';
                return orig.call(this, init);
            };
            Element.prototype.attachShadow.toString = function () { return 'function attachShadow() { [native code] }'; };
        }
    }, t.includes('shadow'));
}

async function removeJunk(page) {
    // Test D: Q2 ka junk removal + iframe hiding
    await page.evaluate(() => {
        const sel = '.chat, #chat, header, footer, .sidebar, .banner, .ads, [class*="overlay"]';
        document.querySelectorAll(sel).forEach(el => { try { el.remove(); } catch (e) {} });
        const ifr = Array.from(document.querySelectorAll('iframe'));
        let best = null, max = 5000;
        ifr.forEach(f => { const a = f.clientWidth * f.clientHeight; if (a > max) { max = a; best = f; } });
        if (best) {
            ifr.forEach(f => { if (f !== best) f.style.setProperty('display', 'none', 'important'); });
            best.style.cssText = 'position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;z-index:2147483645 !important;border:none !important;';
        }
    }).catch(() => {});
}

async function inspect(page) {
    let hasError = false, errWord = '', playing = false, hasVideo = false, vTime = 0;
    for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        try {
            const r = await Promise.race([
                frame.evaluate((words) => {
                    const txt = document.body ? document.body.innerText.toLowerCase() : '';
                    const w = words.find(x => txt.includes(x)) || '';
                    const v = document.querySelector('video');
                    return {
                        w, hasVideo: !!v,
                        playing: !!(v && !v.paused && v.readyState >= 2 && v.currentTime > 0),
                        t: v ? v.currentTime : 0
                    };
                }, ERROR_WORDS),
                sleep(2000).then(() => null)
            ]);
            if (!r) continue;
            if (r.w) { hasError = true; errWord = r.w; }
            if (r.hasVideo) hasVideo = true;
            if (r.playing) { playing = true; vTime = r.t; }
        } catch (e) {}
    }
    return { hasError, errWord, playing, hasVideo, vTime };
}

async function clickPlay(page) {
    for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        await frame.evaluate(() => {
            document.querySelectorAll('.jw-icon-display, .jw-icon-playback, button[data-plyr="play"], .vjs-big-play-button, .fp-play, [class*="unmute"]')
                .forEach(el => { try { el.click(); } catch (e) {} });
            document.querySelectorAll('video').forEach(v => { v.muted = false; v.play().catch(() => {}); });
        }).catch(() => {});
    }
}

async function runTest(test) {
    console.log(`\n=== TEST: ${test.name}  [${test.t.join(', ') || 'koi extra nahi'}] ===`);
    let browser;
    const res = { name: test.name, verdict: 'UNKNOWN', detail: '' };
    try {
        browser = await puppeteer.launch({
            headless: false, defaultViewport: { width: W, height: H },
            ignoreDefaultArgs: ['--enable-automation'], args: buildArgs(test.t)
        });
        const page = (await browser.pages())[0];
        await setupPage(page, test.t);
        try { await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
        catch (e) { console.log('   [!] goto warning:', e.message); }

        let firstError = null, firstPlay = null, last = {};
        const start = Date.now();
        let junkDone = false;
        while ((Date.now() - start) / 1000 < WATCH_SEC) {
            await clickPlay(page);
            if (test.t.includes('junk') && !junkDone && (Date.now() - start) > 4000) { await removeJunk(page); junkDone = true; }
            last = await inspect(page);
            const sec = Math.round((Date.now() - start) / 1000);
            if (last.hasError && firstError === null) { firstError = sec; console.log(`   [${sec}s] PLAYBACK ERROR text mila: "${last.errWord}"`); }
            if (last.playing && firstPlay === null) { firstPlay = sec; console.log(`   [${sec}s] Video chal gayi (time=${last.vTime.toFixed(1)})`); }
            await sleep(2000);
        }
        try { await page.screenshot({ path: `test_${test.name}.png` }); } catch (e) {}

        if (last.hasError || firstError !== null) { res.verdict = 'ERROR'; res.detail = `error "${last.errWord}" at ${firstError}s`; }
        else if (last.playing) { res.verdict = 'OK'; res.detail = `video playing, time=${last.vTime.toFixed(1)}s`; }
        else if (!last.hasVideo) { res.verdict = 'NO_VIDEO'; res.detail = 'na error, na video element'; }
        else { res.verdict = 'NOT_PLAYING'; res.detail = 'video element hai lekin chal nahi rahi'; }
    } catch (e) {
        res.verdict = 'CRASH'; res.detail = e.message;
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
    }
    console.log(`   >>> RESULT: ${res.verdict} (${res.detail})`);
    return res;
}

(async () => {
    console.log(`URL: ${TEST_URL}\nWATCH: ${WATCH_SEC}s per test | Proxy: ${USE_PROXY}`);
    const only = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
    const list = only.length ? TESTS.filter(t => only.includes(t.name)) : TESTS;
    const results = [];
    await startOBS();
    for (const t of list) { results.push(await runTest(t)); await sleep(2000); }
    await stopOBS();

    console.log('\n\n================ FINAL SUMMARY ================');
    results.forEach(r => console.log(`${r.verdict.padEnd(12)} | ${r.name.padEnd(22)} | ${r.detail}`));
    const base = results.find(r => r.name === 'BASELINE');
    console.log('------------------------------------------------');
    if (base && base.verdict === 'OK') {
        const culprits = results.filter(r => r.name !== 'BASELINE' && r.verdict === 'ERROR');
        if (culprits.length) console.log('SHAK WALI CHEEZEN (baseline OK, in mein ERROR):', culprits.map(c => c.name).join(', '));
        else console.log('Koi akeli cheez error nahi de rahi. ALL ka result dekhein (combination ka masla ho sakta hai).');
    } else {
        console.log('BASELINE bhi OK nahi aaya, matlab masla Q2 ki cheezon ka nahi (URL/proxy/site check karein).');
    }
    process.exit(0);
})();
