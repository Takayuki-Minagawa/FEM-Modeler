# FEM Modeler

**FEM/CAE Pre-processing Web Application**

ブラウザ上で動作する有限要素法 (FEM) / CAE 解析モデルの前処理支援アプリケーションです。
形状作成から境界条件設定、メッシュ方針の定義、各種ソルバ向けファイル出力までをWebブラウザだけで完結できます。

**Live Demo:** [https://mina25.github.io/FEM-Modeler/](https://mina25.github.io/FEM-Modeler/)

---

## 特徴

- **静的Webアプリ** - サーバー不要。GitHub Pagesで配信可能
- **ローカル完結** - データはブラウザ内に保持。外部送信なし
- **3Dビューワー** - Three.js ベースのインタラクティブな3D表示・選択
- **共通中間表現 (IR)** - ソルバ非依存のJSON形式でプロジェクトを管理
- **名前付き選択** - 面・辺・体積に意味のある名前を付け、条件設定の基盤とする
- **複数ソルバ対応** - 1つのモデルから複数ソルバへ出力可能
- **Undo / Redo** - 全操作の取り消し・やり直し対応

## 対応ソルバ

| ソルバ | 用途 | 出力形式 |
|--------|------|----------|
| **OpenSeesPy** | 構造解析 (フレーム・トラス) | Python スクリプト + CSV |
| **DOLFINx** | 連続体解析 (弾性・熱伝導) | Gmsh MSH + Python テンプレート |
| **OpenFOAM** | 流体解析 (非圧縮流) | ケースディレクトリ一式 (ZIP) |

## 対応形状 (初期版)

直方体 / 円柱 / パイプ / 平板 / 穴あき平板 / L字ブラケット / 梁・柱・フレーム / トラス / 2D領域 / 単純流路

---

## 技術スタック

| 分類 | 採用技術 |
|------|----------|
| フレームワーク | React 19 + TypeScript |
| ビルドツール | Vite 6 |
| 状態管理 | Zustand + Immer |
| 3Dビューワー | Three.js (@react-three/fiber + drei) |
| UIコンポーネント | shadcn/ui + Radix UI |
| CSS | Tailwind CSS 4 |
| フォーム | react-hook-form + zod |
| テスト | Vitest + Playwright |

---

## はじめに

### 必要な環境

- Node.js 20 以上
- npm

### ローカルで実行

```bash
git clone https://github.com/mina25/FEM-Modeler.git
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

### テスト

```bash
npm run test
```

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
各ソルバへの出力はすべてこのIRから生成されます。

```
ProjectIR
├── meta            # プロジェクト情報、スキーマバージョン
├── units           # 単位系 (SI, mm-N-s, mm-t-s)
├── geometry        # 形状、トポロジ (ボディ/面/辺/頂点)
├── named_selections # 名前付き選択 (条件割当の基盤)
├── materials       # 材料物性
├── sections        # 断面情報 (梁・トラス用)
├── mesh_controls   # メッシュ方針 (全体/局所/品質目標)
├── boundary_conditions # 境界条件
├── loads           # 荷重
├── initial_conditions  # 初期条件
├── analysis_cases  # 解析ケース
├── solver_targets  # 出力先ソルバ設定
└── validation      # 検証結果
```

### 画面構成

4ペイン構成のデスクトップ向けレイアウト:

| 位置 | 内容 |
|------|------|
| 左 | プロジェクトツリー / 名前付き選択一覧 |
| 中央 | 3Dビューワー (メイン作業領域) |
| 右 | プロパティフォーム / 条件設定 |
| 下部 | 検証結果 / ログ / エクスポート結果 |

---

## 設計方針

### データの正本はIR

OpenSeesPy / DOLFINx / OpenFOAM 向けの出力はすべて生成物であり、正本ではありません。
保存と再編集は必ず共通IR (JSON) を基準に行います。

### 名前付き選択を中心に条件を管理

材料、境界条件、荷重、メッシュ方針は **名前付き選択** に紐付けます。
例: `fixed_face`, `inlet`, `outlet`, `frame_col_01`

### 検証を重視

- 単位整合性、必須入力、参照整合性を常時チェック
- ソルバ別の不足項目を出力前に検出
- 不完全な出力を成功扱いにしない

### 静的配信・ローカル完結

- バックエンドに依存しない
- ユーザーデータは外部に送信しない
- オフラインでもプロジェクト編集・保存・読込が可能

---

## ロードマップ

- [x] **Phase 1** - IR定義、UI骨格、3Dビューワー基本、プロジェクト保存/読込
- [ ] **Phase 1** - パラメトリック形状、名前付き選択システム
- [ ] **Phase 2** - 材料/断面/境界条件/荷重フォーム、検証エンジン
- [ ] **Phase 3** - メッシュ方針設定、OpenSeesPy / DOLFINx / OpenFOAM エクスポータ
- [ ] **Phase 4** - テンプレート、一括I/O、性能改善、UX研磨

---

## ライセンス

MIT License

---

## 参考

- [OpenSeesPy Documentation](https://openseespydoc.readthedocs.io/)
- [DOLFINx Documentation](https://docs.fenicsproject.org/)
- [OpenFOAM User Guide](https://www.openfoam.com/documentation/user-guide)
- [Three.js](https://threejs.org/) / [React Three Fiber](https://r3f.docs.pmnd.rs/)
