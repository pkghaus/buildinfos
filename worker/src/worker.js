// pkghaus-buildinfos serves buildinfos.pkg.haus: the build records for every
// package in the pkg.haus archive, and the source packages they describe.
//
// The objects live in the archive's own R2 bucket under a buildinfos/ prefix,
// written by pkghaus/apt's publish-buildinfo.sh. They are served from here
// rather than from apt.pkg.haus for two reasons. The layout is Debian's source
// pool, which apt never fetches and no Release file references, so under the
// archive's host it read as an archive path while not being one. And the
// archive Worker is what answers `apt update`; a provenance page should not be
// able to break it.
//
// There is no static asset tree. Every page here is rendered from a LIST, which
// is affordable because the prefix holds a few objects per package rather than
// a pool, and it means nothing has to be regenerated when a publish happens.

const PREFIX = "buildinfos/";
const POOL = "buildinfo-pool/";
const LIST_FILE = "buildinfo-pool.list";

// A record describes bytes that cannot change: a published version is never
// rebuilt, so neither is its .buildinfo or its source package. The listing
// pages are derived from what exists and are revalidated instead.
const IMMUTABLE_MAX_AGE = 2592000;

const DESCRIPTION =
  "Build records for the pkg.haus archive: what each package was built from, and with.";

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="16" height="16">
  <path d="M32 6 L56 18 V46 L32 58 L8 46 V18 Z" fill="#FFFFFF"/>
  <g stroke="#101010" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" fill="none">
    <path d="M8 18 L32 30 L56 18"/>
    <path d="M32 30 V58"/>
    <path d="M32 6 L56 18 V46 L32 58 L8 46 V18 Z"/>
  </g>
  <path d="M11.087 12.543 L21.087 7.543 L49 21.5 L49 28.5 L39 33.5 L39 26.5 Z" fill="#E0421B"/>
</svg>
`;
const LISTING_MAX_AGE = 300;

export function contentType(key) {
  if (key.endsWith(".gz")) return "application/gzip";
  if (key.endsWith(".xz")) return "application/x-xz";
  if (key.endsWith(".bz2")) return "application/x-bzip2";
  if (key.endsWith(".zst")) return "application/zstd";
  // .buildinfo, .dsc and .source are RFC822-shaped text a browser should show
  // rather than download, which is the whole point of reading one.
  return "text/plain; charset=utf-8";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function humanSize(n) {
  if (n === null || n === undefined) return "-";
  if (n < 1024) return `${n}`;
  const u = ["K", "M", "G"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}

// Everything under one R2 prefix, following the continuation cursor. Callers
// pass a delimiter to get one directory level instead of the whole subtree.
export async function listAll(bucket, prefix, delimiter) {
  const objects = [];
  const prefixes = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, delimiter, cursor, limit: 1000 });
    objects.push(...page.objects);
    if (page.delimitedPrefixes) prefixes.push(...page.delimitedPrefixes);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return { objects, prefixes };
}

const STYLE = `
/* Tokens, and every shared rule below, are apt.pkg.haus's. The two hosts are
   one surface and a reader moves between them, so this is a copy rather than an
   approximation: the earlier hand-written near-miss got the link colour wrong
   (see --accent-text), dropped the horizontal-scroll wrapper, and put the
   tagline outside the header where the archive keeps it inside. */
