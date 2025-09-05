// main.ts
// Deno Deploy / Deno-compatible server that posts messages to Discord channels
// via HTTP and streams activity logs to the browser using Server-Sent Events (SSE).

interface StartPayload {
  name: string;
  token: string;
  channelId: string;
  intervalSeconds: number;
  messages: string[];
}

type Subscriber = {
  id: string;
  controller: ReadableStreamDefaultController<string>;
};

type Job = {
  id: string;
  name: string;
  token: string;
  channelId: string;
  intervalMs: number;
  messages: string[];
  timer: number | null;
  subscribers: Set<Subscriber>;
  running: boolean;
  lastSentAt?: number;
};

const jobs = new Map<string, Job>();

function sseEncode(data: any, event?: string) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  return (event ? `event: ${event}\n` : "") + `data: ${payload}\n\n`;
}

function sanitizeMessages(raw: string[]): string[] {
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

function ensureBotPrefix(token: string): string {
  return token.toLowerCase().startsWith("bot ") ? token : `Bot ${token}`;
}

function log(job: Job, level: "info" | "error" | "warn", message: string) {
  const line = `${new Date().toISOString()} | ${level.toUpperCase()} | ${message}`;
  // Broadcast to all subscribers
  for (const sub of job.subscribers) {
    try {
      sub.controller.enqueue(sseEncode(line, "log"));
    } catch {
      // ignore
    }
  }
  // Also print to server console
  console.log(`[${job.id}] ${line}`);
}

async function sendDiscordMessage(job: Job, content: string) {
  const url = `https://discord.com/api/v10/channels/${job.channelId}/messages`;
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "DiscordBot-DenoDeploy",
    "Authorization": job.token,
  };
  const body = JSON.stringify({ content, tts: false });

  try {
    const resp = await fetch(url, { method: "POST", headers, body });
    const text = await resp.text();
    if (resp.status >= 200 && resp.status < 300) {
      log(job, "info", `Message sent successfully: "${content.slice(0, 80)}"`);
    } else {
      log(job, "error", `HTTP ${resp.status} ${resp.statusText} | response: ${text.slice(0, 300)}`);
    }
  } catch (err) {
    log(job, "error", `Exception while sending message: ${err && (err as Error).message}`);
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function startJob(payload: StartPayload): Job {
  const id = crypto.randomUUID();
  const job: Job = {
    id,
    name: payload.name?.trim() || "Discord Bot",
    token: ensureBotPrefix(payload.token.trim()),
    channelId: payload.channelId.trim(),
    intervalMs: Math.max(1, Math.floor(payload.intervalSeconds || 3600)) * 1000,
    messages: sanitizeMessages(payload.messages || ["Hello from Deno Deploy!"]),
    timer: null,
    subscribers: new Set(),
    running: true,
  };

  const tick = async () => {
    if (!job.running) return;
    const msg = pickRandom(job.messages)
      .replace("{now}", new Date().toISOString().replace("T", " ").slice(0, 19));
    await sendDiscordMessage(job, msg);
    job.lastSentAt = Date.now();
  };

  // first tick immediately, then set interval
  tick();
  const handle = setInterval(tick, job.intervalMs) as unknown as number;
  job.timer = handle;

  jobs.set(id, job);
  log(job, "info", `Job started | name="${job.name}" | channel=${job.channelId} | interval=${job.intervalMs / 1000}s | messages=${job.messages.length}`);
  return job;
}

function stopJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.running = false;
  if (job.timer !== null) {
    clearInterval(job.timer as unknown as number);
    job.timer = null;
  }
  // notify subscribers
  for (const sub of job.subscribers) {
    try {
      sub.controller.enqueue(sseEncode({ stopped: true, id }, "stop"));
      sub.controller.close();
    } catch {
      // ignore
    }
  }
  jobs.delete(id);
  console.log(`[${id}] stopped`);
  return true;
}

async function serveStatic(pathname: string): Promise<Response | null> {
  // Very small static server for /static/*
  if (!pathname.startsWith("/static/")) return null;
  const filePath = new URL("." + pathname, import.meta.url);
  try {
    const file = await Deno.readFile(filePath);
    const ext = pathname.split(".").pop()?.toLowerCase();
    const types: Record<string, string> = {
      "html": "text/html; charset=utf-8",
      "js": "text/javascript; charset=utf-8",
      "css": "text/css; charset=utf-8",
      "json": "application/json; charset=utf-8",
      "txt": "text/plain; charset=utf-8",
    };
    const ct = types[ext ?? ""] ?? "application/octet-stream";
    return new Response(file, { headers: { "content-type": ct } });
  } catch (_e) {
    return new Response("Not found", { status: 404 });
  }
}

function sseStream(job: Job): Response {
  const stream = new ReadableStream<string>({
    start(controller) {
      const sub: Subscriber = { id: crypto.randomUUID(), controller };
      job.subscribers.add(sub);
      controller.enqueue(sseEncode({ id: job.id, name: job.name, started: true }, "hello"));
      // heartbeat to keep connection open
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(`event: ping\ndata: ${Date.now()}\n\n`);
        } catch {
          // ignore
        }
      }, 15000);
      // When stream is cancelled/closed, remove subscriber
      // @ts-ignore - "cancel" exists at runtime
      controller.signal?.addEventListener?.("abort", () => {
        clearInterval(heartbeat);
        job.subscribers.delete(sub);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
  });
}

function badRequest(msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  const { pathname, searchParams } = new URL(req.url);

  // Static UI
  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    const fileUrl = new URL("./static/index.html", import.meta.url);
    const html = await Deno.readFile(fileUrl);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const staticResp = await serveStatic(pathname);
  if (staticResp) return staticResp;

  // Start a job
  if (req.method === "POST" && pathname === "/start") {
    let payload: StartPayload;
    try {
      payload = await req.json();
    } catch {
      return badRequest("Invalid JSON");
    }
    if (!payload.token || !payload.channelId || !payload.messages?.length) {
      return badRequest("Fields 'token', 'channelId', and 'messages' are required");
    }
    const job = startJob(payload);
    return new Response(JSON.stringify({ jobId: job.id }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // Stop a job
  if (req.method === "POST" && pathname === "/stop") {
    const id = searchParams.get("id") || "";
    if (!id) return badRequest("Missing id");
    const ok = stopJob(id);
    return new Response(JSON.stringify({ ok }), {
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  // SSE events for logs
  if (req.method === "GET" && pathname === "/events") {
    const id = searchParams.get("id") || "";
    const job = jobs.get(id);
    if (!job) return badRequest("Unknown job id");
    return sseStream(job);
  }

  return new Response("Not found", { status: 404 });
});
