import { getAnonymousKey, Share, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

// 콘솔에서 "리워드" 유형으로 등록한 광고 그룹 ID. 개발 단계에서는 토스가 제공하는 테스트 ID를 쓴다.
// 실제 배포 시에는 콘솔에서 발급받은 값을 VITE_AD_GROUP_ID로 넣어 교체한다.
const AD_GROUP_ID = import.meta.env.VITE_AD_GROUP_ID || 'ait-ad-test-rewarded-id';

// 보상형 광고를 끝까지 시청했을 때만 true를 반환한다(userEarnedReward 이벤트 기준).
function watchRewardedAd(){
  return new Promise((resolve, reject) => {
    let settled = false;
    loadFullScreenAd({
      options: { adGroupId: AD_GROUP_ID },
      onEvent: (event) => {
        if(event.type === 'loaded'){
          showFullScreenAd({
            options: { adGroupId: AD_GROUP_ID },
            onEvent: (event2) => {
              if(event2.type === 'userEarnedReward'){
                settled = true;
                resolve(true);
              } else if(event2.type === 'dismissed' && !settled){
                settled = true;
                resolve(false);
              }
            },
            onError: (err) => { if(!settled){ settled = true; reject(err); } },
          });
        }
      },
      onError: (err) => { if(!settled){ settled = true; reject(err); } },
    });
  });
}

const ICONS = {
  home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9"/></svg>',
  rank: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 21h8M12 17v4"/><path d="M6 4h12v5a6 6 0 0 1-12 0V4Z"/><path d="M6 6H4a2 2 0 0 0-2 2c0 2.5 2 4 4.5 4.2M18 6h2a2 2 0 0 1 2 2c0 2.5-2 4-4.5 4.2"/></svg>',
  note: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5M8 12h7M8 16h5"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
  down: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>',
  close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  coin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M9.5 10.2c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.6c0 2.2-5 1-5 3.2 0 .9 1 1.7 2.5 1.7s2.5-.7 2.5-1.7"/></svg>',
  flame: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2.5c1 3-3.5 4-3.5 8a3.5 3.5 0 0 0 7 0c0-1.2-.5-2-1-2.7.7 3.5-1.2 4.2-1.2 4.2 1-2.3-.3-4-1.3-5A5 5 0 0 1 12 2.5Z"/><path d="M8 14.5A4 4 0 0 0 12 21a4 4 0 0 0 4-6.5"/></svg>',
  stock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/></svg>',
  house: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/></svg>',
  fund: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><path d="M15 16.5h5M17.5 14v5"/></svg>'
};

// 서버(AI+DB) 연결이 끊겼을 때만 쓰는 최소한의 비상용 문제은행.
const TOPICS = [
  { id:'stock', name:'주식', desc:'PER, 배당, 분산투자 기초', color:'#3d5afe', bg:'#e8ecff', icon:'stock',
    questions:[
      { q:'PER(주가수익비율)이 낮다는 것은 일반적으로 무엇을 의미할까요?',
        choices:['회사가 곧 상장폐지된다','주가가 이익 대비 저평가되어 있을 가능성이 높다','배당금을 지급하지 않는다는 뜻이다','무조건 좋은 주식이라는 뜻이다'],
        correct:1, explain:'PER이 낮으면 순이익 대비 주가가 낮다는 뜻으로 저평가 신호일 수 있지만, 업종 특성도 함께 봐야 해요.', difficulty:'medium' },
      { q:"배당금이란 무엇인가요?",
        choices:['주식을 살 때 내는 수수료','주가가 오른 만큼의 차익','회사가 이익의 일부를 주주에게 나눠주는 돈','거래에 부과되는 세금'],
        correct:2, explain:'배당은 기업이 벌어들인 이익을 주주에게 현금 등으로 분배하는 것이에요.', difficulty:'easy' },
    ]},
  { id:'realestate', name:'부동산', desc:'전월세, LTV, 청약 기초', color:'#c9701a', bg:'#faeadb', icon:'house',
    questions:[
      { q:"'전세'와 '월세'의 가장 큰 차이는 무엇인가요?",
        choices:['등기 여부','보증금 규모와 매달 임대료 지불 여부','부과되는 세금 종류','계약 기간의 유무'],
        correct:1, explain:'전세는 큰 보증금을 맡기고 월세 부담이 없는 반면, 월세는 보증금이 작은 대신 매달 임대료를 내요.', difficulty:'easy' },
      { q:"'LTV(주택담보대출비율)'가 의미하는 것은?",
        choices:['대출 금리','집값 대비 대출 가능 금액의 비율','전세보증금 반환 비율','주택 재산세율'],
        correct:1, explain:'LTV는 담보가치(집값) 대비 얼마까지 대출받을 수 있는지를 나타내는 비율이에요.', difficulty:'medium' },
    ]},
  { id:'fund', name:'펀드', desc:'ETF, 운용보수, 기준가 기초', color:'#1f8f5c', bg:'#e2f3ea', icon:'fund',
    questions:[
      { q:"'펀드'란 무엇인가요?",
        choices:['은행이 원금을 보장하는 예금 상품','정부가 발행하는 채권','여러 투자자의 돈을 모아 전문가가 대신 운용하는 상품','개인이 직접 매매하는 주식 계좌'],
        correct:2, explain:'펀드는 다수의 투자자 자금을 모아 전문 운용사가 주식·채권 등에 투자하는 간접투자 상품이에요.', difficulty:'easy' },
      { q:"'ETF'의 특징으로 옳은 것은?",
        choices:['하루에 한 번만 가격이 정해지는 예금','원금이 보장되는 채권','부동산 실물을 직접 소유하는 상품','주식처럼 거래소에서 실시간 매매가 가능한 펀드'],
        correct:3, explain:'ETF는 지수 등을 추종하며 주식처럼 실시간으로 사고팔 수 있는 상장지수펀드예요.', difficulty:'medium' },
    ]},
];

const DIFF_LABEL = { easy:'쉬움', medium:'보통', hard:'어려움' };

// 누적 정답 수 기준 등급. 등급이 오르면 다음 문제 난이도도 함께 올라간다.
const LEVELS = [
  { key:'beginner', name:'초급', min:0, difficulty:'easy' },
  { key:'intermediate', name:'중급', min:15, difficulty:'medium' },
  { key:'advanced', name:'고급', min:40, difficulty:'hard' },
];

function getLevelInfo(totalCorrect){
  let level = LEVELS[0];
  for(const lv of LEVELS){ if(totalCorrect >= lv.min) level = lv; }
  const next = LEVELS[LEVELS.indexOf(level)+1];
  let progress = 1, remain = 0;
  if(next){
    remain = next.min - totalCorrect;
    progress = Math.min(1, (totalCorrect - level.min) / (next.min - level.min));
  }
  return { level, next, progress, remain };
}

function pickFallbackQuestion(topic, difficulty){
  const matched = topic.questions.filter(q => q.difficulty === difficulty);
  const list = matched.length ? matched : topic.questions;
  return { ...list[Math.floor(Math.random() * list.length)], id: null };
}

let userKey = 'guest';
// 초대 링크(intoss://cash-quiz?ref=...)로 진입했을 때의 초대자 키. 닉네임 저장 시 1회만 서버에 전달한다.
let pendingRef = null;
let state = {
  screen:'home', tab:'home',
  topic:null, question:null, answered:false, selected:false, recording:false,
  points:0, streak:0, totalCorrect:0,
  hasAdTicket:false, needsAd:false, watchingAd:false,
  rankPeriod:'daily', rankingRows:[], rankingLoading:false,
  wrongNoteItems:[], wrongnoteLoading:false,
  loadingQuestions:false,
  levelBefore:null, leveledUp:false, levelAfterName:'',
  nickname:null, savingNickname:false,
};

// 하루 1문제 제한, 문제 풀 사전생성, 사용자별 진행 기록은 모두 서버(DB)가 진짜 기준이다.
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function fetchProfile(){
  try{
    const res = await fetch(`${API_BASE}/api/profile?userKey=${encodeURIComponent(userKey)}`);
    if(!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    state.nickname = data.nickname;
  }catch(e){
    console.warn('닉네임을 불러오지 못했습니다.', e);
  }
}

async function saveNickname(nickname){
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userKey, nickname, ref: pendingRef }),
  });
  if(!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  state.nickname = data.nickname;
}

