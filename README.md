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
| `app-name-template` | `string` | | Template for the preview app name, e.g. `pr-${number}-api`. Rendered per closed PR into the `APP_NAME` env var for a downstream `helm uninstall` step. Omit and `APP_NAME` is empty. |
| `cecm-app-name-template` | `string` | | Same, but only for PRs whose body ticks `[x] cecm-frontend`. Appended to `APP_NAME` alongside the main app. |
| `caw-app-name-template` | `string` | | Same, for PRs whose body ticks `[x] caw-frontend`. A PR may tick both boxes; both companion apps are emitted. |

All open PRs are paginated through, so a large backlog drains in a single run.
`APP_NAME` is identical in `dry-run` and real mode, so a dry run shows exactly
what a real run would uninstall.

## Output

The action exports `APP_NAME` (space-separated) for the calling workflow to pass
to `helm uninstall`. It does not uninstall anything itself.

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
