const https = require("node:https");
const core = require("@actions/core");

const owner = core.getInput("owner");
const repo = core.getInput("repo");
const token = core.getInput("github-token");
const inactiveDays = parseInt(core.getInput("inactive-days"), 10);
const dryRun = core.getInput("dry-run") === "true";

// `body` is required: the cecm/caw checkbox detection below reads it. It used to
// be missing from the selection set, so `pr.body` was always undefined and the
// companion-app cleanup could never fire.
const prQuery = `
query repository($name: String!, $owner: String!, $after: String) {
  repository(name: $name, owner: $owner) {
    pullRequests(first: 100, after: $after, states: [OPEN], orderBy: {field: UPDATED_AT, direction: ASC}) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        number
        updatedAt
        body
      }
    }
  }
}
`;

const closePrQuery = `
mutation closePr($input: ClosePullRequestInput!) {
  closePullRequest(input: $input) {
    pullRequest {
      closed
    }
  }
}
`;

const addCommentQuery = `
mutation addComment($input: AddCommentInput!) {
  addComment(input: $input) {
    commentEdge {
      node {
        id
      }
    }
  }
}
`;

const options = {
  hostname: "api.github.com",
  port: 443,
  path: "/graphql",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v4.idl",
    "User-Agent": "Github Actions",
  },
};

const template = (string) => (variables) =>
  string.replace(/\${(.*?)}/g, (_, v) => variables[v]);

// NOTE: no `g` flag. `RegExp.prototype.test` on a global regex is stateful — it
// advances `lastIndex` between calls, so reusing one across PRs alternates
// true/false and silently skips every other match.
const cecmRegex = /\[x\]\s*cecm-frontend/i;
const cawRegex = /\[x\]\s*caw-frontend/i;

const appNameTemplate = core.getInput("app-name-template");
const cecmAppNameTemplate = core.getInput("cecm-app-name-template");
const cawAppNameTemplate = core.getInput("caw-app-name-template");

// The app names to hand to the caller's `helm uninstall` step: one per closed
// PR, plus a companion frontend app for each PR that opted into one.
const closedPrsAppList = (prs) => {
  if (!appNameTemplate) return [];
  const list = prs.map((pr) => template(appNameTemplate)(pr));
  prs.forEach((pr) => {
    const body = pr.body || "";
    // Independent `if`s, not `if/else if`: a PR can tick both boxes, and the
    // chained version dropped the caw app whenever cecm also matched.
    if (cecmAppNameTemplate && cecmRegex.test(body)) {
      list.push(template(cecmAppNameTemplate)(pr));
    }
    if (cawAppNameTemplate && cawRegex.test(body)) {
      list.push(template(cawAppNameTemplate)(pr));
    }
  });
  return list;
};

const gqlReq = ({ query, variables }) =>
  new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.setEncoding("utf8");
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        core.debug(`Response: ${data}`);
        core.debug(`Status ${res.statusCode}`);
        let json;
        try {
          json = JSON.parse(data);
        } catch (e) {
          reject(
            new Error(
              `Non-JSON response (HTTP ${res.statusCode}): ${data.slice(
                0,
                200
              )}`
            )
          );
          return;
        }
        if (res.statusCode !== 200) {
          reject(json);
        } else if (json.errors) {
          reject(json.errors);
        } else {
          resolve(json);
        }
      });
    });

    req.write(JSON.stringify({ query, variables }));

    req.on("error", reject);
    req.end();
  });

// Walk every page. The old query took `first: 10` with no pagination, capping
// each run at 10 closures regardless of how large the backlog was.
const fetchOpenPrs = async () => {
  const prs = [];
  let after = null;
  for (;;) {
    const res = await gqlReq({
      query: prQuery,
      variables: { owner, name: repo, after },
    });
    const page = res.data.repository.pullRequests;
    prs.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return prs;
};

async function run() {
  try {
    const prs = await fetchOpenPrs();
    core.info(`Fetched ${prs.length} open PR(s)`);

    const now = new Date();
    const filteredPrs = prs.filter((pr) => {
      const days = (now - new Date(pr.updatedAt)) / (1000 * 60 * 60 * 24);
      return days > inactiveDays;
    });
    core.info(
      `Found ${filteredPrs.length} PRs inactive for more than ${inactiveDays} days`
    );

    // Built the same way on both paths — dry-run used to report a different
    // (companion-app-free) list than the one a real run would act on.
    const appNames = closedPrsAppList(filteredPrs);

    if (dryRun) {
      core.info(
        `Would have closed PR(s) ${filteredPrs
          .map((pr) => `#${pr.number}`)
          .join(", ")}`
      );
    } else {
      // Sequential, not Promise.all: bursting mutations trips GitHub's
      // secondary rate limits, and now that pagination is fixed a backlog could
      // be far larger than the previous hard cap of 10.
      for (const pr of filteredPrs) {
        await gqlReq({
          query: addCommentQuery,
          variables: {
            input: {
              subjectId: pr.id,
              body: `This PR has been open for more than ${inactiveDays} days without any activity. Closing it.`,
            },
          },
        });
        core.info(`Added comment to PR #${pr.number}`);
        await gqlReq({
          query: closePrQuery,
          variables: { input: { pullRequestId: pr.id } },
        });
        core.info(`Closed PR #${pr.number}`);
      }
    }

    core.info(`App Names ${appNames.join(" ")}`);
    core.exportVariable("APP_NAME", appNames.join(" "));
  } catch (err) {
    core.setFailed(err.message || JSON.stringify(err));
  }
}

run();
