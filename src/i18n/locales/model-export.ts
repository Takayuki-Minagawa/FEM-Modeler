const en = {
  handoff: 'Use STEP or IGES to transfer geometry to another app. All bodies are exported together with their placement and scale.',
  projectData: 'JSON and Bundle retain the complete editing model: IDs, units, materials, sections, assignments, named groups, transforms and imported assets. STEP/IGES do not transfer these editing relationships. Check which formats the receiving app supports.',
  cadLimits: 'Frame/truss members are exported as centreline curves, without section solids. Curve-only CAD cannot be reopened in the surface viewer. STL-only bodies require original CAD surfaces for STEP/IGES export.',
  save: 'JSON · Save model',
  running: 'Exporting…',
  cancelCAD: 'Cancel CAD export',
  targets: {
    STEP: 'Export all bodies as STEP geometry (.step)',
    IGES: 'Export all bodies as IGES geometry (.iges)',
    JSON: 'Save the complete model and embedded imported assets (.fem.json)',
    Bundle: 'Save the complete model with original imported files in a ZIP (.fem.zip)',
  },
  activity: (target: string, status: 'failed' | 'warning' | 'completed') => (
    status === 'failed' ? `${target} export failed.` : status === 'warning' ? `${target} exported with warnings.` : `${target} export completed.`
  ),
};

const ja: typeof en = {
  handoff: '別アプリへの形状の受け渡しには STEP／IGES を使用します。すべてのボディを、配置・拡大縮小を反映してまとめて出力します。',
  projectData: 'JSON／Bundle は、ID・単位・材料・断面・割当・名前付きグループ・配置・読み込みアセットを含む編集モデル全体を保存します。STEP／IGES には、これらの編集上の関連付けは引き継がれません。受け渡し先アプリの対応形式をご確認ください。',
  cadLimits: 'フレーム・トラス部材は中心線として出力され、断面を持つソリッドにはなりません。線のみの CAD はこのアプリの面表示ビューアーでは再読込できません。STL のみのボディを STEP／IGES に出力するには、元の CAD 曲面が必要です。',
  save: 'JSON · モデルを保存',
  running: '出力中…',
  cancelCAD: 'CAD 出力をキャンセル',
  targets: {
    STEP: 'すべてのボディを STEP 形状として出力（.step）',
    IGES: 'すべてのボディを IGES 形状として出力（.iges）',
    JSON: 'モデル全体と読み込みアセットを埋め込んで保存（.fem.json）',
    Bundle: 'モデル全体と読み込み元ファイルを ZIP にまとめて保存（.fem.zip）',
  },
  activity: (target, status) => (
    status === 'failed' ? `${target} の出力に失敗しました。` : status === 'warning' ? `${target} を注意事項付きで出力しました。` : `${target} の出力が完了しました。`
  ),
};

export function modelExportCopy(language: string) {
  return language.startsWith('ja') ? ja : en;
}
