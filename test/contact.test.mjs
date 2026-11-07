import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const ACCESS_KEY = "7e854e63-bc4d-4f54-ac8e-6362d3894edf";
const visitor = ["ada", "example.com"].join("@");

function pages() {
  const match = html.match(/const PAGES = (\{.*\});/);
  assert.ok(match, "PAGES must be present");
  return JSON.parse(match[1]);
}

function contactSlice(doc) {
  const start = doc.indexOf('<section id="contact">');
  assert.notEqual(start, -1, "contact section");
  const end = doc.indexOf("</section>", start);
  assert.notEqual(end, -1, "contact section end");
  return doc.slice(start, end);
}

test("index.html has no email address and no mailto link", () => {
  assert.equal(html.includes("mailto:"), false);
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(html), false);
  assert.equal(html.includes("WEB3FORMS_ACCESS_KEY_PLACEHOLDER"), false);
});

test("english and french pages share one contact form", () => {
  const { en, fr } = pages();
  assert.equal(html.includes(en), true);
  for (const [lang, doc] of [["en", en], ["fr", fr]]) {
    assert.equal((doc.match(/data-nav="contact"/g) || []).length, 2, lang);
    const lead = doc.indexOf('id="leadership"');
    const contactAt = doc.indexOf('id="contact"');
    const footerAt = doc.indexOf("<footer>");
    assert.ok(lead < contactAt && contactAt < footerAt, lang);
    assert.match(doc, /<a class="btn line" href="#contact">/);
    assert.match(doc, /<a href="#contact">/);
    assert.equal(doc.includes("mailto:"), false, lang);
    const section = contactSlice(doc);
    assert.match(section, /action="https:\/\/api\.web3forms\.com\/submit"/);
    assert.match(section, /method="POST"/);
    assert.match(section, new RegExp(`name="access_key" value="${ACCESS_KEY}"`));
    assert.match(section, /name="subject" value="New message from ikjotsingh\.ca"/);
    assert.match(section, /name="from_name" value="ikjotsingh\.ca"/);
    assert.match(section, /name="botcheck"/);
    assert.match(section, /type="checkbox"/);
    assert.equal(/name="redirect"/.test(section), false);
    assert.match(section, /id="contact-name"/);
    assert.match(section, /for="contact-name"/);
    assert.match(section, /name="name"/);
    assert.match(section, /autocomplete="name"/);
    assert.match(section, /id="contact-email"/);
    assert.match(section, /for="contact-email"/);
    assert.match(section, /type="email"/);
    assert.match(section, /autocomplete="email"/);
    assert.match(section, /id="contact-message"/);
    assert.match(section, /for="contact-message"/);
    assert.match(section, /name="message"/);
    assert.match(section, /autocomplete="off"/);
    assert.equal((section.match(/required/g) || []).length >= 3, true);
    assert.match(section, /data-success="/);
    assert.match(section, /data-error="/);
    assert.equal((section.match(/<input /g) || []).length, 6);
    assert.equal((section.match(/<textarea /g) || []).length, 1);
  }
  assert.match(en, />Get in touch</);
  assert.match(en, />Send message</);
  assert.equal(en.match(/id="contact-help">([^<]+)/)[1], "I'll get back to you within 24 hours.");
  assert.equal(fr.match(/id="contact-help">([^<]+)/)[1], "Je vous répondrai dans les 24 heures.");
  assert.equal(en.match(/data-success="([^"]+)"/)[1], "Thank you. Have a great day.");
  assert.equal(fr.match(/data-success="([^"]+)"/)[1], "Merci. Passez une belle journée.");
  assert.equal(en.includes("Thank you. Your message is on its way."), false);
  assert.equal(fr.includes("Merci. Votre message a bien été envoyé."), false);
  assert.equal(html.includes("Thank you. Your message is on its way."), false);
  assert.equal(html.includes("Merci. Votre message a bien été envoyé."), false);
  assert.equal(en.includes("I usually reply within a couple of days."), false);
  assert.equal(fr.includes("Je réponds habituellement en quelques jours."), false);
  assert.equal(html.includes("I usually reply within a couple of days."), false);
  assert.equal(html.includes("Je réponds habituellement en quelques jours."), false);
  assert.equal("I'll".charCodeAt(1), 39);
  assert.match(en, />Contact</);
  assert.match(fr, />Me joindre</);
  assert.match(fr, />Envoyer le message</);
  assert.match(fr, />Contact</);
  assert.match(fr, />Nom </);
  assert.match(fr, />Courriel </);
  assert.match(fr, />Message </);
  assert.match(html, /#contact \{ scroll-margin-top:/);
  assert.match(html, /Accept: "application\/json"/);
  assert.match(html, /"home","mission","skills","community","certifications","leadership","contact"/);
});

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        const type = file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function browser() {
  const server = await startServer();
  const port = server.address().port;
  const debugPort = await freePort();
  const profile = fs.mkdtempSync("/tmp/contact-chrome-");
  const chrome = spawn("/usr/local/bin/google-chrome", [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: "ignore" });
  const shutdown = async () => {
    chrome.kill();
    await new Promise((resolve) => server.close(resolve));
  };
  try {
    await waitOk(`http://127.0.0.1:${debugPort}/json/version`);
    const tab = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${port}/`)}`, { method: "PUT" });
    if (!tab.ok) throw new Error(`could not open tab: ${tab.status}`);
    const list = await tab.json();
    const socket = new WebSocket(list.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      socket.send(JSON.stringify({ id: messageId, method, params }));
    });
    await send("Runtime.enable");
    await send("Page.enable");
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await evaluate(`new Promise((resolve) => {
      if (document.readyState === "complete") resolve();
      else addEventListener("load", () => resolve(), { once: true });
    })`);
    return {
      evaluate,
      viewport: (width, height) => send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: width < 700
      }),
      close: async () => {
        socket.close();
        await shutdown();
      }
    };
  } catch (error) {
    await shutdown();
    throw error;
  }
}

