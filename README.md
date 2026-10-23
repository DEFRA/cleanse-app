# cleanse-app

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_cleanse-app&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_cleanse-app)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_cleanse-app&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_cleanse-app)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_cleanse-app&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_cleanse-app)

Core delivery platform Node.js Frontend Template.

- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Sessions](#sessions)
- [Demo anonymisation](#demo-anonymisation)
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

## Sessions

Sessions are held by the browser, in an encrypted cookie named `session`, rather than in a server-side cache. The
service needs no Redis, and any instance can serve any request.

The cookie is sealed with `SESSION_COOKIE_PASSWORD`. Set it as a secret in each CDP environment, because the default in
`src/config/config.js` is public.

Browsers limit a cookie to about 4KB, so sessions only carry small values: flash notifications, and the issues list
query that "Back to issues" returns to. A query of more than 1,000 characters is not remembered. A session larger than
3,500 bytes would move to one instance's memory, where the other instances could not see it.
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

The local backend stack is started from the `cleanse` repository, with `.\dev-docker-up.ps1`.

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

A local environment with:

- Floci (replacing Localstack) for AWS services (S3, SQS)
- Redis
- MongoDB
- This service.
- A commented out backend example.

```bash
docker compose up --build -d
```

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
