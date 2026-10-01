import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../public/", import.meta.url);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const routes = new Map([
  ["/", ["index.html", "text/html"]],
  ["/index.html", ["index.html", "text/html"]],
  ["/task-tracker.html", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/config.js", ["config.js", "text/javascript"]],
  ["/cloud.js", ["cloud.js", "text/javascript"]],
  [
    "/vendor/supabase-2.117.2.js",
    ["vendor/supabase-2.117.2.js", "text/javascript"],
  ],
  ["/styles.css", ["styles.css", "text/css"]],
]);

export const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const route = routes.get(pathname);
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  if (!route) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(new URL(route[0], root));
    response.writeHead(200, {
      "Content-Type": `${route[1]}; charset=utf-8`,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(500).end("Unable to load application");
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () =>
    console.log(`Taskline: http://${host}:${port}`),
  );
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
