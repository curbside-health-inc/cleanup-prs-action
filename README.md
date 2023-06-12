# Github Cleanup PRs

This Action allows you to cleaup unused PRs.

## Parameters
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `github-token` | `string` | | Your Github token |
| `owner` | `string` | | Github owner name |
| `repo` | `string` | | Name of your Github repository |
| `inactive-days` | `string` | 5 | Number of days of inactivity which will close the PR |
| `dry-run` | `boolean` | false | If true, it will only print the PRs that will be closed |

## Usage

```yaml
jobs:
  clean-prs:
    runs-on: ubuntu-latest
    steps:
    - uses: curbside-health-inc/cleanup-prs-action@main
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
        owner: ${{ github.repository_owner }}
        repo: ${{ github.event.repository.name }}
```
## License
The MIT License (MIT)