:root{
--paper:#FFFFFF;--ink:#141414;--muted:#6B6B66;
--line:#E4E4DF;--accent:#E0421B;
/* The brand red measures 4.23:1 on white: fine for the mark, the dots and
   headings, which are large text needing 3:1, and short of the 4.5:1 small
   text needs. Small text gets a darker step; everything seen at size keeps the
   brand value. Dark mode passes at 5.92:1, so there the two are the same. */
--accent-text:#CC3B18;
--mono:ui-monospace,Menlo,Consolas,monospace}
@media(prefers-color-scheme:dark){:root{
--paper:#0E0E0E;--ink:#F0F0EC;--muted:#8F8F88;
--line:#2A2A27;--accent:#F0603C;--accent-text:#F0603C}}
*{box-sizing:border-box}
body{background:var(--paper);color:var(--ink);
font-family:system-ui,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
line-height:1.55;margin:0;padding:0 1.25rem 4rem}
main{max-width:46rem;margin:0 auto}
header{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;
padding:2.25rem 0 1.25rem;border-bottom:3px solid var(--ink)}
h1{font-family:var(--mono);font-size:clamp(1.9rem,6vw,2.6rem);letter-spacing:-.03em;
margin:0;line-height:1.15;min-width:0}
h1 .dot,h1 .sep{color:var(--accent)}
h1 .path{font-size:.65em}
h1 .gap{color:var(--muted)}
h1 a{color:inherit;text-decoration:none}
h1 a:hover{color:var(--accent)}
.tagline{flex-basis:100%;color:var(--muted);margin:.75rem 0 0;max-width:38rem}
.tablewrap{overflow-x:auto;padding:1.5rem 0}
.tablewrap:has(+ footer){padding-bottom:0}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:.5rem .75rem .5rem 0;
border-bottom:1px dashed var(--line);vertical-align:top}
th{font-family:var(--mono);font-size:.7rem;letter-spacing:.12em;
text-transform:uppercase;color:var(--muted);font-weight:600}
td{word-break:break-all}
td.size{text-align:right;color:var(--muted);
font-variant-numeric:tabular-nums;white-space:nowrap}
th.size{text-align:right}
code{font-family:var(--mono)}
a{color:var(--accent-text);text-decoration:none}
a:hover{text-decoration:underline}
footer{border-top:3px solid var(--ink);margin-top:2rem;
padding-top:1.5rem;display:flex;gap:1.5rem;
flex-wrap:wrap;font-size:.85rem;color:var(--muted)}
footer a{color:inherit}
footer a:hover{color:var(--accent-text)}

/* Only what the archive has no counterpart for: this host explains itself on
   its root page, which no listing page does. */
.about{border-top:3px solid var(--ink);margin-top:2.5rem;padding-top:1.25rem}
.about h2{font-size:1.05rem;margin:1.75rem 0 .5rem}
.about h2:first-child{margin-top:0}
.about p{margin:0 0 .9rem;max-width:38rem}
.about>:last-child{margin-bottom:0}
.about code{font-size:.9em}
pre{background:rgba(128,128,128,.1);padding:.7rem .85rem;overflow-x:auto;
font-family:var(--mono);font-size:.78rem;line-height:1.5;margin:0 0 .9rem}
pre .c{color:var(--muted)}
`;

const MARK = `<svg width="80" height="80" viewBox="0 0 64 64" role="img" aria-label="pkg.haus - a taped parcel with a haus stenciled on its face">
<path d="M32 8 L54 19 V45 L32 56 L10 45 V19 Z" fill="var(--paper)"/>
<g stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" fill="none">
<path d="M10 19 L32 30 L54 19"/><path d="M32 30 V56"/>
<path d="M32 8 L54 19 V45 L32 56 L10 45 V19 Z"/></g>
<path d="M15.658 14.829 L23.658 10.829 L47 22.5 L47 28.5 L45.7 27.2 L44.3 29.8 L43 28.5 L41.7 31.2 L40.3 29.8 L39 32.5 L39 26.5 Z" fill="var(--accent)"/>
<path d="M21 20 L27 26 V33 H15 V26 Z" fill="currentColor" transform="matrix(1,0.5,0,1,0,0)"/></svg>`;

// "listed" rather than "listed live from the archive bucket": the timestamp
// beside it carries the meaning, the rest was provenance, and it is what put
// this footer onto a second line once the time was added.
function footer() {
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d+Z$/, "Z");
  const stamp = iso.replace("T", " ").replace("Z", " UTC");
  return `<footer><a href="https://pkg.haus">pkg.haus</a>
<a href="https://apt.pkg.haus">apt.pkg.haus</a>
<a href="https://github.com/pkghaus">github.com/pkghaus</a>
<span>listed <time datetime="${iso}">${stamp}</time></span>
<span>Apache-2.0</span></footer>`;
}

// The <time> above carries UTC so an edge-cached copy stays honest; this
// rewrites it into the reader's own zone. Byte-identical to the block
// apt.pkg.haus and /stats run, so all three agree on the format.
const LOCALISE = `
  document.querySelectorAll("time[datetime]").forEach(function (t) {
    t.textContent = new Date(t.getAttribute("datetime")).toLocaleString([], {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZoneName: "short"
    });
  });
`;

const PLAUSIBLE_INIT = `
  window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};
  plausible.init({ endpoint: "/zk/api/event" })
