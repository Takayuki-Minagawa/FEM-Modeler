export const reviewJa = {
  validation: {
    not_run: '検証はまだ実行していません',
    stale: '入力変更後のため、再検証が必要です',
    common: '共通検証済み（ケース・ソルバの出力可否は未検証）',
    other_scope: '別のケース・ソルバの検証結果です',
    current: '指定ケース・ソルバの検証済み',
    commonScope: '共通検証',
    scope: '検証対象',
    revision: '検証revision {{validated}}／現在 {{current}}',
    counts: 'エラー {{errors}}件・警告 {{warnings}}件',
    clear: 'この検証範囲では問題はありません',
    openTarget: '対象の入力を開く: {{name}}',
  },
  history: {
    filter: '出力履歴の範囲', current: '現在のプロジェクト', all: '全プロジェクト',
    project: 'プロジェクト', case: '解析ケース', revision: 'revision', file: 'ファイル', bytes: '容量',
    unknownSize: '容量未記録', success: '生成成功', warning: '警告付き生成', error: '生成失敗',
    generatedOnly: 'ファイルの生成結果です。ソルバ解析の完了を示すものではありません。',
  },
  export: {
    nextStep: '次に確認する項目: {{step}}', ready: 'このケース・ソルバの準備チェックが完了しました。',
    report: '再現用レポート', reportDescription: 'SIの数量・割当・参加条件・メッシュ・検証対象を含むMarkdown',
    running: '{{target}}を処理中', operation: '処理ID: {{id}}',
  },
};

export const reviewEn = {
  validation: {
    not_run: 'Validation has not been run',
    stale: 'Inputs changed; validation is out of date',
    common: 'Common checks completed; case and solver export eligibility not checked',
    other_scope: 'These results belong to another case or solver',
    current: 'Selected case and solver validated',
    commonScope: 'Common checks', scope: 'Validation scope',
    revision: 'Validated revision {{validated}} / current {{current}}',
    counts: '{{errors}} error(s), {{warnings}} warning(s)',
    clear: 'No issues in this validation scope',
    openTarget: 'Open target input: {{name}}',
  },
  history: {
    filter: 'Export history scope', current: 'Current project', all: 'All projects',
    project: 'Project', case: 'Analysis case', revision: 'Revision', file: 'File', bytes: 'Size',
    unknownSize: 'Size not recorded', success: 'Files generated', warning: 'Generated with warnings', error: 'Generation failed',
    generatedOnly: 'This records file generation, not completion of a solver analysis.',
  },
  export: {
    nextStep: 'Next item to review: {{step}}', ready: 'Preparation checks are complete for this case and solver.',
    report: 'Reproducible report', reportDescription: 'Markdown with SI quantities, assignments, participation, mesh and validation scope',
    running: 'Processing {{target}}', operation: 'Operation ID: {{id}}',
  },
};
