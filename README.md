# cleanse-app

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_cleanse-app&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_cleanse-app)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_cleanse-app&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_cleanse-app)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_cleanse-app&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_cleanse-app)

Core delivery platform Node.js Frontend Template.

- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Signing in](#signing-in)
- [Sessions](#sessions)
- [Demo anonymisation](#demo-anonymisation)
- [Status page](#status-page)
- [Local Development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Choosing a backend](#choosing-a-backend)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Update dependencies](#update-dependencies)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Requirements

### Node.js

Please install Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd cleanse-app
nvm use
```

## Signing in

Every page asks for a password first, and the admin area, under `/admin`, then asks for a second one. Both are secrets,
set in the CDP Portal for each environment, and take effect when the service is next deployed:

| Secret           | What it opens                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `PASSWORD`       | The whole service. Until it is set, nobody can sign in, and the sign-in page says so.            |
| `ADMIN_PASSWORD` | The admin area, for someone already signed in. Until it is set, the admin area cannot be opened. |

The `cleanse` repository's `scripts/generate-secrets.ps1` generates both, along with the service's other secrets.

- Only `/health`, which the platform calls, and the stylesheets, scripts and images are open without signing in.
- The session cookie holds proof that the password was typed, not the password: a MAC, under the password, of when that
  sign-in was made and a random value. It cannot be made without the password, even by someone who can read or write
  the cookie, nor moved to another sign-in or a later time. Changing a password signs everyone out of what it opens.
- A sign-in lasts for `SESSION_COOKIE_TTL`, 4 hours by default, from when it was made, however busy the session. Sign
  out ends it in that browser. Nothing is kept on the server, so a copy of the cookie made earlier lasts until the
  sign-in runs out; only changing a password ends every sign-in at once.
- After signing in, people go on to the page they asked for. Only pages of this service are gone on to.
- Sign out, in the navigation, ends both sign-ins.
- Sign-ins are logged with `event.category` `authentication`. A refused password is logged at warning, but what was
  typed never is.

## Sessions

Sessions are held by the browser, in an encrypted cookie named `session`, rather than in a server-side cache. The
service needs no Redis, and any instance can serve any request.

The cookie is sealed with `SESSION_COOKIE_PASSWORD`. Set it as a secret in each CDP environment, because the default in
`src/config/config.js` is public.

Browsers limit a cookie to about 4KB, so sessions only carry small values: the sign-in, flash notifications, and the
issues list query that "Back to issues" returns to. A query of more than 1,000 characters is not remembered. A session
larger than 3,500 bytes would move to one instance's memory, where the other instances could not see it.
`src/server/plugins/session.test.js` checks that the largest session the service stores still fits.

## Proxy

We are using forward-proxy which is set up by default. Services are automatically configured with the proxy environment variables when deployed.

Node.js 24 uses these variables to route outbound HTTP(S) requests through the proxy:

NODE_USE_ENV_PROXY=1
HTTPS_PROXY=...
NO_PROXY=...

No additional proxy configuration is required in the service.

## Demo anonymisation

The issues the service shows are built from production data. To demo it without showing personal data, start it with:

```bash
DEMO_ANONYMISE=true DEMO_ANONYMISE_KEY=<any secret string> npm run dev
```

On Windows, `.\dev-up.ps1 -Demo` does the same, using a SHA-256 hash of the machine name as the key.

Every backend response is then rewritten before any page renders it (see
`src/server/common/helpers/cleanse/anonymise.js`):

- CPHs, keeper surnames, postcodes, holding names and holding IDs are replaced with realistic fakes. The CPH keeps its
  county prefix, and the location number uses the same fake CPH.
- Notes, comments and people's names are replaced with plausible fake text and names. Failure messages, stack traces and
  import rejection details are shown as "Hidden in demo mode."
- Rule numbers, error codes, premises types, counties, species codes, counts, dates and statuses are shown as they are.
- Context fields the anonymiser doesn't know about are masked character by character, and a client method without a rule
  stops the service from starting, so new data cannot leak through unnoticed.

The fakes come from an HMAC of each real value under `DEMO_ANONYMISE_KEY`, so the same value always gets the same fake
while the key is unchanged, and the fakes cannot be traced back without the key. Searching for a fake CPH, surname,
postcode or holding name that has already been shown searches for the real value behind it.

Only what the service displays is anonymised. Logs, uploaded CSVs and anything typed into the service are still real,
and actions taken during a demo change real issues.

## Status page

`/admin/status` shows whether the service is working, and is the first place to look when it is not. A tag at the top
sums up the checks: a red tag counts the problems, and a grey tag counts the checks that could not be confirmed.

| Check            | What it means                                                                          |
| ---------------- | -------------------------------------------------------------------------------------- |
| Cleanse service  | Whether this service could call the backend's `/v1/diagnostics`, and how long it took  |
| Database         | The backend's PostgreSQL database, as the backend reports it                           |
| Import storage   | The backend's S3 bucket for imports, as the backend reports it                         |
| KRDS health      | Whether the KRDS Data Bridge is up, from its own `/health`, which needs no key         |
| KRDS read access | Whether the backend can read KRDS with its API key: the genuine connection a run needs |

KRDS health passes even when the backend's KRDS API key is wrong or missing, because the bridge's health check needs no
key. KRDS read access asks the Data Bridge for its latest snapshot with the key, as a rule run does, and names that
snapshot, its size and when it was last modified. A refused key, or no snapshot to read, shows there as a problem.

If the backend cannot be reached, its four checks show as not confirmed rather than failed. The reason is shown with the
failure: for example, a 401 means the backend refused this service's credential, and a 403 from the developer gateway
means the developer key has expired.

Below the checks, the page shows the following:

- Each service's version, environment, start time and uptime, and the front end's Node.js version. If the backend is too
  old to report these, the page says so.
- The backend URL the front end uses, and how it authenticates: an STS web identity token on CDP, or an API key locally.
- When the data was last reset.
- The number of issues in each status and workflow status.

## Local Development

### Setup

Install application dependencies:

```bash
npm install
```

### Git hooks

Install git hooks (optional)

```bash
npm run git:hooks
```

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Choosing a backend

The service needs a Cleanse backend. On Windows, `dev-up.ps1` runs `npm run dev` against one:

```powershell
.\dev-up.ps1                 # The local backend stack, on http://localhost:8085
.\dev-up.ps1 -Backend dev    # cleanse in CDP's dev environment, through CDP's developer gateway
.\dev-up.ps1 -Demo           # Either backend, with its data anonymised (see Demo anonymisation)
```

The local backend stack is started from the `cleanse` repository, with `.\dev-docker-up.ps1`. To run this service and
the backend in Docker as one stack instead, see [Docker Compose](#docker-compose).

Both `dev-up.ps1` and `dev-docker-up.ps1` read the sign-in passwords, `PASSWORD` and `ADMIN_PASSWORD`, from your User
environment variables. If either is not set, they generate one for the run and show it, so set both to keep the same
passwords between runs. Without the scripts, set them yourself, for example in a `.env` file, which `npm run dev` reads
and git ignores.

`-Backend dev` calls `https://ephemeral-protected.api.dev.cdp-int.defra.cloud/cleanse`. The gateway can only be reached
from the DEFRA network. It needs two User environment variables:

| Variable               | Value                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `CDP_EPHEMERAL_GW_KEY` | Your developer API key for dev, from your user profile in the CDP Portal. It lasts 24 hours. |
| `CLEANSE_APIKEY`       | cleanse's `Auth__ApiKey__Key` secret in dev                                                  |

The script checks both keys before it starts the service. If a key is refused, it stops and explains what to fix.
Anything you do against dev changes the data in dev.

Without the script, set the service's own variables:

| Variable              | Purpose                                                 | Default                                    |
| --------------------- | ------------------------------------------------------- | ------------------------------------------ |
| `CLEANSE_API_URL`     | The backend's base URL                                  | `http://localhost:8085`                    |
| `CLEANSE_API_AUTH`    | `apiKey`, or `stsJwt` on CDP                            | `stsJwt` in production, otherwise `apiKey` |
| `CLEANSE_API_KEY`     | Sent to the backend as `x-cleanse-api-key`              | `local-development-key`                    |
| `CLEANSE_GATEWAY_KEY` | Sent as `x-api-key`, for the CDP developer gateway only | Not sent                                   |

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json)
To view them in your command line run:

```bash
npm run
```

### Update dependencies

To update dependencies use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

> The following script is a good start. Check out all the options on
> the [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

```bash
ncu --interactive --format group
```

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## Docker

### Development image

> [!TIP]
> For Apple Silicon users, you may need to add `--platform linux/amd64` to the `docker run` command to ensure
> compatibility fEx: `docker build --platform=linux/arm64 --no-cache --tag cleanse-app`

Build:

```bash
docker build --target development --no-cache --tag cleanse-app:development .
```

Run:

```bash
docker run -p 3000:3000 cleanse-app:development
```

### Production image

Build:

```bash
docker build --no-cache --tag cleanse-app .
```

Run:

```bash
docker run -p 3000:3000 cleanse-app
```

### Docker Compose

`compose.yml` runs this service from the production image, in the same way as CDP. It sets `NODE_ENV=production` and
logs ECS JSON.

By default the Cleanse backend runs in the same stack. `compose.local-backend.yml` includes the backend's own
`compose.yml` from the `cleanse` repository, which must be checked out next to this one, as `../cleanse`. The stack then
has these services:

| Service       | What it is                                                         | Port |
| ------------- | ------------------------------------------------------------------ | ---- |
| `cleanse-app` | This service, which calls the backend as `http://cleanse:8085`     | 3000 |
| `cleanse`     | The backend, built from `../cleanse`                               | 8085 |
| `postgres`    | The backend's database, kept in the stack's `postgres-data` volume | 5432 |
| `liquibase`   | Applies the backend's changelog to the database, then exits        |      |
| `floci`       | The S3 emulator holding the imports bucket                         | 4566 |

On Windows, `dev-docker-up.ps1` builds the images and starts the stack. It then waits for the health checks, checks that
the backend answers, signs in with both passwords and reads back the home page and the status page:

```powershell
.\dev-docker-up.ps1                         # The whole stack, with the backend built from ../cleanse
.\dev-docker-up.ps1 -KrdsSnapshot <path>    # The same, with the backend's rules engine reading a KRDS snapshot
.\dev-docker-up.ps1 -Backend dev            # This service alone, against cleanse in CDP's dev environment
.\dev-docker-up.ps1 -NoBuild -Follow        # Start without rebuilding, then follow both services' logs
.\dev-docker-up.ps1 -Down                   # Stop, keeping the database. Add -Reset to delete it
```

The stack's database starts empty. To fill it, start the stack with `-KrdsSnapshot`, then start a rule run from the Runs
page. `-KrdsSnapshot` defaults to the `CLEANSE_KRDS_SNAPSHOT` environment variable, so setting that keeps the rules
engine on whenever the stack is restarted.

The backend's own stack, which the `cleanse` repository starts, publishes the same ports, so stop it first. Its
database is separate from this stack's, and is kept.

Without the script, set `PASSWORD` and `ADMIN_PASSWORD` in your environment, which `compose.yml` passes through, then
run:

```bash
docker compose -f compose.yml -f compose.local-backend.yml up --build --detach --wait
```

To turn the rules engine on, set `CLEANSE_KRDS_SNAPSHOT` to the snapshot's path and add
`-f ../cleanse/compose.krds.yml`.

To use other ports, set `CLEANSE_APP_PORT`, `CLEANSE_PORT`, `CLEANSE_POSTGRES_PORT` and `CLEANSE_FLOCI_PORT`. Cookies
are not marked as Secure, because the service is served over plain HTTP.

### Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

### SonarCloud

Instructions for setting up SonarCloud can be found in [sonar-project.properties](./sonar-project.properties).

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