`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${esc(title)}</title>
<script defer src="/zk/js/script.js"></script>
<script>${PLAUSIBLE_INIT}</script>
<style>${STYLE}</style></head><body><main>
${body}${footer()}</main><script>${LOCALISE}</script></body></html>`;
}

function rows(entries) {
  const body = entries.map((e) =>
    `<tr><td><a href="${esc(e.href)}"><code>${esc(e.name)}</code></a></td>` +
    `<td class="size">${esc(e.size)}</td></tr>`).join("\n");
  return `<div class="tablewrap"><table>
<thead><tr><th>name</th><th class="size">size</th></tr></thead>
<tbody>${body}</tbody></table></div>`;
}

// The prose lives here rather than in a README.txt beside the pool: a second
// copy of the same explanation is a second thing to keep current.
const ABOUT = `<div class="about">
<h2>What these are</h2>
<p>A <code>.buildinfo</code> is dpkg's own record of a build: the exact version of
every package installed in the build environment, and the checksums of what came
out. It is written by <code>dpkg-genbuildinfo</code> during the build, not by hand.</p>
<p>pkg.haus builds from upstream source at release tags rather than repackaging a
vendor binary. These files, and the source packages published beside them, are what
make that checkable instead of a claim.</p>
<h2>The layout</h2>
<p><code>buildinfo-pool/</code> shards by the source package's first letter, the same
convention the Debian package pool uses, and the same name
<a href="https://buildinfos.debian.net">buildinfos.debian.net</a> gives its pool view.
Each version appears once per suite, because each suite gets its own build against its
own libraries, and the version qualifier says which:</p>
<pre><span class="c">buildinfo-pool/c/croc/</span>croc_11.3.6-2~haus13+1_amd64.buildinfo
<span class="c">buildinfo-pool/c/croc/</span>croc_11.3.6-2~testing1_amd64.buildinfo
<span class="c">buildinfo-pool/c/croc/</span>croc_11.3.6-2_amd64.buildinfo</pre>
<p>Beside each record sit the <code>.dsc</code> and the source tarballs it was built
from, and a <code>.source</code> naming the upstream repository, tag and commit.</p>
<h2>What you can do with one</h2>
<p>Rebuild the package and compare. <code>debrebuild</code> resolves the recorded
environment from <code>snapshot.debian.org</code>, unpacks the <code>.dsc</code>
published beside the record, rebuilds, and checks every checksum. Fetch a record
and the source beside it, then run the procedure from
<a href="https://github.com/pkghaus/apt">pkghaus/apt</a>, which carries the
container it needs:</p>
<pre><span class="c"># the four files, all from one directory here</span>
B=https://buildinfos.pkg.haus/buildinfo-pool/m/mandown
mkdir mandown &amp;&amp; cd mandown
curl -fsSLO "$B/mandown_1.0.5.2-2~haus13+1_amd64.buildinfo"
curl -fsSLO "$B/mandown_1.0.5.2-2~haus13+1.dsc"
curl -fsSLO "$B/mandown_1.0.5.2-2~haus13+1.debian.tar.xz"
curl -fsSLO "$B/mandown_1.0.5.2.orig.tar.gz"
cd ..

<span class="c"># rebuild and compare</span>
git clone https://github.com/pkghaus/apt
apt/verify/rebuild.sh mandown</pre>
<p>What a match looks like, run against this record on 2026-09-02:</p>
<pre>checking mandown_1.0.5.2-2~haus13+1_amd64.deb: size... sha256... md5... sha1... all OK</pre>
<p>The rebuilt <code>.deb</code> was byte-identical to the one
<a href="https://apt.pkg.haus">apt.pkg.haus</a> serves. You need Docker and root,
because the rebuild installs an exact set of package versions and then builds;
the container is the throwaway system it is allowed to change.</p>
<h2>What these files do not tell you</h2>
<p><strong>The compiler is named in the source, not the record.</strong> Go and Rust
both fetch their own toolchain, so <code>Installed-Build-Depends</code> names the
bootstrap and <code>go.mod</code>, <code>rust-toolchain.toml</code> or
<code>debian/rules</code> names what actually ran. Both ship inside the
<code>.dsc</code>.</p>
</div>`;

