# FEM Modeler コードレビュー／リファクタリング・機能ロードマップ

> レビュー日: 2026-07-15
> 対象コミット: `e7a73ab` (`main`)
> 対象: `src/`、`tests/`、ビルド・Lint・型設定、GitHub Actions
> 規模: TypeScript/TSX 68ファイル、約10,038行

## 1. 結論

コードベースには、共通IR、ソルバ別エクスポータ、検証ルール、Zodによる読込、Zustand/Immer、IndexedDB自動保存など、拡張に適した土台がある。型チェック・Lint・既存30テスト・本番ビルドもすべて成功している。

一方、現在の最大リスクはコードの長さや重複ではなく、**IR/UIで入力した解析モデルと、生成されるソルバモデルが一致しない場合があること**である。未対応入力を無視・推測・既定値置換しても出力できるため、生成ZIPは現段階では「実行可能性が保証された解析モデル」ではなく「編集が必要なテンプレート」として扱うのが安全である。

最優先の順序は次のとおり。

1. 未対応入力・推測フォールバックを strict export で禁止する。
2. 単位を正本化し、表示とソルバ出力で次元変換を保証する。
3. 解析ケース中心のコンパイラと、厳密なトポロジ／割当解決を導入する。
4. 各ソルバを実際に動かす物理ベンチマークをCIへ追加する。
5. その後にメッシュ可視化、結果取込、収束確認を追加する。

## 2. 確認結果

| 確認項目 | 結果 | 補足 |
|---|---:|---|
| `npm run check` | 成功 | TypeScript、ESLint、7テストファイル・30テストが成功 |
| `npm run build` | 成功（警告あり） | main JS 1,525.00 kB、gzip 427.38 kB。設定済みの1,500 kB閾値も超過 |
| `npm audit --omit=dev` | 0件 | production依存には検出なし |
| `npm audit` | 6件 | high 2 / moderate 3 / low 1。直接dev依存のVite 8.0.2を含む |
| 外部ソルバ実行 | 未実施 | OpenSeesPy、Gmsh/DOLFINx、OpenFOAMによる生成物の実行確認は現行CIにもない |
| UI手動／E2E／a11y | 未実施 | コンポーネント・ブラウザ・キーボード操作テストは未整備 |

## 3. 現状の良い点

