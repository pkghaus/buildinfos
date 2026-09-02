// The serving path, against a fake R2. pkghaus/apt learned this the hard way:
// the archive Worker had no test at all until the split, and the two decisions
// worth testing here are the same shape -- what a request maps to in the
// bucket, and what happens when it maps to nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { contentType, humanSize, listAll, renderRoot, renderListing, resolveRange, breadcrumb }
  from "../src/worker.js";

// Enough of R2 to drive the Worker: prefix and delimiter semantics, ranges and
// conditional gets are what the real one is asked for.
function fakeBucket(keys) {
  const objects = new Map(
    Object.entries(keys).map(([k, v]) => [k, typeof v === "string" ? v : v.body]));
  return {
    async list({ prefix = "", delimiter, cursor, limit = 1000 }) {
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const out = [];
      const dirs = new Set();
      for (const k of all) {
        const rest = k.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) {
          dirs.add(prefix + rest.slice(0, rest.indexOf(delimiter) + 1));
        } else {
          out.push({ key: k, size: objects.get(k).length });
        }
      }
      // One page is enough for the fixtures; the cursor path is exercised by
      // the truncation test below.
      const start = cursor ? Number(cursor) : 0;
      const page = out.slice(start, start + limit);
      const end = start + page.length;
      return {
        objects: page,
        delimitedPrefixes: [...dirs],
        truncated: end < out.length,
        cursor: String(end),
      };
    },
    async get(key, opts = {}) {
      if (!objects.has(key)) return null;
      const body = objects.get(key);
      const size = body.length;

      // Real R2 takes an R2Range or a Headers here and throws on a string.
      // Handed the header's value instead of the headers, every ranged request
      // is a 500 -- which is what apt.pkg.haus/buildinfos served on the day it
      // went live, before this line existed to catch it.
      if (typeof opts.range === "string") {
        throw new TypeError("Incorrect type for the 'range' field");
      }

      // Measured against live R2 2026-09-02, all four cases below. Two traps,
      // both of which shipped before this modelled them:
      //
      // 1. A GET with no Range still comes back with `range` set to the whole
      //    object, so `object.range` does not mean "the client asked for one".
      // 2. `offset` and `length` are always resolved numbers -- a suffix range
      //    arrives converted -- but ALL THREE keys are own properties, with
      //    `suffix` always undefined. `"suffix" in range` is therefore true on
      //    every single result.
      let [offset, length] = [0, size];
      let slice = body;
      const header = opts.range instanceof Headers ? opts.range.get("range") : null;
      const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
      if (m) {
        if (m[1] === "") offset = size - Number(m[2]);
        else { offset = Number(m[1]); if (m[2] !== "") length = Number(m[2]) - offset + 1; }
        if (m[1] === "") length = Number(m[2]);
        else if (m[2] === "") length = size - offset;
        slice = body.slice(offset, offset + length);
      }
      const range = { offset, length, suffix: undefined };

      const etag = '"x"';
      const base = { size, httpEtag: etag, range, writeHttpMetadata() {} };

      // onlyIf satisfied means a bodiless result, which is how R2 says 304.
      const inm = opts.onlyIf instanceof Headers ? opts.onlyIf.get("if-none-match") : null;
      if (inm === etag) return base;

      return { ...base, body: slice };
    },
  };
}

const FIXTURE = {
  "buildinfos/buildinfo-pool/c/croc/croc_11.3.6-1_amd64.buildinfo": "Format: 1.0\n",
  "buildinfos/buildinfo-pool/c/croc/croc_11.3.6-1.dsc": "Format: 3.0 (quilt)\n",
  "buildinfos/buildinfo-pool/c/croc/croc_11.3.6.orig.tar.gz": "tarball-bytes",
  "buildinfos/buildinfo-pool/z/zola/zola_0.23.4-1_amd64.buildinfo": "Format: 1.0\n",
  // Under the prefix but outside the pool. Nothing should ever serve it, and
  // it exists in the fixture so the guard below fails for the right reason:
  // a request for a key that simply is not there 404s either way.
  "buildinfos/stray-object.txt": "should never be served",
};

const env = { ARCHIVE: fakeBucket(FIXTURE) };
const get = (p, init) => worker.fetch(new Request(`https://buildinfos.pkg.haus${p}`, init), env, {});