// The archive's breadcrumb, in JS. Same contract as apt's breadcrumb_for(): the
// host links home at full size, the path rides a smaller tier inside the same
// h1, beyond two segments the middle collapses to an ellipsis, and a <wbr>
// before each separator lets a long segment wrap at a slash instead of clipping.
// Kept identical on purpose -- two pkg.haus hosts whose headers disagree read as
// two projects.
export function breadcrumb(rel) {
  const wordmark = '<a href="/">buildinfos<span class="dot">.</span>pkg'
    + '<span class="dot">.</span>haus</a>';
  if (!rel) return wordmark;
  const parts = rel.split("/");
  const sep = '<span class="sep">/</span>';
  const path = parts.length <= 2
    ? sep + parts.map(esc).join(`<wbr>${sep}`)
    : `${sep}<span class="gap">&hellip;</span><wbr>${sep}${esc(parts[parts.length - 1])}`;
  return `${wordmark}<span class="path">${path}</span>`;
}

function header(rel, tagline) {
  return `<header>${MARK}<h1>${breadcrumb(rel ?? "")}</h1>`
    + (tagline ? `<p class="tagline">${tagline}</p>` : "") + `</header>`;
}

export function renderRoot(listBytes) {
  const body = header("", "Build records for the pkg.haus archive: what each "
    + "package was built from, and with.") +
    rows([
      { name: POOL, href: POOL, size: "-" },
      { name: LIST_FILE, href: LIST_FILE, size: humanSize(listBytes) },
    ]) + ABOUT;
  return page("buildinfos.pkg.haus", body);
}

export function renderListing(path, dirs, files) {
  const parts = path.replace(/^\/|\/$/g, "").split("/");
  const entries = [{ name: "../", href: "../", size: "-" }]
    .concat(dirs.map((d) => ({ name: d, href: d, size: "-" })))
    .concat(files.map((f) => ({ name: f.name, href: f.name, size: humanSize(f.size) })));
  return page(`buildinfos.pkg.haus/${parts.join("/")}/`,
    header(parts.join("/")) + rows(entries));
}

// Both no-object endings, in this host's own furniture. One helper so the two
// cannot drift in status furniture or headers.
async function errorPage(status, title, tagline) {
  return new Response(
    page(`${title} - buildinfos.pkg.haus`,
      header("", tagline)
      + `<p style="margin:1.5rem 0 0">Start from the <a href="/">pool listing</a>, `
      + `or the <a href="https://apt.pkg.haus">archive</a>.</p>`),
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        ...(await htmlSecurityHeaders()),
      },
    });
}

function notFound() {
  return errorPage(404, "Not found", "No such record.");
}

// Malformed request, not a broken server: 400, not the 500 an unhandled
// URIError produces.
function badRequest() {
  return errorPage(400, "Bad request", "That address is not a valid URL.");
}

const CSP_TAIL =
  "style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": `default-src 'none'; ${CSP_TAIL}`,
};

// The HTML pages carry the Plausible loader and one inline block, so they need
// a script-src the records do not. It names that block by hash rather than
// allowing every inline script, which is what keeps the CSP a real second wall
// behind esc(): an injected <script> has no matching hash. The digest is taken
// from the same constant page() emits, so the two cannot drift, and it is
// cached per isolate because the input is static.
let htmlHeaders = null;
async function htmlSecurityHeaders() {
  if (!htmlHeaders) {
    const hashes = await Promise.all([PLAUSIBLE_INIT, LOCALISE].map(async (body) => {
      const digest = await crypto.subtle.digest(
        "SHA-256", new TextEncoder().encode(body));
      return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
    }));
    htmlHeaders = {
      ...SECURITY_HEADERS,
      "content-security-policy":
        `default-src 'none'; script-src 'self' ${hashes.join(" ")}; ` +
        `connect-src 'self'; ${CSP_TAIL}`,
    };
  }
  return htmlHeaders;
}

