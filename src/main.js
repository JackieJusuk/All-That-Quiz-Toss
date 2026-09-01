import { getAnonymousKey } from '@apps-in-toss/web-framework';

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

const TOPICS = [
  { id:'stock', name:'주식', desc:'PER, 배당, 분산투자 기초', color:'#3d5afe', bg:'#e8ecff', icon:'stock',
    questions:[
      { q:'PER(주가수익비율)이 낮다는 것은 일반적으로 무엇을 의미할까요?',
        choices:['회사가 곧 상장폐지된다','주가가 이익 대비 저평가되어 있을 가능성이 높다','배당금을 지급하지 않는다는 뜻이다','무조건 좋은 주식이라는 뜻이다'],
        correct:1, explain:'PER이 낮으면 순이익 대비 주가가 낮다는 뜻으로 저평가 신호일 수 있지만, 업종 특성도 함께 봐야 해요.' },
      { q:"배당금이란 무엇인가요?",
        choices:['주식을 살 때 내는 수수료','주가가 오른 만큼의 차익','회사가 이익의 일부를 주주에게 나눠주는 돈','거래에 부과되는 세금'],
        correct:2, explain:'배당은 기업이 벌어들인 이익을 주주에게 현금 등으로 분배하는 것이에요.' },
      { q:"'분산투자'의 주된 목적은 무엇인가요?",
        choices:['특정 종목 하락에 따른 손실 위험을 줄이기 위해','세금을 아예 내지 않기 위해','매매 수수료를 없애기 위해','상장폐지를 막기 위해'],
        correct:0, explain:'여러 자산에 나눠 투자하면 한 종목의 급락이 전체 자산에 주는 충격을 줄일 수 있어요.' },
      { q:"코스피(KOSPI)는 무엇을 나타내는 지수인가요?",
        choices:['원/달러 환율','시중은행 기준금리','한국 부동산 가격 지수','유가증권시장 상장 주식들의 전반적 가격 흐름'],
        correct:3, explain:'코스피는 한국 유가증권시장 상장 종목들의 시가총액 변화를 지수화한 지표예요.' },
      { q:"'시가총액'은 어떻게 계산하나요?",
        choices:['주가 × 발행주식수','매출액 − 비용','부채총액 + 자본총액','주가 ÷ 액면가'],
        correct:0, explain:'시가총액은 현재 주가에 발행된 총 주식 수를 곱해 회사의 시장 가치를 나타내요.' }
    ]},
  { id:'realestate', name:'부동산', desc:'전월세, LTV, 청약 기초', color:'#c9701a', bg:'#faeadb', icon:'house',
    questions:[
      { q:"'전세'와 '월세'의 가장 큰 차이는 무엇인가요?",
        choices:['등기 여부','보증금 규모와 매달 임대료 지불 여부','부과되는 세금 종류','계약 기간의 유무'],
        correct:1, explain:'전세는 큰 보증금을 맡기고 월세 부담이 없는 반면, 월세는 보증금이 작은 대신 매달 임대료를 내요.' },
      { q:"'LTV(주택담보대출비율)'가 의미하는 것은?",
        choices:['대출 금리','집값 대비 대출 가능 금액의 비율','전세보증금 반환 비율','주택 재산세율'],
        correct:1, explain:'LTV는 담보가치(집값) 대비 얼마까지 대출받을 수 있는지를 나타내는 비율이에요.' },
      { q:"청약통장의 주된 목적은 무엇인가요?",
        choices:['대출 금리를 낮추기 위해','전세보증금을 보호받기 위해','신규 분양 아파트 청약 자격을 얻기 위해','재산세를 감면받기 위해'],
        correct:2, explain:'청약통장은 일정 요건을 채우면 신규 분양 주택 청약에 신청할 자격을 줘요.' },
      { q:"'등기부등본'에서 확인할 수 없는 것은?",
        choices:['소유자 정보','근저당권 설정 여부','집주인의 소득 수준','압류·가압류 여부'],
        correct:2, explain:'등기부등본은 부동산의 권리관계를 보여주는 서류로, 소유자의 소득 정보는 나오지 않아요.' },
      { q:"'재건축'과 '재개발'의 차이로 옳은 것은?",
        choices:['재건축은 노후 건물 자체를, 재개발은 주변 기반시설까지 포함해 정비한다','재건축은 상업지역만 대상으로 한다','재개발은 세금 감면이 전혀 없다','둘은 완전히 동일한 절차다'],
        correct:0, explain:'재건축은 건물 위주로, 재개발은 도로·상하수도 등 기반시설까지 포함해 지역 전체를 정비해요.' }
    ]},
  { id:'fund', name:'펀드', desc:'ETF, 운용보수, 기준가 기초', color:'#1f8f5c', bg:'#e2f3ea', icon:'fund',
    questions:[
      { q:"'펀드'란 무엇인가요?",
        choices:['은행이 원금을 보장하는 예금 상품','정부가 발행하는 채권','여러 투자자의 돈을 모아 전문가가 대신 운용하는 상품','개인이 직접 매매하는 주식 계좌'],
        correct:2, explain:'펀드는 다수의 투자자 자금을 모아 전문 운용사가 주식·채권 등에 투자하는 간접투자 상품이에요.' },
      { q:"'ETF'의 특징으로 옳은 것은?",
        choices:['하루에 한 번만 가격이 정해지는 예금','원금이 보장되는 채권','부동산 실물을 직접 소유하는 상품','주식처럼 거래소에서 실시간 매매가 가능한 펀드'],
        correct:3, explain:'ETF는 지수 등을 추종하며 주식처럼 실시간으로 사고팔 수 있는 상장지수펀드예요.' },
      { q:"펀드의 '운용보수'란 무엇인가요?",
        choices:['펀드를 운용해주는 대가로 지불하는 수수료','원금 손실을 보전해주는 금액','세금 환급액','배당금의 일종'],
        correct:0, explain:'운용보수는 자산운용사가 펀드를 관리·운용하는 대가로 매년 일정 비율 부과하는 비용이에요.' },
      { q:"'액티브 펀드'와 '패시브 펀드'의 차이는?",
        choices:['액티브는 원금보장, 패시브는 미보장','패시브는 해외투자만 가능','액티브는 매니저가 초과 수익을 노리고, 패시브는 지수를 그대로 추종','둘 다 완전히 동일한 전략을 사용'],
        correct:2, explain:'액티브 펀드는 시장 대비 초과수익을 목표로 적극 운용하고, 패시브 펀드는 특정 지수를 그대로 따라가요.' },
      { q:"펀드 투자 시 '기준가'란 무엇인가요?",
        choices:['펀드 가입 최소 금액','펀드 1좌의 현재 평가 가격','판매사가 받는 수수료율','환매 시 부과되는 세금'],
        correct:1, explain:'기준가는 펀드 자산을 좌수로 나눈 값으로, 매입·환매 시 기준이 되는 가격이에요.' }
    ]}
];

