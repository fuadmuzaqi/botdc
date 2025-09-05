// static/client.js
let currentJobId = null;
let evtSource = null;

const qs = (sel) => document.querySelector(sel);
const logEl = qs("#log");
const statusEl = qs("#status");

function appendLog(line) {
  logEl.textContent += (line.endsWith("\n") ? line : (line + "\n"));
  logEl.scrollTop = logEl.scrollHeight;
}

function toLines(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function readMessagesFile(file) {
  if (!file) return [];
  const text = await file.text();
  return toLines(text);
}

function connectSSE(jobId) {
  if (evtSource) {
    evtSource.close();
  }
  evtSource = new EventSource(`/events?id=${encodeURIComponent(jobId)}`);
  evtSource.addEventListener("hello", (e) => {
    const data = JSON.parse(e.data);
    appendLog(`[SSE] Connected to job ${data.id} (${data.name})`);
    statusEl.textContent = "Berjalan";
  });
  evtSource.addEventListener("log", (e) => {
    appendLog(e.data);
  });
  evtSource.addEventListener("stop", () => {
    appendLog(`[SSE] Job dihentikan.`);
    statusEl.textContent = "Berhenti";
    evtSource?.close();
  });
  evtSource.addEventListener("ping", () => {
    // heartbeat; no-op
  });
  evtSource.onerror = () => {
    appendLog("[SSE] Koneksi terputus.");
  };
}

async function start() {
  const name = qs("#name").value.trim();
  const intervalSeconds = parseInt(qs("#interval").value, 10) || 300;
  const token = qs("#token").value.trim();
  const channelId = qs("#channelId").value.trim();
  const file = qs("#messagesFile").files[0];
  const messages = await readMessagesFile(file);

  if (!token || !channelId || messages.length === 0) {
    appendLog("[UI] Mohon lengkapi token, channel id, dan unggah file pesan (.txt).");
    return;
  }

  const payload = { name, token, channelId, intervalSeconds, messages };
  const resp = await fetch("/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    appendLog(`[HTTP] Gagal memulai job: ${resp.status} ${resp.statusText} | ${text}`);
    statusEl.textContent = "Gagal";
    return;
  }
  const { jobId } = await resp.json();
  currentJobId = jobId;
  appendLog(`[UI] Job dimulai. ID: ${jobId}`);
  statusEl.textContent = "Menghubungkan…";
  connectSSE(jobId);
}

async function stop() {
  if (!currentJobId) {
    appendLog("[UI] Tidak ada job yang berjalan.");
    return;
  }
  const resp = await fetch(`/stop?id=${encodeURIComponent(currentJobId)}`, { method: "POST" });
  if (!resp.ok) {
    appendLog(`[HTTP] Gagal menghentikan job: ${resp.status} ${resp.statusText}`);
    return;
  }
  const data = await resp.json();
  if (data.ok) {
    appendLog(`[UI] Perintah stop dikirim.`);
  } else {
    appendLog(`[UI] Job sudah tidak aktif.`);
  }
  currentJobId = null;
  statusEl.textContent = "Berhenti";
  evtSource?.close();
}

document.getElementById("startBtn")?.addEventListener("click", start);
document.getElementById("stopBtn")?.addEventListener("click", stop);