async function html(bodyText, maxAge, status = 200) {
  return new Response(bodyText, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      ...(await htmlSecurityHeaders()),
    },
  });
}

// This function and resolveRange below are identical in pkghaus/apt
// worker/src/worker.js. A bug in either is a bug in both: the NaN content-range
// was. Fix them together.
//
// R2 signals an unsatisfiable range by throwing, with no typed error to match
// on. Matches both the message and the code it actually emits, because either
// alone is one upstream wording change away from silently reverting this to a
// 500. Captured verbatim from a production log line:
//   get: The requested range is not satisfiable (10039)
export function isUnsatisfiableRange(e) {
  const msg = String(e?.message ?? e);
  return msg.includes("range is not satisfiable") || msg.includes("10039");
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);

    // decodeURIComponent throws URIError on a malformed escape (`/%`, or a
    // truncated sequence like `/%E0%A4%A`). Unhandled that is Cloudflare's 1101
    // page: a 500 blaming the server for the client's address.
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return badRequest();
    }

    if (!env.ARCHIVE) return new Response("Not configured", { status: 503 });

    // A response this Worker builds itself never reaches the CDN cache that
    // the zone's cache rules configure: those govern origin fetches, and
    // nothing sits behind this route. Without the Cache API every record
    // download and every listing render was a live R2 operation, and a
    // listing render is a LIST. pkghaus-archive learned this at the R2
    // cutover and pkghaus-stats was written with it; this Worker is the copy
    // that did not inherit it.
    //
    // Keyed on the decoded path so the encoded and literal spellings of a
    // version's '~' and '+' share one entry and a query string cannot
    // multiply them. HEAD is excluded rather than sharing the GET's key: it
    // would otherwise store or return a body-less answer under it.
    const cacheKey = new Request(`https://buildinfos.pkg.haus${path}`);
    const cache = caches.default;
    // Every conditional, not just the "has it changed" pair. if-match and
    // if-unmodified-since were missing, so a request carrying one was treated
    // as cacheable, took a cache hit, and got a 200 -- which is how the cache
    // silently undid the 412 that shipped alongside it. Measured live: 412 on
    // every cache miss, 200 on every HIT, across eight requests.
    //
    // Only R2 can answer a precondition, because only R2 knows the current
    // object. A cached copy cannot, so these have to reach it.
    const conditional =
      request.headers.has("range") ||
      request.headers.has("if-none-match") ||
      request.headers.has("if-modified-since") ||
      request.headers.has("if-match") ||
      request.headers.has("if-unmodified-since");
    const cacheable = request.method === "GET" && !conditional;

    if (cacheable) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    const response = await serve(request, env, path);

    // Only a complete, successful body. A 206 is a fragment, a 304 is not the
    // object, and a 404 page must not outlive the publish that fills the gap.
    if (cacheable && response.status === 200) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  },
};

