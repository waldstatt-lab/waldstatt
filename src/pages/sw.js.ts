/**
 * The service worker of the Waldstatt (ADR 0002), generated at build time so
 * that its scope follows the base path and its cache name changes with every
 * build. It is registered with the base path as its scope and caches
 * only this site's files: the page network-first, Astro's hashed assets
 * cache-first. Old caches of the Waldstatt go when a new worker activates.
 */
import type { APIRoute } from "astro";
import { href } from "../lib/url";

const build = Date.now().toString(36);

/** The worker's source; the three constants are filled in below. */
const source = `
// Asset URLs carry a content hash, so a cached copy fits whatever headers
// (such as Origin on module scripts) the request has.
const allowed = (url) => url.startsWith(SCOPE) || url.startsWith(ASSETS);
const store = (request, response) => {
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SCOPE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("waldstatt-cache-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// The page sends the files it loaded before the worker controlled it.
self.addEventListener("message", (event) => {
  const files = event.data && event.data.type === "cache" ? event.data.files : null;
  if (!Array.isArray(files)) return;
  const urls = files
    .filter((url) => typeof url === "string")
    .map((url) => url.split("#")[0])
    .filter(allowed)
    .slice(0, 200);
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)))),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !allowed(request.url)) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => store(request, response))
        .catch(() =>
          caches
            .match(request, { ignoreVary: true })
            .then((hit) => hit || caches.match(SCOPE, { ignoreVary: true }))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }
  event.respondWith(
    caches
      .match(request, { ignoreVary: true })
      .then((hit) => hit || fetch(request).then((response) => store(request, response))),
  );
});
`;

export const GET: APIRoute = () => {
  const constants = [
    // Absolute URLs from the worker's own location.
    `const SCOPE = new URL(${JSON.stringify(href("/"))}, self.location.href).href;`,
    `const ASSETS = new URL(${JSON.stringify(href("/_astro/"))}, self.location.href).href;`,
    `const CACHE = ${JSON.stringify(`waldstatt-cache-${build}`)};`,
  ];
  const body = `${constants.join("\n")}\n${source}`;
  return new Response(body, {
    headers: { "Content-Type": "text/javascript" },
  });
};
