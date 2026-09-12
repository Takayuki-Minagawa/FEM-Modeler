# Sourced by run.sh before uv/native setup so even environment failures cannot
# leave a previous successful package or native result behind.
invalidate_result_outputs() {
  rm -f result_package.json result_manifest.json results.csv result.xdmf result.h5
}
finish_solver_run() {
  local status="$1"
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    invalidate_result_outputs
    sed "s/\"execution_return_code\": -1/\"execution_return_code\": $status/" runtime/failure_manifest.json > result_manifest.json
  fi
  exit "$status"
}
invalidate_result_outputs
cp runtime/failure_manifest.json result_manifest.json
trap 'finish_solver_run "$?"' EXIT