async function serve(request, env, path) {
  if (path === "/favicon.svg") {
    return new Response(FAVICON, {
      headers: {
        "content-type": "image/svg+xml",
        "cache-control": `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`,
        ...SECURITY_HEADERS,
      },
    });
  }

  // The flat index. Generated per request from a LIST rather than stored,
  // so it cannot drift from the pool it describes.
  if (path === `/${LIST_FILE}`) {
    const { objects } = await listAll(env.ARCHIVE, PREFIX + POOL);
    const body = objects.map((o) => o.key.slice(PREFIX.length)).sort().join("\n") + "\n";
    return new Response(body, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": `public, max-age=${LISTING_MAX_AGE}`,
        ...SECURITY_HEADERS,
      },
    });
  }

  if (path === "/" || path === "") {
    const { objects } = await listAll(env.ARCHIVE, PREFIX + POOL);
    const listBytes = objects.reduce(
      (n, o) => n + o.key.slice(PREFIX.length).length + 1, 0);
    return html(renderRoot(listBytes), LISTING_MAX_AGE);
  }

  if (!path.startsWith(`/${POOL}`)) return notFound();

  // A trailing slash is a directory: one level, via the delimiter.
  if (path.endsWith("/")) {
    const prefix = PREFIX + path.slice(1);
    const { objects, prefixes } = await listAll(env.ARCHIVE, prefix, "/");
    if (objects.length === 0 && prefixes.length === 0) return notFound();
    const dirs = prefixes.map((p) => p.slice(prefix.length)).sort();
    const files = objects
      .map((o) => ({ name: o.key.slice(prefix.length), size: o.size }))
      .filter((f) => f.name !== "")
      .sort((a, b) => a.name.localeCompare(b.name));
    return html(renderListing(path, dirs, files), LISTING_MAX_AGE);
  }

  const key = PREFIX + path.slice(1);
  const range = request.headers.get("range");

  // R2 wants a Headers object here, not the header's string value -- handed a
  // string it throws, which is a 500 on every ranged request. HEAD passes no
  // range at all: asking R2 for a slice it will not send wastes the read.
  let object;
  try {
    object = await env.ARCHIVE.get(key, {
      onlyIf: request.headers,
      range: request.method === "HEAD" ? undefined : request.headers,
    });
  } catch (e) {
    // R2 THROWS for a range it cannot satisfy rather than returning null, and
    // an unhandled throw here is a 500 -- telling a client with a stale partial
    // download that the server is broken. RFC 9110 says 416 with the object's
    // real length, which is what lets the client discard its partial and start
    // again.
    //
    // Nothing here is load-bearing the way the archive's copy is -- there the
    // same throw rendered as 404 fails `apt update` outright -- but a 500 is
    // still the wrong answer to a well-formed question.
    if (!isUnsatisfiableRange(e)) throw e;
    const head = await env.ARCHIVE.head(key);
    if (!head) return notFound();
    const headers = new Headers(SECURITY_HEADERS);
    headers.set("content-range", `bytes */${head.size}`);
    headers.set("accept-ranges", "bytes");
    // Specific to this request's Range header: never store it and replay it to
    // a client that asked for something else.
    headers.set("cache-control", "no-store");
    return new Response(null, { status: 416, headers });
  }
  if (!object) return notFound();

  const headers = new Headers(SECURITY_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-type", contentType(key));
  headers.set("cache-control", `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`);
  headers.set("accept-ranges", "bytes");

  // A bodiless result is R2 answering the onlyIf, not a missing object.
  // Which status that is depends on which condition failed: the "has it
  // changed" pair means the caller's copy is current, the "only if it is still
  // this" pair means it is not. Collapsing both into 304 tells a failed
  // If-Match that nothing changed.
  if (!("body" in object)) {
    const fresh =
      request.headers.has("if-none-match") ||
      request.headers.has("if-modified-since");
    return new Response(null, { status: fresh ? 304 : 412, headers });
  }

  // 206 is decided by what the CLIENT asked for. R2 reports `range` on the
  // result whether or not one was requested, so keying the status off the
  // response alone answers every plain GET with a partial.
  if (range && object.range) {
    const [start, end] = resolveRange(object.range, object.size);
    headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  // HEAD carries the size or it tells the caller nothing, which is the
  // main reason to send one. The 200 path below sets it from the body.
  if (request.method === "HEAD") {
    headers.set("content-length", String(object.size));
    return new Response(null, { status: 200, headers });
  }

  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

// Measured against live R2, all four cases: the result's range is always
// {offset, length}, both already resolved to numbers, whatever the request
// asked for. A suffix range comes back converted to an offset; an open-ended
// one comes back with its length filled in.
//
// The trap is that all three keys are own properties of that object and
// `suffix` is always undefined, so `"suffix" in range` is true on EVERY result.
// Branching on key presence therefore takes the suffix path every time and
// computes `size - undefined`, serving `content-range: bytes NaN-4357/4358`
// while slicing the bytes correctly. Test the values, never the keys.
export function resolveRange(range, size) {
  // Guarded on the VALUE, not the key. Unreached by live R2, one typeof, and it
  // keeps the function total if R2 ever reports a suffix it has not resolved.
  if (typeof range.offset !== "number" && typeof range.suffix === "number") {
    return [size - range.suffix, size - 1];
  }
  const start = typeof range.offset === "number" ? range.offset : 0;
  const end = typeof range.length === "number" ? start + range.length - 1 : size - 1;
  return [start, end];
}
