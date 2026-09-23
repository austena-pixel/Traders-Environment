# H·IOS Modular Foundation — Stage 2A

This package converts the working H·IOS + Goals-IOS prototype into the first
backward-compatible A1/A2 modular foundation. The visible interfaces and the
existing browser data keys are preserved.

## What is modular now

- `index.html`, `h-ios.css`, and `h-ios.js` are separated.
- Product identity, capabilities, and browser connection state are separated
  under `02-products/`.
- Goals-IOS has its own product boundary, data constants, pure intelligence
  helpers, connector, event declarations, stylesheet, and interface controller.
- The Communication Centre is separated into contracts, permissions, logging,
  connection state, signal transport, routing, product connection, and a stable
  `index.js` gateway.
- The old root routes remain available:
  - `g-ios.html` opens the modular Goals-IOS page.
  - `h-ios.html` opens `index.html`.
  - `hios-connection-layer.js` remains as a generated compatibility bundle.

## Current tree

```text
H-IOS-Modular/
├── index.html
├── h-ios.html
├── h-ios.css
├── h-ios.js
├── g-ios.html
├── hios-connection-layer.js
├── 02-products/
│   ├── product-capabilities.js
│   ├── product-registry.js
│   ├── product-state.js
│   └── goals-ios/
│       ├── g-ios.html
│       ├── goals.css
│       ├── goals.js
│       ├── goals-data.js
│       ├── goals-intelligence.js
│       ├── goals-connector.js
│       └── goals-events.js
├── 03-communication-centre/
│   ├── index.js
│   ├── communication-centre.js
│   ├── product-connector.js
│   ├── event-router.js
│   ├── permissions.js
│   ├── data-contracts.js
│   ├── signal-bus.js
│   ├── connection-state.js
│   └── communication-log.js
├── scripts/
│   └── build-connection-bundle.mjs
└── tests/
    └── modular-foundation.test.mjs
```

## GitHub deployment

1. Extract the ZIP.
2. Upload the **contents** of `H-IOS-Modular` to the repository root.
3. Keep any existing `t-ios.html` file; this package does not replace the
   Traders-IOS interface.
4. Commit the complete folder structure together. Do not upload only the two
   HTML files because they now depend on the modular JavaScript and CSS files.
5. Redeploy or wait for the connected hosting service to deploy the commit.

The same-domain requirement still applies. H·IOS and Goals-IOS must be served
from the same website origin for the current local connection layer.

## Preserved behavior

- Goal and task creation syncs to H·IOS.
- Daily Progress Status uses completed daily tasks divided by today's expected
  daily tasks.
- Today's Focus shows today's unfinished daily tasks and removes them after
  Done is clicked.
- H·IOS calendar task removal and deletion requests are processed by Goals-IOS.
- Existing `localStorage` keys are unchanged, so current browser data remains
  available when deployed on the same domain.

## Current limitation

This remains **Layer 1 browser-local communication** using `localStorage`,
`storage` events, and `BroadcastChannel`. Cross-device data, Supabase
persistence, Personal Intelligence, and the later blueprint layers have not
been added yet.

## Rebuild the compatibility bundle

After changing any file in `03-communication-centre/`, run:

```bash
node scripts/build-connection-bundle.mjs
```

The source modules remain authoritative; the root bundle exists for older
pages that still load `hios-connection-layer.js`.
