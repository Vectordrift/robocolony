# Contributing to RoboColony

Thanks for your interest in contributing! RoboColony is early-stage and we welcome contributions of all kinds.

## Getting Started

```bash
git clone https://github.com/Vectordrift/robocolony.git
cd robocolony
npm install
cp .env.example .env   # edit with your PostgreSQL connection
npx drizzle-kit push   # apply schema
npm test               # run tests
npm run dev            # start dev server (http://localhost:3000)
```

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- A running Postgres instance (local or cloud)

## Development Workflow

1. **Find an issue** — check [open issues](https://github.com/Vectordrift/robocolony/issues) labeled `good first issue` or `help wanted`
2. **Fork & branch** — `git checkout -b feat/your-feature`
3. **Write tests first** — every feature needs tests (Vitest)
4. **Implement** — keep PRs focused and small
5. **Run tests** — `npm test` must pass
6. **Open a PR** — reference the issue with `Closes #N`

## Code Style

- TypeScript strict mode
- Fastify for HTTP, Drizzle ORM for database
- Tests colocated: `src/**/__tests__/*.test.ts`
- Descriptive names over comments
- No `any` types — use proper typing

## Project Structure

```
src/
├── server.ts              # Fastify app setup + route registration
├── db/
│   ├── index.ts           # Drizzle client
│   └── schema/            # Database tables (one file per entity)
├── engine/
│   ├── hex.ts             # Hex grid math (cube coordinates)
│   ├── mapgen.ts          # World map generation (seeded noise)
│   └── noise.ts           # Simplex noise implementation
├── lib/
│   └── auth.ts            # API key generation + hashing
├── middleware/
│   └── auth.ts            # Authentication middleware
└── routes/
    ├── health.ts          # Health check endpoint
    └── worlds.ts          # World + colony endpoints
```

## Testing

```bash
npm test              # run all tests once
npm run test:watch    # watch mode
```

Tests use Vitest. For database tests, mock the db layer — don't require a live database.

## Commit Messages

Use conventional commits:

```
feat: add resource production engine
fix: hex distance calculation off by one
docs: update API endpoint documentation
test: add combat resolution tests
```

## Questions?

Open a [discussion](https://github.com/Vectordrift/robocolony/discussions) or file an issue. We're friendly.

## License

By contributing, you agree that your contributions will be dual-licensed under MIT and Apache 2.0.
