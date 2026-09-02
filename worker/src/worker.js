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
footer{border-top:3px solid var(--ink);padding-top:1.5rem;display:flex;gap:1.5rem;
flex-wrap:wrap;font-size:.85rem;color:var(--muted)}
footer a{color:inherit}
footer a:hover{color:var(--accent-text)}

/* Only what the archive has no counterpart for: this host explains itself on
   its root page, which no listing page does. */
.about{border-top:3px solid var(--ink);margin-top:2.5rem;padding-top:1.25rem}
.about h2{font-size:1.05rem;margin:1.75rem 0 .5rem}
.about h2:first-child{margin-top:0}
.about p{margin:0 0 .9rem;max-width:38rem}
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

const FOOTER = `<footer><a href="https://pkg.haus">pkg.haus</a>
<a href="https://apt.pkg.haus">apt.pkg.haus</a>
<a href="https://github.com/pkghaus">github.com/pkghaus</a>
<span>listed live from the archive bucket</span>
<span>Apache-2.0</span></footer>`;

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
${body}${FOOTER}</main></body></html>`;
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
<pre><span class="c">buildinfo-pool/c/croc/</span>croc_11.3.6-1~haus13+1_amd64.buildinfo
<span class="c">buildinfo-pool/c/croc/</span>croc_11.3.6-1~testing1_amd64.buildinfo
<span class="c">buildinfo-pool/c/croc/</span>croc_11.3.6-1_amd64.buildinfo</pre>
<p>Beside each record sit the <code>.dsc</code> and the source tarballs it was built
from, and a <code>.source</code> naming the upstream repository, tag and commit.</p>
<h2>What you can do with one</h2>
<p>Rebuild the package and compare. <code>debrebuild</code> resolves the recorded
environment from <code>snapshot.debian.org</code>, unpacks the <code>.dsc</code>
published beside the record, rebuilds, and checks every checksum. The whole procedure,
with its container, is <code>verify/</code> in
<a href="https://github.com/pkghaus/apt">pkghaus/apt</a>.</p>
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
  return page(`${parts.join("/")} - buildinfos.pkg.haus`,
    header(parts.join("/")) + rows(entries));
}

function notFound() {
  return new Response(
    page("Not found - buildinfos.pkg.haus",
      header("", "No such record.")
      + `<p style="margin:1.5rem 0 0"><a href="/">Back to the pool</a></p>`),
    { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function html(bodyText, maxAge, status = 200) {
  return new Response(bodyText, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": `public, max-age=${maxAge}`,
      ...SECURITY_HEADERS,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    if (!env.ARCHIVE) return new Response("Not configured", { status: 503 });

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
    const object = await env.ARCHIVE.get(key, {
      onlyIf: request.headers,
      range: request.method === "HEAD" ? undefined : request.headers,
    });
    if (!object) return notFound();

    const headers = new Headers(SECURITY_HEADERS);
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("content-type", contentType(key));
    headers.set("cache-control", `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`);
    headers.set("accept-ranges", "bytes");

    // A bodiless result is R2 answering the onlyIf, not a missing object.
    if (!("body" in object)) return new Response(null, { status: 304, headers });

    // 206 is decided by what the CLIENT asked for. R2 reports `range` on the
    // result whether or not one was requested, so keying the status off the
    // response alone answers every plain GET with a partial.
    if (range && object.range) {
      const [start, end] = resolveRange(object.range, object.size);
      headers.set("content-range", `bytes ${start}-${end}/${object.size}`);
      headers.set("content-length", String(end - start + 1));
      return new Response(object.body, { status: 206, headers });
    }

    return new Response(request.method === "HEAD" ? null : object.body,
      { status: 200, headers });
  },
};

// Measured against live R2 on 2026-09-02, all four cases: the result's range is
// always {offset, length}, both already resolved to numbers, whatever the
// request asked for. A suffix range comes back converted to an offset; an
// open-ended one comes back with its length filled in.
//
// The trap is that all three keys are own properties of that object and
// `suffix` is always undefined, so `"suffix" in range` is true on EVERY result.
// Branching on key presence therefore takes the suffix path every time and
// computes `size - undefined`, which is how both this Worker and the archive's
// served `content-range: bytes NaN-4357/4358` while slicing the bytes correctly.
// Test the values, never the keys.
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
