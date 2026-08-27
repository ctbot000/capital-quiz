"use strict";

/* ── 상태 ───────────────────────────────────────────── */
const COUNT_OPTIONS = [10, 20, 50, 0]; // 0 = 전체
const MODES = [
  { id: "choice", label: "객관식", en: "Multiple choice" },
  { id: "typing", label: "주관식", en: "Type the answer" }
];
const STORAGE_KEY = "capital-quiz:best";

const settings = { region: "전체", count: 10, mode: "choice" };

let quiz = {
  questions: [],   // [{ item, choices }]
  index: 0,
  correct: 0,
  answered: false,
  log: []          // [{ item, given, ok }]
};

/* ── DOM ────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const screens = {
  start: $("screen-start"),
  quiz: $("screen-quiz"),
  result: $("screen-result")
};

/* ── 유틸 ───────────────────────────────────────────── */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFC")
    .replace(/[\s.,'’·\-]/g, "");
}

function pool() {
  return settings.region === "전체"
    ? COUNTRIES
    : COUNTRIES.filter((c) => c.region === settings.region);
}

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => { el.hidden = k !== name; });
  window.scrollTo(0, 0);
}

/* ── 시작 화면 ──────────────────────────────────────── */
function buildChips(container, options, isActive, onPick) {
  container.innerHTML = "";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = opt.label;
    if (opt.en) {
      btn.title = opt.en;
      btn.setAttribute("aria-label", `${opt.label} (${opt.en})`);
    }
    btn.setAttribute("aria-pressed", String(isActive(opt)));
    btn.addEventListener("click", () => { onPick(opt); renderStart(); });
    container.appendChild(btn);
  });
}

function renderStart() {
  const regionOptions = [{ value: "전체", label: "전체", en: "All" }]
    .concat(REGIONS.map((r) => ({ value: r, label: r })));
  buildChips($("region-picker"), regionOptions,
    (o) => o.value === settings.region,
    (o) => { settings.region = o.value; clampCount(); });

  buildChips($("count-picker"),
    COUNT_OPTIONS.map((n) => ({ value: n, label: n === 0 ? "전체" : `${n}문제` })),
    (o) => o.value === settings.count,
    (o) => { settings.count = o.value; });

  buildChips($("mode-picker"),
    MODES.map((m) => ({ value: m.id, label: m.label, en: m.en })),
    (o) => o.value === settings.mode,
    (o) => { settings.mode = o.value; });

  const size = pool().length;
  const asked = settings.count === 0 ? size : Math.min(settings.count, size);
  $("pool-info").textContent = `${settings.region} ${size}개국 중 ${asked}문제 출제`;

  const best = loadBest()[bestKey()];
  $("best-record").textContent = best
    ? `최고 기록 · ${best.correct} / ${best.total} (${Math.round((best.correct / best.total) * 100)}%)`
    : "";
}

function clampCount() {
  // 지역을 바꿔 후보가 줄어들면 선택 가능한 문항 수로 낮춘다.
  const size = pool().length;
  if (settings.count !== 0 && settings.count > size) settings.count = 0;
}

/* ── 문제 생성 ──────────────────────────────────────── */
function makeChoices(answer, source) {
  const others = shuffle(
    source.filter((c) => normalize(c.capital) !== normalize(answer.capital))
  );
  const picked = [];
  const seen = new Set([normalize(answer.capital)]);
  for (const c of others) {
    const key = normalize(c.capital);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
    if (picked.length === 3) break;
  }
  return shuffle(picked.concat([answer]));
}

function buildQuiz(items) {
  const source = COUNTRIES;
  return items.map((item) => ({
    item,
    choices: settings.mode === "choice" ? makeChoices(item, source) : []
  }));
}

function startQuiz(items) {
  quiz = { questions: buildQuiz(items), index: 0, correct: 0, answered: false, log: [] };
  showScreen("quiz");
  renderQuestion();
}

function startNewQuiz() {
  const p = shuffle(pool());
  const n = settings.count === 0 ? p.length : Math.min(settings.count, p.length);
  startQuiz(p.slice(0, n));
}

