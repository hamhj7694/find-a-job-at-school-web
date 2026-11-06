"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const labels = {OPEN: "접수 중", SCHEDULED: "접수 예정", CLOSED: "마감", CANCELLED: "취소", UNKNOWN: "확인 필요"};
  const freshLabels = {FRESH: "최근 확인", STALE: "최신 확인 지연", FAILED: "최근 확인 실패", UNVERIFIED: "미수집"};
  const params = new URLSearchParams(location.search);
  let section = ["notices", "history", "coverage"].includes(params.get("section")) ? params.get("section") : "notices";
  let payload;
  const dateValue = value => value ? Date.parse(value) : NaN;
  const kstDate = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
  const format = value => {
    const ms = dateValue(value);
    return Number.isFinite(ms) ? new Intl.DateTimeFormat("ko-KR", {timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false}).format(ms) + " KST" : "확인되지 않음";
  };
  const dateOnly = value => value ? value.replaceAll("-", ".") : "확인되지 않음";
  function evaluate(n, now = Date.now()) {
    const today = kstDate(now), verified = dateValue(n.verified_at);
    let freshness = ["FAILED", "PARTIAL"].includes(n.last_attempt_result) ? "FAILED" :
      !Number.isFinite(verified) || verified > now ? "UNVERIFIED" : now - verified > 86400000 ? "STALE" : "FRESH";
    // A client clock earlier than the published snapshot cannot establish freshness.
    if (now < dateValue(payload?.generated_at)) freshness = "UNVERIFIED";
    const result = (status, reason) => ({status, freshness, reason});
    const start = dateValue(n.start_at), close = dateValue(n.close_at), expiry = dateValue(n.review_expires_at);
    if (n.cancelled || n.review_status === "CANCELLED") return result("CANCELLED", "공식 취소 근거가 확인된 공고입니다.");
    if ((Number.isFinite(start) && Number.isFinite(close) && start >= close) || (n.start_date && n.close_date && n.start_date > n.close_date)) return result("UNKNOWN", "접수 시작과 마감의 순서가 충돌하여 검수가 필요합니다.");
    if ((Number.isFinite(close) && now >= close) || (!Number.isFinite(close) && n.close_date && today > n.close_date)) return result("CLOSED", "확인된 접수 마감이 지났습니다.");
    if (["CLOSED", "UNKNOWN"].includes(n.review_status)) return result(n.review_status, "원문 검수 결과를 확인해 주세요.");
    if (n.requires_review) return result("UNKNOWN", n.employer_review ? "실제 고용주 확인이 필요합니다. 대학 자체 채용으로 확정하지 않았습니다." : "접수 시작일·마감 또는 현재 접수 가능 근거를 확인해야 합니다.");
    if ((Number.isFinite(start) && now < start) || (!Number.isFinite(start) && n.start_date && today < n.start_date)) return result("SCHEDULED", "접수 시작 전입니다.");
    if (n.review_status !== "AUTO") {
      if (!Number.isFinite(expiry) || now >= expiry) return result("UNKNOWN", "검수 확인 기간이 만료되어 재확인이 필요합니다.");
      if (n.review_status === "OPEN" && n.has_period_evidence) return result("OPEN", "원문 근거와 접수 가능 여부를 별도로 확인했습니다.");
    }
    if (!Number.isFinite(close) && n.close_date === today) return result("UNKNOWN", "오늘 마감이며 정확한 종료 시각 확인이 필요합니다.");
    if (!Number.isFinite(start) && n.start_date === today && !n.open_confirmed) return result("UNKNOWN", "오늘 접수 시작이며 정확한 시작 시각 확인이 필요합니다.");
    if ((Number.isFinite(start) || n.start_date || n.open_confirmed) && (Number.isFinite(close) || n.close_date) && n.has_period_evidence) return result("OPEN", "원문의 접수기간을 기준으로 확인했습니다.");
    if (n.open_confirmed && Number.isFinite(expiry) && now < expiry && n.has_period_evidence) return result("OPEN", "기한 없는 모집의 접수 가능 여부를 별도로 확인했습니다.");
    return result("UNKNOWN", "현재 접수 가능한 기간을 확정할 근거가 부족합니다.");
  }
  function el(tag, text, cls) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  function link(text, url) {
    const a = el("a", text);
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return el("span", text + " · 원문 링크 확인 필요");
      a.href = parsed.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    } catch { return el("span", text + " · 원문 링크 확인 필요"); }
  }
  function matchesWords(text, words) { const value = text.toLocaleLowerCase("ko-KR"); return words.every(word => value.includes(word)); }
  const matchView = (e, view) => view === "all" || (view === "open" && e.status === "OPEN" && e.freshness === "FRESH") ||
    (view === "scheduled" && e.status === "SCHEDULED" && e.freshness === "FRESH") ||
    (view === "review" && (e.status === "UNKNOWN" || (!["CLOSED", "CANCELLED"].includes(e.status) && e.freshness !== "FRESH")));
  function noticeCard(n, evaluation) {
    const card = el("article", undefined, "notice");
    card.dataset.noticeId = n.id;
    card.append(el("p", [n.university_name, n.job_type, n.employment_type, n.region].join(" · "), "meta"));
    card.append(el("h3", n.title));
    const badges = el("div");
    badges.append(el("span", labels[evaluation.status], "badge " + evaluation.status.toLowerCase()), el("span", freshLabels[evaluation.freshness], "badge"));
    if (n.employer_review) badges.append(el("span", "고용주 확인 필요", "badge unknown"));
    card.append(badges);
    const facts = el("div", undefined, "facts");
    const deadline = el("span"); deadline.append(el("strong", "접수 마감 "), document.createTextNode(n.close_at ? format(n.close_at) : n.close_date ? dateOnly(n.close_date) + " · 시각 미기재" : "확인 필요"));
    facts.append(deadline, el("span", "원문 게시일 " + dateOnly(n.published_date)), el("span", "마지막 확인 " + format(n.verified_at)));
    card.append(facts, el("p", evaluation.reason, "reason"), link("대학 원문 보기 ↗", n.url));
    const details = el("details"); details.append(el("summary", "접수 시작·출처·공식 첨부 확인"));
    details.append(el("p", "실제 고용주: " + n.employer), el("p", "접수 시작: " + (n.start_at ? format(n.start_at) : n.start_date ? dateOnly(n.start_date) + " · 시각 미기재" : "확인되지 않음")));
    const source = el("p"); source.append(document.createTextNode("출처: "), link(n.source_name, n.source_url)); details.append(source);
    if (n.attachments.length) {
      const list = el("ul");
      for (const item of n.attachments) { const li = el("li"); li.append(link(item.name, item.url)); list.append(li); }
      details.append(list);
    } else details.append(el("p", "등록된 공식 첨부 링크가 없습니다. 원문에서 확인하세요."));
    card.append(details);
    return card;
  }
  function sourceFresh(s, now) { const at = dateValue(s.last_success_at); return s.auto && s.last_attempt_result === "SUCCESS" && at <= now && now - at <= 86400000 && now >= dateValue(payload.generated_at); }
  function render() {
    if (!payload) return;
    const now = Date.now(), university = $("university").value;
    const words = $("q").value.trim().toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean).slice(0, 12);
    const results = $("results"); results.replaceChildren();
    $("heading").textContent = {notices: "지금, 대학에서 일할 기회", history: "대학별 채용의 지난 기록", coverage: "어디까지 확인했나요?"}[section];
    $("intro").textContent = {notices: "공식 채용 공고의 접수기간과 원문을 함께 확인하세요.", history: "원문에 게시된 날짜를 기준으로 이전 채용 공고를 살펴보세요.", coverage: "실제 확인 게시판과 자동 수집 상태를 구분해 보여드립니다."}[section];
    $("view-field").hidden = section !== "notices"; $("month-field").hidden = section !== "history"; $("source-field").hidden = section !== "coverage";
    for (const nav of document.querySelectorAll("[data-section]")) { nav.removeAttribute("aria-current"); if (nav.dataset.section === section) nav.setAttribute("aria-current", "page"); }
    const stats = $("stats"); stats.replaceChildren();
    for (const [label, count, suffix] of [["게시판 확인 대학", new Set(payload.sources.map(s => s.university)).size, "/ " + payload.universities.length + "교"], ["실제 확인 게시판", payload.sources.length, "개"], ["자동 수집 게시판", payload.sources.filter(s => s.auto).length, "개"]]) {
      const item = el("div", undefined, "stat"); item.append(el("span", label), el("strong", String(count)), document.createTextNode(" "), el("small", suffix)); stats.append(item);
    }
    if (section === "coverage") {
      const state = $("source-state").value;
      const sources = payload.sources.filter(s => (!university || s.university === university) && matchesWords([s.university_name, s.name, s.organization, s.kind].join(" "), words) && (!state || (state === "auto" && s.auto) || (state === "manual" && !s.auto) || (state === "fresh" && sourceFresh(s, now))));
      $("count").textContent = "검색 결과 " + sources.length + "개 게시판 · 최근 수집 성공은 24시간 기준";
      if (sources.length) {
        const table = el("table"), head = el("thead"), row = el("tr");
        for (const text of ["대학과 게시판", "수집 상태", "마지막 성공 확인"]) { const th = el("th", text); th.scope = "col"; row.append(th); } head.append(row); table.append(head);
        const body = el("tbody");
        for (const s of sources) { const tr = el("tr"), name = el("td"), stateCell = el("td"), timeCell = el("td", format(s.last_success_at)); name.append(el("strong", s.university_name), link(s.name + " ↗", s.url), el("p", [s.organization, s.kind].filter(Boolean).join(" · "))); stateCell.append(el("span", s.auto ? "자동 수집 사용" : "자동 수집 보류"), el("p", sourceFresh(s, now) ? "최근 수집 성공" : s.last_attempt_result === "PARTIAL" ? "일부 공고·첨부 검토" : s.last_attempt_result === "FAILED" ? "최근 확인 실패" : "최신 확인 필요")); tr.append(name, stateCell, timeCell); body.append(tr); } table.append(body); results.append(table);
      }
      if (!sources.length) results.append(el("p", "조건에 맞는 확인 게시판이 없습니다. 해당 대학의 모든 게시판을 연결한 상태는 아닙니다.", "empty"));
      return;
    }
    let notices = payload.notices.filter(n => (!university || n.university === university) && matchesWords([n.title, n.university_name, n.job_type, n.employer, n.source_name].join(" "), words));
    notices = notices.map(n => ({n, e: evaluate(n, now)}));
    if (section === "notices") notices = notices.filter(({e}) => matchView(e, $("view").value));
    if (section === "history" && $("month").value) notices = notices.filter(({n}) => n.published_date?.startsWith($("month").value));
    notices.sort((a, b) => (b.n.published_date || "").localeCompare(a.n.published_date || "") || b.n.id - a.n.id);
    $("count").textContent = "검색 결과 " + notices.length + "개 공고" + (section === "history" ? " · 원문 게시일 기준, 수집 기록이 있는 기간만 표시" : " · " + $("view").selectedOptions[0].textContent);
    if (!notices.length) {
      results.append(el("p", "조건에 맞는 공고가 없습니다. ‘확인 필요’ 또는 ‘전체 공고’도 확인해 보세요. 공고가 없다는 뜻으로 해석하지 마세요.", "empty"));
      return;
    }
    if (section === "history") {
      const groups = new Map();
      for (const item of notices) { const month = item.n.published_date?.slice(0, 7) || "게시일 미확인"; if (!groups.has(month)) groups.set(month, []); groups.get(month).push(item); }
      for (const [month, items] of groups) { const group = el("section", undefined, "month-group"); group.append(el("h2", month + " · " + items.length + "건")); for (const {n, e} of items) group.append(noticeCard(n, e)); results.append(group); }
    } else {
      results.append(el("h2", "공고 목록", "visually-hidden"));
      for (const {n, e} of notices) results.append(noticeCard(n, e));
    }
  }
  function writeURL() {
    const next = new URLSearchParams();
    if (section !== "notices") next.set("section", section);
    for (const key of ["q", "university"]) if ($(key).value.trim()) next.set(key, $(key).value.trim());
    if (section === "notices" && $("view").value !== "open") next.set("view", $("view").value);
    if (section === "coverage" && $("source-state").value) next.set("state", $("source-state").value);
    if (section === "history" && $("month").value) next.set("month", $("month").value);
    history.replaceState(null, "", location.pathname + (next.size ? "?" + next.toString() : ""));
  }
  $("search-form").addEventListener("submit", event => { event.preventDefault(); writeURL(); render(); });
  $("reset-filters").addEventListener("click", () => { $("search-form").reset(); writeURL(); render(); });
  for (const anchor of document.querySelectorAll("[data-section]")) anchor.addEventListener("click", event => { event.preventDefault(); section = anchor.dataset.section; writeURL(); render(); });
  $("q").value = params.get("q") || "";
  if (["open", "scheduled", "review", "all"].includes(params.get("view"))) $("view").value = params.get("view");
  if (["auto", "manual", "fresh"].includes(params.get("state"))) $("source-state").value = params.get("state");
  if (/^\d{4}-\d{2}$/.test(params.get("month") || "")) $("month").value = params.get("month");
  fetch("./data.json", {cache: "no-cache"}).then(response => { if (!response.ok) throw new Error("data"); return response.json(); }).then(data => {
    payload = data;
    for (const u of payload.universities) { const option = el("option", u.name); option.value = u.slug; $("university").append(option); }
    if (payload.universities.some(u => u.slug === params.get("university"))) $("university").value = params.get("university");
    $("generated").textContent = "데이터 갱신 " + format(payload.generated_at);
    $("scope").textContent = payload.scope_note;
    render();
    setInterval(render, 60000);
  }).catch(() => { $("generated").textContent = "데이터 갱신 시각을 확인할 수 없습니다."; $("count").textContent = "데이터를 불러오지 못했습니다."; $("results").append(el("p", "연결 상태를 확인하고 새로고침해 주세요. 오류가 계속되면 대학 공식 게시판을 직접 확인하세요.", "empty")); });
})();
