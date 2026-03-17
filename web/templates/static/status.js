// status.js
const API_BASE = ""; // 같은 origin
const METRIC_WINDOW_HOURS = 1; // 기본: 최근 1시간 그래프

// --- sidebar DOM (status 방식) ---
const serverListEl = document.getElementById("server-list");
const containerListEl = document.getElementById("container-list");
const serverSearchInput = document.getElementById("server-search-input");
const containerSearchWrap = document.querySelector(".container-search");
const containerSearchInput = document.getElementById("container-search-input");

// --- detail DOM ---
const scLabelEl = document.getElementById("sc-label");
const statusPillEl = document.getElementById("status-pill");
const uptimeBadgeEl = document.getElementById("uptime-badge");
const lastUpdateEl = document.getElementById("last-update");
const cpuSummaryEl = document.getElementById("cpu-summary");
const memSummaryEl = document.getElementById("mem-summary");
const memBytesSummaryEl = document.getElementById("mem-bytes-summary");
const netSummaryEl = document.getElementById("net-summary");

// --- metric DOM ---
const metricBtns = document.querySelectorAll(".metric-btn");
const metricMetaEl = document.getElementById("metric-meta");
const metricTbodyEl = document.getElementById("metric-tbody");

let servers = [];
let currentServerId = null;
let containersCache = {}; // server_id -> container list
let currentContainerName = null;
let currentStatusRow = null; // /v1/status latest=1 결과

let metricChart = null;

// 쿼리스트링에서 초기 선택값 읽기
const params = new URLSearchParams(window.location.search);
const initialServerId = params.get("server_id");
const initialContainerName = params.get("container_name");

let sidebar = null;

// ---------------- 공통 util ----------------

function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function formatUptime(uptimeSec, ts, createdAt) {
  let sec = uptimeSec;
  if (sec == null) {
    if (!ts || !createdAt) return "-";
    const t = new Date(ts).getTime();
    const c = new Date(createdAt).getTime();
    if (isNaN(t) || isNaN(c)) return "-";
    sec = Math.max(0, Math.floor((t - c) / 1000));
  }
  if (sec < 0) return "-";

  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");

  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function buildMetricTimeParams() {
  const now = new Date();
  const since = new Date(now.getTime() - METRIC_WINDOW_HOURS * 3600 * 1000);
  const qs = new URLSearchParams();
  qs.set("since", since.toISOString());
  qs.set("until", now.toISOString());
  return qs;
}

// ---------------- sidebar data provider ----------------

function getServerIds() {
  return servers.map((s) => s.server_id);
}

function getContainersForServer(serverId) {
  return containersCache[serverId] || [];
}

// 서버 선택 시: 컨테이너 데이터만 확보 (렌더는 app.js가 함)
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

// 컨테이너 선택 시: 상세/메트릭 갱신 트리거
function onContainerSelected(serverId, containerName) {
  currentServerId = serverId;
  currentContainerName = containerName;
  loadCurrentStatus(serverId, containerName);
}

// ---------------- 현재 상태 (latest=1) ----------------

function statusToClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "running" || s === "up") return "status-running";
  if (s === "restarting" || s === "paused" || s === "unhealthy") return "status-warning";
  return "status-error";
}

async function loadCurrentStatus(serverId, containerName) {
  resetMetricView();
  if (scLabelEl) scLabelEl.textContent = `${serverId} / ${containerName}`;
  if (metricMetaEl) metricMetaEl.textContent = "현재 상태 조회 중...";

  const qs = new URLSearchParams();
  qs.set("server_id", serverId);
  qs.set("container_name", containerName);
  qs.set("latest", "1");

  try {
    const res = await fetch(`${API_BASE}/v1/status?${qs.toString()}`);
    if (!res.ok) throw new Error("failed to load status");
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) {
      if (metricMetaEl) metricMetaEl.textContent = "데이터 없음";
      applyStatusHeader(null);
      return;
    }
    const row = data[0];
    currentStatusRow = row;
    applyStatusHeader(row);
    if (metricMetaEl) metricMetaEl.textContent = "메트릭을 선택하면 해당 구간의 그래프를 표시합니다.";
  } catch (e) {
    console.error(e);
    if (metricMetaEl) metricMetaEl.textContent = "상태 로딩 실패";
    applyStatusHeader(null);
  }
}

