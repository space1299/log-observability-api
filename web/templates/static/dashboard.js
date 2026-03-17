const API_BASE = "";
const STATUS_URL_BASE = "/status";

const serverListEl = document.getElementById("server-list");
const containerGridEl = document.getElementById("container-grid");
const selectedServerLabelEl = document.getElementById("selected-server-label");
const containerCountEl = document.getElementById("container-count");

let servers = [];
let currentServerId = null;

// status → 색상 클래스 매핑
function statusToClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "running" || s === "up") {
    return "status-running";
  }
  if (s === "restarting" || s === "paused" || s === "unhealthy") {
    return "status-warning";
  }
  // exited, dead, 기타 전부 error 취급
  return "status-error";
}

function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

// 서버 목록 로딩
async function loadServers() {
  serverListEl.textContent = "로딩 중...";
  try {
    const res = await fetch(`${API_BASE}/v1/servers`);
    if (!res.ok) throw new Error("failed to load servers");
    const data = await res.json();
    servers = Array.isArray(data) ? data : [];
    renderServerList();
  } catch (e) {
    console.error(e);
    serverListEl.textContent = "서버 목록 로딩 실패";
  }
}

function renderServerList() {
  if (!servers.length) {
    serverListEl.textContent = "등록된 서버 없음";
    return;
  }

  serverListEl.innerHTML = "";

  let firstBtn = null;
  let firstServerId = null;

  servers.forEach((s, idx) => {
    const btn = document.createElement("button");
    btn.className = "server-btn";
    btn.textContent = s.server_id;

    btn.addEventListener("click", () => {
      currentServerId = s.server_id;

      document
        .querySelectorAll(".server-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      selectedServerLabelEl.textContent = s.server_id;
      loadContainersForServer(currentServerId);
    });

    if (idx === 0) {
      firstBtn = btn;
      firstServerId = s.server_id;
    }

    serverListEl.appendChild(btn);
  });

  if (!currentServerId && firstBtn) {
    firstBtn.click();
  }
}


// 특정 서버의 컨테이너 최신 상태 목록 로딩
async function loadContainersForServer(serverId) {
  containerGridEl.innerHTML = '<div class="empty-text">컨테이너 목록 로딩 중...</div>';
  containerCountEl.textContent = "";

  if (!serverId) {
    containerGridEl.innerHTML = '<div class="empty-text">서버를 먼저 선택하세요.</div>';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/v1/servers/${encodeURIComponent(serverId)}/containers`);
    if (!res.ok) throw new Error("failed to load containers");
    const data = await res.json();
    const containers = Array.isArray(data) ? data : [];
    renderContainerCards(serverId, containers);
  } catch (e) {
    console.error(e);
    containerGridEl.innerHTML = '<div class="empty-text">컨테이너 로딩 실패</div>';
    containerCountEl.textContent = "";
  }
}

function renderContainerCards(serverId, containers) {
  if (!containers.length) {
    containerGridEl.innerHTML = '<div class="empty-text">컨테이너 없음</div>';
    containerCountEl.textContent = "0 containers";
    return;
  }

  containerGridEl.innerHTML = "";
  containerCountEl.textContent = `${containers.length} containers`;

  containers.forEach((c) => {
    const card = document.createElement("div");
    card.className = "container-card";

    const nameDiv = document.createElement("div");
    nameDiv.className = "container-name";
    nameDiv.textContent = c.container_name || "(no name)";

    const metaDiv = document.createElement("div");
    metaDiv.className = "container-meta";
    const imageText = c.image ? c.image : "";
    const lastTsText = fmtTs(c.ts);
    const metaParts = [];
    if (imageText) metaParts.push(imageText);
    metaDiv.textContent = metaParts.join(" | ");

    const statusDiv = document.createElement("div");
    const statusSpan = document.createElement("span");
    const statusText = c.status || "unknown";
    statusSpan.className = `status-pill ${statusToClass(statusText)}`;
    statusSpan.textContent = statusText;
    statusDiv.appendChild(statusSpan);

    const statsDiv = document.createElement("div");
    statsDiv.className = "container-stats";
    const statsParts = [];
    if (typeof c.cpu_usage === "number") {
      statsParts.push(`CPU: ${c.cpu_usage.toFixed(1)}%`);
    }
    if (typeof c.mem_usage === "number") {
      statsParts.push(`MEM: ${c.mem_usage.toFixed(1)}%`);
    }
    if (statsParts.length) {
      statsDiv.textContent = statsParts.join(" | ");
    }

    card.appendChild(nameDiv);
    if (metaParts.length) card.appendChild(metaDiv);
    card.appendChild(statusDiv);
    if (statsParts.length) card.appendChild(statsDiv);

    card.addEventListener("click", () => {
      const url = `${STATUS_URL_BASE}?server_id=${encodeURIComponent(
        serverId
      )}&container_name=${encodeURIComponent(c.container_name || "")}`;
      window.location.href = url;
    });

    containerGridEl.appendChild(card);
  });
}

loadServers();