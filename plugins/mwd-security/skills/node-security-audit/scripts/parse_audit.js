#!/usr/bin/env node
/**
 * parse_audit.js — parses npm audit JSON into a normalized, prioritized list.
 *
 * Usage: node parse_audit.js <audit.json> [outdated.json]
 *
 * Outputs a JSON array of issues, each with:
 *   { kind, package, severity, priority, current, recommended, notes }
 *
 * "kind" is one of: "vulnerability" | "outdated"
 * "priority" is one of: "Critical" | "High" | "Medium" | "Low"
 *
 * Priorities follow the rubric in references/severity_rubric.md.
 */

const fs = require("fs");

const SEVERITY_TO_PRIORITY = {
  critical: "Critical",
  high: "Critical",
  moderate: "High",
  low: "Medium",
  info: "Low",
};

function parseVulnerabilities(auditJson) {
  const issues = [];
  if (!auditJson?.vulnerabilities) return issues;

  for (const [name, vuln] of Object.entries(auditJson.vulnerabilities)) {
    // npm v7+ format
    const severity = vuln.severity || "low";
    const priority = SEVERITY_TO_PRIORITY[severity] || "Medium";

    // fixAvailable can be true, false, or an object { name, version, isSemVerMajor }
    let recommended = null;
    let breaking = false;
    if (vuln.fixAvailable && typeof vuln.fixAvailable === "object") {
      recommended = vuln.fixAvailable.version;
      breaking = vuln.fixAvailable.isSemVerMajor === true;
    } else if (vuln.fixAvailable === true) {
      recommended = "(see npm audit fix)";
    }

    // Pull a representative advisory title if available
    const via = Array.isArray(vuln.via) ? vuln.via : [];
    const advisory = via.find((v) => typeof v === "object");
    const title = advisory?.title || `${severity} severity issue`;
    const url = advisory?.url || null;

    issues.push({
      kind: "vulnerability",
      package: name,
      severity,
      priority,
      current: vuln.range || null,
      recommended,
      notes: [
        title,
        url,
        breaking ? "⚠ breaking change (major version bump)" : null,
        recommended ? null : "no fix available — workaround required",
      ]
        .filter(Boolean)
        .join(" — "),
    });
  }

  return issues;
}

function parseOutdated(outdatedJson) {
  const issues = [];
  if (!outdatedJson || typeof outdatedJson !== "object") return issues;

  for (const [name, info] of Object.entries(outdatedJson)) {
    const current = info.current || "(not installed)";
    const wanted = info.wanted;
    const latest = info.latest;
    if (!latest || latest === current) continue;

    // Determine severity of the gap
    const [curMajor] = (current || "0").split(".").map((n) => parseInt(n) || 0);
    const [latestMajor] = latest.split(".").map((n) => parseInt(n) || 0);
    const majorBehind = latestMajor - curMajor;

    let priority = "Low";
    if (majorBehind >= 2) priority = "High";
    else if (majorBehind === 1) priority = "Medium";

    // Recommended target: prefer wanted if it differs from current,
    // else latest with a note about breaking change
    let recommended;
    let notes;
    if (wanted && wanted !== current) {
      recommended = wanted;
      notes = `safe upgrade within current semver range; latest is ${latest}`;
    } else {
      recommended = latest;
      notes =
        majorBehind >= 1
          ? `${majorBehind} major version(s) behind — review changelog`
          : "minor/patch upgrade";
    }

    issues.push({
      kind: "outdated",
      package: name,
      severity: priority.toLowerCase(),
      priority,
      current,
      recommended,
      notes,
    });
  }

  return issues;
}

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function main() {
  const auditPath = process.argv[2];
  const outdatedPath = process.argv[3];

  let issues = [];

  if (auditPath && fs.existsSync(auditPath)) {
    try {
      const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
      issues = issues.concat(parseVulnerabilities(audit));
    } catch (e) {
      console.error(`Failed to parse ${auditPath}: ${e.message}`);
    }
  }

  if (outdatedPath && fs.existsSync(outdatedPath)) {
    try {
      const text = fs.readFileSync(outdatedPath, "utf8").trim();
      if (text) {
        const outdated = JSON.parse(text);
        issues = issues.concat(parseOutdated(outdated));
      }
    } catch (e) {
      console.error(`Failed to parse ${outdatedPath}: ${e.message}`);
    }
  }

  // Sort by priority, then package name
  issues.sort((a, b) => {
    const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (p !== 0) return p;
    return a.package.localeCompare(b.package);
  });

  console.log(JSON.stringify(issues, null, 2));
}

main();
