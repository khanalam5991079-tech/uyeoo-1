'use strict';
/**
 * Q1 -> one-variable-at-a-time playback diagnostic harness.
 * BASELINE is launched using the exact original source bytes, without edits.
 * Variants are made from the same baseline, changing ONE feature per run.
 * Each case starts a fresh Q1 engine/one Chrome; never creates a backup Chrome.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const ROOT = __dirname;
const SOURCE = path.join(ROOT, 'question1-original.js');
const RUNS = path.join(ROOT, 'reports');
const original = fs.readFileSync(SOURCE, 'utf8');
const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex');
const observeSeconds = Number(process.env.TEST_SECONDS || 30);
const watchReadySeconds = Number(process.env.READY_TIMEOUT_SECONDS || 120);
const repeats = Number(process.env.REPEATS || 1);
const mode = (process.env.TEST_MODE || 'isolated').toLowerCase();
const captureImages = process.env.CAPTURE_SCREENSHOTS !== 'OFF';
const target = (process.env.TARGET_URLS || '').trim();

if (!Number.isFinite(observeSeconds) || observeSeconds < 10 || observeSeconds > 3600) throw Error('TEST_SECONDS must be 10..3600');
if (!Number.isFinite(repeats) || repeats < 1 || repeats > 5 || !Number.isInteger(repeats)) throw Error('REPEATS must be 1..5');
if (!['isolated', 'cumulative'].includes(mode)) throw Error('TEST_MODE must be isolated or cumulative');
if (!target || target.includes(',') || target.includes('|')) throw Error('Set TARGET_URLS to ONE exact source URL; multiple URLs would confound an A/B test.');
if (!/^https?:\/\//i.test(target)) throw Error('Set TARGET_URLS to a full http:// or https:// URL.');
fs.mkdirSync(RUNS, { recursive: true });

function replaceOnce(src, search, replacement, id) {
  const first = src.indexOf(search);
  if (first < 0) throw Error(`${id}: expected Q1 anchor missing`);
  if (src.indexOf(search, first + search.length) !== -1) throw Error(`${id}: Q1 anchor ambiguous (multiple matches)`);
  return src.slice(0, first) + replacement + src.slice(first + search.length);
}
function flagVariant(flag) {
  return source => replaceOnce(
    source,
    "    if (PROXY_ENGINE.includes('Cloudflare')) args.push('--proxy-server=socks5://127.0.0.1:40000');",
    `    args.push(${JSON.stringify(flag)});\n    if (PROXY_ENGINE.includes('Cloudflare')) args.push('--proxy-server=socks5://127.0.0.1:40000');`,
    flag
  );
}
const changes = [
  {
    id:'q2-disable-accelerated-video-decode',
    title:'Add Q2 flag: --disable-accelerated-video-decode',
    apply:flagVariant('--disable-accelerated-video-decode')
  },
  {
    id:'q2-disable-accelerated-video-encode',
    title:'Add Q2 flag: --disable-accelerated-video-encode',
    apply:flagVariant('--disable-accelerated-video-encode')
  },
  {
    id:'q2-disable-web-security',
    title:'Add Q2 OLD flag: --disable-web-security',
    apply:flagVariant('--disable-web-security')
  },
  {
    id:'q2-allow-insecure-content',
    title:'Add Q2 OLD flag: --allow-running-insecure-content',
    apply:flagVariant('--allow-running-insecure-content')
  },
  {
    id:'q2-ignore-certificate-errors',
    title:'Add Q2 flag: --ignore-certificate-errors',
    apply:flagVariant('--ignore-certificate-errors')
  },
  {
    id:'q2-disable-background-timer-throttling',
    title:'Add Q2 flag: --disable-background-timer-throttling',
    apply:flagVariant('--disable-background-timer-throttling')
  },
  {
    id:'q2-disable-renderer-backgrounding',
    title:'Add Q2 flag: --disable-renderer-backgrounding',
    apply:flagVariant('--disable-renderer-backgrounding')
  },
  {
    id:'q2-extra-script-blocker',
    title:'Add only Q2 broad script URL blocker (analytics/tracking/ad-delivery/pop/zone)',
    apply:source => replaceOnce(
      source,
      "            if (badWords.some(w => url.includes(w))) return req.abort().catch(() => {});",
      "            if (req.resourceType() === 'script' && ['analytics','tracking','ad-delivery','pop','zone'].some(w => url.includes(w))) return req.abort().catch(() => {});\n            if (badWords.some(w => url.includes(w))) return req.abort().catch(() => {});",
      'q2-extra-script-blocker'
    )
  },
  {
    id:'q2-extra-ad-domains',
    title:'Add Q2 extra blocked URL domains (jerkmate/adrevenue/fanduel)',
    apply:source => replaceOnce(
      source,
      "'adexchangerapid', 'bet365', '1xbet'",
      "'adexchangerapid', 'bet365', '1xbet', 'jerkmate', 'adrevenue', 'fanduel'",
      'q2-extra-ad-domains'
    )
  },
  {
    id:'q2-shadow-dom-open',
    title:'Add Q2 closed->open Shadow DOM monkeypatch',
    apply:source => replaceOnce(
      source,
      '            window.open = () => null;',
      `            const originalAttachShadow = Element.prototype.attachShadow;\n            Element.prototype.attachShadow = function(init) {\n                if (init && init.mode === 'closed') init = Object.assign({}, init, {mode:'open'});\n                return originalAttachShadow.call(this, init);\n            };\n            window.open = () => null;`,
      'q2-shadow-dom-open'
    )
  },
  {
    id:'q2-external-link-click-shield',
    title:'Add Q2 external link click blocking',
    apply:source => replaceOnce(
      source,
      '            window.prompt = () => null;',
      `            window.prompt = () => null;\n            document.addEventListener('click', (e) => {\n                const link = e.target && e.target.closest ? e.target.closest('a') : null;\n                if (link && link.href && !link.href.includes(window.location.hostname) && !link.href.includes('javascript')) {\n                    e.preventDefault(); e.stopPropagation();\n                }\n            }, true);`,
      'q2-external-link-click-shield'
    )
  },
  {
    id:'q2-remove-ui-overlays',
    title:'Add Q2 generic overlay/banner DOM removal during Q1 fullscreen lock',
    apply:source => replaceOnce(
      source,
      "                    if (document.body) document.body.style.setProperty('background', '#000', 'important');",
      "                    if (document.body) document.body.style.setProperty('background', '#000', 'important');\n                    document.querySelectorAll('.chat, #chat, header, footer, .sidebar, .banner, .ads, [class*=\\\"overlay\\\"]').forEach(el => { try { el.remove(); } catch(e) {} });",
      'q2-remove-ui-overlays'
    )
  },
  {
    id:'remove-q1-broad-player-clicks',
    title:'Remove only Q1 initial click-all selectors; retain HTMLVideoElement.play()',
    apply:source => replaceOnce(
      source,
      '                        document.querySelectorAll(playAndLiveSelectors).forEach(el => { try { el.click(); } catch(e){} });',
      '                        // Experiment: remove Q1 click-all selectors; preserve v.play() below.',
      'remove-q1-broad-player-clicks'
    )
  },
  {
    id:'remove-q1-ublock-extension',
    title:'Remove only optional Q1 uBlock Lite extension loading',
    apply:source => replaceOnce(
      source,
      "    if (fs.existsSync(path.join(ublockPath, 'manifest.json'))) {",
      "    if (false && fs.existsSync(path.join(ublockPath, 'manifest.json'))) {",
      'remove-q1-ublock-extension'
    )
  }
];
const selectRaw = (process.env.TEST_CASES || 'all').trim();
const wanted = selectRaw.toLowerCase() === 'all' ? changes : changes.filter(c=> selectRaw.split(',').map(s=>s.trim()).includes(c.id));
if (wanted.length === 0) throw Error('TEST_CASES matched no variants. Available: '+changes.map(c=>c.id).join(', '));

const cases = [{id:'q1-original-baseline', title:'EXACT Q1 original, unchanged', applyList:[]}];
for(let i=0;i<wanted.length;i++) cases.push({id:wanted[i].id,title:wanted[i].title,applyList:mode==='cumulative'? wanted.slice(0,i+1):[wanted[i]]});

function safeSlug(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '-'); }
function sleep(ms) { return new Promise(resolve=>setTimeout(resolve,ms)); }
async function screenshot(output) {
  if (!captureImages || !process.env.DISPLAY) return null;
  const quality = (process.env.STREAM_QUALITY || '720p');
  const size = quality === '360p' ? '640x360' : quality === '480p' ? '854x480' : /1080p|Original/i.test(quality) ? '1920x1080' : '1280x720';
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner','-loglevel','error','-nostdin','-y',
      '-f','x11grab','-video_size',size,'-framerate','1',
      '-i',`${process.env.DISPLAY}+0,0`, '-frames:v','1',output
    ], {timeout:12000, maxBuffer:512*1024});
    return path.relative(ROOT,output);
  } catch (e) { return null; }
}
function escapedCSV(s) { const t=String(s===undefined?'':s);return '"'+t.replace(/"/g,'""')+'"'; }
function toCSV(rows) {
  const cols = ['case','round','description','changes','ready','observed_seconds','healthy_reports','unhealthy_reports','playback_time_increased','decoded_frames_increased','error_lines','screenshot_count','classification','log_file'];
  return cols.join(',')+'\n'+rows.map(r=>cols.map(c=>escapedCSV(r[c])).join(',')).join('\n')+'\n';
}
function parsePlaybackReports(logText) {
  const lines = logText.split(/\r?\n/);
  const healthy = lines.filter(s=>s.includes('REPORT |') && s.includes('Playback: HEALTHY'));
  const unhealthy = lines.filter(s=>s.includes('Stream Unhealthy') || s.includes('PLAYBACK FROZEN') || s.includes('VISUAL SCREEN FROZEN') || s.includes('FRESHNESS FAIL') || s.includes('NETWORK/MANIFEST FAIL'));
  const samples = healthy.map(s=>{
    const t=s.match(/Time:([\d.]+)s/),f=s.match(/Frames:(\d+)/);
    return {time:t?Number(t[1]):null,frames:f?Number(f[1]):null};
  });
  const inc = key => samples.filter(s=>s[key]!==null).some((s,i,arr)=>i>0 && s[key]>arr[i-1][key]);
  const errors=lines.filter(s=>/player error|playback error|media.?error|failed to load|engine error|Navigation warning|OBS Error|UNCAUGHT EXCEPTION/i.test(s));
  return { healthy:healthy.length,unhealthy:unhealthy.length,timeAdvanced:inc('time'),framesAdvanced:inc('frames'),errorLines:errors.slice(0,25),samples };
}
async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid,'SIGTERM'); } catch(e) { try {child.kill('SIGTERM');} catch(_){} }
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3500)]);
  try { process.kill(-child.pid,'SIGKILL'); } catch(e) { try {child.kill('SIGKILL');} catch(_){} }
  await sleep(1500); // let Xvfb and audio release between stages
}
async function runCase(test,round) {
  const prefix = `${String(round).padStart(2,'0')}_${safeSlug(test.id)}`;
  const generated = path.join(RUNS,prefix+'.js');
  const logPath=path.join(RUNS,prefix+'.log');
  const source = test.applyList.reduce((code,c)=>c.apply(code), original);
  const isOriginal = test.applyList.length===0;
  const jsPath=isOriginal?SOURCE:generated;
  if (!isOriginal) fs.writeFileSync(generated,source);
  const caseLog=[];
  let ready=false,readyAt=null,exitedBeforeReady=false;
  let screenFiles=[];
  const caseStarted=Date.now();
  const env={...process.env,CUSTOM_DURATION:'24/7'};
  console.log(`\n==== [${round}] ${test.id} ====`);
  console.log(`Changes: ${isOriginal?'NONE — original source launched byte-for-byte':test.applyList.map(x=>x.id).join(', ')}`);
  const child=spawn(process.execPath,[jsPath],{cwd:ROOT,env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  function onLine(part,stream) {
    const entry=`[${new Date().toISOString()}] [${stream}] ${part}`;
    caseLog.push(entry);
    if (/\[💓\] REPORT|Stream Unhealthy/i.test(part) && !ready) {ready=true;readyAt=Date.now();}
    if (/\[💓\] REPORT|Stream Unhealthy|Engine Error|Playback Error|Navigation warning/i.test(part)) console.log(entry);
  }
  function wire(stream,label) {
    let backlog='';
    stream.setEncoding('utf8');
    stream.on('data',data=>{
      backlog+=data;
      const items=backlog.split(/\r?\n/);backlog=items.pop()||'';
      for(const line of items) onLine(line,label);
    });
    stream.on('end',()=>{if(backlog) onLine(backlog,label)});
  }
  wire(child.stdout,'stdout');wire(child.stderr,'stderr');
  child.on('exit',()=>{if(!ready)exitedBeforeReady=true});
  const readyDeadline=Date.now()+watchReadySeconds*1000;
  while(!ready && !exitedBeforeReady && Date.now()<readyDeadline) await sleep(500);
  if(ready) {
    console.log(`Q1 watchdog started. Observing ${observeSeconds}s without changing anything.`);
    const snapTimes=[Math.round(observeSeconds*.15),Math.round(observeSeconds*.55),Math.round(observeSeconds*.90)];
    let lastSnap=-1;
    while(Date.now()-readyAt < observeSeconds*1000) {
      const elapsed=Math.floor((Date.now()-readyAt)/1000);
      for(let i=0;i<snapTimes.length;i++) if(lastSnap<i && elapsed>=snapTimes[i]) {
        lastSnap=i;
        const file=path.join(RUNS,`${prefix}-screen-${i+1}.png`);
        const saved=await screenshot(file);
        if(saved) screenFiles.push(saved);
      }
      await sleep(250);
    }
  } else console.log(`No watchdog ready signal: ${exitedBeforeReady?'exited':'timeout'}`);
  await stopProcess(child);
  const raw=caseLog.join('\n')+'\n';fs.writeFileSync(logPath,raw);
  const parsed=parsePlaybackReports(raw);
  const observed=readyAt?Math.round((Date.now()-readyAt)/1000):0;
  const classification=(!ready)?'NO_READY_SIGNAL':(parsed.timeAdvanced||parsed.framesAdvanced)?'VIDEO_PROGRESS_SIGNAL':parsed.unhealthy?'UNHEALTHY_SIGNAL':'INSUFFICIENT_PROGRESS_DATA';
  const result={case:test.id,round,description:test.title,changes:test.applyList.map(x=>x.id).join(' + ')||'none',ready,observed_seconds:observed,healthy_reports:parsed.healthy,unhealthy_reports:parsed.unhealthy,playback_time_increased:parsed.timeAdvanced,decoded_frames_increased:parsed.framesAdvanced,error_lines:parsed.errorLines.length,screenshot_count:screenFiles.length,classification,log_file:path.relative(ROOT,logPath),screenshots:screenFiles,error_details:parsed.errorLines,media_samples:parsed.samples,wall_elapsed_seconds:Math.round((Date.now()-caseStarted)/1000),source_sha256:crypto.createHash('sha256').update(source).digest('hex')};
  console.log(`RESULT: ${classification} | Healthy reports=${parsed.healthy}, Unhealthy reports=${parsed.unhealthy}, Time grew=${parsed.timeAdvanced}, Frames grew=${parsed.framesAdvanced}`);
  return result;
}
function writeReport(results) {
  fs.writeFileSync(path.join(RUNS,'summary.json'),JSON.stringify({created_at:new Date().toISOString(),source_sha256:sourceHash,target,mode,observeSeconds,repeats,results},null,2));
  fs.writeFileSync(path.join(RUNS,'summary.csv'),toCSV(results));
  const base=results.filter(r=>r.case==='q1-original-baseline');
  const baseGood=base.some(r=>r.classification==='VIDEO_PROGRESS_SIGNAL');
  const suspect = results.filter(r=>r.case!=='q1-original-baseline' && ['UNHEALTHY_SIGNAL','NO_READY_SIGNAL'].includes(r.classification));
  const md=[
    '# Q1 playback A/B experiment report',
    '',
    `- Original Q1 SHA256: \`${sourceHash}\``,
    `- Single tested URL: \`${target}\``,
    `- Mode: \`${mode}\`; observation after first watchdog signal: **${observeSeconds}s** per case; repeats: **${repeats}**`,
    '- Baseline was launched from the original uploaded Q1 file with identical bytes.',
    '- Every case uses a fresh instance of the same ONE-Chrome Q1 engine; OBS reinitializes between cases.',
    '',
    '| Round | Case | Changed feature(s) | Media progress signal | Unhealthy reports | Log |',
    '|---|---|---|---|---:|---|',
    ...results.map(r=>`| ${r.round} | ${r.case} | ${r.changes.replace(/\|/g,'/')} | ${r.classification} | ${r.unhealthy_reports} | ${r.log_file} |`),
    '',
    '## Provisional interpretation',
    baseGood?'- Baseline had a positive frame/time-advancing health signal.':'- Baseline did NOT provide verified advancing video-frame/time evidence. Do not attribute failures to variants yet.',
    suspect.length?`- Variants showing failed/unhealthy signals: ${suspect.map(r=>'`'+r.case+'`').join(', ')}. These are **candidates**, NOT proven causes. Repeat with controlled A/B/A and inspect screenshot/video + underlying player errors.`:'- No variant generated an unambiguous unhealthy/no-ready signal (or there were not enough reports). No cause established.',
    '',
    '## Evidence caveats',
    '- **The original Q1 does not log player DOM error messages**, so this harness cannot automatically claim "Playback error did not appear". Open per-test PNG screenshots and full logs.',
    '- A positive watchdog signal does **not** guarantee video is perceptually correct; some players can update time while showing errors or black frames.',
    '- 30 seconds is enough for an initial screen, NOT proof of long-term stability. Timing/network variance and player-server outages can create false positives.',
    '- `isolated` changes exactly one selected feature versus baseline. `cumulative` adds one feature at each successive step and therefore is weaker for isolating individual causes.',
    '- Browser startup flags only take effect on launch, so every stage necessarily restarts Chrome. There is no simultaneous second/backup Chrome.',
    '- The full Q1 OBS stream and credentials are untouched: do not upload this project to a public repository.',
    '',
    '## Manual verification',
    'Review the three screenshots for each run. Record whether the literal player error appeared, if video was visible, and the earliest timestamp. If a candidate is found, run baseline → candidate → baseline → candidate (A/B/A/B) with 3 repeats under the same URL/proxy/extension settings.',
    ''
  ];
  fs.writeFileSync(path.join(RUNS,'REPORT.md'),md.join('\n'));
}
async function main() {
  const output=[];
  console.log(`Q1 ORIGINAL SHA-256: ${sourceHash}`);
  console.log(`A/B mode=${mode}; window=${observeSeconds}s; cases=${cases.length}; rounds=${repeats}`);
  for(let repeat=1;repeat<=repeats;repeat++) for(const testcase of cases) {
    try { output.push(await runCase(testcase,repeat)); }
    catch(e) { console.error(`TEST FAILED ${testcase.id}`,e); output.push({case:testcase.id,round:repeat,description:testcase.title,changes:testcase.applyList.map(x=>x.id).join(' + '),ready:false,observed_seconds:0,healthy_reports:0,unhealthy_reports:0,playback_time_increased:false,decoded_frames_increased:false,error_lines:1,screenshot_count:0,classification:'HARNESS_ERROR',log_file:'',error_details:[String(e)]}); }
    writeReport(output);
  }
  console.log(`\nCOMPLETED — reports/REPORT.md , reports/summary.csv , reports/summary.json and per-stage screenshots/logs`);
}
if (process.env.DRY_RUN === '1') {
  for (const testcase of cases) {
    const src=testcase.applyList.reduce((code,c)=>c.apply(code),original);
    const name=`dryrun-${safeSlug(testcase.id)}.js`;
    fs.writeFileSync(path.join(RUNS,name),src);
    console.log(`Prepared ${name}`);
  }
} else main().catch(e=>{console.error(e);process.exitCode=1;});
