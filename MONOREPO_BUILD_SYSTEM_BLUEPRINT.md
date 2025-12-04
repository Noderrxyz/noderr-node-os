# Monorepo Build System Blueprint

This document outlines the architectural blueprint for a robust and scalable TypeScript monorepo build system for the `noderr-node-os` repository.

## 1. Root `tsconfig.json`

The root `tsconfig.json` file will be responsible for defining the project references, which will determine the build order of the packages.

```json
{
  "files": [],
  "references": [
    { "path": "./packages/types" },
    { "path": "./packages/utils" },
    { "path": "./auth-api" },
    { "path": "./deployment-engine" }
  ]
}
```

## 2. `tsconfig.base.json`

The `tsconfig.base.json` file will contain the shared compiler options and path aliases for all packages in the monorepo.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "composite": true,
    "types": ["node", "jest"],
    "baseUrl": ".",
    "paths": {
      "@noderr/types": ["packages/types/src"],
      "@noderr/utils": ["packages/utils/src"],
      "@noderr/auth-api": ["auth-api/src"],
      "@noderr/deployment-engine": ["deployment-engine/src"]
    }
  }
}
```

## 3. Package `tsconfig.json` Files

Each package in the monorepo will have its own `tsconfig.json` file that extends the base configuration and specifies its own local settings.

### `packages/types/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### `packages/utils/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"],
  "references": [
    { "path": "../types" }
  ]
}
```

### `auth-api/tsconfig.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"],
  "references": [
    { "path": "../packages/types" },
    { "path": "../packages/utils" }
  ]
}
```

### `deployment-engine/tsconfig.json`

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"],
  "references": [
    { "path": "../packages/types" },
    { "path": "../packages/utils" }
  ]
}
```

## 4. Root `package.json`

The root `package.json` file will contain a single, authoritative `build` script that uses `tsc --build` to build the entire monorepo in the correct order.

```json
{
  "name": "@noderr/node-os",
  "private": true,
  "workspaces": [
    "packages/*",
    "auth-api",
    "deployment-engine"
  ],
  "scripts": {
    "build": "tsc --build",
    "clean": "pnpm -r exec rimraf dist"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "rimraf": "^5.0.0"
  }
}
```

## 5. Package `package.json` Files

All `prepare` scripts will be removed from the individual `package.json` files.