async function fetchStatus(){
  try{
    const res = await fetch(`${API_BASE}/api/status?userKey=${encodeURIComponent(userKey)}`);
    if(!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    state.totalCorrect = data.totalCorrect;
    state.streak = data.streak;
    state.points = data.points;
    state.hasAdTicket = data.hasAdTicket ?? false;
  }catch(e){
    console.warn('사용자 상태를 불러오지 못했습니다.', e);
  }
}

// 보상형 광고를 끝까지 보면 +10포인트와 함께 문제 풀이권을 1개 얻는다. 풀이 횟수 제한은 없다.
async function watchAdThenFetchQuestion(){
  if(state.watchingAd) return;
  state.watchingAd = true;
  render();
  try{
    const earned = await watchRewardedAd();
    if(!earned){
      state.watchingAd = false;
      render();
      return;
    }
    const res = await fetch(`${API_BASE}/api/ads/reward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey }),
    });
    if(res.ok){
      const data = await res.json();
      state.points = data.points;
      state.totalCorrect = data.totalCorrect;
      state.streak = data.streak;
      state.hasAdTicket = data.hasAdTicket ?? true;
    }
  }catch(e){
    console.warn('광고 시청에 실패했습니다.', e);
  }
  state.watchingAd = false;

  if(state.hasAdTicket && state.topic){
    state.needsAd = false;
    state.loadingQuestions = true;
    render();
    const difficulty = state.levelBefore.difficulty;
    const q = await fetchQuestion(state.topic, difficulty);
    if(state.screen==='quiz' && state.topic){
      if(q === 'ad_required'){
        state.needsAd = true;
        state.question = null;
      }else{
        state.question = q;
      }
      state.loadingQuestions = false;
    }
  }
  render();
}

async function fetchQuestion(topic, difficulty){
  try{
    const res = await fetch(`${API_BASE}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey, topic: topic.id, difficulty }),
    });
    if(res.status === 403) return 'ad_required';
    if(!res.ok) throw new Error(`status ${res.status}`);
    const q = await res.json();
    if(!q || typeof q.q !== 'string' || !Array.isArray(q.choices) || q.choices.length !== 4) throw new Error('malformed response');
    return q;
  }catch(e){
    console.warn('AI 문제를 불러오지 못해 기본 문제은행으로 대체합니다.', e);
    return pickFallbackQuestion(topic, difficulty);
  }
}

