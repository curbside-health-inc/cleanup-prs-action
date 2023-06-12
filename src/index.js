const https = require('node:https');
const core = require('@actions/core');
const github = require('@actions/github');

const owner = core.getInput('owner')
const repo = core.getInput('repo')
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
`

const closePrQuery = `
mutation closePr($input: ClosePullRequestInput!) {
  closePullRequest(input: $input) {
    pullRequest {
      closed
    }
  }
}
`


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
`

const options = {
  hostname: 'api.github.com',
  port: 443,
  path: '/graphql',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    "Authorization": "Bearer ${{ secrets.GITHUB_TOKEN }}",
    "Accept": "application/vnd.github.v4.idl",
    "User-Agent": "Github Actions"
  }
}

const gqlReq = ({query, variables}) => new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    res.setEncoding('utf8');
    let data = '';
    res.on('data', (d) => data += d);
    res.on('end', () => resolve(JSON.parse(data)));
  })
  
  req.write(JSON.stringify({ query, variables }))
  
  req.on('error', reject);
  req.end();
})
const payload = JSON.stringify(github.context.payload, undefined, 2)
console.log(`The event payload: ${payload}`);
gqlReq({query: prQuery, variables : {
  owner,
  name: repo,
}}).then((prs) => {
  prs.data.repository.pullRequests.nodes.filter((pr) => {
    const updatedAt = new Date(pr.updatedAt)
    const now = new Date()
    const diff = now - updatedAt
    const days = diff / (1000 * 60 * 60 * 24)
    return days > 5
    }).forEach((pr) => {
      // Add a comment
      gqlReq({query: addCommentQuery, variables: {
        input: {
          subjectId: pr.id,
          body: "This PR has been open for more than 5 days without any activity. Closing it."
        }
      }})
      .then((res) => {
        console.log('Close PR response', res)
        console.log(`Added comment to PR #${pr.number}`)
        return gqlReq({query: closePrQuery, variables: {
          input: {
            pullRequestId: pr.id
          }
        }})
      })
      .then((res) => {
        console.log(res)
        console.log(`Closed PR #${pr.id}`)
      })
      .catch((err) => {
        core.setFailed(err.message);
      })
    })
}).catch((err) => {
  core.setFailed(err.message);
})
