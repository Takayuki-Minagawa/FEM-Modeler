# FEM/CAE静的Webアプリ 追加設計ドキュメント一式

本ディレクトリは、既存の `AI_FEM_WebApp_Instruction.md` を補完する追加MDファイル群である。  
目的は、実装段階で必要になる **画面構成・データスキーマ・各ソルバ出力仕様** を、議論しやすく、レビューしやすく、AIにも人にも解釈しやすい粒度まで具体化することである。

## ファイル一覧

### 1. `FEM_WebApp_Screen_Architecture.md`
- 画面構成
- 情報設計
- UIパネル設計
- 3Dビューワー要件
- フォーム設計
- 操作フロー
- 検証表示
- 受け入れ基準

### 2. `FEM_WebApp_JSON_IR_Spec.md`
- アプリ内部の共通中間表現(IR)仕様
- バージョニング
- トップレベル構造
- 各オブジェクト定義
- 必須・推奨・任意項目
- 妥当性ルール
- 保存・読込・差分管理方針

### 3. `FEM_WebApp_Solver_Export_Spec.md`
- OpenSeesPy / DOLFINx / OpenFOAM への出力仕様
- IRから各ソルバへのマッピング
- 出力時の必須検証
- 出力成果物
- 制約事項
- 対応優先順位

## 推奨の読み順

1. `AI_FEM_WebApp_Instruction.md`
2. `FEM_WebApp_Screen_Architecture.md`
3. `FEM_WebApp_JSON_IR_Spec.md`
4. `FEM_WebApp_Solver_Export_Spec.md`

## 実装会議での使い方

- プロダクト要件確認: 元の指示書
- 画面設計レビュー: Screen Architecture
- データ設計レビュー: JSON IR Spec
- エクスポータ設計レビュー: Solver Export Spec

## 位置づけ

これらの文書は、以下を前提とする。

- 静的Webアプリである
- ローカル主体でデータを扱う
- 市販ソフト同等の操作性を目指す
- AIは自由生成器ではなく、構造化支援の役割を担う
- 正本データはソルバ個別形式ではなく共通IRである

## 補足

必要に応じて次の文書も追加する。

- APIなし静的構成でのモジュール分割指示書
- IndexedDB / File System Access API 利用方針
- 3Dビューワー選定比較メモ
- AIプロンプトテンプレート集
- テスト仕様書
- UX文言集
