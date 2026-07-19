// Builds the per-sandbox gh-fixture.json the stub answers from, out of a fixture profile's
// `gh` block plus a derived reviewer display-name map. Plain data in, plain data out.

/** @param {{name:string, gh?:object}} profile */
export function buildGhFixture(profile) {
  const gh = profile.gh || {};
  const collaborators = gh.collaborators || [];
  const displayNames = {};
  for (const c of collaborators) {
    displayNames[c.login] = c.name ?? c.login;
  }
  return {
    fixture: profile.name,
    owner: gh.owner || "Intentional-Society",
    repo: gh.repo || "is-app",
    auth: gh.auth || { loggedIn: true, login: gh.self || "sandbox-user", host: "github.com" },
    self: gh.self || "sandbox-user",
    collaborators,
    displayNames,
    issues: gh.issues || {},
    prs: gh.prs || {},
    branchPr: gh.branchPr ?? null,
    checks: gh.checks || [],
    runs: gh.runs || [],
    createPr: gh.createPr || null,
    sequences: gh.sequences || {},
    vercelProductionUrl: gh.vercelProductionUrl || null,
  };
}
