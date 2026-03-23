# ソルバ出力仕様書
## 対象: OpenSeesPy / DOLFINx / OpenFOAM

## 1. 目的

本書は、共通IRから各ソルバ向け成果物を生成するための出力仕様を定義する。  
対象は以下の3系統である。

- OpenSeesPy
- DOLFINx
- OpenFOAM

ここで定義するのは、単なるファイル生成手順ではなく、**何をどの粒度で対応させるか**、**どの条件で出力を許可または禁止するか**、**何を人へ明示すべきか** を含む実装仕様である。

---

## 2. 共通原則

### 2.1 出力元は必ずIR
出力ロジックは、フォーム状態や画面表示状態を直接読まず、必ずIRを入力とする。

### 2.2 ソルバ固有不足を明示する
IRが十分でも、特定ソルバの出力には追加条件が必要な場合がある。  
その場合は以下のどちらかを必ず行う。

- 不足を error として出力停止
- 許容可能な範囲で template export として warning 付き出力

### 2.3 サイレントフォールバック禁止
未対応の条件を無言で捨てない。  
削除・近似・置換を行う場合は、必ず出力レポートに記録する。

### 2.4 出力成果物には manifest を付ける
各ソルバ出力には、最低限以下を含む `export_manifest` 相当を付ける。

- export target
- export time
- source project name
- source schema version
- active analysis case
- included items
- omitted items
- warnings
- limitations

---

## 3. 出力レベル定義

## 3.1 strict
- 必要条件が全て満たされるまで出力しない
- 未確定値があれば停止する
- 実務向け

## 3.2 permissive
- 一部未確定値を placeholder として出力する
- warning を強く出す
- 教育・試作用

## 3.3 template_based
- 既存テンプレートへIRを流し込む
- OpenFOAMで特に有効
- 対応範囲外はテンプレート外として明示する

---

## 4. OpenSeesPy出力仕様

## 4.1 適用対象
優先対応:
- 2D frame
- 3D frame
- truss
- 基本的な nodal load
- 基本的な support condition
- 線形静解析
- 簡易動的時刻歴の雛形

初期版で非優先:
- 高度な非線形材料
- 接触
- シェル / ソリッドの広範対応
- 複雑な拘束関係の自動解釈

## 4.2 出力成果物
- Pythonスクリプト本体
- 入力データ表の補助CSVまたはJSON
- export_manifest
- validation_report
- readme

## 4.3 IRからの主な対応
### geometry
- frame_graph または node/element 定義へ変換する
- bodyベースのソリッド形状は原則直接対応しない
- 座標系は global と local を区別する

### materials
- 線形弾性材料に優先対応
- 必須: ヤング率、必要に応じて密度
- ポアソン比は対象要素で不要な場合がある

### sections
- frame/trussでは必須
- area, inertia, torsion 定数が不足する場合は error または placeholder

### boundary_conditions
- 支点条件へ変換
- 固定自由度は DOF マップに変換

### loads
- 節点荷重
- 部材荷重
- 重力
- 時間依存荷重の雛形

### analysis_cases
- ndm, ndf
- static / transient の基本設定
- recorders の最小雛形

## 4.4 OpenSeesPy出力の前提条件
必須:
- node 座標が定義済み
- element 接続が定義済み
- モデル次元が確定
- 各要素に適切な section または material が紐付く
- 支持条件が最低限存在する
- 単位が明示されている

警告:
- 拘束不足が疑われる
- 部材座標系が未確認
- 荷重ケース名が曖昧
- 時刻歴入力が未リンク

## 4.5 名前付き選択の使い方
推奨:
- support_* は fix 条件候補
- frame_col_* や frame_beam_* は section assignment 候補
- load_node_* や load_edge_* は load assignment 候補

## 4.6 出力停止条件
- 主要接続が欠ける
- ndm と要素種別が矛盾
- セクション未設定
- 解析ケースが空
- 拘束条件ゼロで線形静解析を出そうとしている

## 4.7 代表ユースケース
### 2D portal frame
出力内容:
- model 基本定義
- node
- geomTransf
- element
- mass または loads
- fix
- time series / pattern
- integrator / algorithm / analysis
- recorder 雛形

---

## 5. DOLFINx出力仕様

## 5.1 適用対象
優先対応:
- 線形弾性
- Poisson / 拡散
- 定常熱伝導
- 基本的な境界タグ付き連続体問題

初期版で非優先:
- 毎回異なる弱形式の完全自由生成
- 複雑非線形
- 高度な接触
- 多物理強連成の汎用自動生成

