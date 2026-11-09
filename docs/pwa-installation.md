# Installing the existing H-IOS website

This is installation metadata for the existing root `index.html`, not a separate
application. The manifest uses `/` for its identity, start URL, and scope, so the
installed app opens the same origin and existing H-IOS login and environments.
Install from the production origin after the change has been approved and merged;
a preview installation belongs to the preview origin and has separate browser data.

## Installation

- Android Chrome: open the website, then use the browser menu's Install app or
  Add to Home screen option. Labels and installation availability depend on the browser.
- iPhone/iPad Safari: open the website, choose Share, then Add to Home Screen.
  Enable Open as Web App if offered. The 180px Apple touch icon identifies H-IOS.

No service worker or offline caching is added. Network access is required for
loading the application and its existing online services.

## Existing data boundaries

The root page retains its existing Supabase authentication. Its product selection,
calendar items, and structured evidence use localStorage; the shared connection
layer also uses localStorage, storage events, and BroadcastChannel. These records
do not become cross-device data by installing the PWA. Browser profiles, origins,
and some installed-app storage contexts can be separate. Existing backend-backed
features keep their existing behavior; this change adds no synchronization.

## Icons and verification

The regular 192px/512px and Apple 180px icons retain the draft's H mark.
`icons/h-ios-maskable.svg` is the source for the repaired maskable PNG. Its opaque
blue/purple background extends to every edge, and the white H is wholly inside
the central circle with radius 204.8px. To render it with Node.js and `sharp` available:

```sh
node -e "require('sharp')('icons/h-ios-maskable.svg').png().toFile('icons/h-ios-maskable-512.png')"
```

Before release, decode all PNGs, verify dimensions against the manifest, run
`node scripts/vercel-build.cjs`, and inspect the preview root, manifest, and icons.
Actual Android and iOS installation should also be checked on those devices.
