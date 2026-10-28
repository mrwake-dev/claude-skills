#!/usr/bin/env node
/**
 * check_deprecated.js — finds deprecated packages by querying the npm registry.
 *
 * Usage: node check_deprecated.js <path-to-package.json>
 *
 * Reads dependencies and devDependencies, queries the registry for each,
 * and prints a JSON array of { name, installedRange, latestVersion, deprecated, replacement? }.
 *
 * The "replacement" field is heuristically extracted from the deprecation
 * message when it follows common patterns like "use X instead" or "switch to X".
 */

const fs = require("fs");
const https = require("https");
const path = require("path");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: "application/json" } }, (res) => {
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function extractReplacement(message) {
  if (!message) return null;
  const patterns = [
    /use\s+([@\w/.\-]+)\s+instead/i,
    /switch\s+to\s+([@\w/.\-]+)/i,
    /replaced\s+by\s+([@\w/.\-]+)/i,
    /migrate\s+to\s+([@\w/.\-]+)/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m) return m[1];
  }
  return null;
}

async function checkPackage(name, range) {
  try {
    // Encode scoped packages: @scope/name -> @scope%2Fname
    const encoded = name.replace("/", "%2F");
    const data = await fetchJson(`https://registry.npmjs.org/${encoded}`);
    if (!data) {
      return { name, installedRange: range, error: "not found in registry" };
    }
    const latest = data["dist-tags"]?.latest;
    const versionInfo = latest ? data.versions?.[latest] : null;
    const deprecated = versionInfo?.deprecated || null;
    return {
      name,
      installedRange: range,
      latestVersion: latest,
      deprecated,
      replacement: extractReplacement(deprecated),
    };
  } catch (e) {
    return { name, installedRange: range, error: e.message };
  }
}

async function main() {
  const pkgPath = process.argv[2] || "./package.json";
  if (!fs.existsSync(pkgPath)) {
    console.error(`File not found: ${pkgPath}`);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const names = Object.keys(allDeps);
  console.error(`Checking ${names.length} packages against registry...`);

  // Run in batches of 10 to avoid hammering the registry
  const results = [];
  const batchSize = 10;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((n) => checkPackage(n, allDeps[n]))
    );
    results.push(...batchResults);
    console.error(`  ${Math.min(i + batchSize, names.length)}/${names.length}`);
  }

  const deprecated = results.filter((r) => r.deprecated);
  const errors = results.filter((r) => r.error);

  console.log(
    JSON.stringify(
      { total: names.length, deprecated, errors, all: results },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