function applyStatusHeader(row) {
  // DOM이 페이지에 없을 수 있으니 방어적으로 처리
  if (!statusPillEl) return;

  if (!row) {
    statusPillEl.textContent = "-";
    if (uptimeBadgeEl) uptimeBadgeEl.textContent = "-";
    if (lastUpdateEl) lastUpdateEl.textContent = "-";
    if (cpuSummaryEl) cpuSummaryEl.textContent = "-";
    if (memSummaryEl) memSummaryEl.textContent = "-";
    if (memBytesSummaryEl) memBytesSummaryEl.textContent = "-";
    if (netSummaryEl) netSummaryEl.textContent = "-";
    return;
  }

  const statusText = row.status || "unknown";
  statusPillEl.textContent = `${statusText}`;

  const uptimeText = formatUptime(row.uptime_sec, row.ts, row.created_at);
  if (uptimeBadgeEl) uptimeBadgeEl.textContent = `${uptimeText}`;

  if (lastUpdateEl) lastUpdateEl.textContent = fmtTs(row.ts);

  if (cpuSummaryEl) {
    cpuSummaryEl.textContent =
      typeof row.cpu_usage === "number" ? `${row.cpu_usage.toFixed(1)} %` : "-";
  }

  if (memSummaryEl) {
    memSummaryEl.textContent =
      typeof row.mem_usage === "number" ? `${row.mem_usage.toFixed(1)} %` : "-";
  }

  if (memBytesSummaryEl) {
    memBytesSummaryEl.textContent =
      typeof row.mem_usage_bytes === "number" ? row.mem_usage_bytes.toLocaleString() : "-";
  }

  if (netSummaryEl) {
    const rx = row.net_rx_bytes;
    const tx = row.net_tx_bytes;
    if (typeof rx === "number" || typeof tx === "number") {
      const rxStr = typeof rx === "number" ? rx.toLocaleString() : "-";
      const txStr = typeof tx === "number" ? tx.toLocaleString() : "-";
      netSummaryEl.textContent = `${rxStr} / ${txStr}`;
    } else {
      netSummaryEl.textContent = "-";
    }
  }
}

// ---------------- 메트릭 / 그래프 ----------------

function resetMetricView() {
  metricBtns.forEach((b) => b.classList.remove("active"));
  if (metricTbodyEl) metricTbodyEl.innerHTML = '<tr><td colspan="3">메트릭을 선택하세요.</td></tr>';
  if (metricChart) {
    metricChart.destroy();
    metricChart = null;
  }
}

function setupMetricButtons() {
  metricBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!currentServerId || !currentContainerName) {
        alert("먼저 서버와 컨테이너를 선택하세요.");
        return;
      }
      const metric = btn.dataset.metric;
      metricBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadMetricSeries(currentServerId, currentContainerName, metric);
    });
  });
}