async function recordAnswer(topic, question, correct){
  if(!question.id){
    // 서버 연결이 끊긴 상태의 비상용 문제는 기록할 곳이 없어 로컬로만 대략 반영한다.
    // 포인트 = 정답 시 10포인트 (오답은 없음).
    state.totalCorrect += correct ? 1 : 0;
    state.points += correct ? 10 : 0;
    state.streak += 1;
    state.hasAdTicket = false;
    return;
  }
  try{
    const res = await fetch(`${API_BASE}/api/questions/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey, questionId: question.id, topic: topic.id, correct }),
    });
    if(!res.ok) throw new Error(`status ${res.status}`);
    const stats = await res.json();
    state.totalCorrect = stats.totalCorrect;
    state.streak = stats.streak;
    state.points = stats.points;
    state.hasAdTicket = stats.hasAdTicket ?? false;
  }catch(e){
    console.warn('결과 기록에 실패했습니다.', e);
  }
}

async function fetchRanking(period){
  try{
    const res = await fetch(`${API_BASE}/api/ranking?period=${period}&userKey=${encodeURIComponent(userKey)}`);
    if(!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    state.rankingRows = data.rows;
  }catch(e){
    console.warn('랭킹을 불러오지 못했습니다.', e);
    state.rankingRows = [];
  }
}

async function fetchWrongnote(){
  try{
    const res = await fetch(`${API_BASE}/api/wrongnote?userKey=${encodeURIComponent(userKey)}`);
    if(!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    state.wrongNoteItems = data.items;
  }catch(e){
    console.warn('오답노트를 불러오지 못했습니다.', e);
    state.wrongNoteItems = [];
  }
}

const screenEl = document.createElement('div');
screenEl.className = 'screen';
screenEl.id = 'screen';
const tabbarEl = document.createElement('div');
tabbarEl.className = 'tabbar';
tabbarEl.id = 'tabbar';

function mountShell(){
  const app = document.getElementById('app');
  app.appendChild(screenEl);
  app.appendChild(tabbarEl);
}

function go(screen, extra){
  state.screen = screen;
  if(screen!=='quiz' && screen!=='result'){
    state.tab = screen==='wrongnote' ? 'wrongnote' : (screen==='ranking' ? 'ranking' : 'home');
  }
  Object.assign(state, extra||{});
  render();
}

async function openRanking(){
  state.screen = 'ranking';
  state.tab = 'ranking';
  state.rankingLoading = true;
  render();
  await fetchRanking(state.rankPeriod);
  state.rankingLoading = false;
  render();
}

// 친구에게 초대 메시지를 공유한다(토스 공유 시트를 열어 사용자가 직접 대상을 고름).
async function shareWithFriend(){
  const name = state.nickname || '친구';
  try{
    await Share.sendMessage({
      message: `[포인트퀴즈] ${name}님이 투자 퀴즈에 도전했어요! 나도 도전해보기\nintoss://cash-quiz?ref=${encodeURIComponent(userKey)}`,
    });
  }catch(e){
    console.warn('공유하기 실패', e);
  }
}

