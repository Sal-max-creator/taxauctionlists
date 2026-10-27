// Cloudflare Worker: serves the static site from _site and handles the signup form at POST /api/subscribe.
// Only /api/* reaches this code (see run_worker_first in wrangler.jsonc); every other path is a static asset.
//
// The Buttondown API key lives in the Worker secret BUTTONDOWN_API_KEY. It is never logged or sent to the browser.

const BUTTONDOWN_URL = "https://api.buttondown.com/v1/subscribers";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MESSAGES = {
  ok: "You're on the list. Check your inbox to confirm.",
  invalid: "Please enter a valid email address.",
  closed: "Signups aren't open yet. Please try again soon.",
  busy: "Too many signups right now. Please try again in a minute.",
  error: "Something went wrong. Please try again.",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/subscribe") return subscribe(request, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};

async function subscribe(request, env, url) {
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  const reply = (status, key) => respond(status, key, wantsJson, request);

  if (request.method !== "POST") return reply(405, "error");

  // Only accept posts from this site's own pages.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return reply(403, "error");

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (env.SIGNUP_LIMITER) {
    const { success } = await env.SIGNUP_LIMITER.limit({ key: `signup:${ip}` });
    if (!success) return reply(429, "busy");
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(400, "invalid");
  }

  // Honeypot: people never see this field, bots fill it in. Pretend it worked and send nothing.
  if (String(form.get("company") || "").trim()) return reply(200, "ok");

  const email = String(form.get("email") || "").trim();
  if (email.length > 254 || !EMAIL_RE.test(email)) return reply(400, "invalid");

  if (!env.BUTTONDOWN_API_KEY) {
    console.error("signup: BUTTONDOWN_API_KEY is not set");
    return reply(503, "closed");
  }

  const states = String(form.get("states") || "").replace(/[^A-Za-z ,]/g, "").trim().slice(0, 120);
  const body = {
    email_address: email,
    referrer_url: request.headers.get("referer") || url.origin,
    metadata: { source: "taxauctionlists-site", ...(states ? { states } : {}) },
  };
  if (ip) body.ip_address = ip;

  let res;
  try {
    res = await fetch(BUTTONDOWN_URL, {
      method: "POST",
      headers: { Authorization: `Token ${env.BUTTONDOWN_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("signup: Buttondown unreachable", err && err.name);
    return reply(502, "error");
  }

  if (res.ok) return reply(200, "ok");

  const detail = await res.text().catch(() => "");
  if (res.status === 400) {
    // Already subscribed: say the same thing as a new signup, so the form can't be used to look up who's on the list.
    if (/already|exists|subscribed/i.test(detail)) return reply(200, "ok");
    return reply(400, "invalid");
  }
  console.error(`signup: Buttondown returned ${res.status}`, detail.slice(0, 300));
  if (res.status === 429) return reply(503, "busy");
  return reply(502, "error");
}

function respond(status, key, wantsJson, request) {
  const message = MESSAGES[key];
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  if (wantsJson) {
    return Response.json({ ok: key === "ok", message }, { status, headers });
  }
  // Without JavaScript the browser posts the form directly, so send back a small page with a way home.
  const back = safeBack(request);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signup</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><p>${message}</p><p><a href="${back}">Back to TaxAuctionLists</a></p></body>`;
  return new Response(html, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

function safeBack(request) {
  const self = new URL(request.url);
  try {
    const ref = new URL(request.headers.get("referer") || "");
    if (ref.origin === self.origin) return ref.pathname.replace(/[^\w\-/.]/g, "") || "/";
  } catch {}
  return "/";
}
