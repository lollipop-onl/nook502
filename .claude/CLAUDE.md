# nook502

Astro (TypeScript, SSR) を Cloudflare Workers Static Assets で稼働させる Web アプリケーション。

## Tech Stack

- **Runtime**: Cloudflare Workers（Workers Static Assets 方式）
- **Framework**: Astro 5（`output: "server"`）
- **Adapter**: `@astrojs/cloudflare` v12
- **Language**: TypeScript（`astro/tsconfigs/strict` 継承）
- **Lint/Format**: Biome v2
- **Git Hooks**: Lefthook v1
- **Deploy**: Wrangler v4
- **Package Manager**: pnpm v10（Node 24 想定）

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Astro dev server（`http://localhost:4321`） |
| `pnpm build` | Astro build → `dist/.assetsignore` 生成 |
| `pnpm preview` | build 後 `wrangler dev` でローカル Workers 実行 |
| `pnpm deploy` | build 後 `wrangler deploy` で本番デプロイ |
| `pnpm typecheck` | `astro check`（TS 型チェック） |
| `pnpm lint` | `biome check`（lint + format チェック） |
| `pnpm fix` | `biome check --write`（auto-fix） |
| `pnpm cf-typegen` | `wrangler types` で `Env` 型を再生成 |

## Architecture

```
nook502/
├── src/
│   ├── env.d.ts          # App.Locals に Cloudflare Runtime を注入
│   └── pages/            # Astro routing（file-based）
├── scripts/
│   └── postbuild.mjs     # dist/.assetsignore 生成
├── astro.config.mjs      # @astrojs/cloudflare adapter 設定
├── biome.jsonc           # Biome v2 設定
├── lefthook.yml          # Git hooks（pre-commit / pre-push）
├── wrangler.jsonc        # Cloudflare Workers 設定
└── tsconfig.json         # astro/tsconfigs/strict 継承
```

## Key Files

- `astro.config.mjs` - `output: "server"` + `imageService: "compile"`（Workers runtime に sharp 不可）
- `wrangler.jsonc` - `main: ./dist/_worker.js/index.js`、`assets.binding: "ASSETS"`、`compatibility_flags: ["nodejs_compat"]`
- `scripts/postbuild.mjs` - `_worker.js` と `_routes.json` を assets から除外する `dist/.assetsignore` を生成
- `src/env.d.ts` - `App.Locals` に `Runtime<Env>` を流し込む型定義
- `worker-configuration.d.ts` - `wrangler types` 生成物（gitignore 済み）

## Code Style

- **Indent**: スペース 2、Line Width 100、LF
- **Quotes**: JS/TS はダブルクオート、JSON は trailing comma なし
- **Imports**: Biome の `organizeImports` で自動整理
- **`.astro` は Biome 対象外**: template 内の `{var}` 参照を解析できず誤検知するため除外。必要なら `prettier-plugin-astro` を別途導入

## Git Workflow

- コミットメッセージは `.claude/rules/git-commit.md` の **Conventional Commits** ルールに従う
- `pre-commit`: 変更ファイルに `biome check --write` 実行 → auto-fix を `stage_fixed` で再ステージ
- `pre-push`: `pnpm typecheck`（`astro check`）

## Gotchas

- **`.assetsignore` は必須**: `dist/_worker.js/` は server コード。static asset として公開してはいけない。`pnpm build`（`astro build` + `node scripts/postbuild.mjs`）を経由すること。`astro build` 直叩きは NG。
- **Astro 6 / `@astrojs/cloudflare` v13 はまだ採用しない**: v13 は `@cloudflare/vite-plugin` ベースの新ビルド方式に移行し、`wrangler.jsonc` の `main` をソースに向ける必要がある。エコシステム安定まで 5 + 12 を維持。
- **pnpm 10 の build script 承認**: `package.json` の `pnpm.onlyBuiltDependencies` に `lefthook` 等を含めないと postinstall が走らず Git hooks が設置されない。新規 deps で postinstall が必要なら追加する。
- **`wrangler types` の再実行**: `wrangler.jsonc` の bindings を変更したら必ず `pnpm cf-typegen` を実行。`worker-configuration.d.ts` は gitignore 済みなので CI でも生成する前提。
- **sharp は build time only**: Workers runtime に sharp は無い → `imageService: "compile"` で prerender 時のみ最適化。動的画像処理が必要なら Cloudflare Images を検討。
- **Cloudflare KV `SESSION` 警告**: アダプターが Sessions 機能向けに自動有効化する。使わない場合は無視で OK。使う場合は `wrangler.jsonc` に `kv_namespaces` で `SESSION` バインディングを追加。

## Environment

- `wrangler login` で OAuth 認証（deploy 時）
- ローカル secret は `.dev.vars`（gitignore 済み）
- 本番 secret は `wrangler secret put <name>`
- bindings は `wrangler.jsonc` に追記 → `pnpm cf-typegen` で型反映