async function openWrongnote(){
  state.screen = 'wrongnote';
  state.tab = 'wrongnote';
  state.wrongnoteLoading = true;
  render();
  await fetchWrongnote();
  state.wrongnoteLoading = false;
  render();
}

async function startTopic(topic){
  state.topic = topic;
  state.answered = false;
  state.selected = null;
  state.question = null;
  state.needsAd = false;
  state.leveledUp = false;
  state.levelBefore = getLevelInfo(state.totalCorrect).level;
  state.loadingQuestions = true;
  go('quiz');

  if(!state.hasAdTicket){
    // 문제 풀이권(광고 시청권)이 없으면 먼저 광고를 봐야 한다. 풀이 횟수 자체엔 제한이 없다.
    state.needsAd = true;
    state.loadingQuestions = false;
    render();
    return;
  }

  const difficulty = state.levelBefore.difficulty;
  const q = await fetchQuestion(topic, difficulty);
  if(state.screen!=='quiz' || state.topic!==topic) return; // 로딩 중 화면을 벗어났으면 무시

  if(q === 'ad_required'){
    state.needsAd = true;
    state.loadingQuestions = false;
    render();
    return;
  }
  state.question = q;
  state.loadingQuestions = false;
  render();
}

async function pickChoice(idx){
  if(state.answered) return;
  state.answered = true;
  state.selected = idx;
  state.recording = true;
  render();

  const q = state.question;
  const correct = idx === q.correct;
  await recordAnswer(state.topic, q, correct);
  const afterLevel = getLevelInfo(state.totalCorrect).level;
  state.leveledUp = afterLevel.key !== state.levelBefore.key;
  state.levelAfterName = afterLevel.name;
  state.recording = false;
  render();
}

function finishQuiz(){
  go('result');
}

function renderTabbar(){
  if(state.screen==='quiz' || state.screen==='result' || state.screen==='onboarding'){ tabbarEl.style.display='none'; return; }
  tabbarEl.style.display='flex';
  const tabs = [['home','홈','home'],['ranking','랭킹','rank'],['wrongnote','오답노트','note']];
  tabbarEl.innerHTML = tabs.map(([key,label,ic])=>
    `<button class="tab ${state.tab===key?'active':''}" data-tab="${key}">${ICONS[ic]}<span>${label}</span></button>`
  ).join('');
  tabbarEl.querySelectorAll('[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.tab;
      if(tab==='ranking') openRanking();
      else if(tab==='wrongnote') openWrongnote();
      else go(tab);
    });
  });
}

