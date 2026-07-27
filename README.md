# SaverAbi Performance Hub

Dark-mode FACEIT community leaderboard and Uniliga CS2 dashboard, deployed on Vercel.

## Features

- Progressive SaverAbi leaderboard with Elo and market-value sorting
- Player search, detail view, form indicators, and direct FACEIT links
- On-demand Leetify ratings and mechanics data in the player detail view
- Uniliga team standings and player-performance tables
- Responsive layout, keyboard-accessible tabs, and loading/error states
- Redis-backed API caching plus a daily Uniliga refresh

## Local setup

```bash
npm install
cp .env.example .env.local
npx vercel dev
```

Add the following values to `.env.local`:

```dotenv
FACEIT_API_KEY=
LEETIFY_API_KEY=
REDIS_URL=
```

Create the Leetify key at [leetify.com/app/developer](https://leetify.com/app/developer).
It stays server-side and is optional for local development, but recommended for
reliable production limits. Leetify profiles are fetched on demand and are not
stored in Redis or browser storage.

## Validation

```bash
npm test
npm audit
```

## Deployment

Vercel deploys the connected GitHub branch. The scheduled refresh runs daily at `04:00 UTC` and rebuilds the same Uniliga snapshot served by `/api/uniliga-stats`.
