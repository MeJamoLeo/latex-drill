# TODO

残タスク一覧（2026-07-31 時点）。優先度順ではなくカテゴリ順。出典は
Fable 5 のデザイン診断×3回・Store 公開調査・verifier レビュー。

## Store 提出（P0 — これを全部潰せば提出できる。計 1.5〜2 日）

- [ ] **UI の英語化**（明文の却下事由）
  - realtime.tsx: 「リセット」「問題を選ぶ」「この行をスキップ」「お手本をコピー」「完成！ ⌘R でもう一回」・navigationTitle の「行」
  - surface.ts: 「正確さ」「行 x/y」・完走スコア文言
- [ ] **バイナリパスの preferences 化＋未導入案内**（Video Downloader 方式）
  - latex / dvipng / magick の 3 パスを preferences に（デフォルト `/opt/homebrew/bin`）
  - 起動時 `existsSync` 検出 → 未導入なら Detail で `brew install texlive imagemagick` 案内
  - Intel Mac (`/usr/local/bin`) と MacTeX (`/Library/TeX/texbin`) が動機
- [ ] **スクリーンショット 3 枚**（2000×1250 PNG、`metadata/` に配置）
- [ ] **CHANGELOG.md**（`## [Initial Version] - {PR_MERGE_DATE}` 形式）
- [ ] **package.json 整備**
  - `author` を Raycast アカウントのユーザー名に（"treo" で合っているか要確認）
  - `platforms: ["macOS"]` 追加
  - `"lint": "ray lint"` / `"publish": "npx @raycast/api@latest publish"` 追加
  - `npm run build && npm run lint` をクリーンに
- [ ] icon のライト/ダーク両テーマ確認（必要なら差し替え）
- [ ] PR 本文に ZWSP 番兵ハックの設計意図説明を用意（レビュー往復の短縮）
- [ ] 提出は**指摘に即応できる週**に（PR は 14 日放置で stale、21 日でクローズ）

## ゲーム機能（Fable Top3 の残り）

- [ ] **弱点レビュー＋自己ベスト永続化**（中・半日）
  - 打鍵ごとに (char, ms, miss) を記録
  - 完走画面に「遅かった/ミスったトークン Top3」と PB 差分（Raycast LocalStorage）
  - 問題スキーマに `focus: string[]`（トークン族タグ）を足して接続
- [ ] **cloze（穴あき）モード**（中）
  - 灰ソースの一部（required のトークン）を `▁▁▁` で隠すだけ
  - 入力は依然お手本と完全一致＝プリコンパイル不変条件を保ったまま検索練習
- [ ] 完全リコールモード（大・cloze の後）
  - プローズだけ見て自由入力。プリコンパイル不変条件を壊すので
  - ライブコンパイル＋自由入力採点の別アーキテクチャが必要
- [ ] プローズ⇄行の対応ハイライト（`proseMap` スキーマ拡張）
  - 今アクティブな行が英文のどの文に対応するか見えるように

## 磨き残し（小粒）

- [ ] doc 画像の上端 fade グラデ（tail-crop で文字が水平にぶった切れる見た目の緩和）
- [ ] `environment.appearance` のテーマ分岐を実機で確認（ライト⇄ダーク切替後は問題再選択が必要な仕様の妥当性）
- [ ] 問題追加時の手順を docs 化（JSON 1 枚 → `tests/latex.test.ts` が自動検証、の流れ）

## 判断待ち・再訪条件

- [ ] **ネイティブヘルパー（CGEventTap で検索バー撤廃）は棚上げ中**。再訪条件:
  - (a) Raycast 拡張 API に検索バー非表示 or 生キーイベントが来た場合
  - (b) 2 週間の日常使用後もプレイ**中**にバー行が意識に上る場合
  - 再訪時も「遅延を検証する捨てプロトタイプ → 合格なら本実装」の 2 段階で
- [ ] 2 週間遊んでから Store 提出するか最終判断（弱点レビューの欲しさも体感で校正）

## プロジェクト外（claude-obsidian 側）

- [ ] verifier エージェント定義（.claude/agents/verifier.md）に「ビルド実行禁止・
  git は読み取りコマンド限定」を明文化（2026-07-31 のステージ破壊事故の再発防止）
