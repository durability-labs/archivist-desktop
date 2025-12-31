# CI/CD Setup Guide

This document explains the CI/CD infrastructure for Archivist Desktop.

## Overview

The project uses GitHub Actions for continuous integration and deployment with the following workflows:

- **CI Workflow** (`.github/workflows/ci.yml`) - Runs on every push and PR
- **Release Workflow** (`.github/workflows/release.yml`) - Builds and publishes releases

## CI Workflow

### Jobs

1. **frontend-test** - Tests TypeScript/React code
   - Type checking with `tsc`
   - Linting with ESLint
   - Unit tests with Vitest

2. **backend-test** - Tests Rust code (runs on Linux, macOS, Windows)
   - Format checking with `cargo fmt`
   - Linting with `cargo clippy`
   - Unit tests with `cargo test`
   - Build verification

3. **security-audit** - Security scanning
   - Rust dependencies with `cargo audit`
   - npm packages with `pnpm audit`

4. **integration-build** - Full app build test
   - Downloads sidecar binary
   - Builds complete Tauri application
   - Verifies cross-platform compatibility

5. **coverage** (optional) - Code coverage reporting
   - Generates coverage reports with `cargo-tarpaulin`
   - Uploads to Codecov

### Running Locally

Before pushing code, run these checks locally:

```bash
# Frontend checks
pnpm tsc --noEmit      # Type check
pnpm lint              # Lint
pnpm test              # Run tests

# Backend checks
cd src-tauri
cargo fmt --check      # Format check
cargo clippy           # Lint
cargo test             # Run tests
```

## Release Workflow

### Creating a Release

1. Update version in `src-tauri/Cargo.toml` and `package.json`
2. Create and push a version tag:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. The workflow will:
   - Create a GitHub release (draft)
   - Build binaries for all platforms
   - Upload artifacts to the release
   - Publish the release

### Supported Platforms

- **macOS**: Intel (x86_64) and Apple Silicon (aarch64)
- **Linux**: x86_64
- **Windows**: x86_64

## Pre-commit Hooks

The project uses Husky for pre-commit hooks that run automatically before each commit.

### Setup

```bash
pnpm install  # Installs husky automatically
```

### What Gets Checked

- TypeScript type checking
- ESLint
- Frontend tests
- Rust formatting
- Cargo clippy
- Backend tests

### Bypassing Hooks (Not Recommended)

```bash
git commit --no-verify -m "message"
```

## Test Structure

### Frontend Tests

- Location: `src/test/*.test.tsx`
- Framework: Vitest + React Testing Library
- Configuration: `vitest.config.ts`
- Run: `pnpm test`

### Backend Tests

- Unit tests: Within `src-tauri/src/**/*.rs` files using `#[cfg(test)]`
- Integration tests: `src-tauri/tests/*.rs`
- Run: `cd src-tauri && cargo test`

## Adding New Tests

### Frontend Example

```typescript
// src/components/MyComponent.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MyComponent from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Backend Example

```rust
// src-tauri/src/services/my_service.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_function() {
        assert_eq!(my_function(), expected_value);
    }

    #[tokio::test]
    async fn test_async_function() {
        let result = async_function().await;
        assert!(result.is_ok());
    }
}
```

## Required Secrets

For the release workflow to work, configure these GitHub secrets:

- `TAURI_SIGNING_PRIVATE_KEY` - For code signing (optional)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Password for signing key (optional)

## Coverage Reports

Code coverage is tracked using:
- **Backend**: cargo-tarpaulin → Codecov
- **Frontend**: Vitest coverage → Codecov

View coverage at: https://codecov.io/gh/basedmint/archivist-desktop

## Troubleshooting

### CI Fails on Linux Dependencies

If the Linux build fails, ensure `.github/workflows/ci.yml` includes all system dependencies:
```yaml
- libwebkit2gtk-4.1-dev
- build-essential
- libgtk-3-dev
# ... etc
```

### Pre-commit Hook Fails

1. Check which step failed in the output
2. Run that step manually to see detailed errors
3. Fix the issue and try committing again

### Tests Pass Locally But Fail in CI

- Ensure you've pushed all changes
- Check for environment-specific issues (file paths, etc.)
- Review CI logs for specific error messages

## Best Practices

1. **Always run tests before pushing**: `pnpm test && cd src-tauri && cargo test`
2. **Keep CI fast**: Optimize slow tests, use caching
3. **Fix broken builds immediately**: Don't let failures pile up
4. **Write tests for new features**: Maintain coverage levels
5. **Review CI logs**: Understand why builds pass or fail

## Maintenance

### Updating Dependencies

```bash
# Frontend
pnpm update

# Backend
cd src-tauri
cargo update
```

### Updating Workflows

When modifying workflows:
1. Test changes in a feature branch first
2. Use `act` to test GitHub Actions locally (optional)
3. Monitor first run carefully after merge

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Tauri CI Guide](https://tauri.app/v1/guides/building/cross-platform)
- [Vitest Documentation](https://vitest.dev)
- [Cargo Test Documentation](https://doc.rust-lang.org/cargo/commands/cargo-test.html)
