# Git Commit Rules

このプロジェクトのコミットメッセージは **Conventional Commits 1.0.0** に従う。

## フォーマット

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Type（必須）

| Type | 用途 |
|------|------|
| `feat` | 新機能の追加 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみの変更 |
| `style` | フォーマット等、コードの動作に影響しない変更 |
| `refactor` | バグ修正でも機能追加でもないコード変更 |
| `perf` | パフォーマンス改善 |
| `test` | テストの追加・修正 |
| `chore` | ビルド/補助ツール/設定など雑多な変更 |
| `build` | ビルドシステム・依存関係の変更（pnpm, vite, wrangler 等） |
| `ci` | CI 設定の変更（GitHub Actions 等） |
| `revert` | 以前のコミットの取り消し |

## Scope（任意）

変更箇所を示す名詞。例: `auth`, `api`, `ui`, `worker`, `biome`。
モノレポでない場合や明確に絞れない場合は省略可。

## Subject（必須）

- **命令形・現在形**で書く（"add" not "added" / "adds"）
- **小文字**で始める（固有名詞は除く）
- **末尾にピリオドを打たない**
- 50 文字以内が目安、72 文字を超えない
- 「何を変更したか」を簡潔に表す

## Body（任意）

- subject から空行を 1 行空ける
- **What / Why** を書く（How はコード自体が示すので不要）
- 1 行 72 文字で折り返す
- 複数段落・箇条書き可

## Footer（任意）

- `BREAKING CHANGE: <説明>` 破壊的変更
- `Closes #123` / `Refs #456` issue 参照
- `Co-Authored-By: Name <email>` 共同作業者（AI 含む）

## Breaking Change

破壊的変更は次のいずれか（または併用）で示す:

1. type/scope の後ろに `!`: `feat(api)!: remove deprecated endpoint`
2. footer に `BREAKING CHANGE: <説明>`

## 良い例

```
feat(auth): add OAuth2 login flow

Replace legacy session-based auth with OAuth2 to support SSO with
Google and GitHub providers.

Closes #142
```

```
fix: prevent race condition in cache invalidation

Multiple workers could write to the cache simultaneously, causing
inconsistent reads. Wrap writes in a per-key mutex.
```

```
chore: bump astro to 5.18.1
```

```
refactor!: rename `getUser` to `fetchUser`

BREAKING CHANGE: All consumers must update import names.
```

## 悪い例 → 直し方

| ❌ NG | ✅ OK |
|------|------|
| `update files` | `fix: handle empty array in user list` |
| `Fixed bug.` | `fix: prevent null deref on missing config` |
| `feat: Added a new feature for user authentication system.` | `feat(auth): add OAuth2 login` |
| `wip` を main に push | ローカルブランチに留め、push 前に squash/rewrite |

## ベストプラクティス

- **1 コミット = 1 論理的変更**。複数の関心事を混ぜない
- リファクタ・フォーマットは feat/fix とは別コミット
- AI と共同作業した場合は `Co-Authored-By:` を付ける
- 長文の理由は body に。subject は要約のみ
- 同種の細かい修正コミットが連続したら squash を検討
- pre-commit hook (Biome) が auto-fix した変更は同じコミットに含める（`stage_fixed`）