- TypeScript `strict`、未使用変数検査、ESLint、Vitestを `npm run check` に集約し、GitHub Actionsでも実行している（[package.json](package.json#L7)、[tsconfig.app.json](tsconfig.app.json#L19)、[deploy.yml](.github/workflows/deploy.yml#L19)）。
- UI、IR、geometry、validation、export、persistenceのディレクトリ境界が明瞭で、ソルバ非依存IRを正本にする方針は妥当である（[ProjectIR](src/core/ir/types.ts#L31)）。
- 形状複製や座標変換が純粋関数として分離され、単体テストがある（[editing.ts](src/geometry/editing.ts#L31)、[body-transform.test.ts](tests/unit/export/body-transform.test.ts#L8)）。
- プロジェクト読込の既定値補完、エラー整形、旧版対応の枠組みと、IndexedDB自動保存の分離はよい出発点である。
- body／named selection削除でcascadeを意識しており、これを中央の参照整合性サービスへ発展させやすい（[store.ts](src/state/store.ts#L248)）。
- Three.jsのgeometry生成に `useMemo`、Canvasに `frameloop="demand"` を使っている（[GeometryRenderer.tsx](src/viewer/GeometryRenderer.tsx#L94)、[ViewerCanvas.tsx](src/viewer/ViewerCanvas.tsx#L19)）。

## 4. 優先度の定義

| 優先度 | 意味 |
|---|---|
| P0 | 解析対象・境界条件・単位・生成モデルが入力と異なり、誤解析や実行不能を成功扱いし得る。リリースゲート相当 |
| P1 | データ破損、参照不整合、保守性、検証不足、性能劣化につながる。P0後に優先対応 |
| P2 | UX、アクセシビリティ、ドキュメント、最適化など。基盤修正と並行可能 |

## 5. P0: 先に是正すべき解析上の問題

### P0-01. ソルバ能力と解析ケースを中心にexportを再設計する

**確認事項**

- UIは非線形、モーダル、過渡解析、`pisoFoam` などを選択できる（[AnalysisCaseForm.tsx](src/ui/forms/AnalysisCaseForm.tsx#L8)）。
- OpenSeesPyは常に線形静解析（[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L258)）、DOLFINxはproject domainまたはthermal BCの有無だけで定常熱／線形弾性を選ぶ（[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L37)）、OpenFOAMは常に`simpleFoam`・定常計算（[openfoam/exporter.ts](src/export/openfoam/exporter.ts#L260)）。
- `participating_*_ids`、`nonlinear`、`transient`、`result_requests` は各exporterで使われない（[AnalysisCase](src/core/ir/types.ts#L521)）。
- 各exporterは先頭のbody/material/sectionを使い、複数bodyやassignmentを無視する（[OpenSeesPy](src/export/openseespy/exporter.ts#L25)、[DOLFINx](src/export/dolfinx/exporter.ts#L19)、[OpenFOAM](src/export/openfoam/exporter.ts#L76)）。
- solver別validationは`enabled=false`ならskipするが、Exportボタンは算出した`enabled`を`disabled`へ反映していない（[ExportForm.tsx](src/ui/forms/ExportForm.tsx#L113)、[ExportForm.tsx](src/ui/forms/ExportForm.tsx#L140)）。無効targetを押すと、そのtarget固有検証を経ずにexportできる。

**推奨リファクタリング**

`compile({ analysisCaseId, solverTarget, mode: 'strict' })` を唯一のexport入口にし、次の段階へ分ける。

1. `capabilities`: 対応domain、analysis、BC、load、material、mesh、resultを宣言。
2. `resolve`: analysis caseから参加body/material/section/BC/load/ICとassignmentを厳密に解決。
3. `validate`: 未対応、未割当、重複、参照切れ、値域違反を検出。
4. `render`: 検証済みのsolver-specific modelのみを文字列化。
5. `package`: ZIP、manifest、実行手順を生成。

strictモードでは、activeなIR項目が1つでも未消費ならerrorにする。推測を許す場合は別の`preview/template`モードとし、生成物とUIに明示する。

**完了条件**

- 選択した解析ケースがソルバ、アルゴリズム、参加条件、結果要求を支配する。
- 未対応の解析タイプはUIで選択不可、またはexport時に明確に停止する。
- requested targetの検証を必ず実行し、他targetのエラーではブロックしない。
- manifestに「消費したIR ID」「無視したIR ID（strictでは0件）」を記録する。

### P0-02. 単位の正本化と次元変換

**確認事項**

- `setUnitSystem`はunit presetを置換するだけで数値を変換しない（[store.ts](src/state/store.ts#L203)）。
- 材料ライブラリはSI値（例: 鋼材 `E=2.05e11 Pa`, `rho=7850 kg/m³`）を保持する（[material-library.ts](src/lib/material-library.ts#L20)）。
- 非SIでは同じ値を`MPa`や`kg/mm³`として表示する（[MaterialForm.tsx](src/ui/forms/MaterialForm.tsx#L25)）。`mm-t-s`でも密度表示はkgのままである。
- Load UIはpressure以外をすべてN表示するため、重力、線荷重、熱源、質量流量などの次元が誤る（[LoadForm.tsx](src/ui/forms/LoadForm.tsx#L28)、[LoadForm.tsx](src/ui/forms/LoadForm.tsx#L99)）。
- exporterは裸の数値をそのまま使用し、OpenFOAMは常に`convertToMeters 1`を出力する（[openfoam/exporter.ts](src/export/openfoam/exporter.ts#L124)）。

**影響**

長さ、密度、ヤング率、熱伝導率、圧力などが最大で数桁から12桁程度ずれ、見かけ上は解けても物理的に別問題になる。

**推奨リファクタリング**

- 内部値はcanonical SIで保持し、`Quantity<Dimension>`または少なくとも物理量ごとの変換registryを導入する。
- UIは表示単位との相互変換、solver adapterはsolver単位系への変換だけを担当する。
- BC/load/materialをdiscriminated union化し、型ごとに必要な次元を固定する。
- 単位変更は1 transactionとし、変換前後の確認、audit entry、Undoを提供する。
- `mm-N-s`等の基礎単位が力・質量・長さの次元式を満たすか検証する。

**完了条件**

同じ物理モデルをSI／mm系で保存・再読込・exportしても、solverへ渡るSI換算値とベンチマーク結果が許容差内で一致する。

### P0-03. トポロジ、名前付き選択、割当を厳密に対応させる

**確認事項**

- Named Selection UIではface/edge/vertexボタンが無効で、body選択だけを実装している（[NamedSelectionsForm.tsx](src/ui/forms/NamedSelectionsForm.tsx#L102)）。viewer clickもbody IDのみを選択する（[GeometryRenderer.tsx](src/viewer/GeometryRenderer.tsx#L26)）。
- DOLFINxは選択面を抽出した後に`1..N`へ再採番するため、例えば3番目の面1枚を選んでもSurface 1になる（[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L97)）。さらに配列順をGmsh surface tagと仮定している。
- material/section assignmentはIRとUIに存在するが、exporterは先頭要素だけを使う（[MaterialAssignment](src/core/ir/types.ts#L277)、[SectionAssignment](src/core/ir/types.ts#L310)）。
- OpenSeesPyは選択を解決できない場合、名前の正規表現や最下端／最上端nodeへ黙ってfallbackする（[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L294)）。

**推奨リファクタリング**

- face/edge/vertex/node pickingと、選択種別ごとのハイライトを実装する。
- BC/load/material/section/mesh controlごとに許可するentity dimensionを定義し、選択UIとvalidationの両方で制限する。
- IR entity IDからGmsh/OpenSees/OpenFOAM entityへの確定マップを構築し、順序・名称・座標guessをstrict exportから排除する。
- assignmentの未割当領域、重複、override優先順位を解決する共通domain serviceを設ける。

**完了条件**

各面・辺・節点を個別に選択したgolden testで、生成されたsolver tagとBC/load対象が必ず同じentityを指す。

### P0-04. 各ソルバの物理マッピングを正す

#### DOLFINx

- 熱RHSと弾性RHSは常に0で、`ir.loads`を使わない（[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L156)、[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L181)）。
- `heat_flux`と`convection`は未実装で、現在は0温度Dirichletへ落ちる（[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L317)）。入力した熱問題とは別問題になる。
- `pipe`、`lBracket`、`imported_stl`等の未対応形状を既定Boxへ置換する（[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L49)）。

対応: body force、traction、pressure、heat source、volumetric heat、Neumann heat flux、Robin convectionを弱形式へ実装する。未実装型・未対応形状はerrorとする。Poisson比、材料値、剛体モード／熱nullspaceもpreflightする。

#### OpenSeesPy

- truss要素はviewerの結線ではなく「simplified」な別結線を生成する（[generators.ts](src/geometry/primitives/generators.ts#L273)、[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L100)）。
- 全要素にsection tag 1を与え、先頭section/materialを使う。2D曲げ剛性の軸も明示的に解決していない（[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L78)、[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L120)）。
- pressure、traction、line/body load、gravityもすべてnodal forceとして処理し、面積・長さ・体積積分をしない（[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L177)）。
- prescribed displacementの値を出力せず、0固定として扱う（[openseespy/exporter.ts](src/export/openseespy/exporter.ts#L139)）。
- frame templateは荷重と支持を同じ`support_base`へ割り当てるため、固定nodeへ水平荷重を載せる（[project-templates.ts](src/lib/project-templates.ts#L42)）。

対応: geometry edge graphを正本としてnode-element graphを構築し、assignment単位でsection/materialを付与する。load typeごとの等価節点荷重／要素荷重、prescribed値、複数BCのDOF mergeを実装する。`ops.analyze()`戻り値と反力釣合も確認する。

#### OpenFOAM

- z方向セル数を最低2にする一方、front/backを`empty`にする（[openfoam/exporter.ts](src/export/openfoam/exporter.ts#L118)、[openfoam/exporter.ts](src/export/openfoam/exporter.ts#L176)）。2Dの`empty`条件と格子が矛盾する。
- `0/p`はkinematic pressureの次元だが、IR/UI側でdynamic/kinematic pressureを区別せず密度換算もしない（[openfoam/exporter.ts](src/export/openfoam/exporter.ts#L221)）。
- 常に先頭fluid body、先頭fluid material、`simpleFoam`を使い、solver hintや複数領域を無視する。

対応: 2Dなら法線方向1 cell、3Dならfront/backをwall/symmetry/patchにする明示モードを設ける。pressure種別をIRで区別し、`p_dynamic = rho * p_kinematic`を保証する。`blockMesh && checkMesh`をsmoke testにする。

### P0-05. STLと解析形状を永続化する

**確認事項**

- STLの実geometryはmodule-level `Map`だけにあり、IRにはfile nameとtriangle count程度しか残らない（[stl-loader.ts](src/geometry/import/stl-loader.ts#L31)、[stl-geometry-cache.ts](src/geometry/import/stl-geometry-cache.ts#L3)）。
- JSON保存はIRだけをserializeする（[save.ts](src/export/project/save.ts#L3)）。
- 再読込、draft復元、複製後のcache missではunit Boxを表示する（[GeometryRenderer.tsx](src/viewer/GeometryRenderer.tsx#L99)）。DOLFINx exportでも既定Boxになる。

**推奨リファクタリング**

- `asset_ref`とcontent hashをIRに持たせ、raw STLまたはvertex/index dataをIndexedDBとproject ZIPの`assets/`へ保存する。
- load、duplicate、delete、undo/redoにassetのclone/reference count/disposeを統合する。
- watertight、manifold、法線、退化三角形、自己交差、寸法をpreflightし、surface-only STLをsolid解析へ出さない。
- asset欠落時はBoxで代用せず`unresolved`としてexportを停止する。

**完了条件**

STL import → save → reload → duplicate → exportのround-trip後もgeometry hash、bounds、triangle countが一致する。

### P0-06. テンプレートを実行可能なベンチマークにする

**確認事項**

- truss templateには支持と荷重がない（[project-templates.ts](src/lib/project-templates.ts#L73)）。
- solid／thermal templateにはBCとloadがなく（[project-templates.ts](src/lib/project-templates.ts#L89)）、弾性は剛体モード、定常熱は温度nullspaceを持つ。
- DOLFINxのBCなしはwarningなので、物理的に不定なケースをexportできる（[dolfinx validation](src/validation/rules/dolfinx.ts#L15)）。
- Start画面は「3D Truss」と表示するが、実体は`truss2d`である（[StartScreen.tsx](src/ui/dialogs/StartScreen.tsx#L19)、[project-templates.ts](src/lib/project-templates.ts#L73)）。

**推奨**

片持ち梁／portal frame、既知トラス、plate-with-hole、1D定常熱、Poiseuille channelなどへ置き換え、各テンプレートに期待QoIと許容差を持たせる。CIで生成→solver実行→変位・反力・温度・流量を比較する。

## 6. P1: 設計・保守性のリファクタリング

### R-01. IR更新をtransaction／Command APIへ統一する（優先度P1、工数M）

- 通常actionは`saveBefore/saveAfter`を通るが（[store.ts](src/state/store.ts#L139)）、Mesh formはUIから直接`setState`し、Undo履歴を迂回する（[MeshControlForm.tsx](src/ui/forms/MeshControlForm.tsx#L22)）。templateのsolver切替も直接更新する（[project-templates.ts](src/lib/project-templates.ts#L153)）。
- template適用は多数のactionに分かれ、1操作が複数Undoになる。

`mutateIR(label, recipe)`またはcommand dispatcherで、mutation、`updated_at`、Undo、validation dirty、autosave通知、auditを1回で処理する。`store.ts`はproject/geometry/material/conditions/analysis/UI sliceと純粋domain reducerへ分割する。

### R-02. Undo/Redoを全量JSON snapshotからpatchへ移す（P1、M）

- 各変更でIR全体のbefore/afterを`JSON.stringify`し最大100件保持する（[undo-redo.ts](src/state/middleware/undo-redo.ts#L21)）。
- 多くのフォームは入力1文字ごとにstore更新し、Applyは閉じるだけである。自動保存でも変更ごとに全量serializeしてサイズを測る（[useProjectDraftPersistence.ts](src/hooks/useProjectDraftPersistence.ts#L24)）。

Immer patch/inverse patch、連続入力のcoalescing、form local draft→Applyの1 commitを採用する。大型assetはhistory本体へ複製せずhash referenceとする。serializeはidle callbackまたはWorkerへ移す。

### R-03. 参照整合性をrelation graphで中央管理する（P1、M）

- material削除はassignmentだけを消し、`Section.material_id`やanalysis case参照を残す（[store.ts](src/state/store.ts#L359)）。section/BC/load/IC削除、named selection cascadeでも`participating_*_ids`が残る（[AnalysisCase](src/core/ir/types.ts#L521)）。
- 一般的なforeign-key、一意ID、重複assignment検証がない。

全entity relationとcascade/restrict方針を1か所に定義し、`deleteEntityCascade`と`validateReferences`を純粋関数化する。追加・更新時もID存在、重複、dimension、domain整合を検証する。

### R-04. IRとZod schemaをdiscriminated unionから生成する（P1、L）

- `GeometryBody.metadata`、BC/load payload、solver optionsが`Record<string, unknown>`またはoptional field集合で、不正な組合せを表現できる（[types.ts](src/core/ir/types.ts#L134)、[BCValues](src/core/ir/types.ts#L411)）。
- 読込schemaはunion/enumを意図的に`z.string()`で受け、最後に`as ProjectIR`する（[project-file-schema.ts](src/export/project/project-file-schema.ts#L1)、[project-file-schema.ts](src/export/project/project-file-schema.ts#L582)）。
- 未来versionも現行versionへ上書きして「migration」とし、未知fieldを失う可能性がある（[project-file-schema.ts](src/export/project/project-file-schema.ts#L564)）。draft復元はschema自体を通らない（[project-draft-storage.ts](src/lib/project-draft-storage.ts#L97)）。

`LegacyProjectSchema -> version別migration chain -> strict CurrentProjectSchema`の2段階にする。未来versionは拒否し、最終TypeScript型は`z.infer`から得る。shape/material/BC/load/analysisは判別unionとし、未知形状やpayloadを既定値へ落とさない。

### R-05. validationを存在確認から物理・数値・安定性検証へ拡張する（P1、L）

現状は主に存在とnullを確認し、exporter側がE/A/I/nu/k/viscosityを既定値へ置換する（[common validation](src/validation/rules/common.ts#L42)、[OpenSees defaults](src/export/openseespy/exporter.ts#L120)、[DOLFINx defaults](src/export/dolfinx/exporter.ts#L28)）。

最低限、次を追加する。

- 物性: `E>0`, `rho>0`, `k>0`, `cp>0`, `mu>0`, `nu_visc>0`, `-1 < Poisson < 0.5`、`mu ≈ rho * nu_visc`。
- 断面: `A/I/J/thickness>0`、断面寸法からの再計算一致。
- 形状: integer divisions、inner radius < outer radius、穴が母材内、finite座標、zero-length禁止。
- 参照: ID一意、全FK存在、entity type/dimensionとBC/load用途の一致。
- 構造: connectivity、拘束rank、mechanism、剛体モード、荷重方向nonzero。
- 熱: Dirichlet/Robinの存在、純Neumann問題の互換条件。
- CFD: patch完全被覆、重複なし、圧力reference、inlet/outlet、2D/3D整合。

validation結果には`modelRevision/validatedRevision`を持たせ、編集後は古い「検証OK」を表示せず「未検証」にする。validation IDも`Date.now()`だけでなくrule+targetの安定キーにする（[validation/types.ts](src/validation/types.ts#L8)）。

### R-06. assetとI/O境界を堅牢化する（P1、M）

- binary STLはheaderのtriangle countをbuffer長・上限確認前に巨大TypedArrayへ使う（[stl-loader.ts](src/geometry/import/stl-loader.ts#L62)）。JSON/STLとも全量読込でサイズ上限がない。
- STLの`file.arrayBuffer()`失敗はtry外で、void呼出しのためunhandled rejectionになり得る（[ImportDialog.tsx](src/ui/dialogs/ImportDialog.tsx#L26)）。
- IndexedDB open失敗後、rejected `dbPromise`をresetせずretryできない（[project-draft-storage.ts](src/lib/project-draft-storage.ts#L41)）。

file size、triangle count、`84 + 50*n`厳密長、finite座標、0 triangleを検証し、Worker、progress、cancelを追加する。全I/O境界を`try/catch/finally`で統一し、破損draftは共通loaderで検証後に隔離／削除確認を行う。

### R-07. solver向け識別子・CSV・Markdownを安全にescapeする（P1、S〜M）

- Gmsh physical名、OpenFOAM patch名などへ外部projectの任意文字列を直接展開する（[dolfinx/exporter.ts](src/export/dolfinx/exporter.ts#L102)、[openfoam/exporter.ts](src/export/openfoam/exporter.ts#L43)）。quote、改行、braceで生成物を破損でき、利用者が生成scriptを実行するワークフローではsource/dictionary injection経路になる。
- CSVはRFC 4180 escapeがなく、通常のvector値だけでもcommaで列が崩れる。名称先頭が`=`, `+`, `-`, `@`ならspreadsheet formulaとして解釈され得る（[csv-export.ts](src/export/project/csv-export.ts#L18)）。

表示名とsolver IDを分離し、solver IDは`[A-Za-z_][A-Za-z0-9_]*`へslug化する。target別escape、comment改行除去、`sanitizeArtifactName`、`escapeCsvCell`、Markdown table escapeを共通化し、parse/syntax round-trip testを追加する。

### R-08. AppContextと描画範囲を分割する（P2、M）

theme、dialog、autosave、activity、export historyを1 Contextにまとめ、provider valueも毎render再生成する（[AppContext.tsx](src/contexts/AppContext.tsx#L10)）。IRの小変更がautosave hookを経由し、themeしか使わないViewerを含む広い再描画につながる。

Theme/Dialog/Persistence/Activity/Exportを分割するかZustand selectorへ統合し、action/valueをmemo化する。`GeometryRenderer`はbody単位にmemo化し、selected IDをSet化する。Line modelの一時CylinderGeometryをdisposeし、nodeは`InstancedMesh`を使う（[GeometryRenderer.tsx](src/viewer/GeometryRenderer.tsx#L173)）。

### R-09. UI stateの二重正本とdead stateを解消する（P2、S〜M）

ProjectIR内の`ui_state`とZustand transient stateがactive panel、selection等を重複保持するが同期していない（[UIState](src/core/ir/types.ts#L612)、[TransientState](src/state/store.ts#L37)）。`pickFilter`、`viewMode`、`displayMode`も実UIから使われない。

persist対象を明確にし、必要なUI stateだけhydrate/serializeする。load/new時はselection、hover、panel、STL cache等をリセットする。不要な将来fieldは実装までIRから外すかexperimental namespaceへ隔離する。

### R-10. 大型ファイルを分割し、設定registryを一元化する（P2、M）

- `types.ts` 679行、project schema 595行、store 591行、GeometryForm 545行、各exporter 360〜403行。
- panel key、label、component、countがLeft/Right sidebarへ重複する（[LeftSidebar.tsx](src/ui/layout/LeftSidebar.tsx#L4)、[RightSidebar.tsx](src/ui/layout/RightSidebar.tsx#L13)）。

domain別IR/schema/store slice、solver adapter、shape registry、panel registryへ分ける。Material/Section/BC/Loadの共通EditorCard、FieldRow、AssignmentPickerを抽出する。ただし、物理型とtransaction境界を決めてから機械的分割を行う。

## 7. P1/P2: テスト、CI、依存関係

### T-01. solver contract／benchmark testを最優先で追加する（P0相当）

現行export testはbody transformの文字列確認が中心で、物理内容、BC tag、単位、solver syntaxを確認しない（[body-transform.test.ts](tests/unit/export/body-transform.test.ts#L8)）。

追加するテスト:

- OpenSeesPy: 片持ち梁変位、トラス結線、prescribed displacement、反力と外力の釣合。
- DOLFINx/Gmsh: 各face tag、1D/2D熱伝導、traction付き弾性、Neumann/Robin、nullspace検出。
- OpenFOAM: `blockMesh`, `checkMesh`, Poiseuille流量、mass balance、2D/3D patch。
- 共通: 単位round-trip、assignment、unsupported capability、strict fallback禁止、project/draft future version、STL round-trip。
- property/fuzz: schema、ID/FK、STL header、生成識別子、CSV escape。

実ソルバが重い場合、PRではsyntax/light smoke、nightlyでfull benchmarkに分ける。

### T-02. UI／a11y／E2E gateを追加する（P2）

- 共通input/selectは見出しが`span`で、`label/id/aria-label`がない（[UnitInput.tsx](src/ui/forms/common/UnitInput.tsx#L21)、[SelectInput.tsx](src/ui/forms/common/SelectInput.tsx#L9)）。
- Import drop zoneはclickable `div`でkeyboard操作できず、dialogに`role="dialog"`、focus trap、Escape、focus returnがない（[ImportDialog.tsx](src/ui/dialogs/ImportDialog.tsx#L92)）。
- 3D選択はpointer中心で、同等のkeyboard entity treeがない。
- muted textの小文字contrastは現行色で約3.0:1となり、4.5:1を満たさない箇所がある（[index.css](src/index.css#L3)）。
- HTMLの`lang`は`ja`固定で、英語切替時に更新しない（[index.html](index.html#L2)、[GlobalBar.tsx](src/ui/layout/GlobalBar.tsx#L54)）。

Testing Library + axe、Playwright keyboard testを導入し、semantic label、dialog/tabs/live region、focus-visible、keyboard entity tree、contrastを検証する。

### T-03. build／dependency gateを強化する（P1〜P2）

- `vite.config.ts`でwarning閾値を1,500 kBへ上げても実測1,525 kBで、CIはwarningのまま通る（[vite.config.ts](vite.config.ts#L14)）。ExportFormが全exporter、JSZip、file-saverをeager importする（[ExportForm.tsx](src/ui/forms/ExportForm.tsx#L1)）。
- 2026-07-15時点の全依存auditは6件で、Vite 8.0.2のdev-server file read／deny bypass系high advisoryを含む。一方production-onlyは0件である（[package.json](package.json#L37)）。

panel／solverを`React.lazy`・`import()`で遅延ロードし、bundle budgetをCIの失敗条件にする。Viteとtransitive依存を修正版へ更新してlockを再生成し、`npm audit`、Dependabot、SBOMを追加する。dev serverを外部公開しない。GitHub ActionsのPages write／id-token権限はdeploy jobだけへ絞り、重要actionはcommit SHA pinを検討する（[deploy.yml](.github/workflows/deploy.yml#L10)）。

## 8. 有効な追加機能

| ID | 優先度 | 機能 | ユーザ価値／前提 |
|---|---:|---|---|
| F-01 | P1 | face/edge/vertex/node選択と自動Named Selection | BC、荷重、局所メッシュ、solver tagの基盤。平面・法線・位置による`x_min`, `inlet`, `hole_surface`自動選択が有効 |
| F-02 | P1 | solver capability／coverageレポート | 選択した解析で「対応・未対応・無視」を事前表示し、誤った期待を防ぐ。strict compilerが前提 |
| F-03 | P1 | mesh previewと品質評価 | 要素数、Jacobian、aspect、skewness、negative volume、境界tag件数、局所細分、boundary layerを可視化 |
| F-04 | P1 | solver dry-run package | version固定requirements/container、`run.sh`、Gmsh check、OpenFOAM checkMesh、Python syntax/import check、実行manifestを同梱 |
| F-05 | P1 | 共通ResultIRと結果再取込 | OpenSees CSV、XDMF/VTK、OpenFOAM fieldを取込み、変形、stress/strain、reaction、temperature、heat flux、velocity、pressureをcontour/probe表示 |
| F-06 | P1 | 保存則・収束チェック | `Σload + Σreaction`、熱収支、流入出mass imbalance、solver return code、residual、iterationを結果manifestへ記録 |
| F-07 | P2 | mesh convergence／benchmark assistant | h-refinement 3段階、QoI差、observed order、GCI、解析解比較を自動レポートし、単一meshの見かけの解を防ぐ |
| F-08 | P2 | 物理アドバイザ | slenderness、near-incompressible locking、Reynolds/CFL/y+、Biot/Fourier数を計算し、要素・solver・mesh候補を根拠値付きで提示 |
| F-09 | P2 | 断面計算・材料ライブラリ強化 | 寸法からA/I/Jを自動計算し、温度・単位・出典・適用範囲を保持。手入力不一致を警告 |
| F-10 | P2 | project bundle／PWA | `.fem.zip`へIR・STL・添付・manifestを収容。service workerを追加し、READMEのオフライン保証を実装 |
| F-11 | P2 | guided analysis wizard | geometry→selection→assignment→BC/load→well-posedness→exportのチェックリスト。未対応の初期条件・過渡解析は能力実装後に解放 |

## 9. 推奨実装順

### Stage 0: 安全策

1. solver出力をexperimental/template扱いと明示する。
2. requested targetのvalidationを必ず実行し、disabled targetのボタンを無効化する。
3. silent defaults、名前／座標heuristic、未対応analysis/BC/load/shapeをstrict exportでerrorにする。
4. frame/truss/solid/thermal/fluid templateの明白な不整合を修正する。

### Stage 1: 正本モデルの再構築

1. canonical unitsとquantity registry。
2. strict schema、判別union、version別migration。
3. transaction/Command API、relation graph、patch-based Undo。
4. analysis-case-centric compilerとsolver capability registry。
5. entity picking、確定topology tag、asset registry。

### Stage 2: 検証可能なsolver export

1. load/BC/material/section/meshの全マッピング。
2. 各テンプレートのgolden output。
3. 実ソルバsmoke testと解析解／参照解比較。
4. unit、reaction、conservation、solver return codeをmanifestへ記録。

### Stage 3: CAEワークフローの完成度向上

1. mesh preview／quality。
2. ResultIRと結果可視化。
3. conservation、convergence、physics advisor。
4. project bundle、PWA、アクセシビリティ、性能最適化。

## 10. リリース完了条件の提案

- [ ] strict exportでactiveなIR項目の未消費が0件。
- [ ] target、analysis case、body、material、section、BC、load、IC、meshの対応表がmanifestに残る。
- [ ] SIとmm系で同一ベンチマークの結果が許容差内で一致する。
- [ ] face/edge/node選択とsolver tagのgolden testが通る。
- [ ] 5つの標準テンプレートが実ソルバで終了コード0となり、期待QoIを満たす。
- [ ] 構造の反力釣合、熱収支、CFD mass balanceを自動確認する。
- [x] STL save/reload/duplicateでgeometry hash、bounds、三角形数、元単位が一致し、bundle読込時に再検証される。
- [x] project JSONとdraftが同じstrict validation/migration経路を通る。
- [ ] 1つのユーザー操作が1つのUndo transactionになる。
- [ ] production bundle budget、coverage、a11y、auditのCI gateが通る。

## 11. ドキュメント同期

- [x] READMEのNamed Selection説明を、確定トポロジが提供される範囲に限定した。
- [x] READMEのsolver対応表、L-Bracket、ResultIR、テンプレート、外部runtime検証範囲を実装と同期した。
- [x] service worker、web app manifest、同一originのruntime cache上限を実装し、PWA説明を同期した。
- [x] Start画面の表記を2D Trussへ統一した。

---

本レポートは静的コードレビューとローカル品質ゲートに基づく。外部ソルバのversion差や実行時挙動は、Stage 2のcontainer／CI smoke testで最終確認する必要がある。

## 12. 実装結果（2026-07-15）

本ロードマップに基づく今回の実装では、現行の対応範囲における危険なsilent fallbackの除去と、検証可能なワークフローの基盤を優先した。以下は「ロードマップ全体の完了」ではなく、今回実装したsupported contractの範囲である。

- canonical SIのquantity registry、表示単位変換、version別migration、unknown keyを拒否するcurrent Zod schemaと意味的refinement
- analysis-case中心のsolver capability／scope preflight、requested-target validation、exporter別の実消費ID／除外ID manifest
- native対応形状のbody/face/edge/vertex確定トポロジ選択と、主要な外部キー・dimension・重複割当のrelation validation
- STLの元単位、サイズ・三角形数・有限値・縮退・watertight/manifold検査、IR asset永続化、save/reload/duplicate、bundle改ざん検知
- OpenSeesPy frame/truss、DOLFINx単一primitive solid/thermal、OpenFOAM単一channel simpleFoamのstrict contractとdry-run package
- 5テンプレートの選択・割当・BC・荷重・解析ケース生成、およびアプリ内strict export contract test
- provenance付き数値CSV／JSON manifestの共通ResultIR取込、構造反力チェック、process statusと明示されたconvergence情報の分離
- メッシュ事前推定、3メッシュobserved order／Richardson／GCI、細長比／Re／Bi／Foアドバイザ
- `.fem.zip` project bundleとPWA service worker
- artifact名、solver ID、CSV、Markdownのescape／formula injection対策
- TypeScript、ESLint、Vitest、coverage、production build、bundle budget、dependency audit、SBOM、Dependabotを含む品質基盤
- Immer patch履歴によるUndo/Redo基盤。ただしtransaction前後の`structuredClone`は残り、すべてのUI入力が常に1操作1transactionになることは未完了

今回のローカル環境ではTypeScript、ESLint、Vitest、coverage、production build、bundle budget、dependency audit、CycloneDX SBOM生成を検証対象とした。Gmsh、OpenSeesPy、DOLFINx runtime、OpenFOAMは通常PATHに存在しないため、生成Pythonの構文検査を除く外部solver実行と基準QoI照合は未実施である。

リリース前の残存gateは、上記チェックリストに加えて、全shape/material/BC/loadを判別unionから導出する型設計、relation/cascade方針の完全な一元化、cloneを避けるUndo transaction、5テンプレートの実solver benchmark、SI/mm系の基準解一致、熱収支、CFD mass balance、XDMF/VTK/OpenFOAM fieldの完全なcontour、ブラウザa11y E2Eである。OpenFOAMの`run.sh`終了コード0はprocess成功のみを表し、数値収束は残差等から別途評価する。
