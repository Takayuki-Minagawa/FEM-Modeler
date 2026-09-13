# STEP / IGES 入出力 (v0.4)

「インポート」で `.step` / `.stp` / `.iges` / `.igs` を選びます。「エクスポート」の STEP / IGES ボタンで、プロジェクト内の全ボディ（非表示を含む）を書き出せます。材料や解析ケースの設定はCAD出力には不要です。

| 対象 | 読み込み | 書き出し |
|---|---|---|
| STEP / IGESのソリッド・曲面 | 対応。ファイル内の長さ単位を解釈し、内部SI座標へ変換 | 元のCAD原本から曲面を再構成して出力 |
| アプリ内のbox / plate / cylinder / pipe / plateWithHole / lBracket / channel | 通常の形状作成 | BRepソリッドとして出力 |
| アプリ内のframe2d / truss2d | 通常の形状作成 | 部材の中心線をCAD曲線として出力。断面ソリッドは含まない |
| STLのみを持つボディ | 既存のSTL読込に対応 | STEP / IGES出力は非対応。対象ボディ名と理由を表示して中止 |
| 独立した曲線・点を含むSTEP / IGES | 曲線だけのファイルと、面・独立曲線の混在ファイルは非対応。一部だけの読込は行わない | 上記frame / trussの曲線出力は可能 |

複数部品を含むファイルは、部品の配置を保った1つのアプリボディとして読み込みます。アセンブリ階層、部品名、色、材質、PMI、履歴はアプリの編集情報として取り込みません。読み込んだCADへの移動・回転・一様／非一様スケール・反転は書き出しに反映します。出力ファイルの長さ単位はmmです。変換に伴いCADのエンティティや数値表現は変わるため、出力は原本とのバイト一致を意味しません。

画面用の三角形メッシュと元のSTEP / IGESバイト列を別々に保存します。CAD書き出しは原本を使用するため、表示用三角形への近似がCAD曲面の解像度を決めることはありません。変換時に等価なNURBS曲面へ表現を変更する場合があります。読み込み時の曲面ごとの選択情報は、保存したプレビューの三角形番号に対応します。

## 保存・互換性

- `.fem.json`、`.fem.zip`、IndexedDB自動保存はすべてCAD原本を保持し、サイズとSHA-256を再検証します。
- ZIP manifest v3はCAD原本を独立した `.step` / `.iges` エントリとして格納します。既存manifest v2は引き続き読み込めます。
- IR schema 0.3のプロジェクトを0.4へ移行できます。保存された検証結果は既存の入力照合を再適用します。CADを持つ0.4ファイルは古いアプリでは扱えません。
- IndexedDBをv4へ更新し、開いたままの旧バージョンのタブがCAD原本を誤って削除することを防ぎます。

## 制限

CAD原本は1ファイル25 MiB、プレビューは20,000面・200,000三角形までです。1回の書き出しに渡すCAD原本合計と出力はそれぞれ100 MiBまで、変換の制限時間は2分です。キャンセル、プロジェクト切り替え、ダイアログを閉じる操作でWorkerを終了します。変換失敗時は一部だけのモデルを追加しません。

変換はWebAssemblyと専用Workerによりブラウザー内で行います。初回のCAD操作時のみ、同じサイトから約66 MBのCADエンジンをダウンロードします。キャッシュが保持されていればオフラインでも利用できますが、ブラウザーの保存容量や削除操作によって再取得が必要になります。CADファイルをサーバーへ送信する処理はありません。

読み込んだCAD形状からの**解析用メッシュ生成とOpenSeesPy / DOLFINx / OpenFOAMのstrict出力は未対応**です。CADの表示・保存・交換と、境界条件を含む解析モデルの生成は別機能です。既存ソルバの対応形状は従来の範囲を維持します。

## 検証と再現

実データは [CAD fixturesの参照値](../tests/fixtures/cad/references.json) を参照してください。mm・m・inchの円柱、穴付きソリッド、配置済みの複数部品、一般的なIGESのトリム面を扱います。JavaScriptの実WASMによる往復と、別ビルドのネイティブOCPによる境界箱・体積・面積・曲面位置を照合します。両者はOCCT系統であり、異なるCADカーネル同士の比較ではありません。

```bash
CAD_EXPORT_ARTIFACTS=/tmp/fem-cad-exports npx vitest run tests/cad/kernel.test.ts
uv sync --locked --project cad-tests
uv run --locked --project cad-tests pytest cad-tests/test_fixtures.py -q
```

独立した読み戻し手順と許容差は [cad-tests](../cad-tests/README.md)、結果は [CAD検証記録](cad-validation.json) を参照してください。ブラウザーE2Eでは実CADの読み込み、SI寸法、原文付きJSONの保存・再読み込み、CAD出力、失敗後の再試行を検証します。

## 依存ライブラリ

CAD変換は [OpenCascade.js](https://github.com/donalffons/opencascade.js) 1.1.1（LGPL-2.1-only）を使用します。同梱元のOCCTは7.4.0p1です。バージョンとnpm配布物の整合性はpackage-lock.jsonで固定します。CAD用JSとWASMは通常のアプリJSとは別ファイルで配信し、それぞれ350,000 bytes・66,000,000 bytesを上限として計測します。通常のアプリJSには従来の1,900,000 bytes上限を維持します。

配布ライセンス、ソース、差し替え・ビルド手順は [CADライセンス案内](../public/cad-notices.txt) を参照してください。
