// Tests for the signup Worker (worker/index.js). Buttondown is faked; nothing leaves this machine.
import assert from "node:assert/strict";
import worker from "../worker/index.js";

const SITE = "https://taxauctionlists.example.workers.dev";
const KEY = "test-key-not-real";
let calls = [];
let fakeReply = () => new Response("{}", { status: 201 });
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return fakeReply();
};
const quiet = console.error;
console.error = () => {};

function post(fields, { headers = {}, json = true } = {}) {
  const body = new URLSearchParams(fields);
  return new Request(`${SITE}/api/subscribe`, {
    method: "POST",
    body,
    headers: { Origin: SITE, "cf-connecting-ip": "203.0.113.9", ...(json ? { Accept: "application/json" } : {}), ...headers },
  });
}
const env = (extra = {}) => ({ BUTTONDOWN_API_KEY: KEY, ...extra });
async function run(name, fn) {
  calls = [];
  fakeReply = () => new Response("{}", { status: 201 });
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}`);
    throw err;
  }
}

await run("good signup reaches Buttondown with the key and states", async () => {
  const res = await worker.fetch(post({ email: " a@b.co ", states: "FL, TX<script>" }), env());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.buttondown.com/v1/subscribers");
  assert.equal(calls[0].init.headers.Authorization, `Token ${KEY}`);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.email_address, "a@b.co");
  assert.equal(sent.ip_address, "203.0.113.9");
  assert.equal(sent.metadata.states, "FL, TXscript");
});

await run("bad email is refused without calling Buttondown", async () => {
  const res = await worker.fetch(post({ email: "nope" }), env());
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

await run("honeypot looks like success and sends nothing", async () => {
  const res = await worker.fetch(post({ email: "a@b.co", company: "Spam Inc" }), env());
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

await run("posts from another site are refused", async () => {
  const res = await worker.fetch(post({ email: "a@b.co" }, { headers: { Origin: "https://evil.example" } }), env());
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

await run("GET is refused", async () => {
  const res = await worker.fetch(new Request(`${SITE}/api/subscribe`, { headers: { Accept: "application/json" } }), env());
  assert.equal(res.status, 405);
});

await run("rate limit stops the request", async () => {
  const limiter = { limit: async () => ({ success: false }) };
  const res = await worker.fetch(post({ email: "a@b.co" }), env({ SIGNUP_LIMITER: limiter }));
  assert.equal(res.status, 429);
  assert.equal(calls.length, 0);
});

await run("missing key says signups aren't open and sends nothing", async () => {
  const res = await worker.fetch(post({ email: "a@b.co" }), {});
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /aren't open/);
  assert.equal(calls.length, 0);
});

await run("already subscribed reads the same as a new signup", async () => {
  fakeReply = () => new Response(JSON.stringify({ code: "email_already_exists", detail: "That email address already exists." }), { status: 400 });
  const res = await worker.fetch(post({ email: "a@b.co" }), env());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

await run("Buttondown rejecting the address shows the invalid message", async () => {
  fakeReply = () => new Response(JSON.stringify({ code: "email_invalid", detail: "Invalid email." }), { status: 400 });
  const res = await worker.fetch(post({ email: "a@b.co" }), env());
  assert.equal(res.status, 400);
});

await run("Buttondown outage gives a retry message", async () => {
  fakeReply = () => new Response("oops", { status: 500 });
  const res = await worker.fetch(post({ email: "a@b.co" }), env());
  assert.equal(res.status, 502);
  assert.equal((await res.json()).ok, false);
});

await run("without JavaScript the reply is a small page that links back", async () => {
  const res = await worker.fetch(post({ email: "a@b.co" }, { json: false, headers: { Referer: `${SITE}/calendar/` } }), env());
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /on the list/);
  assert.match(html, /href="\/calendar\/"/);
});

await run("the key never appears in a response", async () => {
  fakeReply = () => new Response("boom", { status: 500 });
  const res = await worker.fetch(post({ email: "a@b.co" }), env());
  assert.ok(!(await res.text()).includes(KEY));
});

await run("other paths go to the static assets", async () => {
  const assets = { fetch: async () => new Response("asset") };
  const res = await worker.fetch(new Request(`${SITE}/api/other`), { ASSETS: assets });
  assert.equal(await res.text(), "asset");
});

console.error = quiet;
console.log("worker tests passed");
