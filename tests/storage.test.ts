import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const files = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const full = path.join(directory, name);
  return statSync(full).isDirectory() ? files(full) : [full];
});
const sources = files(path.join(root, "src")).filter((file) => /\.(ts|tsx)$/.test(file));

test("browser storage is used only for the interface language", () => {
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(root, file);
    if (relative === path.join("src", "i18n", "storage.ts")) continue;
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open/, `${relative} must not touch browser storage`);
  }
  const storage = readFileSync(path.join(root, "src", "i18n", "storage.ts"), "utf8");
  assert.doesNotMatch(storage, /sessionStorage|indexedDB|document\.cookie/);
  assert.deepEqual([...storage.matchAll(/"(arasya\.[a-z0-9.]+)"/g)].map((match) => match[1]), ["arasya.b2b.locale"]);
});

test("no authentication token handling, JWT or third-party auth exists", () => {
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /["']Authorization["']|Bearer /, `${path.relative(root, file)} sends no bearer header`);
    assert.doesNotMatch(source, /\bjwt\b|jsonwebtoken|firebase|auth0|accessToken|refreshToken/i, path.relative(root, file));
  }
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { name: string; version: string; dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.equal(manifest.name, "arasya-b2b");
  assert.equal(manifest.version, "0.6.1");
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["react", "react-dom"], "runtime dependencies stay minimal");
  for (const forbidden of ["three", "@babylonjs/core", "babylonjs", "@react-three/fiber", "next", "vue", "@angular/core", "tailwindcss", "jsonwebtoken", "jose", "firebase", "@auth0/auth0-react"]) {
    assert.equal(forbidden in { ...manifest.dependencies, ...manifest.devDependencies }, false, forbidden);
  }
});

test("all API traffic goes through the single client with credentials included", () => {
  const fetchers = sources.filter((file) => /\bfetch\(/.test(readFileSync(file, "utf8")));
  assert.deepEqual(fetchers.map((file) => path.relative(root, file)), [path.join("src", "api", "client.ts")]);
  assert.match(readFileSync(path.join(root, "src", "api", "client.ts"), "utf8"), /credentials: "include"/);
  for (const file of sources) assert.doesNotMatch(readFileSync(file, "utf8"), /https?:\/\/(localhost|127\.0\.0\.1)/, path.relative(root, file));
});