// 데모용 랭킹 데이터 — 실제 서비스에서는 백엔드 API로 대체해야 해요.
const RANKING = {
  daily:[ ['1','민지','980'],['2','현우','860'],['3','서연','790'],['5','도윤','610'],['6','하은','540'] ],
  weekly:[ ['1','서연','5210'],['2','민지','4980'],['4','현우','4310'],['5','지호','3990'],['6','도윤','3540'] ]
};

let userKey = 'guest';
let state = {
  screen:'home', tab:'home',
  topic:null, qIndex:0, answered:false, selected:null, sessionScore:0,
  cash:0, streak:0, rankPeriod:'daily', wrongNote:[]
};

function storageKey(){ return `point-quiz:${userKey}`; }

function loadState(){
  try{
    const raw = localStorage.getItem(storageKey());
    if(raw){
      const saved = JSON.parse(raw);
      state.cash = saved.cash ?? 0;
      state.streak = saved.streak ?? 0;
      state.wrongNote = saved.wrongNote ?? [];
    }
  }catch(e){ /* 저장된 값이 없거나 손상된 경우 기본값 사용 */ }
}

function saveState(){
  try{
    localStorage.setItem(storageKey(), JSON.stringify({
      cash: state.cash, streak: state.streak, wrongNote: state.wrongNote
    }));
  }catch(e){ /* 저장 실패는 무시 — 다음 세션에 이어지지 않을 뿐 */ }
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

function startTopic(topic){
  state.topic = topic;
  state.qIndex = 0;
  state.answered = false;
  state.selected = null;
  state.sessionScore = 0;
  go('quiz');
}

function pickChoice(idx){
  if(state.answered) return;
  state.answered = true;
  state.selected = idx;
  const q = state.topic.questions[state.qIndex];
  if(idx===q.correct){
    state.sessionScore++;
    state.cash += 20;
  } else {
    state.wrongNote.push({topic:state.topic.name, q, chosen:idx});
  }
  saveState();
  render();
}

function nextQuestion(){
  const total = state.topic.questions.length;
  if(state.qIndex < total-1){
    state.qIndex++;
    state.answered = false;
    state.selected = null;
    render();
  } else {
    state.streak += 1;
    saveState();
    go('result');
  }
}

function renderTabbar(){
  if(state.screen==='quiz' || state.screen==='result'){ tabbarEl.style.display='none'; return; }
  tabbarEl.style.display='flex';
  const tabs = [['home','홈','home'],['ranking','랭킹','rank'],['wrongnote','오답노트','note']];
  tabbarEl.innerHTML = tabs.map(([key,label,ic])=>
    `<button class="tab ${state.tab===key?'active':''}" data-tab="${key}">${ICONS[ic]}<span>${label}</span></button>`
  ).join('');
  tabbarEl.querySelectorAll('[data-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=> go(btn.dataset.tab));
  });
}