## 5.2 出力成果物
- mesh ファイル群
- facet / cell tag 情報
- XDMF または MSH 기반の読み込み資産
- 問題設定用 Python スクリプト雛形
- materials / BC / load mapping 表
- export_manifest
- validation_report

## 5.3 IRからの主な対応
### geometry
- 形状または既存メッシュを DOLFINx 読込可能な形に落とす
- 推奨は Gmsh ベースのタグ付きメッシュ
- body / face / edge の意味名を cell / facet marker に変換する

### named_selections
- 最重要項目
- DOLFINx側で marker に変換される前提
- face 相当と body 相当を必ず区別する

### materials
- 領域ごとの材料割当として使う
- 線形弾性なら E, nu
- 熱なら k, rho, cp など

### boundary_conditions
- Dirichlet / Neumann / Robin 相当の分類へ変換する
- facet marker が存在しない境界条件は error

### loads
- body force
- traction
- heat source
- source term

### analysis_cases
- 使用テンプレートを決める
- function space の型
- result request の雛形
- 出力ファイル名規則

## 5.4 DOLFINx出力の前提条件
必須:
- メッシュが存在するか生成可能
- cell/facet のタグ体系が成立している
- 解析種別がテンプレート群のいずれかに該当する
- 材料と領域の対応が明確
- 境界条件対象が境界タグとして識別可能

警告:
- 物理モデルに対して材料値が不足
- マーカー名が曖昧
- facet と cell を取り違える可能性
- weak form テンプレート外の条件が含まれる

## 5.5 推奨テンプレート群
- linear_elasticity_2d
- linear_elasticity_3d
- poisson_scalar
- steady_heat
- transient_heat_basic

## 5.6 出力停止条件
- 領域タグがない
- 境界条件対象が面でなく体積として定義されている
- DOLFINxテンプレートへ落とせない解析種別
- メッシュ生成失敗
- 必須材料未設定

## 5.7 名前付き選択の命名推奨
- dom_* : cell tags
- bc_* : facet tags
- load_* : traction or source targets
- sym_* : symmetry boundaries
- mat_* : material assignment groups

## 5.8 代表ユースケース
### 穴あき平板の線形弾性
出力内容:
- plate_domain
- hole_boundary
- left_support
- right_traction
- これらを marker として保持
- 線形弾性テンプレートへ流し込む

---

## 6. OpenFOAM出力仕様

## 6.1 適用対象
優先対応:
- 単相非圧縮定常流
- 単相非圧縮非定常流の基本雛形
- 基本的な熱流体テンプレート
- 単純形状の blockMesh
- 複雑形状の snappyHexMesh 前提テンプレート

初期版で非優先:
- 高度乱流モデルの完全自動選定
- 多相流
- 反応流
- 移動境界
- 多領域連成の汎用自動化

## 6.2 出力成果物
- ケースディレクトリ一式
  - 0
  - constant
  - system
- メッシュ生成関連設定
- patch対応表
- export_manifest
- validation_report
- readme

## 6.3 IRからの主な対応
### geometry
- 単純形状なら blockMesh 用幾何へ変換
- 複雑形状なら STL 等の表面資産 + snappyHexMesh 設定へ変換
- mesh only の場合は変換可能性を検査する

### named_selections
- patch 名へ変換する
- inlet / outlet / wall / symmetry などの物理意味を持つ名前が望ましい
- OpenFOAMでは patch の境界型と 0 ディレクトリの条件が整合している必要がある

### materials
- 流体物性、熱物性、乱流モデル関連に対応
- 初期版では定数物性を優先

### boundary_conditions
- 0/U, 0/p, 0/T などへ振り分ける
- patchごとの型と値に落とす
- 2D問題の empty 指定などもここで扱う

### loads
OpenFOAMでは構造系の「荷重」とは概念が異なるため、以下に読み替える。
- source terms
- body force
- initial field or boundary driving conditions

### analysis_cases
- 使用ソルバ名
- controlDict
- fvSchemes
- fvSolution
- turbulence / transport / thermophysical settings

## 6.4 OpenFOAM出力の前提条件
必須:
- patch 名体系が確定
- case template が選ばれている
- 0 / constant / system の必要辞書へ落とせる
- 流体領域と固体領域が必要に応じて区別されている

警告:
- inlet/outlet の意味が曖昧
- 壁条件が不足
- 初期場未設定
- メッシュ生成器選択が未確定
- テンプレート外の物理が含まれる

