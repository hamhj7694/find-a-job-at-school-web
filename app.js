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
  const field = (id, visible) => { if ($(id)) $(id).hidden = !visible; };
  const value = id => $(id)?.value || "";
  const code = (n, key) => n[key + "_code"] || n[key];
  let pageNumber = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
  const deadline = n => n.close_at ? format(n.close_at) : n.close_date ? dateOnly(n.close_date) + " · 시각 미기재" : "접수 마감 확인 필요";
  function badge(e) {
    return el("span", e.status === "OPEN" && e.freshness !== "FRESH" ? "마지막 확인 당시 접수 중" : labels[e.status], "notice-status status--" + e.status.toLowerCase() + (e.freshness !== "FRESH" ? " is-unverified" : ""));
  }
  function noticeCard(n, e) {
    const card = el("article", undefined, "notice notice-row"); card.dataset.noticeId = n.id;
    const main = el("div", undefined, "notice-main"), top = el("div", undefined, "notice-topline");
    top.append(el("span", n.university_name, "university-name"), el("span", n.job_type, "notice-job"), el("span", n.employment_type, "notice-employment"));
    main.append(top, el("h3", n.title));
    main.append(el("p", [n.employer, n.region === "미상" ? "근무지역 미상" : n.region, "공고 " + dateOnly(n.published_date)].join(" · "), "notice-bottomline"));
    if (e.status === "UNKNOWN" || e.freshness !== "FRESH" || n.employer_review) main.append(el("p", n.employer_review ? "실제 고용주 확인 필요 · 대학 자체 채용으로 확정하지 않았습니다." : e.freshness !== "FRESH" ? freshLabels[e.freshness] + " · 현재 모집 여부는 최신 원문에서 확인하세요." : e.reason, "notice-warning"));
    const details = el("details", undefined, "pages-notice-details"); details.append(el("summary", "접수 시작·출처·공식 첨부 확인"));
    details.append(el("p", "실제 고용주: " + n.employer), el("p", "접수 시작: " + (n.start_at ? format(n.start_at) : n.start_date ? dateOnly(n.start_date) + " · 시각 미기재" : "확인되지 않음")));
    const source = el("p"); source.append(document.createTextNode("출처: "), link(n.source_name, n.source_url)); details.append(source);
    for (const item of n.attachments || []) { const row = el("p"); row.append(link(item.name, item.url)); details.append(row); }
    main.append(details);
    const timing = el("div", undefined, "notice-timing"); timing.append(badge(e), el("span", deadline(n), "deadline"), el("span", "확인 " + format(n.verified_at), "verified-time"));
    const original = link("대학 원문 보기 ↗", n.url); original.className = "source-link"; timing.append(original); card.append(main, timing); return card;
  }
  function historyRow(n, e) {
    const row = el("article", undefined, "notice archive-row"); row.dataset.noticeId = n.id;
    const at = el("div", undefined, "archive-date"); at.append(el("time", dateOnly(n.published_date)), el("span", n.published_date ? "원문 게시일" : "게시일 미상"));
    const main = el("div"), top = el("p", undefined, "notice-topline");
    const school = el("a", n.university_name); const url = new URL(location.href); url.search = new URLSearchParams({section: "history", university: n.university}).toString(); school.href = url.href;
    top.append(school, el("span", n.job_type), badge(e)); main.append(top, el("h3", n.title), el("p", "접수 마감 " + deadline(n), "muted"));
    if (e.freshness !== "FRESH") main.append(el("p", freshLabels[e.freshness] + " · 현재 모집 여부는 최신 원문에서 확인하세요.", "muted"));
    if (n.employer_review) main.append(el("p", "실제 고용주 확인 필요", "notice-warning"));
    const original = link("원문 ↗", n.url); original.className = "source-link"; original.setAttribute("aria-label", n.title + " 공식 원문"); row.append(at, main, original); return row;
  }
  function sourceFresh(s, now) { const at = dateValue(s.last_success_at); return s.auto && s.last_attempt_result === "SUCCESS" && at <= now && now - at <= 86400000 && now >= dateValue(payload.generated_at); }
  function renderChart(notices, year) {
    const chart = $("history-chart"); chart.replaceChildren();
    const heading = el("div", undefined, "section-heading"); const title = el("h2", year + "년 월별 게시 기록"); title.id = "monthly-heading";
    heading.append(title, el("span", "수집한 원문 게시일 기준 · 게시일 미상 제외")); chart.append(heading);
    const counts = Array.from({length: 12}, (_, i) => notices.filter(n => n.published_date?.startsWith(year + "-" + String(i + 1).padStart(2, "0"))).length);
    const maximum = Math.max(1, ...counts), bars = el("div", undefined, "monthly-bars");
    counts.forEach((count, i) => {
      const month = i + 1, cell = el("div"), button = el("button", undefined, "month-select"); cell.dataset.month = month; cell.dataset.count = count;
      button.type = "button"; button.setAttribute("aria-label", `${year}년 ${month}월 게시 공고 ${count}건 보기`); button.setAttribute("aria-pressed", String(Number(value("month")) === month));
      const track = el("div", undefined, "bar-track"), fill = el("span"); track.setAttribute("aria-hidden", "true"); fill.style.height = Math.round(count * 100 / maximum) + "%"; track.append(fill);
      button.append(el("span", count + "건", "bar-count"), track, el("span", month + "월"));
      button.addEventListener("click", () => { $("year").value = String(year); $("month").value = String(month); pageNumber = 1; writeURL(); render(); });
      cell.append(button); bars.append(cell);
    });
    chart.append(bars, el("p", "0건은 수집된 기록이 없다는 뜻입니다. 실제 채용 공고가 없었다는 뜻으로 해석하지 마세요.", "muted"));
  }
  function pagination(items, renderItem) {
    const total = Math.max(1, Math.ceil(items.length / 20)); pageNumber = Math.min(pageNumber, total);
    const list = el("div", undefined, section === "history" ? "archive-list" : "notice-list");
    for (const {n, e} of items.slice((pageNumber - 1) * 20, pageNumber * 20)) list.append(renderItem(n, e)); $("results").append(list);
    if (total <= 1) return;
    const nav = el("nav", undefined, "pagination"); nav.setAttribute("aria-label", section === "history" ? "이력 페이지" : "공고 페이지");
    for (const [text, step] of [["이전", -1], ["다음", 1]]) {
      const button = el("button", text, "button button-secondary pagination-link"); button.type = "button"; button.disabled = pageNumber + step < 1 || pageNumber + step > total;
      button.addEventListener("click", () => { pageNumber += step; writeURL(); render(); $("count").scrollIntoView({block: "start"}); });
      nav.append(button); if (step === -1) nav.append(el("span", pageNumber + " / " + total));
    }
    $("results").append(nav);
  }
  function render() {
    if (!payload) return;
    const now = Date.now(), university = value("university"), school = payload.universities.find(u => u.slug === university);
    const words = value("q").trim().toLocaleLowerCase("ko-KR").split(/\s+/).filter(Boolean).slice(0, 12);
    const results = $("results"); results.replaceChildren();
    $("heading").textContent = {notices: "다음 기회는, 대학에서.", history: (school ? school.name + " " : "대학별 ") + "채용 이력", coverage: "전국 대학 조사·수집 현황"}[section];
    $("intro").textContent = {notices: "국공립대 공식 채용 공고에서 지금 지원할 수 있는 자리를 찾아보세요.", history: "예전에 어떤 채용 공고가 언제 올라왔는지 살펴보세요.", coverage: "대학별 여러 공개 게시판과 자동 수집 상태를 확인하세요."}[section];
    document.title = $("heading").textContent + " | 국공립대 채용모아";
    if ($("page-container")) $("page-container").className = "container " + {notices: "listing-page", history: "history-page", coverage: "coverage-page"}[section];
    $("search-form").className = section === "notices" ? "" : "archive-filters " + (section === "coverage" ? "coverage-filters" : "");
    for (const id of ["region-field", "employment-field", "region-note", "trust-strip", "view-tabs", "scope-shortcut"]) field(id, section === "notices");
    field("view-field", false);
    for (const id of ["year-field", "month-field", "history-status-field", "history-chart", "history-note"]) field(id, section === "history");
    field("source-field", section === "coverage"); field("job-field", section !== "coverage"); field("stats", section === "coverage"); field("scope", section === "coverage");
    if ($("search-panel")) $("search-panel").className = section === "notices" ? "search-section" : "pages-filter-panel";
    if ($("search-submit")) $("search-submit").textContent = {notices: "공고 검색", history: "이력 검색", coverage: "현황 보기"}[section];
    for (const nav of document.querySelectorAll("[data-section]")) { nav.removeAttribute("aria-current"); if (nav.dataset.section === section) nav.setAttribute("aria-current", "page"); }
    const stats = $("stats"); stats.replaceChildren();
    for (const [label, count, suffix] of [["게시판 확인 대학", new Set(payload.sources.map(s => s.university)).size, "/ " + payload.universities.length + "교"], ["확인된 게시판", payload.sources.length, "개"], ["자동 수집 게시판", payload.sources.filter(s => s.auto).length, "개"]]) {
      const item = el("dl"); item.append(el("dt", label)); const result = el("dd"); result.append(el("strong", String(count)), document.createTextNode(" "), el("span", suffix)); item.append(result); stats.append(item);
    }
    if ($("scope-shortcut")) $("scope-shortcut").textContent = `게시판 확인 ${new Set(payload.sources.map(s => s.university)).size} / 조사 대상 ${payload.universities.length}개 대학 · 공식 게시판 ${payload.sources.length}개 →`;
    if (section === "coverage") {
      const state = value("source-state");
      const sources = payload.sources.filter(s => (!university || s.university === university) && matchesWords([s.university_name, s.name, s.organization, s.kind].join(" "), words) && (!state || (state === "auto" && s.auto) || (state === "manual" && !s.auto) || (state === "fresh" && sourceFresh(s, now))));
      $("count").textContent = "실제 확인한 게시판 · 검색 결과 " + sources.length + "개 · 최근 수집 성공은 24시간 기준";
      const table = el("table", undefined, "source-table"), head = el("thead"), row = el("tr");
      for (const text of ["대학과 게시판", "수집 상태", "마지막 성공 확인"]) { const th = el("th", text); th.scope = "col"; row.append(th); } head.append(row); table.append(head);
      const body = el("tbody");
      for (const s of sources) { const tr = el("tr"), name = el("td"), stateCell = el("td"), timeCell = el("td", format(s.last_success_at)); name.append(el("strong", s.university_name), link(s.name + " ↗", s.url), el("p", [s.organization, s.kind].filter(Boolean).join(" · "))); stateCell.append(el("span", s.auto ? "자동 수집 사용" : "자동 수집 보류"), el("p", sourceFresh(s, now) ? "최근 수집 성공" : s.last_attempt_result === "PARTIAL" ? "일부 공고·첨부 검토" : s.last_attempt_result === "FAILED" ? "최근 확인 실패" : "최신 확인 필요")); tr.append(name, stateCell, timeCell); body.append(tr); } table.append(body);
      if (sources.length) results.append(table); else results.append(el("p", "조건에 맞는 확인 게시판이 없습니다. 해당 대학의 모든 게시판을 연결한 상태는 아닙니다.", "empty-state"));
      return;
    }
    let records = payload.notices.filter(n => (!university || n.university === university) && matchesWords([n.title, n.university_name, n.job_type, n.employer, n.source_name].join(" "), words) && (!value("job_type") || code(n, "job_type") === value("job_type")));
    if (section === "history") {
      const universityRecords = payload.notices.filter(n => (!university || n.university === university) && n.published_date);
      const years = universityRecords.map(n => Number(n.published_date.slice(0, 4)));
      const year = Number(value("year")) || Math.max(0, ...years) || Number(kstDate(now).slice(0, 4));
      renderChart(records, year);
      if (value("year")) records = records.filter(n => n.published_date?.startsWith(value("year") + "-"));
      if (value("month")) records = records.filter(n => Number(n.published_date?.slice(5, 7)) === Number(value("month")));
    } else records = records.filter(n => (!value("region") || n.region === value("region")) && (!value("employment_type") || code(n, "employment_type") === value("employment_type")));
    let notices = records.map(n => ({n, e: evaluate(n, now)}));
    if (section === "notices") {
      if ($("view-tabs")) { $("view-tabs").replaceChildren(); for (const [tab, label] of [["open", "접수 중"], ["scheduled", "접수 예정"], ["review", "확인 필요"], ["all", "전체 공고"]]) { const button = el("button", label + " " + notices.filter(({e}) => matchView(e, tab)).length, "view-tab"); button.type = "button"; button.setAttribute("aria-pressed", String(value("view") === tab)); button.addEventListener("click", () => { $("view").value = tab; pageNumber = 1; writeURL(); render(); }); $("view-tabs").append(button); } }
      notices = notices.filter(({e}) => matchView(e, value("view")));
    } else if (value("history-status")) notices = notices.filter(({e}) => e.status === value("history-status"));
    notices.sort((a, b) => (b.n.published_date || "").localeCompare(a.n.published_date || "") || b.n.id - a.n.id);
    $("count").textContent = "검색 결과 " + notices.length + "개 공고" + (section === "history" ? " · 원문 게시일 최신순" : " · " + labels[{open: "OPEN", scheduled: "SCHEDULED", review: "UNKNOWN"}[value("view")]]);
    if (section === "notices" && value("view") === "all") $("count").textContent = "검색 결과 " + notices.length + "개 공고 · 전체 공고";
    results.append(el("h2", section === "history" ? "공고 게시 이력" : "공고 목록", section === "history" ? "pages-results-heading" : "sr-only"));
    if (!notices.length) { const empty = el("div", undefined, "empty-state"); empty.append(el("h3", section === "history" ? "수집된 이력이 없습니다." : "선택한 조건에 맞는 공고가 없어요."), el("p", "검색 조건이나 확인 필요·전체 공고를 함께 확인해 주세요. 기록이 없다는 뜻이며 실제 채용이 없었다는 뜻은 아닙니다.")); results.append(empty); return; }
    pagination(notices, section === "history" ? historyRow : noticeCard);
  }
  function writeURL() {
    const next = new URLSearchParams(); if (section !== "notices") next.set("section", section);
    const keys = ["q", "university", ...(section === "coverage" ? [] : ["job_type"]), ...(section === "notices" ? ["region", "employment_type"] : section === "history" ? ["year", "month"] : [])];
    for (const key of keys) if (value(key).trim()) next.set(key, value(key).trim());
    if (section === "notices" && value("view") !== "open") next.set("view", value("view"));
    if (section === "coverage" && value("source-state")) next.set("state", value("source-state"));
    if (section === "history" && value("history-status")) next.set("status", value("history-status"));
    if (pageNumber > 1) next.set("page", String(pageNumber));
    history.replaceState(null, "", location.pathname + (next.size ? "?" + next.toString() : ""));
  }
  $("search-form").addEventListener("submit", event => { event.preventDefault(); pageNumber = 1; writeURL(); render(); });
  $("reset-filters").addEventListener("click", () => { $("search-form").reset(); pageNumber = 1; writeURL(); render(); });
  for (const anchor of document.querySelectorAll("[data-section]")) anchor.addEventListener("click", event => { event.preventDefault(); section = anchor.dataset.section; pageNumber = 1; writeURL(); render(); });
  function populate(id, values) { if (!$(id)) return; for (const [key, text] of values) { if ([...$(id).options].some(o => o.value === key)) continue; const option = el("option", text); option.value = key; $(id).append(option); } }
  function restore() {
    for (const key of ["q", "university", "region", "job_type", "employment_type", "year", "month"]) if ($(key) && params.get(key)) $(key).value = params.get(key);
    if (["open", "scheduled", "review", "all"].includes(params.get("view"))) $("view").value = params.get("view");
    if (["auto", "manual", "fresh"].includes(params.get("state"))) $("source-state").value = params.get("state");
    if (labels[params.get("status")]) $("history-status").value = params.get("status");
    // Preserve links from the first Pages version, which used YYYY-MM as the month value.
    const oldMonth = /^(\d{4})-(\d{2})$/.exec(params.get("month") || "");
    if (oldMonth) { $("year").value = oldMonth[1]; $("month").value = String(Number(oldMonth[2])); }
  }
  fetch("./data.json", {cache: "no-cache"}).then(response => { if (!response.ok) throw new Error("data"); return response.json(); }).then(data => {
    payload = data;
    populate("university", payload.universities.map(u => [u.slug, u.name]));
    const uniqueOptions = key => [...new Map(payload.notices.map(n => [code(n, key), n[key]])).entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
    populate("job_type", uniqueOptions("job_type")); populate("employment_type", uniqueOptions("employment_type"));
    populate("region", [...new Set(payload.notices.map(n => n.region))].sort().map(r => [r, r === "미상" ? "근무지역 미상" : r]));
    const years = [...new Set(payload.notices.filter(n => n.published_date).map(n => n.published_date.slice(0, 4)))].sort().reverse();
    populate("year", years.map(y => [y, y + "년"])); populate("month", Array.from({length: 12}, (_, i) => [String(i + 1), i + 1 + "월"]));
    populate("history-status", Object.entries(labels)); restore();
    $("generated").textContent = "데이터 갱신 " + format(payload.generated_at); $("scope").textContent = payload.scope_note;
    render(); setInterval(render, 60000);
  }).catch(() => { $("generated").textContent = "데이터 갱신 시각을 확인할 수 없습니다."; $("count").textContent = "데이터를 불러오지 못했습니다."; $("results").append(el("p", "연결 상태를 확인하고 새로고침해 주세요. 오류가 계속되면 대학 공식 게시판을 직접 확인하세요.", "empty-state")); });
})();
