# 共通中間表現(IR) JSON仕様書
## 対象: FEM/CAE向け静的Webアプリ

## 1. 目的

本書は、アプリ内部で扱う共通中間表現(IR: Intermediate Representation)の仕様を定義する。  
本IRは、OpenSeesPy / DOLFINx / OpenFOAM のいずれかに依存しない **正本データ** であり、次の役割を持つ。

- プロジェクト保存
- 再読込
- 差分管理
- AI支援の入出力
- 3D表示状態の再現
- 各ソルバへの出力元データ
- 検証結果の保持

本書では、スキーマ定義そのものだけでなく、**項目設計の意図** も明示する。

---

## 2. 設計原則

### 2.1 正本はIRである
- OpenSeesPyスクリプト
- DOLFINx用mesh/XDMF
- OpenFOAMケース

これらはすべて生成物であり、正本ではない。  
保存と再編集は必ずIRを基準に行う。

### 2.2 名前付き選択を中心に条件を張る
材料、境界条件、荷重、メッシュ方針は、原則として **名前付き選択** に紐付ける。  
ジオメトリIDに直接結び付けるだけでは、設計変更時の耐久性が低くなるためである。

### 2.3 単位を明示する
すべての数値項目は、次のいずれかの方法で単位を明確にする。

- プロジェクト単位系に従う
- 項目ごとの単位属性を持つ
- 無次元であることを明示する

### 2.4 不確実な値は状態を持つ
AIが提案した未確定値や、インポート時に推定した値には **状態** を持たせる。

状態例:
- confirmed
- inferred
- imported
- missing
- needs_review

---

## 3. バージョニング

## 3.1 必須項目
トップレベルに以下を持つ。

- schema_name
- schema_version
- app_version
- created_at
- updated_at

## 3.2 互換方針
- マイナーバージョン差では可能な限り後方互換を維持する
- 破壊的変更時はマイグレーションルールを別紙化する
- 読込時には schema_version を必ず検査する

---

## 4. トップレベル構造

推奨トップレベル項目:

- meta
- units
- geometry
- named_selections
- materials
- sections
- mesh_controls
- boundary_conditions
- loads
- initial_conditions
- analysis_cases
- solver_targets
- validation
- ui_state
- ai_annotations
- audit_trail
- attachments

---

## 5. meta

目的:
- プロジェクトそのものの属性を管理する

項目:
- project_id
- project_name
- description
- author
- organization
- created_at
- updated_at
- tags
- status
- default_solver_target
- domain_type

domain_type 例:
- frame
- truss
- solid
- thermal
- fluid
- coupled

status 例:
- draft
- review
- approved
- archived

---

## 6. units

目的:
- 単位系の一貫性を確保する

必須項目:
- system_name
- base_length
- base_mass
- base_time
- base_temperature
- base_force
- angle_unit

推奨追加項目:
- display_precision
- preferred_stress_unit
- preferred_pressure_unit
- preferred_energy_unit

例となる system_name:
- SI
- mm-N-s
- mm-t-s
- custom

ルール:
- 単位変換履歴を audit_trail に残す
- 変換時に丸めが発生したら情報を残す

---

## 7. geometry

## 7.1 目的
形状、トポロジ、参照情報、インポート元を扱う。

## 7.2 サブ構造
- model_type
- source
- bodies
- faces
- edges
- vertices
- reference_frames
- geometry_parameters

model_type 例:
- cad_brep
- mesh_only
- frame_graph
- hybrid

source 例:
- native
- imported_step
- imported_stl
- imported_obj
- imported_msh
- generated_by_ai

## 7.3 bodies
各bodyが持つ推奨項目:
- id
- name
- category
- visible
- locked
- color
- transform
- topology_ref
- metadata

category 例:
- solid
- shell
- beam_region
- fluid_region
- void

## 7.4 reference_frames
局所座標系や部材座標系を保持する。

項目:
- id
- name
- origin
- axis_x
- axis_y
- axis_z
- type
- attached_to

---

## 8. named_selections

## 8.1 目的
意味名を持つ選択集合を定義し、全条件の基準とする。

## 8.2 必須項目
各 named_selection は以下を持つ。

- id
- name
- target_dimension
- entity_type
- member_refs
- color
- description
- created_by
- status
- usages

target_dimension 例:
- 0
- 1
- 2
- 3

entity_type 例:
- vertex
- edge
- face
- body
- node
- element
- cell
- patch

created_by 例:
- user
- import
- ai

status 例:
- active
- stale
- unresolved

usages 例:
- material_assignment
- boundary_condition
- load
- mesh_control
- export_tag

## 8.3 設計ルール
- 名前は英数字とアンダースコアを基本とする
- 空白や日本語表示名は別項目に分けてもよい
- 名前の重複は不可
- 削除ではなく無効化できるようにする