/* ── 퀴즈 진행 ──────────────────────────────────────── */
function renderQuestion() {
  const q = quiz.questions[quiz.index];
  quiz.answered = false;

  $("q-index").textContent = `${quiz.index + 1} / ${quiz.questions.length}`;
  $("q-score").textContent = `${quiz.correct}점`;
  $("progress-bar").style.width = `${(quiz.index / quiz.questions.length) * 100}%`;

  $("q-country").textContent = q.item.country;
  $("q-country-en").textContent = q.item.countryEn;
  $("q-region").textContent = q.item.region;

  $("feedback").hidden = true;
  $("feedback").className = "feedback";

  const choicesEl = $("choices");
  const formEl = $("typing-form");
  choicesEl.innerHTML = "";

  if (settings.mode === "choice") {
    formEl.hidden = true;
    choicesEl.hidden = false;
    q.choices.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.innerHTML =
        `<span class="choice-key">${i + 1}</span>` +
        `<span class="choice-text">${escapeHtml(c.capital)}<span class="en">${escapeHtml(c.capitalEn)}</span></span>` +
        `<span class="choice-mark"></span>`;
      btn.addEventListener("click", () => submitAnswer(c.capital, btn));
      choicesEl.appendChild(btn);
    });
  } else {
    choicesEl.hidden = true;
    formEl.hidden = false;
    $("typing-input").value = "";
    $("typing-input").disabled = false;
    $("typing-input").focus();
  }
}

function isCorrect(item, given) {
  const g = normalize(given);
  if (!g) return false;
  const accepted = [item.capital, item.capitalEn].concat(item.alt || []);
  return accepted.some((a) => normalize(a) === g);
}

function submitAnswer(given, clickedBtn) {
  if (quiz.answered) return;
  quiz.answered = true;

  const q = quiz.questions[quiz.index];
  const ok = isCorrect(q.item, given);
  if (ok) quiz.correct++;
  quiz.log.push({ item: q.item, given: given, ok: ok });

  if (settings.mode === "choice") {
    Array.from($("choices").children).forEach((btn, i) => {
      btn.disabled = true;
      const cap = q.choices[i].capital;
      const mark = btn.querySelector(".choice-mark");
      if (normalize(cap) === normalize(q.item.capital)) {
        btn.classList.add("is-correct");
        mark.textContent = "✓";
      } else if (btn === clickedBtn) {
        btn.classList.add("is-wrong");
        mark.textContent = "✕";
      } else {
        btn.classList.add("is-dim");
      }
    });
  } else {
    $("typing-input").disabled = true;
  }

  const fb = $("feedback");
  fb.className = `feedback ${ok ? "ok" : "no"}`;
  $("feedback-title").textContent = ok ? "정답입니다!" : "아쉬워요";
  $("feedback-answer").innerHTML =
    `${escapeHtml(q.item.country)}의 수도는 <strong>${escapeHtml(q.item.capital)}</strong> ` +
    `<span class="en">(${escapeHtml(q.item.capitalEn)})</span> 입니다.`;
  fb.hidden = false;

  $("q-score").textContent = `${quiz.correct}점`;
  $("btn-next").textContent =
    quiz.index === quiz.questions.length - 1 ? "결과 보기" : "다음 문제";
  $("btn-next").focus();
}

function nextQuestion() {
  if (!quiz.answered) return;
  if (quiz.index === quiz.questions.length - 1) {
    finishQuiz();
  } else {
    quiz.index++;
    renderQuestion();
  }
}