## 6.5 テンプレート方式
OpenFOAMは汎用自由生成より、テンプレート方式を基本とする。

推奨テンプレート:
- simpleFoam_basic_internal_flow
- pisoFoam_basic_transient
- laplacianFoam_basic
- cht_like_placeholder_not_for_initial_release

各テンプレートは次を差し替える。
- patch names
- boundary values
- transport properties
- mesh controls
- run control
- optional function objects

## 6.6 blockMesh と snappyHexMesh の使い分け
### blockMesh
向くもの:
- 直方体流路
- 2Dチャネル
- 後向きステップのような比較的単純なもの

### snappyHexMesh
向くもの:
- 複雑3D形状
- CAD由来の外形
- 局所境界層を持たせたいケース

出力時には、どちらを使うか必ず明示する。

## 6.7 出力停止条件
- patch 未定義
- case template 未選択
- 必須 field 条件未設定
- 形状が blockMesh へ落とせないのに template もない
- 2Dで empty 面未整理

## 6.8 名前付き選択の命名推奨
- inlet
- outlet
- wall_main
- wall_symmetry
- front_and_back
- fluid_domain
- heat_source_wall

## 6.9 代表ユースケース
### 2Dチャネル流
出力内容:
- blockMeshDict
- 0/U
- 0/p
- system/controlDict
- system/fvSchemes
- system/fvSolution
- transport properties
- front/back の empty 指定

---

## 7. IRから各ソルバへのマッピング表

## 7.1 主対応の考え方
- geometry -> topology / mesh / graph
- named_selections -> support groups / tags / patches
- materials -> material / coefficient / property dictionary
- sections -> OpenSeesPyで特に重要
- mesh_controls -> Gmsh / mesher / blockMesh / snappyHexMesh の入力ヒント
- boundary_conditions -> supports / BC / patch fields
- loads -> forces / source terms / traction
- analysis_cases -> solver profile / run settings

## 7.2 ソルバ別の重視点
### OpenSeesPy
- graphとしての整合性
- section と自由度
- 支持条件

### DOLFINx
- tagged mesh
- weak form テンプレート適合
- facet/cell の区別

### OpenFOAM
- case directory の整合性
- patch 名と field 辞書の整合
- mesh template の整合

---

## 8. エクスポート時の共通検証

必須:
- 単位系あり
- 有効な analysis_case あり
- エクスポート対象が1つ以上 enabled
- 参照切れなし
- 名前付き選択名の衝突なし

推奨:
- AI推定値の review 完了
- warnings の確認記録
- export profile の明示
- omitted items レポートの保存

---

## 9. エクスポートレポート仕様

各出力に必ず以下を添える。

- 成功 / 失敗
- 使用した analysis case
- 使用した solver target
- 生成ファイル一覧
- 自動補完した項目
- 省略した項目
- 人が確認すべき点
- 既知の制約

見せ方:
- UI上では一覧カード
- ファイルとしては markdown または JSON の manifest

---

## 10. ZIP構成推奨

### OpenSeesPy
- main script
- data tables
- export_manifest
- validation_report

### DOLFINx
- mesh assets
- tags assets
- main script template
- mapping report
- export_manifest

### OpenFOAM
- case directory
- mesh dicts
- manifest
- report
- readme

---

## 11. 実装優先順位

### Phase 1
- OpenSeesPy: 2D frame / truss
- DOLFINx: 2D linear elasticity / steady heat
- OpenFOAM: 2D simpleFoam/blockMesh template

### Phase 2
- OpenSeesPy: 3D frame
- DOLFINx: 3D elasticity / transient heat
- OpenFOAM: snappyHexMesh based internal flow

### Phase 3
- ソルバ別の高度機能
- テンプレート追加
- 検証高度化
- 出力比較機能

---

## 12. 非対応を明示すべき例

- 接触を単純固定へ勝手に置き換える
- OpenFOAMの複雑物理を basic template へ黙って押し込む
- DOLFINxの複雑弱形式を線形弾性へ誤変換する
- OpenSeesPyでシェル/ソリッドを未対応のまま疑似変換する

---

## 13. 受け入れ基準

- 同一IRから3ソルバへの出力可否判定ができる
- 不足がある場合、理由が明確に出る
- ソルバ固有の最低限必要条件が検証できる
- 出力成果物の構成が一定である
- 名前付き選択が各ソルバの group/tag/patch へ正しく写る
- manifest を見れば、何が出て何が出ていないか分かる