async function waitOk(url) {
  let last = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`chrome did not open: ${last}`);
}

test("contact form submits in place in both languages", async () => {
  const page = await browser();
  try {
    const english = await page.evaluate(`(() => {
      const hero = document.querySelector(".hero .btn.line");
      const footer = document.querySelector("footer .foot-side a");
      const labels = [...document.querySelectorAll("#contact-form label")].map((label) => label.textContent.replace(/\\s+/g, " ").trim());
      const visible = [...document.querySelectorAll("#contact-form input, #contact-form textarea")].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 2 && box.height > 2 && box.left > -1;
      }).map((el) => el.name);
      return {
        hero: hero.textContent.trim(),
        heroHref: hero.getAttribute("href"),
        footer: footer.textContent.trim(),
        footerHref: footer.getAttribute("href"),
        nav: [...document.querySelectorAll(".desk [data-nav]")].map((link) => link.textContent.trim()),
        labels,
        visible,
        scroll: getComputedStyle(document.getElementById("contact")).scrollMarginTop,
        help: document.getElementById("contact-help").textContent,
        text: document.body.innerText
      };
    })()`);
    assert.deepEqual(english.nav.at(-1), "Contact");
    assert.equal(english.hero, "Get in touch");
    assert.equal(english.heroHref, "#contact");
    assert.equal(english.footerHref, "#contact");
    assert.equal(english.footer.includes("@"), false);
    assert.deepEqual(english.visible, ["name", "email", "message"]);
    assert.equal(english.labels.length, 3);
    assert.match(english.labels[0], /Name/);
    assert.match(english.labels[0], /required/i);
    assert.match(english.labels[1], /Email/);
    assert.match(english.labels[2], /Message/);
    assert.notEqual(english.scroll, "0px");
    assert.equal(english.help, "I'll get back to you within 24 hours.");
    assert.equal(english.text.includes("@"), false);
    await assertFits(page, "en");

    const empty = await page.evaluate(`(async () => {
      window.__calls = [];
      window.fetch = async (...args) => { window.__calls.push(args); return { ok: true, json: async () => ({ success: true }) }; };
      document.getElementById("contact-form").requestSubmit();
      await new Promise((resolve) => setTimeout(resolve, 30));
      return window.__calls.length;
    })()`);
    assert.equal(empty, 0);

    const success = await page.evaluate(`(async () => {
      const form = document.getElementById("contact-form");
      form.querySelector("[name=name]").value = "Ada Lovelace";
      form.querySelector("[name=email]").value = "${visitor}";
      form.querySelector("[name=message]").value = "Hello from the portfolio.";
      form.requestSubmit();
      for (let i = 0; i < 20 && !document.querySelector("[data-status]").textContent; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const call = window.__calls[0];
      return {
        status: document.querySelector("[data-status]").textContent,
        state: document.querySelector("[data-status]").dataset.state,
        stayed: location.hostname,
        url: call[0],
        headers: call[1].headers,
        body: JSON.parse(call[1].body),
        name: form.querySelector("[name=name]").value
      };
    })()`);
    assert.equal(success.status, "Thank you. Have a great day.");
    assert.equal(success.state, "ok");
    assert.equal(success.stayed, "127.0.0.1");
    assert.equal(success.url, "https://api.web3forms.com/submit");
    assert.equal(success.headers.Accept, "application/json");
    assert.equal(success.body.access_key, ACCESS_KEY);
    assert.equal(success.body.subject, "New message from ikjotsingh.ca");
    assert.equal(success.body.from_name, "ikjotsingh.ca");
    assert.equal(success.body.name, "Ada Lovelace");
    assert.equal(success.body.email, visitor);
    assert.equal(success.body.message, "Hello from the portfolio.");
    assert.equal("redirect" in success.body, false);
    assert.equal("botcheck" in success.body, false);
    assert.equal(success.name, "");

    const french = await page.evaluate(`(async () => {
      document.querySelector("[data-lang=fr]").click();
      window.__calls = [];
      window.fetch = async () => ({ ok: false, json: async () => ({ success: false, message: "no" }) });
      const form = document.getElementById("contact-form");
      form.querySelector("[name=name]").value = "Ada";
      form.querySelector("[name=email]").value = "${visitor}";
      form.querySelector("[name=message]").value = "Bonjour";
      form.requestSubmit();
      for (let i = 0; i < 20 && !document.querySelector("[data-status]").textContent; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return {
        nav: document.querySelector(".desk [data-nav=contact]").textContent.trim(),
        hero: document.querySelector(".hero .btn.line").textContent.trim(),
        help: document.getElementById("contact-help").textContent,
        successCopy: form.getAttribute("data-success"),
        send: form.querySelector("[type=submit]").textContent.trim(),
        status: document.querySelector("[data-status]").textContent,
        state: document.querySelector("[data-status]").dataset.state,
        kept: form.querySelector("[name=message]").value
      };
    })()`);
    assert.equal(french.nav, "Contact");
    assert.equal(french.hero, "Me joindre");
    assert.equal(french.help, "Je vous répondrai dans les 24 heures.");
    assert.equal(french.successCopy, "Merci. Passez une belle journée.");
    assert.equal(french.send, "Envoyer le message");
    assert.equal(french.status, "Le message n’a pas pu être envoyé. Réessayez dans un moment.");
    assert.equal(french.state, "err");
    assert.equal(french.kept, "Bonjour");
    await assertFits(page, "fr");
  } finally {
    await page.close();
  }
});

async function assertFits(page, lang) {
  for (const width of [390, 880, 1280]) {
    await page.viewport(width, 900);
    const fit = await page.evaluate(`(() => {
      const row = document.querySelector(".bar-row");
      const desk = document.querySelector(".desk");
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        navPast: Math.ceil(desk.getBoundingClientRect().right - row.getBoundingClientRect().right),
        desk: getComputedStyle(desk).display
      };
    })()`);
    assert.equal(fit.overflow, 0, `${lang} ${width}px horizontal overflow`);
    if (fit.desk !== "none") assert.ok(fit.navPast <= 1, `${lang} ${width}px nav overflow ${fit.navPast}`);
  }
}
