import * as THREE from 'three';
import type { Transform } from '@/core/ir/types';

export type Vector3Tuple = [number, number, number];

const EPSILON = 1e-9;

export function toRadiansTuple(rotation: Vector3Tuple): Vector3Tuple {
  return rotation.map((value) => THREE.MathUtils.degToRad(value)) as Vector3Tuple;
}

export function getTransformMatrix(transform: Transform): THREE.Matrix4 {
  const [rx, ry, rz] = toRadiansTuple(transform.rotation);
  const position = new THREE.Vector3(...transform.position);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  const scale = new THREE.Vector3(...transform.scale);

  return new THREE.Matrix4().compose(position, quaternion, scale);
}

export function applyTransformToPoint(
  point: Vector3Tuple,
  transform: Transform,
): Vector3Tuple {
  const vector = new THREE.Vector3(...point).applyMatrix4(getTransformMatrix(transform));
  return [vector.x, vector.y, vector.z];
}

export function isIdentityTransform(transform: Transform): boolean {
  return transform.position.every((value) => Math.abs(value) < EPSILON)
    && transform.rotation.every((value) => Math.abs(value) < EPSILON)
    && transform.scale.every((value) => Math.abs(value - 1) < EPSILON);
}
