const https = require("node:https");
const core = require("@actions/core");

const owner = core.getInput("owner");
const repo = core.getInput("repo");
const token = core.getInput("github-token");
const inactiveDays = parseInt(core.getInput("inactive-days"), 10);
const dryRun = core.getInput("dry-run") === "true";
const prQuery = `
query repository($name: String!, $owner: String!) {
  repository(name: $name, owner: $owner) {
    pullRequests(first: 10, states: [OPEN], orderBy: {field: UPDATED_AT, direction: ASC}) {
      nodes {
        id
        number
        updatedAt
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

const closedPrsAppName = (prs) => prs.map(template(core.getInput('app-name-template'))).join(" ");

const gqlReq = ({ query, variables }) =>
  new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.setEncoding("utf8");
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        core.debug(`Response: ${data}`);
        core.debug(`Status ${res.statusCode}`);
        const json = JSON.parse(data);
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

async function run() {
  try {
    const prs = await gqlReq({
      query: prQuery,
      variables: {
        owner,
        name: repo,
      },
    });
    const filteredPrs = prs.data.repository.pullRequests.nodes.filter((pr) => {
      const updatedAt = new Date(pr.updatedAt);
      const now = new Date();
      const diff = now - updatedAt;
      const days = diff / (1000 * 60 * 60 * 24);
      return days > inactiveDays;
    });
    core.info(
      `Found ${filteredPrs.length} PRs inactive for more than ${inactiveDays} days`
    );
    if (!dryRun) {
      await Promise.all(
        filteredPrs.map(async (pr) => {
          // Add a comment
          const addCommentRes = await gqlReq({
            query: addCommentQuery,
            variables: {
              input: {
                subjectId: pr.id,
                body: `This PR has been open for more than ${inactiveDays} days without any activity. Closing it.`,
              },
            },
          });
          core.debug(`Close PR response ${JSON.stringify(addCommentRes)}`);
          core.info(`Added comment to PR #${pr.number}`);
          const closeRes = await gqlReq({
            query: closePrQuery,
            variables: {
              input: {
                pullRequestId: pr.id,
              },
            },
          });
          core.debug(JSON.stringify(closeRes));
          core.info(`Closed PR #${pr.id}`);
        })
      );
      if (core.getInput('app-name-template')) {
        core.exportVariable("APP_NAME", closedPrsAppName(filteredPrs));
      }
    } else {
      core.info(
        `Would have closed PR(s) #${filteredPrs
          .map((pr) => pr.number)
          .join(", #")}`
      );
      core.info(`App Names ${closedPrsAppName(filteredPrs)}`);
      core.exportVariable("APP_NAME", closedPrsAppName(filteredPrs));
    }
  } catch (err) {
    core.setFailed(err.message || err);
  }
}

run();
