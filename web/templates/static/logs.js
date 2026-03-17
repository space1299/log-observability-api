const API_BASE = "";

const serverListEl = document.getElementById("server-list");
const serverSearchInput = document.getElementById("server-search-input");
const containerListEl = document.getElementById("container-list");
const containerSearchWrap = document.querySelector(".container-search");
const containerSearchInput = document.getElementById("container-search-input");

const logsTbodyEl = document.getElementById("logs-tbody");
const logsMetaEl = document.getElementById("logs-meta");
const currentTitleEl = document.getElementById("current-container-title");

// filters DOM
const levelSelectEl = document.getElementById("level-select");
const sinceInputEl = document.getElementById("since-input");
const untilInputEl = document.getElementById("until-input");
const searchInputEl = document.getElementById("search-input");
const reloadBtnEl = document.getElementById("reload-btn");

// pagination DOM
const prevPageBtnEl = document.getElementById("prev-page-btn");
const nextPageBtnEl = document.getElementById("next-page-btn");
const pageInfoEl = document.getElementById("page-info");
const downloadBtnEl = document.getElementById("download-btn");

let serversAll = [];
let containersCache = {};
let currentServerId = null;
let currentContainerName = null;
let currentPage = 1;
let totalRows = 0;
let pageSize = 100;
let lastRenderedLogs = [];
let currentAbortController = null;

function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function getServerIds() {
  return serversAll;
}

function getContainersForServer(serverId) {
  return containersCache[serverId] || [];
}

async function onServerSelected(serverId) {
  currentServerId = serverId;
  currentContainerName = null;

  if (containersCache[serverId]) return;

  try {
    const res = await fetch(`${API_BASE}/v1/servers/${encodeURIComponent(serverId)}/containers`);
    if (!res.ok) {
      console.error("failed to load containers:", res.status, serverId);
      containersCache[serverId] = [];
      return;
    }
    const data = await res.json();
    containersCache[serverId] = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(e);
    containersCache[serverId] = [];
  }
}

function onContainerSelected(serverId, containerName) {
  currentServerId = serverId;
  currentContainerName = containerName;
  currentTitleEl.textContent = `로그 - ${serverId} : ${containerName}`;
  loadLogs(); // 기본 조회
}

function getFilterParams() {
  const level = levelSelectEl?.value?.trim() || "";
  const since = sinceInputEl?.value?.trim() || "";
  const until = untilInputEl?.value?.trim() || "";
  const search = searchInputEl?.value?.trim() || "";

  const params = {};
  if (level) params.level = level;
  if (since) params.since = since;
  if (until) params.until = until;
  if (search) params.search = search;
  return params;
}

async function loadLogs(page = 1) {
  if (!currentServerId || !currentContainerName) {
    logsMetaEl.textContent = "서버/컨테이너를 먼저 선택하세요.";
    return;
  }

  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  currentPage = page;
  logsMetaEl.textContent = "로그 로딩 중...";

  const qs = new URLSearchParams({
    server_id: currentServerId,
    container_name: currentContainerName,
    page: String(currentPage),
    ...getFilterParams(), // level/since/until/search
  });

  try {
    const res = await fetch(`${API_BASE}/v1/logs?${qs.toString()}`, {
      signal: currentAbortController.signal,
    });
    if (!res.ok) {
      logsMetaEl.textContent = `로드 실패 (${res.status})`;
      return;
    }
    const data = await res.json();

    // 응답 메타 반영
    totalRows = Number(data.total || 0);
    pageSize = Number(data.page_size || pageSize);
    currentPage = Number(data.page || currentPage);

    const items = data.items || [];
    renderLogs(items);

    updatePaginationUI();
    logsMetaEl.textContent = `총 ${totalRows} rows`;
  } catch (e) {
    if (e.name === "AbortError") return;
    console.error(e);
    logsMetaEl.textContent = "로드 실패 (network error)";
  }
}

function updatePaginationUI() {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  if (pageInfoEl) pageInfoEl.textContent = `페이지 ${currentPage} / ${totalPages}`;

  if (prevPageBtnEl) prevPageBtnEl.disabled = currentPage <= 1;
  if (nextPageBtnEl) nextPageBtnEl.disabled = currentPage >= totalPages;
  if (downloadBtnEl) downloadBtnEl.disabled = lastRenderedLogs.length === 0;
}

function renderLogs(list) {
  lastRenderedLogs = Array.isArray(list) ? list : [];

  logsTbodyEl.innerHTML = "";
  lastRenderedLogs.forEach((row) => {
    const tr = document.createElement("tr");

    const level = (row.level || "").toString().trim().toUpperCase();
    const safeLevel = level.replace(/[^A-Z0-9_-]/g, "");

    tr.innerHTML = `
      <td>${row.ts ?? ""}</td>
      <td class="level-${safeLevel}">${level}</td>
      <td>${row.message ?? ""}</td>
    `;
    logsTbodyEl.appendChild(tr);
  });
}

function wirePaginationEvents() {
  prevPageBtnEl?.addEventListener("click", (e) => {
    e.preventDefault();
    if (currentPage > 1) loadLogs(currentPage - 1);
  });

  nextPageBtnEl?.addEventListener("click", (e) => {
    e.preventDefault();
    loadLogs(currentPage + 1);
  });

  downloadBtnEl?.addEventListener("click", (e) => {
    e.preventDefault();
    downloadCsvFromBackend();
  });
}

function downloadCsvFromBackend() {
  if (!currentServerId || !currentContainerName) {
    alert("서버/컨테이너를 먼저 선택하세요.");
    return;
  }

  const qs = new URLSearchParams({
    server_id: currentServerId,
    container_name: currentContainerName,
    ...getFilterParams(),
  });

  const url = `${API_BASE}/v1/logs/export?${qs.toString()}`;
  window.open(url, "_blank");
}

function wireFilterEvents() {
  if (!reloadBtnEl) return;

  reloadBtnEl.addEventListener("click", (e) => {
    e.preventDefault();
    loadLogs(1);
  });

  const debouncedLoadLogs = debounce(() => loadLogs(1), 300);
  searchInputEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") debouncedLoadLogs();
  });
}

async function boot() {
  const res = await fetch(`${API_BASE}/v1/servers`);
  if (!res.ok) throw new Error("failed to load servers");
  const data = await res.json();

  serversAll = Array.isArray(data) ? data.map(s => s.server_id).filter(Boolean) : [];

  const sidebar = window.AppSidebar.createSidebarController({
    el: {
      serverListEl,
      serverSearchInput,
      containerListEl,
      containerSearchWrap,
      containerSearchInput,
    },
    data: {
      getServers: getServerIds,
      getContainersForServer,
    },
    callbacks: {
      onServerSelected,
      onContainerSelected,
    },
  });

  sidebar.boot();

  wireFilterEvents();
  wirePaginationEvents();
  updatePaginationUI();
}

boot();