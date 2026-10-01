import { cp, mkdir } from "node:fs/promises";

const destination = new URL("../dist/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL("../public/", import.meta.url), destination, {
  recursive: true,
});
console.log("Built static app in dist/");
