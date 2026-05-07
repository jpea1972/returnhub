# ADR-0002: Keep Current index.html + server.js Architecture

**Status:** Accepted
**Date:** 2026-04-22

## Context

ReturnHub is a single-page application with one HTML file, 20+ JS modules loaded via script tags, and one Express server.js file (~2,500 lines). There is no build step, no bundler, no framework.

This architecture was questioned during multi-merchant and WMS builds — should we migrate to React, split server.js into route modules, or add a build pipeline?

## Decision

Keep the current architecture. ReturnHub is a warehouse operations tool, not a consumer web app. The team adding features is small (1-2 developers + AI assistance). The app works, deploys in 60 seconds, and can be fully understood by reading two files.

## Consequences

- Fast iteration: change a file, push, live in 60 seconds
- No build step complexity
- Any developer can understand the full app quickly
- server.js will continue growing (currently ~2,500 lines)
- No TypeScript, no component reuse, no tree-shaking

## Alternatives Considered

- **React/Next.js**: Too much overhead for a warehouse tool with 10 users
- **Split server.js into route modules**: Reasonable future improvement but not blocking
- **Add build pipeline (Vite/webpack)**: Adds complexity with no user benefit
