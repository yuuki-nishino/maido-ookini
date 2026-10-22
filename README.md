# 毎度おおきに（maido-ookini）

> イベントの注文管理、まいど、サクッと

文化祭・縁日・マルシェなど、**イベントでの飲食物販売**のための、注文受付・呼び出し番号・売上管理のWebアプリです。スマホ・タブレットのブラウザで動き、**Firebaseの無料枠（Sparkプラン）だけで運用できます**。決済は行いません（現金とPayPayの記録のみ）。

## 何ができるか

- **注文の受付**：メニューを選んで合計金額を表示。メニューごとの販売数・金額を記録します
- **呼び出し番号とQR**：全注文に番号を振り、待ちが出る注文にはQRを発行。お客様はスマホで読むと、自分の番号と状況（調理中／できあがり／お渡し済み）を見られます
- **調理ステータス**：スタッフが「完成」「渡した」を押すと、お客様のスマホに反映されます
- **売上集計とレジ締め**：日別に現金とPayPayを分けて集計。レジ締めでは、あるはずの現金と数えた現金の差額を確認できます
- **メニュー管理・在庫**：追加・編集・売り切れ切替・並べ替え。商品ごとに在庫を持て、足りないときは予約注文として受けられます
- **イベントの共有**：Googleアカウントでログインし、イベントにメンバーを招待して、共同で運営できます

## 2つの画面

| 画面 | 使う人 | 特徴 |
|---|---|---|
| スタッフ用（`/`） | 店のスタッフ | PWA。Googleログインが必要 |
| お客様用（`/customer.html`） | お客様 | QRから開く状況ページ。ログイン不要で、軽さを優先 |

## 技術構成

- フロント：Vite + TypeScript + [Preact](https://preactjs.com/)（`@preact/signals`）
- バックエンド：Firebase（Authentication・Cloud Firestore・Hosting）。自前のサーバーや Cloud Functions は使わず、アクセス制御はすべて `firestore.rules`
- テスト：Vitest、Firebase Emulator Suite

## 動かしてみる

必要なもの：Node.js 24（`.nvmrc`）、Java 21 以上（ルールのテストとEmulatorに使います）

```sh
npm ci
npm run emulators   # 別のターミナルで：Auth・Firestore・Hosting のEmulator
npm run dev:emu     # 開発サーバー（Emulatorに接続）
```

スタッフ用は `http://localhost:5173/`、お客様用は `/customer.html` で開けます（ポートは起動時の表示に従ってください）。

主なコマンド：

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | 型チェック |
| `npm run lint` | Lint |
| `npm test` | 単体テスト ＋ セキュリティルールのテスト ＋ データアクセスの結合テスト |
| `npm run build` | 型チェック ＋ ビルド |

自分のFirebaseプロジェクトにつなぐ場合は、`.env.example` をもとに `.env.development` を作ります（Firebaseの設定値は、リポジトリに入れません）。

## ドキュメント

仕様・設計・設計判断は、すべて [docs/](./docs/README.md) にあります。まずは次の順に読むと全体がわかります。

1. [docs/SPEC.md](./docs/SPEC.md)：何を作るか（要件・決定事項）
2. [docs/DESIGN.md](./docs/DESIGN.md)：どう作るか（構成・データ・ルール・画面・テスト）
3. [docs/adr/](./docs/adr/)：設計判断の記録

## 開発の進め方

Issue駆動で、1 Issue ＝ 1 PR で進めています。ブランチ名・コミットの書き方・マージの条件は、[CLAUDE.md](./CLAUDE.md) にまとめています。

## ライセンス

未設定です。