test("content types are what a browser should render, not download", () => {
  assert.equal(contentType("x.buildinfo"), "text/plain; charset=utf-8");
  assert.equal(contentType("x.dsc"), "text/plain; charset=utf-8");
  assert.equal(contentType("x.orig.tar.gz"), "application/gzip");
  assert.equal(contentType("x.debian.tar.xz"), "application/x-xz");
});

test("sizes stay legible without lying about precision", () => {
  assert.equal(humanSize(0), "0");
  assert.equal(humanSize(868), "868");
  assert.equal(humanSize(2150), "2.1K");
  assert.equal(humanSize(3115687), "3.0M");
  assert.equal(humanSize(null), "-");
});

test("listAll follows the cursor rather than stopping at one page", async () => {
  const many = {};
  for (let i = 0; i < 25; i += 1) many[`buildinfos/buildinfo-pool/a/x/f${i}`] = "b";
  const bucket = fakeBucket(many);
  const orig = bucket.list.bind(bucket);
  bucket.list = (o) => orig({ ...o, limit: 10 });
  const { objects } = await listAll(bucket, "buildinfos/buildinfo-pool/");
  assert.equal(objects.length, 25);
});

test("the root page lists the pool and the index, and nothing else", async () => {
  const r = await get("/");
  const body = await r.text();
  assert.equal(r.status, 200);
  assert.match(body, /buildinfo-pool\//);
  assert.match(body, /buildinfo-pool\.list/);
  // The prose is embedded rather than shipped as a README.txt beside the pool.
  assert.match(body, /dpkg-genbuildinfo/);
  assert.doesNotMatch(body, /README\.txt/);
});

test("a directory lists one level, not the whole subtree", async () => {
  const r = await get("/buildinfo-pool/");
  const body = await r.text();
  assert.equal(r.status, 200);
  assert.match(body, /c\//);
  assert.match(body, /z\//);
  // croc's files are two levels down and must not appear here.
  assert.doesNotMatch(body, /croc_11\.3\.6-1\.dsc/);
});

test("a leaf directory lists its files with sizes", async () => {
  const body = await (await get("/buildinfo-pool/c/croc/")).text();
  assert.match(body, /croc_11\.3\.6-1_amd64\.buildinfo/);
  assert.match(body, /croc_11\.3\.6-1\.dsc/);
  assert.match(body, /croc_11\.3\.6\.orig\.tar\.gz/);
  assert.match(body, /\.\.\//);
});

test("an object is served from the bucket under the buildinfos/ prefix", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(r.headers.get("cache-control"), /immutable/);
  assert.match(await r.text(), /Format: 3\.0/);
});

test("the flat index names every object, relative to the prefix", async () => {
  const r = await get("/buildinfo-pool.list");
  const lines = (await r.text()).trim().split("\n");
  assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => l.startsWith("buildinfo-pool/")));
  // Sorted, so a diff between two fetches means the pool changed.
  assert.deepEqual(lines, [...lines].sort());
});

test("a missing object is a 404 page, not an empty 200", async () => {
  const r = await get("/buildinfo-pool/c/croc/nope.buildinfo");
  assert.equal(r.status, 404);
  assert.match(await r.text(), /No such record/);
});

test("a path outside the pool is refused", async () => {
  // The bucket also holds pool/ and dists/ for the archive. Nothing here may
  // reach them: this Worker's whole remit is the buildinfos/ prefix.
  for (const p of ["/pool/main/c/croc/croc.deb", "/dists/unstable/InRelease", "/etc/passwd"]) {
    assert.equal((await get(p)).status, 404, p);
  }
  // The one that actually exercises the guard: this object is in the bucket
  // under the prefix, and is still refused because it is not in the pool.
  const stray = await get("/stray-object.txt");
  assert.equal(stray.status, 404);
  assert.doesNotMatch(await stray.text(), /should never be served/);
});

test("writes are refused outright", async () => {
  for (const method of ["PUT", "POST", "DELETE"]) {
    assert.equal((await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc", { method })).status, 405);
  }
});

test("every response carries the security headers", async () => {
  for (const p of ["/", "/buildinfo-pool/", "/buildinfo-pool.list"]) {
    const h = (await get(p)).headers;
    assert.equal(h.get("x-content-type-options"), "nosniff", p);
    assert.match(h.get("content-security-policy"), /default-src 'none'/, p);
  }
});

test("an unconfigured binding says so rather than 404ing", async () => {
  const r = await worker.fetch(new Request("https://buildinfos.pkg.haus/"), {}, {});
  assert.equal(r.status, 503);
});

test("rendered pages escape what comes out of the bucket", () => {
  const body = renderListing("/buildinfo-pool/x/", [], [{ name: '<img src=x>', size: 1 }]);
  assert.doesNotMatch(body, /<img src=x>/);
  assert.match(body, /&lt;img/);
});

// The two range bugs that shipped live on 2026-09-02 and were caught by curl,
// not by this file. Both are about trusting the response over the request.

test("a plain GET is a 200, however R2 reports the range it served", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc");
  assert.equal(r.status, 200, "R2 sets .range on every result; only the client's "
    + "Range header may turn a response into a partial");
  assert.equal(r.headers.get("content-range"), null);
  assert.equal(await r.text(), "Format: 3.0 (quilt)\n");
});

test("a ranged GET is served, not thrown", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc",
    { headers: { range: "bytes=0-5" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 0-5/20");
  assert.equal(r.headers.get("content-length"), "6");
  assert.equal(await r.text(), "Format");
});

test("an open-ended range reports the end R2 left implicit", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc",
    { headers: { range: "bytes=7-" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 7-19/20");
  assert.equal(await r.text(), " 3.0 (quilt)\n");
});

test("a suffix range counts back from the end", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc",
    { headers: { range: "bytes=-7" } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-range"), "bytes 13-19/20");
});

test("resolveRange reads R2's values, not its keys", () => {
  assert.deepEqual(resolveRange({ offset: 0, length: 10, suffix: undefined }, 10), [0, 9]);
  assert.deepEqual(resolveRange({ offset: 7, length: 13, suffix: undefined }, 20), [7, 19]);
  assert.deepEqual(resolveRange({ offset: 13, length: 7, suffix: undefined }, 20), [13, 19]);
  // The shape that produced `bytes NaN-...` in production: every real result
  // carries a `suffix` key, so branching on its presence is always wrong.
  assert.deepEqual(resolveRange({ offset: 4346, length: 12, suffix: undefined }, 4358),
    [4346, 4357]);
});

test("HEAD asks R2 for no slice and returns no body", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc", { method: "HEAD" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-range"), null);
  assert.equal(await r.text(), "");
});

test("every served record advertises that ranges work", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc");
  assert.equal(r.headers.get("accept-ranges"), "bytes");
});

