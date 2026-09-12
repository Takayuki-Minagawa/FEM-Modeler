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
- **名前付き選択** - native generatorやimporterが確定トポロジを提供する範囲で、ボディ・面・辺・頂点をIDベースで選択
- **strictソルバ出力** - OpenSeesPy / DOLFINx / OpenFOAM の解析ケースscopeと能力範囲を事前検査し、exporterが実際に消費したIDをmanifestへ記録してZIP出力
- **検証エンジン** - 共通ルール + ソルバ別ルールで不足・不整合を自動検出
- **テンプレート** - 5種を実ソルバーで実行し、別途用意した解析解を持つ小モデル・SI/mm表示系・MPIで回帰検証
- **インポート** - 元単位を明示するSTLファイル (ASCII/バイナリ)、プロジェクトJSON。1 MiB以上のSTL・結果CSV/JSONはWorkerで処理
- **可搬プロジェクト** - IR・STL資産・整合性manifestを`.fem.zip`で保存・再読込
- **ボディ編集** - 移動・回転・スケール・表示/非表示切替をGUIで操作、エクスポートにも反映
- **線形パターン複製** - 選択ボディをオフセット指定で一括複製 (トポロジ完全クローン + Undo/Redo対応)
- **Undo / Redo** - Immerの操作patchを直接記録。複数ボディ削除を1操作で復元し、大きな未変更資産を共有
- **自動保存 / データ復元** - IndexedDBで複数プロジェクト・保存世代を管理。復元待ち保護、STL重複排除、別タブ更新の競合検知
- **エクスポート履歴** - エクスポート結果 (成功/警告/エラー) を下部パネルで一覧表示
- **ファイルバリデーション / マイグレーション** - 読込時にZodスキーマで検証し、旧バージョンのファイルも自動マイグレーション
- **ダーク/ライトモード** - テーマ切替対応
- **多言語対応** - 日本語 (デフォルト) / 英語
- **CAE補助** - メッシュ事前推定、実メッシュ品質・境界tag、保存できる3メッシュGCI検討、細長比・Re・Bi・Fo評価
- **条件・結果表示** - ケース別条件と材料、荷重矢印、対象ズーム、節点IDを照合した変形図・スカラーコンター・probe
- **結果の入力照合** - プロジェクト・ケース・ソルバー・SI入力SHA-256・実行IDを照合。熱・質量・力・モーメント収支と残差を生値から再評価
- **寸法の再編集** - box / plate / cylinderを再生成し、対応する面・辺・頂点の参照を維持
- **PWA** - 初回オンライン読込後にアプリシェルと利用済みチャンクを同一オリジンへキャッシュ

---

## 対応ソルバ

| ソルバ | 用途 | 出力形式 |
|--------|------|----------|
| **OpenSeesPy** | 構造解析 (フレーム・トラス) | Python スクリプト + CSV (ZIP) |
| **DOLFINx** | 連続体解析 (弾性・熱伝導) | Gmsh .geo + Python テンプレート (ZIP) |
| **OpenFOAM** | 単一channelの定常・層流・非圧縮 `simpleFoam` | ケースディレクトリ一式 (ZIP) |

## パラメトリック形状 (9種)

| 形状 | 用途 |
|------|------|
| 直方体 (Box) | 汎用ソリッド |
| 円柱 (Cylinder) | 汎用ソリッド |
| パイプ (Pipe) | 中空円筒 |
| 平板 (Plate) | DOLFINx 熱/弾性 |
| 穴あき平板 (Plate with Hole) | DOLFINx 弾性 |
| L字ブラケット (L-Bracket) | モデリング・表示（現行DOLFINx strict export対象外） |
| 2Dフレーム | OpenSeesPy 骨組 |
| 2Dトラス | OpenSeesPy トラス |
| 流路 (Channel) | OpenFOAM 流体 |

## プロジェクトテンプレート (5種)

テンプレートを選ぶと形状・材料・断面・境界条件・荷重・解析ケースが自動生成されます。5テンプレートの実行検証と、解析解を持つ5つの小モデルの数値検証を分けて実施しています。対象バージョン・許容差・実測結果は [ソルバー検証](solver-tests/README.md) を参照してください。

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
| ビルドツール | Vite 8 |
| 状態管理 | Zustand + Immer |
| 3Dビューワー | Three.js (@react-three/fiber + drei) |
| UI | Tailwind CSS 4 |
| フォーム / バリデーション | React共通入力部品 + Zodのドメイン別schema |
| ローカル永続化 | IndexedDB (idb) |
| 多言語 | i18next + react-i18next |
| テスト | Vitest + Playwright + uv/pytest + Docker内の実ソルバー |
| CI/CD | GitHub Actions → GitHub Pages |

---

## はじめに

### 必要な環境

- Node.js 20.19 以上、または22.12以上
- npm
- Python検証にはuv。実ソルバーの回帰検証にはDocker（Linux/amd64イメージ）も必要です

### ローカルで実行

```bash
git clone https://github.com/Takayuki-Minagawa/FEM-Modeler.git
cd FEM-Modeler
npm ci
npm run dev
```

ブラウザで `http://localhost:5173/FEM-Modeler/` を開きます。

### ビルド

```bash
npm run build     # dist/ に出力
npm run preview   # ビルド結果をプレビュー
```

### コードチェック

生成Pythonの構文検査もuvで実行するため、最初にロック済み検証環境を準備します。

