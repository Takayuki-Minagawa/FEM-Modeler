# 共通結果パッケージ v1

生成したソルバーZIPを実行すると、`result_package.json` にメッシュとスカラー場を出力します。「結果」からJSONを読み込み、「3D表示」でメッシュ・場を表示します。CSVは数値表の取込用で、座標・接続情報を持たないCSVだけでは3D表示を行いません。

## 入力の照合

manifestには次の値を生成時から引き継ぎます。入力の名前・色・表示単位・結果・保存日時を除き、ケースが利用するSI値からSHA-256を計算します。

| キー | 意味 |
|---|---|
| `project_id` / `analysis_case_id` / `export_target` | プロジェクト・ケース・ソルバー |
| `input_fingerprint` | メッシュを含む入力全体の `sha256:` + 64桁の小文字16進数 |
| `comparison_fingerprint` | メッシュ制御とその専用選択を除く同じ物理問題の指紋 |
| `run_id` | ZIP生成ごとの実行識別子。同じZIPを再実行した結果は同じ識別子 |
| `model_revision` | 操作上の参考情報。これだけでは入力を照合しない |

現在の入力が異なる結果は拒否します。メッシュだけを変更した結果は「収束比較用に別メッシュを許可」を明示した場合に限り保存でき、現在モデルへの重ね描きには使いません。情報が足りない旧結果は未検証として取り込めます。供給された検証済みフラグは取込時に再計算します。

この照合はファイルの電子署名ではありません。外部で書き換えた出力が解析に使用されたことまで証明する仕組みではありません。

## 形式

以下は構造を示す例です。`sha256:…` 等は説明用であり、実際には生成されたmanifestの値を使います。

```json
{
  "format": "fem-modeler-result-package-v1",
  "manifest": {
    "project_id": "proj_…",
    "analysis_case_id": "case_…",
    "export_target": "OpenSeesPy",
    "input_fingerprint": "sha256:…",
    "comparison_fingerprint": "sha256:…",
    "run_id": "run_…",
    "analysis_return_code": 0
  },
  "mesh": {
    "length_unit": "m",
    "source": {
      "solver": "OpenSeesPy",
      "generator": "OpenSeesPy 3.7.1.2",
      "input_fingerprint": "sha256:…"
    },
    "representative_size": 1,
    "nodes": [
      { "id": "1", "position": [0, 0, 0] },
      { "id": "2", "position": [1, 0, 0] }
    ],
    "elements": [{ "id": "1", "type": "line2", "node_ids": ["1", "2"], "boundary_tags": [] }],
    "quality": []
  },
  "fields": [{ "name": "ux", "location": "node", "unit": "m", "entity_ids": ["1", "2"], "values": [0, 0.0001] }]
}
```

節点IDと要素IDはそれぞれ一意な文字列です。配列の順番から節点の対応を推測しません。対応要素は `line2 / triangle3 / quad4 / tetra4 / hexa8`、結果の位置は `node / element / cell` です。場は成分ごとに格納します。OpenSeesPyの変位は `ux / uy / uz`、単位は `m` を使います（`ux_m` 等の同義名も受入）。欠損成分をゼロと推定せず、欠損として表示します。

メッシュだけの品質パッケージは `fields: []` にできます。`quality` の各項目は `name / definition / unit / element_ids / values` と任意の `bad_below / bad_above` を持ちます。値が閾値より厳密に小さい・大きい要素を不良として表示します。境界tagは対応要素に保存します。体積要素と境界要素を同時に含むパッケージでは要素数に両方が含まれます。

ファイルは20 MiBまで、節点10万・要素20万・場256までです。品質指標は20種類までで、各接続先・場のID・有限数値を検証します。CSVには別途10万行・256列・100万セルの制限があります。

## 保存則と収束

manifest単体JSONにも同じ測定値を記録できます。アプリは `balance_status: pass` 等の申告から合格を推定しません。

| 評価 | 生値と許容差 | 計算 |
|---|---|---|
| 力 | `applied_force_N`, `reaction_force_N`, `balance_tolerance_N` | 外力と反力の和の最大絶対成分 |
| モーメント | `applied_moment_Nm`, `reaction_moment_Nm`, `moment_balance_tolerance_Nm` | 同じ基準点に対する和の最大絶対成分 |
| 熱 | `heat_boundary_outward_W`, `heat_source_W`, `heat_balance_tolerance_W` | 外向き境界流束合計 − 体積内発熱 |
| 質量 | `mass_boundary_outward_kg_s`, `mass_source_kg_s`, `mass_balance_tolerance_kg_s` | 外向き境界質量流量合計 − 体積内供給 |
| 残差 | `residual_history`, `residual_tolerances` | 最終反復の各場の残差/許容差、その最大が1以下 |

境界流量の配列は最大16成分です。熱・質量収支の評価量は上記差の絶対値です。許容差や測定値がなければ合格を表示しません。OpenFOAMの体積流束 `phi` と質量流束は単位を区別し、密度を使って換算します。

`residual_history` は `[{"iteration": 1, "values": {"p": 0.01, "Ux": 0.002}}]` のように反復番号が増加する列、`residual_tolerances` は場名から正の許容差への対応です。プロセス終了コード0は実行成功だけを表し、残差の収束を意味しません。複数の終了コードが矛盾する場合、明示された失敗を優先します。

汎用VTK/XDMF、混合高次要素、任意のOpenFOAM結果フォルダーの直接読込はこの形式の範囲外です。DOLFINxの高次解を表示用一次メッシュへ出力する際の制約は、生成スクリプトとソルバー検証資料に記録します。