test("a matching etag is a 304 with no body", async () => {
  const r = await get("/buildinfo-pool/c/croc/croc_11.3.6-1.dsc",
    { headers: { "if-none-match": '"x"' } });
  assert.equal(r.status, 304);
  assert.equal(await r.text(), "");
});

// The header is shared with apt.pkg.haus. These assert the contract that host's
// breadcrumb_for() implements, spelling included: two hosts whose headers disagree read
// as two projects, and the difference is invisible unless something checks it.

test("the wordmark links home and colours its dots", () => {
  assert.equal(breadcrumb(""),
    '<a href="/">buildinfos<span class="dot">.</span>pkg<span class="dot">.</span>haus</a>');
});

test("one and two segments spell the path out", () => {
  assert.equal(breadcrumb("buildinfo-pool"),
    '<a href="/">buildinfos<span class="dot">.</span>pkg<span class="dot">.</span>haus</a>'
    + '<span class="path"><span class="sep">/</span>buildinfo-pool</span>');
  assert.match(breadcrumb("buildinfo-pool/c"),
    /<span class="sep">\/<\/span>buildinfo-pool<wbr><span class="sep">\/<\/span>c/);
});

test("beyond two segments the middle collapses, keeping the last", () => {
  const h = breadcrumb("buildinfo-pool/c/croc");
  assert.match(h, /<span class="gap">&hellip;<\/span><wbr><span class="sep">\/<\/span>croc/);
  assert.doesNotMatch(h, /buildinfo-pool</, "the elided middle must not survive");
});

test("a segment cannot inject markup into the header", () => {
  assert.match(breadcrumb('a/b/<img src=x onerror=alert(1)>'), /&lt;img/);
});

test("every page carries the header, and listings carry it once", async () => {
  const listing = await (await get("/buildinfo-pool/c/croc/")).text();
  assert.equal(listing.split("<header>").length - 1, 1);
  assert.match(listing, /<h1><a href="\/">buildinfos/);
  assert.doesNotMatch(listing, /class="crumb"/, "the path belongs in the h1, not below it");
  const root = await (await get("/")).text();
  assert.match(root, /<h1><a href="\/">buildinfos/);
});