```bash
uv sync --locked --project solver-tests/openfoam
npm run typecheck  # TypeScript 型チェック
npm run lint       # ESLint
npm run test       # テスト実行
npm run check      # 上記すべてを実行
npm run test:coverage
npm run audit
npm run build && npm run bundle:check
```

---

## 入出力

### インポート

| 形式 | 説明 |
|------|------|
| `.fem.json` | FEM Modeler プロジェクトファイル |
| `.fem.zip` | IR・STL資産・整合性manifestを含むプロジェクトバンドル |
| `.stl` | STL形状ファイル (ASCII / バイナリ)。STL自体に単位情報がないため、読込時に元単位を選択 |

グローバルバーの「インポート」ボタンまたはドラッグ&ドロップで読み込みます。

### エクスポート

| 形式 | 説明 |
|------|------|
| OpenSeesPy (ZIP) | Python スクリプト + 節点/要素CSV + マニフェスト |
| DOLFINx (ZIP) | Gmsh .geo + Python テンプレート + マニフェスト |
| OpenFOAM (ZIP) | ケースディレクトリ一式 (0/ constant/ system/) + マニフェスト |
| `.fem.json` | プロジェクト保存 (再読込可能) |
| `.fem.zip` | プロジェクトバンドル (STLを分離格納し、読込時にサイズ・ハッシュ・三角形数・bounds・診断情報を再検証) |
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
├── assets            # 永続化されたSTL資産と診断情報
├── named_selections  # 名前付き選択 (条件割当の基盤)
├── materials         # 材料物性
├── sections          # 断面情報 (梁・トラス用)
├── mesh_controls     # メッシュ方針 (全体/局所/品質目標)
├── boundary_conditions # 境界条件
├── loads             # 荷重
├── initial_conditions  # 初期条件
├── analysis_cases    # 解析ケース
├── results           # ResultIR、実メッシュ・節点ID・保存則チェック
├── convergence_studies # 3メッシュ比較の条件・出典・評価点
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
| 共通 | strict schema、参照整合性、選択次元、材料・断面の物理範囲、荷重方向、メッシュ設定、well-posedness |
| OpenSeesPy | 解析ケース、厳密なframe graph、断面・材料割当、BC/荷重、結果要求 |
| DOLFINx | 対応primitive、物理tag、材料割当、BC/荷重の弱形式、MPI集約 |
| OpenFOAM | 単一channel、2D/3D patch、速度/圧力BC、粘性、解析ケース |

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
- 各ソルバは選択解析ケースの対応外形状・物理・割当・BC・荷重・メッシュ意図・結果要求を暗黙に無視せずstrict errorにする
- solver packageにはcoverage/manifest、`run.sh`、構文・メッシュ事前検査を含める

### 静的配信・ローカル完結

- バックエンドに依存しない
- ユーザーデータは外部に送信しない
- service workerの初回インストール後はキャッシュ済みアプリシェルと利用済みチャンクでオフライン編集・保存・読込が可能

### 解析上の注意

- 出力ZIPの生成成功は、外部ソルバでの解析成功や工学的妥当性を保証しません。`run.sh`とmanifestを使い、対象ソルバの対応versionで必ずdry-runと結果照合を行ってください。
- メッシュの事前推定と、取込パッケージが持つ実測品質を区別して表示します。品質指標は定義・単位・生成元と一緒に保存し、未測定の値を合格扱いにしません。
- 結果CSV・保存則manifest・共通メッシュJSONを取り込めます。入力照合が不十分な結果はpartial扱いで、現在モデルへの重ね描きには使いません。ファイル中の成功フラグを信用せず、供給された生値と許容差から評価します。SHA-256は入力の同一性確認用で、解析の正しさやファイルの署名を保証するものではありません。
- 別メッシュの結果は同じ物理入力の場合に限り、明示選択して収束検討用に保存できます。手入力は「未検証」と記録します。点の比較は同じ座標の節点で行い、自動補間はしません。
- 汎用VTK/XDMFや任意のOpenFOAM結果ディレクトリの直接読込は対象外です。生成ソルバーパッケージが出力する共通JSONの仕様は [結果パッケージ](docs/result-package.md) を参照してください。

---

## 保存・履歴の上限

Undoは最大100操作・推定64 MiBです。単一操作が容量を超える場合はその操作のUndo履歴を保持できません。大きな資産を削除する前にはプロジェクトファイルを保存してください。自動保存はプロジェクトごとに最大5世代、ブラウザー内全体で128 MiBを上限とし、古い世代から整理します。ブラウザーの容量不足は保存エラーとして表示します。別タブの更新との競合時は上書きを停止し、保存済み版の復元または別ファイルへの保存で内容を確認できます。

## ローカル検証と公開

```bash
npx playwright install chromium
npm run test:e2e          # 本番buildで操作・保存・オフライン復元を確認
npm run test:performance  # 変更前後の履歴・保存負荷を測定
npm run test:solvers      # Dockerで生成run.shを実行（uvを使用）
npm run test:solvers:verify # 続けて数値の許容差を検証（必須）
```

通常のpush・PRではGitHub Actionsを起動しません。型・lint・単体テスト・coverage・audit・build・bundleと、変更領域のE2E/実ソルバー試験をローカルで通し、PRレビュー後にマージします。GitHub Pagesはmainに対して `Verify and deploy GitHub Pages` を手動実行すると、品質ゲートを再確認して公開します。

測定結果と検証範囲は [実装・検証記録](docs/verification.md)、性能比較は [マイクロベンチマーク](tests/performance/README.md) を参照してください。

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