---

## 9. materials

## 9.1 目的
材料物性を一元管理する。

## 9.2 各材料の項目
- id
- name
- class
- physical_model
- parameter_set
- value_status
- source
- notes

class 例:
- elastic
- thermo_elastic
- fluid_newtonian
- user_defined

physical_model 例:
- isotropic_linear
- orthotropic_linear
- incompressible_newtonian
- constant_property

parameter_set 例:
- density
- young_modulus
- poisson_ratio
- thermal_conductivity
- specific_heat
- dynamic_viscosity
- kinematic_viscosity

value_status:
各物性ごとに状態を持てるようにする。

- confirmed
- inferred
- library
- imported
- missing

## 9.3 割当方針
material assignment は材料側に対象を書くのではなく、別途 assignment として保持してもよい。  
ただし実装上は以下を推奨する。

- material_assignments
  - id
  - material_id
  - target_named_selection_id
  - override_allowed

---

## 10. sections

## 10.1 目的
OpenSeesPyなどの骨組み・梁系で使う断面情報を管理する。

項目:
- id
- name
- section_type
- dimensions
- material_id
- orientation_ref
- area
- inertia_y
- inertia_z
- torsion_constant
- thickness
- metadata

section_type 例:
- beam_rect
- beam_circle
- shell_thickness
- generic_frame_section

ルール:
- solid解析では sections が不要でもよい
- frame/truss では section 未設定を error とする

---

## 11. mesh_controls

## 11.1 目的
メッシュ生成方針をソルバ非依存で保持する。

## 11.2 推奨構造
- global
- local
- quality_targets
- preview

### global
- algorithm_preference
- global_size
- growth_rate
- element_order
- recombine_preference
- curvature_based_refinement

### local
各ローカル設定の項目:
- id
- target_named_selection_id
- control_type
- size
- layers
- bias
- transfinite_hint
- boundary_layer_hint
- priority

control_type 例:
- local_size
- edge_division
- face_refinement
- boundary_layer
- structured_hint

### quality_targets
- min_jacobian
- max_aspect_ratio
- min_skewness
- preferred_quality_level

preferred_quality_level 例:
- preview
- balanced
- high_quality

## 11.3 注意
- 実際のメッシャ実装差を吸収するため、ヒント情報として持つ
- ソルバ固有形式へは export 時に変換する

---

## 12. boundary_conditions

## 12.1 目的
拘束条件、境界条件、物理境界を統一的に表す。

## 12.2 各条件の必須項目
- id
- name
- physics_domain
- bc_type
- target_named_selection_id
- coordinate_system
- values
- temporal_profile
- status
- notes

physics_domain 例:
- structural
- thermal
- fluid

bc_type 例:
- fixed
- prescribed_displacement
- symmetry
- temperature
- heat_flux
- velocity_inlet
- pressure_outlet
- wall
- slip
- no_slip

values 例:
- scalar
- vector
- dof_map
- function_ref

temporal_profile 例:
- constant
- ramp
- table
- expression
- time_series_ref

## 12.3 構造解析の自由度表現
構造系では次を持てるようにする。

- ux
- uy
- uz
- rx
- ry
- rz

各自由度は以下の状態を取る。

- fixed
- free
- prescribed

---

## 13. loads

## 13.1 目的
荷重、外力、体積力、分布荷重、節点荷重などを表す。

## 13.2 項目
- id
- name
- physics_domain
- load_type
- target_named_selection_id
- application_mode
- direction
- magnitude
- distribution
- temporal_profile
- load_case
- coordinate_system
- status

load_type 例:
- nodal_force
- surface_traction
- body_force
- gravity
- line_load
- pressure
- heat_source
- volumetric_heat
- mass_flow_rate

application_mode 例:
- total
- per_area
- per_length
- per_volume

distribution 例:
- uniform
- linear
- table
- field_ref

---

## 14. initial_conditions

項目:
- id
- name
- physics_domain
- ic_type
- target_named_selection_id
- values
- status

ic_type 例:
- initial_temperature
- initial_velocity
- initial_pressure
- initial_displacement

---

## 15. analysis_cases

## 15.1 目的
物理問題と解析条件をケース単位でまとめる。

## 15.2 項目
- id
- name
- active
- domain_type
- analysis_type
- nonlinear
- transient
- participating_material_ids
- participating_section_ids
- participating_bc_ids
- participating_load_ids
- participating_ic_ids
- mesh_policy_ref
- solver_profile_hint
- result_requests

analysis_type 例:
- static_linear
- static_nonlinear
- modal
- transient_structural
- steady_thermal
- transient_thermal
- incompressible_flow_steady
- incompressible_flow_transient