function homeHTML(){
  const topChips = `
    <div class="top-chips">
      <div class="chip streak">${ICONS.flame}<div><div class="v">${state.streak}일</div><div class="l">연속 학습</div></div></div>
      <div class="chip gold">${ICONS.coin}<div><div class="v">${state.points.toLocaleString()}</div><div class="l">보유 포인트</div></div></div>
    </div>`;

  return `
  <div class="scroll">
    ${topChips}
    <p class="greet">${state.nickname}님, 오늘의 문제를 풀어봐요</p>
    <p class="greet-sub">광고를 보면 문제를 풀 수 있어요 · 풀이 횟수 제한 없음</p>
    ${levelCardHTML()}
    <p class="section-label">주제 선택</p>
    <div class="topics">
      ${TOPICS.map(t=>`
        <button class="topic-card" data-topic="${t.id}">
          <div class="topic-ic" style="background:${t.bg};color:${t.color}">${ICONS[t.icon]}</div>
          <div class="topic-body">
            <div class="topic-name">${t.name}</div>
            <div class="topic-desc">${t.desc}</div>
          </div>
          <div class="topic-chev">${ICONS.chev}</div>
        </button>
      `).join('')}
    </div>
    <button class="btn-ghost" id="home-share">친구에게 공유하기</button>
  </div>`;
}