async function loadMetricSeries(serverId, containerName, metricKey) {
  if (!metricMetaEl || !metricTbodyEl) return;

  metricMetaEl.textContent = `메트릭 '${metricKey}' 로딩 중...`;
  metricTbodyEl.innerHTML = '<tr><td colspan="3">로딩 중...</td></tr>';

  const timeParams = buildMetricTimeParams();
  timeParams.set("metric", metricKey);

  // NOTE: 이 엔드포인트는 아직 백엔드에 없을 수 있음.
  const url = `${API_BASE}/v1/containers/${encodeURIComponent(serverId)}/${encodeURIComponent(
    containerName
  )}/metrics?${timeParams.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("failed to load metric series");
    const data = await res.json();
    const points = Array.isArray(data.points) ? data.points : [];

    if (!points.length) {
      metricMetaEl.textContent = `메트릭 '${metricKey}' 데이터 없음 (최근 ${METRIC_WINDOW_HOURS}시간)`;
      metricTbodyEl.innerHTML = '<tr><td colspan="3">데이터 없음</td></tr>';
      if (metricChart) {
        metricChart.destroy();
        metricChart = null;
      }
      return;
    }

    renderMetricTable(metricKey, points);
    renderMetricChart(metricKey, points);
    metricMetaEl.textContent = `메트릭 '${metricKey}' (${points.length} points, 최근 ${METRIC_WINDOW_HOURS}시간)`;
  } catch (e) {
    console.error(e);
    metricMetaEl.textContent = `메트릭 '${metricKey}' 로딩 실패 (백엔드 구현 여부 확인 필요)`;
    metricTbodyEl.innerHTML = '<tr><td colspan="3">에러 발생</td></tr>';
    if (metricChart) {
      metricChart.destroy();
      metricChart = null;
    }
  }
}

function renderMetricTable(metricKey, points) {
  if (!metricTbodyEl) return;

  metricTbodyEl.innerHTML = "";
  points.forEach((p) => {
    const tr = document.createElement("tr");

    const tsTd = document.createElement("td");
    tsTd.textContent = fmtTs(p.ts);
    tr.appendChild(tsTd);

    const valTd = document.createElement("td");
    if (metricKey === "net_bytes") {
      const rx = typeof p.rx === "number" ? p.rx : null;
      const tx = typeof p.tx === "number" ? p.tx : null;
      const rxStr = rx != null ? rx.toLocaleString() : "-";
      const txStr = tx != null ? tx.toLocaleString() : "-";
      valTd.textContent = `${rxStr} / ${txStr}`;
    } else {
      const v = typeof p.value === "number" ? p.value : null;
      valTd.textContent = v != null ? v.toString() : "-";
    }
    tr.appendChild(valTd);

    const extraTd = document.createElement("td");
    extraTd.textContent = "";
    tr.appendChild(extraTd);

    metricTbodyEl.appendChild(tr);
  });
}

function renderMetricChart(metricKey, points) {
  const canvas = document.getElementById("metricChart");
  if (!canvas) return;

  // Chart.js 로드 여부 확인
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded (Chart is undefined)");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (metricChart) {
    metricChart.destroy();
    metricChart = null;
  }

  if (!points.length) return;

  if (metricKey === "net_bytes") {
    const labels = points.map((p) => fmtTs(p.ts));
    const rxData = points.map((p) => (typeof p.rx === "number" ? p.rx : null));
    const txData = points.map((p) => (typeof p.tx === "number" ? p.tx : null));

    metricChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "rx bytes", data: rxData, tension: 0.2, pointRadius: 2, pointHoverRadius: 4 },
          { label: "tx bytes", data: txData, tension: 0.2, pointRadius: 2, pointHoverRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true } },
      },
    });
  } else {
    const labels = points.map((p) => fmtTs(p.ts));
    const data = points.map((p) => (typeof p.value === "number" ? p.value : null));

    metricChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{ label: metricKey, data, tension: 0.2, pointRadius: 2, pointHoverRadius: 4 }],
      },
      options: {
        responsive: true,
        scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true } },
      },
    });
  }
}

// ---------------- 서버 목록 로딩 + sidebar boot ----------------

async function loadServers() {
  serverListEl.textContent = "로딩 중...";
  try {
    const res = await fetch(`${API_BASE}/v1/servers`);
    if (!res.ok) throw new Error("failed to load servers");
    const data = await res.json();
    servers = Array.isArray(data) ? data : [];

    // 사이드바 컨트롤러 부팅
    if (!window.AppSidebar || !window.AppSidebar.createSidebarController) {
      console.error("AppSidebar not found. Check script loading order: app.js must be loaded before status.js");
      serverListEl.textContent = "스크립트 로딩 오류(app.js)";
      return;
    }

    sidebar = window.AppSidebar.createSidebarController({
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
      initial: {
        serverId: initialServerId,
        containerName: initialContainerName,
      },
    });

    sidebar.boot();
  } catch (e) {
    console.error(e);
    serverListEl.textContent = "서버 목록 로딩 실패";
  }
}

setupMetricButtons();
loadServers();