solver_profile_hint 例:
- openseespy_frame_basic
- dolfinx_linear_elasticity
- dolfinx_poisson
- openfoam_simpleFoam
- openfoam_pisoFoam

result_requests 例:
- displacement
- stress
- temperature
- velocity
- pressure
- reaction_force

---

## 16. solver_targets

## 16.1 目的
各ソルバ向けの出力設定を保持する。

## 16.2 推奨構造
- target_name
- enabled
- export_profile
- required_mappings
- solver_options
- path_preferences
- packaging

target_name 例:
- OpenSeesPy
- DOLFINx
- OpenFOAM

export_profile 例:
- strict
- permissive
- template_based

packaging 例:
- single_file
- multi_file
- zip_bundle
- folder_tree

---

## 17. validation

## 17.1 目的
検証結果を永続化し、再読込後も参照可能にする。

## 17.2 項目
- last_run_at
- summary
- items

summary:
- error_count
- warning_count
- info_count

各 item:
- id
- severity
- code
- title
- message
- target_ref
- suggested_fix
- dismissible
- status

status 例:
- open
- dismissed
- resolved

---

## 18. ui_state

## 18.1 目的
保存時の見た目や操作状態を復元する。

項目:
- active_panel
- camera_state
- visibility_map
- isolate_targets
- selection_state
- expanded_tree_nodes
- color_mode
- clipping_planes
- last_opened_tabs

この情報は解析正本ではないため、別セクションに分離する。

---

## 19. ai_annotations

## 19.1 目的
AIの提案、推定、説明責任を保持する。

項目:
- id
- source_prompt_summary
- target_ref
- proposal_type
- rationale
- confidence
- status
- applied_changes

proposal_type 例:
- naming
- material_suggestion
- mesh_hint
- missing_bc_warning
- export_gap_notice

status 例:
- proposed
- accepted
- rejected
- expired

---

## 20. audit_trail

## 20.1 目的
変更履歴、単位変換、AI提案採用、インポート元を追跡する。

項目:
- id
- timestamp
- actor
- action_type
- target_ref
- before_summary
- after_summary
- note

actor 例:
- user
- ai
- import
- migration

---

## 21. attachments

必要に応じて以下を持てるようにする。

- thumbnails
- imported_file_manifest
- preview_assets
- external_links

注意:
大きなバイナリはIRへ直接埋め込まない方針でもよい。  
その場合は manifest のみ保持し、別ファイル参照にする。

---

## 22. ID設計ルール

- 人が読めるnameとは別に不変なidを持つ
- idは再保存で変えない
- 外部ファイル再読込で対象が同じならid再利用を検討する
- 参照切れを validation で拾う

推奨接頭辞:
- proj_
- body_
- face_
- edge_
- ns_
- mat_
- sec_
- mesh_
- bc_
- load_
- ic_
- case_
- tgt_
- val_
- ai_

---

## 23. 妥当性ルール

## 23.1 必須
- meta.project_name が空でない
- units が存在する
- analysis_cases が1件以上ある
- enabled な solver_target が1件以上ある場合、必要項目が埋まっている
- 各参照IDが存在する

## 23.2 条件付き必須
- frame/truss の場合 sections が必要
- OpenFOAM出力有効時は patch相当の named selection が必要
- DOLFINx出力有効時は cell/facet tag 相当の named selection が必要
- OpenSeesPy出力有効時は node/element の接続定義または生成ルールが必要

## 23.3 禁止
- 名前付き選択名の重複
- 単位不明のまま確定出力
- 解析ケースに未定義材料を参加させる
- 同一対象へ矛盾する固定条件を無警告で共存させる

---

## 24. 保存と差分管理

- 保存単位は project 全体とする
- 大規模データでは geometry / ui_state / validation を分割保存してもよい
- 差分レビューしやすいようにキー順序を安定化する
- 配列は順序依存が必要なものと不要なものを区別する

推奨:
- ファイル保存時に pretty print を標準にする
- 大規模データでは compact 保存も選べる

---

## 25. 最小保存要件

最低限、次があれば再編集可能であること。

- meta
- units
- geometry の最小情報
- named_selections
- materials
- analysis_cases
- solver_targets
- validation summary

---

## 26. 拡張方針

将来拡張例:
- contact_definitions
- coupling_interfaces
- design_variables
- optimization_runs
- results_manifest
- comparison_snapshots

拡張時も既存キーの意味を不用意に変えないこと。

---

## 27. 受け入れ基準

- 単一のIRから3ソルバへの出力判断ができる
- AI提案を履歴付きで保持できる
- UI状態を復元できる
- 名前付き選択中心の条件管理が可能
- 設計変更後の再割当がしやすい
- 差分確認しやすい保存形式である