function levelCardHTML(){
  const info = getLevelInfo(state.totalCorrect);
  const pct = Math.round(info.progress*100);
  const sub = info.next ? `${info.next.name}까지 ${info.remain}문제` : '최고 등급 달성';
  return `
  <div class="level-card">
    <div class="level-card-top">
      <span class="level-badge">${info.level.name}</span>
      <span class="level-sub">${sub}</span>
    </div>
    <div class="level-track"><div class="level-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function quizHTML(){
  if(state.needsAd){
    return `
    <div class="quiz-head">
      <button class="iconbtn" id="quiz-close">${ICONS.close}</button>
    </div>
    <div class="empty">
      <b>광고를 보면 문제를 풀 수 있어요</b>
      <span>광고 시청 +10P, 정답을 맞히면 +10P를 더 받아요</span>
    </div>
    <div class="quiz-foot">
      <button class="btn-primary" id="quiz-watch-ad" ${state.watchingAd?'disabled':''}>${state.watchingAd?'광고 불러오는 중...':'광고 보고 문제 풀기'}</button>
    </div>`;
  }
  if(state.loadingQuestions || !state.question){
    return `
    <div class="quiz-head">
      <button class="iconbtn" id="quiz-close">${ICONS.close}</button>
    </div>
    <div class="empty"><b>문제를 준비하고 있어요</b><span>잠시만 기다려 주세요</span></div>`;
  }
  const q = state.question;
  return `
  <div class="quiz-head">
    <button class="iconbtn" id="quiz-close">${ICONS.close}</button>
    <div class="qcount">문제</div>
  </div>
  <div class="scroll">
    <div class="quiz-topic-row">
      <p class="section-label">${state.topic.name}</p>
      <span class="diff-badge diff-${q.difficulty}">${DIFF_LABEL[q.difficulty]}</span>
    </div>
    <p class="qtext">${q.q}</p>
    <div class="choices">
      ${q.choices.map((c,i)=>{
        let cls='choice';
        if(state.answered){
          if(i===q.correct) cls+=' correct';
          else if(i===state.selected) cls+=' wrong';
        }
        return `<button class="${cls}" data-choice="${i}" ${state.answered?'disabled':''}>
          <span class="mark">${String.fromCharCode(65+i)}</span><span>${c}</span>
        </button>`;
      }).join('')}
    </div>
    ${state.answered? `<div class="explain"><b>${state.selected===q.correct?'정답이에요.':'아쉬워요.'}</b> ${q.explain}</div>` : ''}
  </div>
  ${state.answered && !state.recording ? `
  <div class="quiz-foot">
    <button class="btn-primary" id="quiz-finish">결과 보기</button>
  </div>` : ''}`;
}

function resultHTML(){
  const q = state.question;
  const wasCorrect = state.selected === q.correct;
  const earned = wasCorrect ? 10 : 0; // 정답 시에만 10포인트 (오답은 포인트 없음)
  return `
  <div class="result-wrap">
    <div class="result-score">${wasCorrect ? '정답!' : '아쉬워요'}</div>
    <p class="result-title">${wasCorrect ? '문제를 맞혔어요' : '오늘도 하나 배워가요'}</p>
    <p class="result-sub">광고를 보면 다음 문제도 이어서 풀 수 있어요</p>
    ${state.leveledUp ? `<div class="levelup-banner">${state.levelAfterName} 등급으로 승급했어요</div>` : ''}
    <div class="result-stats">
      <div class="result-stat gold"><div class="v">+${earned}</div><div class="l">획득 포인트</div></div>
      <div class="result-stat"><div class="v">${state.streak}일째</div><div class="l">연속 학습</div></div>
    </div>
    <div class="result-actions">
      <button class="btn-primary" id="result-wrong">오답노트 보기</button>
      <button class="btn-ghost" id="result-share">친구에게 공유하기</button>
      <button class="btn-ghost" id="result-home">홈으로</button>
    </div>
  </div>`;
}

function wrongnoteHTML(){
  if(state.wrongnoteLoading){
    return `<div class="empty"><b>불러오는 중이에요</b></div>`;
  }
  if(state.wrongNoteItems.length===0){
    return `<div class="empty"><b>아직 틀린 문제가 없어요</b><span>퀴즈를 풀면 틀린 문제가 여기에 모여요</span></div>`;
  }
  return `<div class="scroll">
    <p class="section-label">틀린 문제 ${state.wrongNoteItems.length}개</p>
    ${state.wrongNoteItems.map((w,i)=>`
      <div class="wnote-item" data-wnote="${i}">
        <button class="wnote-head">
          <span class="wnote-tag">${w.topic}</span>
          <span class="wnote-q">${w.q.q}</span>
          <span class="wnote-chev">${ICONS.down}</span>
        </button>
        <div class="wnote-body">
          <div class="wnote-answer">정답 · ${w.q.choices[w.q.correct]}</div>
          <div class="wnote-explain">${w.q.explain}</div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

function rankingHTML(){
  if(state.rankingLoading){
    return `<div class="scroll">
      <div class="seg">
        <button class="${state.rankPeriod==='daily'?'active':''}" data-period="daily">일간</button>
        <button class="${state.rankPeriod==='weekly'?'active':''}" data-period="weekly">주간</button>
      </div>
      <div class="empty"><b>불러오는 중이에요</b></div>
    </div>`;
  }
  const rows = state.rankingRows;
  return `<div class="scroll">
    <div class="seg">
      <button class="${state.rankPeriod==='daily'?'active':''}" data-period="daily">일간</button>
      <button class="${state.rankPeriod==='weekly'?'active':''}" data-period="weekly">주간</button>
    </div>
    ${rows.length===0 ? `<div class="empty"><b>아직 랭킹 데이터가 없어요</b><span>오늘의 문제를 풀어 랭킹에 참여해보세요</span></div>` :
    rows.map((r,i)=>`
      <div class="rank-row ${r.me?'me':''}">
        <div class="rank-num">${i+1}</div>
        <div class="rank-avatar">${r.label[0]}</div>
        <div class="rank-name">${r.label}${r.me?' (나)':''}${r.friend?' <span class="badge-friend">친구</span>':''}</div>
        <div class="rank-score">${r.score.toLocaleString()}포인트</div>
      </div>
    `).join('')}
  </div>`;
}

function onboardingHTML(){
  return `
  <div class="onboard-wrap">
    <p class="greet">닉네임을 알려주세요</p>
    <p class="greet-sub">홈 화면과 랭킹에 표시돼요</p>
    <input id="nickname-input" class="nickname-input" type="text" maxlength="12" placeholder="예: 투자초보" />
    <button class="btn-primary" id="nickname-submit" ${state.savingNickname?'disabled':''}>${state.savingNickname?'저장 중...':'시작하기'}</button>
  </div>`;
}

function render(){
  if(state.screen==='onboarding') screenEl.innerHTML = onboardingHTML();
  else if(state.screen==='home') screenEl.innerHTML = homeHTML();
  else if(state.screen==='quiz') screenEl.innerHTML = quizHTML();
  else if(state.screen==='result') screenEl.innerHTML = resultHTML();
  else if(state.screen==='wrongnote') screenEl.innerHTML = wrongnoteHTML();
  else if(state.screen==='ranking') screenEl.innerHTML = rankingHTML();

  renderTabbar();
  bindScreenEvents();
}

function bindScreenEvents(){
  screenEl.querySelectorAll('[data-topic]').forEach(el=>{
    el.addEventListener('click', ()=> startTopic(TOPICS.find(t=>t.id===el.dataset.topic)));
  });
  screenEl.querySelectorAll('[data-choice]').forEach(el=>{
    el.addEventListener('click', ()=> pickChoice(Number(el.dataset.choice)));
  });
  const closeBtn = screenEl.querySelector('#quiz-close');
  if(closeBtn) closeBtn.addEventListener('click', ()=> go('home'));
  const finishBtn = screenEl.querySelector('#quiz-finish');
  if(finishBtn) finishBtn.addEventListener('click', finishQuiz);
  const rwBtn = screenEl.querySelector('#result-wrong');
  if(rwBtn) rwBtn.addEventListener('click', openWrongnote);
  const rhBtn = screenEl.querySelector('#result-home');
  if(rhBtn) rhBtn.addEventListener('click', ()=> go('home'));
  const rsBtn = screenEl.querySelector('#result-share');
  if(rsBtn) rsBtn.addEventListener('click', shareWithFriend);
  const hsBtn = screenEl.querySelector('#home-share');
  if(hsBtn) hsBtn.addEventListener('click', shareWithFriend);
  const waBtn = screenEl.querySelector('#quiz-watch-ad');
  if(waBtn) waBtn.addEventListener('click', watchAdThenFetchQuestion);
  screenEl.querySelectorAll('[data-wnote]').forEach(el=>{
    el.addEventListener('click', ()=> el.classList.toggle('open'));
  });
  screenEl.querySelectorAll('[data-period]').forEach(el=>{
    el.addEventListener('click', async ()=>{
      state.rankPeriod = el.dataset.period;
      state.rankingLoading = true;
      render();
      await fetchRanking(state.rankPeriod);
      state.rankingLoading = false;
      render();
    });
  });
  const nicknameBtn = screenEl.querySelector('#nickname-submit');
  if(nicknameBtn) nicknameBtn.addEventListener('click', submitNickname);
  const nicknameInput = screenEl.querySelector('#nickname-input');
  if(nicknameInput) nicknameInput.addEventListener('keydown', e=>{ if(e.key==='Enter') submitNickname(); });
}

async function submitNickname(){
  if(state.savingNickname) return;
  const input = screenEl.querySelector('#nickname-input');
  const value = input ? input.value.trim() : '';
  if(!value) return;
  state.savingNickname = true;
  render();
  try{
    await saveNickname(value);
  }catch(e){
    console.warn('닉네임 저장에 실패했습니다.', e);
    state.nickname = value; // 서버 저장이 실패해도 이번 세션 안에서는 입력값으로 진행
  }
  state.savingNickname = false;
  await fetchStatus();
  go('home');
}

async function init(){
  mountShell();

  // 초대 링크의 ?ref= 값을 읽어둔다. 딥링크 파라미터는 웹뷰 URL 쿼리스트링으로 전달된다.
  try{
    const ref = new URLSearchParams(window.location.search).get('ref');
    if(ref) pendingRef = ref;
  }catch(e){ /* URL 파싱 실패는 무시 — 초대 배지만 못 붙을 뿐 앱 동작엔 영향 없음 */ }

  // 포인트퀴즈는 비게임(퀴즈/교육) 카테고리라 getAnonymousKey를 사용해요.
  // 콘솔 미등록 상태나 개발 서버(devtools mock)에서도 동작해요.
  try{
    const res = await getAnonymousKey();
    if(res && res !== 'INVALID_CATEGORY' && res !== 'ERROR' && res.type === 'HASH'){
      userKey = res.hash;
    }
  }catch(e){
    console.warn('getAnonymousKey 호출 실패, guest 키로 진행합니다.', e);
  }

  await fetchProfile();
  if(!state.nickname){
    go('onboarding');
    return;
  }
  await fetchStatus();
  go('home');
}

init();
