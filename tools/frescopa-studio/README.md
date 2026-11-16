# Frescopa Studio (`/tools/frescopa-studio`)

A DA app for running the [Frescopa app](https://github.com/kunwarsaluja/frescopa-app) from DA.

**Open:** `https://da.live/app/kunwarsaluja/frescopa/tools/frescopa-studio/frescopa-studio`

It edits one structured content document, `/en/us/app/experience` (schema `frescopa-app`), with the form on the left and the app on a phone on the right.

- **As you type:** changes save to DA, and the phone shows them straight away.
- **Preview:** updates the app's preview mode (`…/app/?preview`).
- **Publish:** previews, then publishes. The live app picks it up on its next start.

DA's own form editor opens the same document (`Open in DA`), because both use DA's structured content SDK.

## How it works

- `frescopa-studio.js` loads the schema from `/.da/forms/schemas/frescopa-app` and the document from DA with the author's token ([DA App SDK](https://docs.da.live/developers/guides/developing-apps-and-plugins)), saves with the DA source API, and previews and publishes with the AEM admin API.
- `form.js` draws the form from the [da-sc-sdk](https://github.com/adobe/da-sc-sdk) model. Labels, help text, options and limits all come from the schema, so a schema change needs no code change. Edit the schema with DA's [Schema Editor](https://da.live/apps/schema).
- The SDK is imported from `da.live`, the same copy DA's form editor uses, so there's no npm dependency.
- The phone is the app in an iframe with `?preview`. Studio sends it the draft with `postMessage`; the app only accepts drafts from the site's own hosts.

## Develop

```sh
aem up                                   # serves this repo on localhost:3000
# in frescopa-app: npm start             # the app on localhost:4321
```

Open `https://da.live/app/kunwarsaluja/frescopa/tools/frescopa-studio/frescopa-studio?ref=local`. On localhost, Studio shows the app from `localhost:4321`.

Signing in to DA needs an account with write access to `kunwarsaluja/frescopa` (org config → permissions).