/* ── 결과 ───────────────────────────────────────────── */
function bestKey() {
  return `${settings.region}|${settings.count}|${settings.mode}`;
}

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveBest(correct, total) {
  try {
    const all = loadBest();
    const prev = all[bestKey()];
    const better = !prev || correct / total > prev.correct / prev.total;
    if (better) {
      all[bestKey()] = { correct: correct, total: total };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
    return better && !!prev;
  } catch (e) {
    return false;
  }
}

function finishQuiz() {
  const total = quiz.questions.length;
  const rate = Math.round((quiz.correct / total) * 100);
  const newBest = saveBest(quiz.correct, total);

  const grade =
    rate === 100 ? { emoji: "🏆", title: "완벽합니다!" }
    : rate >= 80 ? { emoji: "🎉", title: "훌륭해요!" }
    : rate >= 60 ? { emoji: "👍", title: "좋아요!" }
    : rate >= 40 ? { emoji: "🙂", title: "조금만 더!" }
    : { emoji: "📚", title: "다시 도전해 볼까요?" };

  $("result-emoji").textContent = grade.emoji;
  $("result-title").textContent = grade.title;
  $("result-correct").textContent = String(quiz.correct);
  $("result-total").textContent = String(total);
  $("result-rate").textContent = `정답률 ${rate}%`;
  $("result-new-best").hidden = !newBest;

  const wrong = quiz.log.filter((l) => !l.ok);
  $("btn-retry-wrong").hidden = wrong.length === 0;
  $("btn-retry-wrong").textContent = `틀린 문제 ${wrong.length}개 다시 풀기`;

  renderReview();
  showScreen("result");
}

function renderReview() {
  const review = $("review");
  review.innerHTML = "";
  const wrong = quiz.log.filter((l) => !l.ok);
  const list = wrong.length ? wrong : quiz.log;

  const title = document.createElement("p");
  title.className = "review-title";
  title.textContent = wrong.length ? `틀린 문제 ${wrong.length}개` : "전체 문제 다시 보기";
  review.appendChild(title);

  list.forEach((l) => {
    const row = document.createElement("div");
    row.className = "review-item";
    const yours = l.ok
      ? ""
      : `<span class="rv-yours">내 답: ${escapeHtml(l.given || "(무응답)")}</span> · `;
    row.innerHTML =
      `<span class="rv-mark">${l.ok ? "✅" : "❌"}</span>` +
      `<span class="rv-body">` +
        `<span class="rv-country">${escapeHtml(l.item.country)}</span>` +
        `<span class="rv-en">${escapeHtml(l.item.countryEn)}</span><br>` +
        `<span class="rv-answer">${yours}정답: <strong>${escapeHtml(l.item.capital)}</strong> ` +
        `<span class="rv-en">${escapeHtml(l.item.capitalEn)}</span></span>` +
      `</span>`;
    review.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

/* ── 이벤트 ─────────────────────────────────────────── */
$("btn-start").addEventListener("click", startNewQuiz);
$("btn-next").addEventListener("click", nextQuestion);
$("btn-again").addEventListener("click", startNewQuiz);
$("btn-home").addEventListener("click", () => { renderStart(); showScreen("start"); });
$("btn-quit").addEventListener("click", () => { renderStart(); showScreen("start"); });
$("btn-retry-wrong").addEventListener("click", () => {
  startQuiz(shuffle(quiz.log.filter((l) => !l.ok).map((l) => l.item)));
});

// 엔터로 제출한다. preventDefault 로 브라우저의 암묵적 제출을 막아 두 번 제출되지 않게 한다.
$("typing-input").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  // 같은 엔터가 document 핸들러까지 올라가 채점 결과를 건너뛰지 않도록 막는다.
  e.stopPropagation();
  $("typing-form").requestSubmit();
});

$("typing-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (quiz.answered) return;
  const given = $("typing-input").value.trim();
  if (!given) return; // 빈 입력으로 실수 제출하는 것을 막는다.
  submitAnswer(given, null);
});

document.addEventListener("keydown", (e) => {
  if (screens.quiz.hidden) return;
  if (!quiz.answered && settings.mode === "choice" && /^[1-4]$/.test(e.key)) {
    const btn = $("choices").children[Number(e.key) - 1];
    if (btn) { e.preventDefault(); btn.click(); }
  } else if (quiz.answered && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    nextQuestion();
  }
});

/* ── 시작 ───────────────────────────────────────────── */
renderStart();