function homeHTML(){
  return `
  <div class="scroll">
    <div class="top-chips">
      <div class="chip streak">${ICONS.flame}<div><div class="v">${state.streak}일</div><div class="l">연속 학습</div></div></div>
      <div class="chip gold">${ICONS.coin}<div><div class="v">${state.cash.toLocaleString()}</div><div class="l">보유 캐시</div></div></div>
    </div>
    <p class="greet">오늘도 5문제, 3분이면 충분해요</p>
    <p class="greet-sub">관심 있는 주제를 골라 퀴즈를 시작해 보세요</p>
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
  </div>`;
}

function quizHTML(){
  const total = state.topic.questions.length;
  const q = state.topic.questions[state.qIndex];
  const pct = Math.round(((state.qIndex + (state.answered?1:0)) / total) * 100);
  return `
  <div class="quiz-head">
    <button class="iconbtn" id="quiz-close">${ICONS.close}</button>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="qcount">${state.qIndex+1} / ${total}</div>
  </div>
  <div class="scroll">
    <p class="section-label">${state.topic.name}</p>
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
  <div class="quiz-foot">
    <button class="btn-primary" id="quiz-next" ${state.answered?'':'disabled'}>${state.qIndex<total-1?'다음 문제':'결과 보기'}</button>
  </div>`;
}

function resultHTML(){
  const total = state.topic.questions.length;
  const earned = state.sessionScore*20;
  return `
  <div class="result-wrap">
    <div class="result-score">${state.sessionScore}<span style="font-size:1.2rem;color:var(--ink-soft)"> / ${total}</span></div>
    <p class="result-title">${state.sessionScore===total? '전부 맞혔어요! 완벽해요' : '오늘도 한 걸음 성장했어요'}</p>
    <p class="result-sub">${state.topic.name} 퀴즈 세션이 끝났어요</p>
    <div class="result-stats">
      <div class="result-stat gold"><div class="v">+${earned}</div><div class="l">획득 캐시</div></div>
      <div class="result-stat"><div class="v">${state.streak}일째</div><div class="l">연속 학습</div></div>
    </div>
    <div class="result-actions">
      <button class="btn-primary" id="result-wrong">오답노트 보기</button>
      <button class="btn-ghost" id="result-home">홈으로</button>
    </div>
  </div>`;
}

function wrongnoteHTML(){
  if(state.wrongNote.length===0){
    return `<div class="empty"><b>아직 틀린 문제가 없어요</b><span>퀴즈를 풀면 틀린 문제가 여기에 모여요</span></div>`;
  }
  return `<div class="scroll">
    <p class="section-label">틀린 문제 ${state.wrongNote.length}개</p>
    ${state.wrongNote.map((w,i)=>`
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
  const rows = [...RANKING[state.rankPeriod]];
  const myScore = state.wrongNote ? (state.cash) : 0; // 데모: 보유 캐시를 임시 점수로 표시
  rows.push(['·','나', String(myScore), true]);
  rows.sort((a,b)=> Number(b[2]) - Number(a[2]));
  return `<div class="scroll">
    <div class="seg">
      <button class="${state.rankPeriod==='daily'?'active':''}" data-period="daily">일간</button>
      <button class="${state.rankPeriod==='weekly'?'active':''}" data-period="weekly">주간</button>
    </div>
    ${rows.map((r,i)=>`
      <div class="rank-row ${r[3]?'me':''}">
        <div class="rank-num">${i+1}</div>
        <div class="rank-avatar">${r[1][0]}</div>
        <div class="rank-name">${r[1]}${r[3]?' (나)':''}</div>
        <div class="rank-score">${Number(r[2]).toLocaleString()}점</div>
      </div>
    `).join('')}
  </div>`;
}

function render(){
  if(state.screen==='home') screenEl.innerHTML = homeHTML();
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
  const nextBtn = screenEl.querySelector('#quiz-next');
  if(nextBtn) nextBtn.addEventListener('click', nextQuestion);
  const rwBtn = screenEl.querySelector('#result-wrong');
  if(rwBtn) rwBtn.addEventListener('click', ()=> go('wrongnote'));
  const rhBtn = screenEl.querySelector('#result-home');
  if(rhBtn) rhBtn.addEventListener('click', ()=> go('home'));
  screenEl.querySelectorAll('[data-wnote]').forEach(el=>{
    el.addEventListener('click', ()=> el.classList.toggle('open'));
  });
  screenEl.querySelectorAll('[data-period]').forEach(el=>{
    el.addEventListener('click', ()=>{ state.rankPeriod = el.dataset.period; render(); });
  });
}

async function init(){
  mountShell();

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

  loadState();
  go('home');
}

init();
