# FEM Modeler

[![CI / Deploy](https://github.com/Takayuki-Minagawa/FEM-Modeler/actions/workflows/deploy.yml/badge.svg)](https://github.com/Takayuki-Minagawa/FEM-Modeler/actions/workflows/deploy.yml)

**FEM/CAE Pre-processing Web Application**

ブラウザ上で動作する有限要素法 (FEM) / CAE 解析モデルの前処理支援アプリケーションです。
形状作成から境界条件設定、メッシュ方針の定義、各種ソルバ向けファイル出力までをWebブラウザだけで完結できます。

**Live Demo:** [https://takayuki-minagawa.github.io/FEM-Modeler/](https://takayuki-minagawa.github.io/FEM-Modeler/)

---

## 特徴

- **静的Webアプリ** - サーバー不要。GitHub Pagesで配信
- **ローカル完結** - データはブラウザ内に保持。外部送信なし
- **3Dビューワー** - Three.js ベースのインタラクティブな3D表示・選択
- **共通中間表現 (IR)** - ソルバ非依存のJSON形式でプロジェクトを管理
- **名前付き選択** - 面・辺・体積に意味のある名前を付け、条件設定の基盤とする
- **3ソルバ出力** - OpenSeesPy / DOLFINx / OpenFOAM へZIP一括出力
- **検証エンジン** - 共通ルール + ソルバ別ルールで不足・不整合を自動検出
- **テンプレート** - 5種のプロジェクトテンプレートで即座に開始
- **インポート** - STLファイル (ASCII/バイナリ)、プロジェクトJSON
- **Undo / Redo** - 全操作の取り消し・やり直し対応
- **ダーク/ライトモード** - テーマ切替対応
- **多言語対応** - 日本語 (デフォルト) / 英語

---

## 対応ソルバ

| ソルバ | 用途 | 出力形式 |
|--------|------|----------|
| **OpenSeesPy** | 構造解析 (フレーム・トラス) | Python スクリプト + CSV (ZIP) |
| **DOLFINx** | 連続体解析 (弾性・熱伝導) | Gmsh .geo + Python テンプレート (ZIP) |
| **OpenFOAM** | 流体解析 (非圧縮流) | ケースディレクトリ一式 (ZIP) |

## パラメトリック形状 (9種)

| 形状 | 用途 |
|------|------|
| 直方体 (Box) | 汎用ソリッド |
| 円柱 (Cylinder) | 汎用ソリッド |
| パイプ (Pipe) | 中空円筒 |
| 平板 (Plate) | DOLFINx 熱/弾性 |
| 穴あき平板 (Plate with Hole) | DOLFINx 弾性 |
| L字ブラケット (L-Bracket) | DOLFINx 弾性 |
| 2Dフレーム | OpenSeesPy 骨組 |
| 2Dトラス | OpenSeesPy トラス |
| 流路 (Channel) | OpenFOAM 流体 |

## プロジェクトテンプレート (5種)

テンプレートを選ぶと形状・材料・断面・境界条件・荷重・解析ケースが自動生成されます。

| テンプレート | 内容 |
|---|---|
| 2Dフレーム | 鋼材SS400 + H形断面 + 固定支持 + 水平荷重 (OpenSeesPy) |
| 2Dトラス | 鋼材 + 丸鋼断面 (OpenSeesPy) |
| ソリッド平板 | 穴あき平板 + 鋼材 (DOLFINx 線形弾性) |
| 熱伝導 | 平板 + 鋼材 (DOLFINx 定常熱) |
| チャネル流れ | 流路 + 水 + 入口/出口BC (OpenFOAM simpleFoam) |

---

## 技術スタック

| 分類 | 採用技術 |
|------|----------|
| フレームワーク | React 19 + TypeScript |
| ビルドツール | Vite 6 |
| 状態管理 | Zustand + Immer |
| 3Dビューワー | Three.js (@react-three/fiber + drei) |
| UI | Tailwind CSS 4 |
| フォーム | react-hook-form + zod |
| 多言語 | i18next + react-i18next |
| テスト | Vitest |
| CI/CD | GitHub Actions → GitHub Pages |

---

## はじめに

### 必要な環境

- Node.js 20 以上
- npm

### ローカルで実行

```bash
git clone https://github.com/Takayuki-Minagawa/FEM-Modeler.git
cd FEM-Modeler
npm install
npm run dev
```

ブラウザで `http://localhost:5173/FEM-Modeler/` を開きます。

### ビルド

```bash
npm run build     # dist/ に出力
npm run preview   # ビルド結果をプレビュー
```

### コードチェック

```bash
npm run typecheck  # TypeScript 型チェック
npm run lint       # ESLint
npm run test       # テスト実行
npm run check      # 上記すべてを実行
```

---

## 入出力

### インポート

| 形式 | 説明 |
|------|------|
| `.fem.json` | FEM Modeler プロジェクトファイル |
| `.stl` | STL形状ファイル (ASCII / バイナリ) |

グローバルバーの「インポート」ボタンまたはドラッグ&ドロップで読み込みます。

### エクスポート

| 形式 | 説明 |
|------|------|
| OpenSeesPy (ZIP) | Python スクリプト + 節点/要素CSV + マニフェスト |
| DOLFINx (ZIP) | Gmsh .geo + Python テンプレート + マニフェスト |
| OpenFOAM (ZIP) | ケースディレクトリ一式 (0/ constant/ system/) + マニフェスト |
| `.fem.json` | プロジェクト保存 (再読込可能) |
| `.csv` | 条件一覧 (材料・断面・境界条件・荷重) |
| `.md` | 入力サマリー Markdown |

---

## アーキテクチャ

### レイヤー構成

```
UI層 (React コンポーネント)
  ├─ 3Dビューワー (Three.js / R3F)
  └─ フォーム / ツリー / パネル
        ↓
状態管理層 (Zustand + Immer)
  └─ 共通中間表現 (IR)  ← 正本データ
        ↓
  ┌─────────┬──────────┐
検証ルール層  │  エクスポート層
  │         │  ├─ OpenSeesPy
  │         │  ├─ DOLFINx
  │         │  └─ OpenFOAM
```

### 共通中間表現 (IR)

アプリ内部のデータは **ソルバ非依存のJSON形式 (IR)** で一元管理されます。

```
ProjectIR
├── meta              # プロジェクト情報、スキーマバージョン
├── units             # 単位系 (SI, mm-N-s, mm-t-s)
├── geometry          # 形状、トポロジ (ボディ/面/辺/頂点)
├── named_selections  # 名前付き選択 (条件割当の基盤)
├── materials         # 材料物性
├── sections          # 断面情報 (梁・トラス用)
├── mesh_controls     # メッシュ方針 (全体/局所/品質目標)
├── boundary_conditions # 境界条件
├── loads             # 荷重
├── initial_conditions  # 初期条件
├── analysis_cases    # 解析ケース
├── solver_targets    # 出力先ソルバ設定
└── validation        # 検証結果
```

### 画面構成

4ペイン構成のデスクトップ向けレイアウト:

| 位置 | 内容 |
|------|------|
| 左 | プロジェクトツリー (11カテゴリ) |
| 中央 | 3Dビューワー (メイン作業領域) |
| 右 | プロパティフォーム / 条件設定 |
| 下部 | 検証結果 / ログ / エクスポート結果 |

### 検証エンジン

エクスポート前に自動検証を実行します。

| カテゴリ | チェック内容 |
|----------|-------------|
| 共通 | プロジェクト名、ジオメトリ有無、未使用選択、未割当材料、物性不足、対象なしBC/荷重 |
| OpenSeesPy | フレーム形状、断面定義、支持条件、断面-材料紐付け |
| DOLFINx | ソリッド形状、境界タグ、材料 |
| OpenFOAM | 流体領域、入口/出口BC、流体材料 |

### キーボードショートカット

| キー | 操作 |
|------|------|
| `Ctrl+Z` | 元に戻す |
| `Ctrl+Shift+Z` | やり直し |
| `Ctrl+S` | プロジェクト保存 |
| `Delete` | 選択ボディ削除 |
| `Escape` | 選択解除 |

---

## 設計方針

### データの正本はIR

OpenSeesPy / DOLFINx / OpenFOAM 向けの出力はすべて生成物であり、正本ではありません。
保存と再編集は必ず共通IR (JSON) を基準に行います。

### 名前付き選択を中心に条件を管理

材料、境界条件、荷重、メッシュ方針は **名前付き選択** に紐付けます。
削除時はcascade deleteにより参照整合性を維持します。

### 検証を重視

- 単位整合性、必須入力、参照整合性を常時チェック
- ソルバ別の不足項目を出力前に検出
- 不完全な出力を成功扱いにしない

### 静的配信・ローカル完結

- バックエンドに依存しない
- ユーザーデータは外部に送信しない
- オフラインでもプロジェクト編集・保存・読込が可能

---

## コントリビュート

1. このリポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/your-feature`)
3. コードチェックを通す (`npm run check`)
4. コミットしてプッシュ
5. Pull Request を作成

---

## ライセンス

[MIT License](LICENSE)

---

## 参考

- [OpenSeesPy Documentation](https://openseespydoc.readthedocs.io/)
- [DOLFINx Documentation](https://docs.fenicsproject.org/)
- [OpenFOAM User Guide](https://www.openfoam.com/documentation/user-guide)
- [Three.js](https://threejs.org/) / [React Three Fiber](https://r3f.docs.pmnd.rs/)
