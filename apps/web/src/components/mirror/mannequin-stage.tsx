'use client';

import { useEffect, useRef } from 'react';
import type { BufferGeometry, Mesh, MeshStandardMaterial } from 'three';

import type { MannequinSpec } from '@mirrorfit/experience';

/**
 * WebGL mannequin. Three.js draws a sized garment on a generic body.
 * It never reads the camera and never uploads a frame.
 */
export function MannequinStage({ spec }: { readonly spec: MannequinSpec }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const specKey = JSON.stringify(spec);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let teardown = () => undefined;

    void import('three').then((THREE) => {
      if (cancelled || !hostRef.current) return;
      const width = Math.max(280, host.clientWidth);
      const height = 420;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 20);
      camera.position.set(spec.camera.x, spec.camera.y, spec.camera.z);
      camera.lookAt(0, 0.95, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const key = new THREE.DirectionalLight(0xffffff, 1.1);
      key.position.set(2, 4, 3);
      scene.add(key);

      const group = new THREE.Group();
      group.rotation.y = spec.yaw;
      group.scale.setScalar(spec.scale);
      scene.add(group);

      const skin = new THREE.MeshStandardMaterial({ color: 0xcbb7a2, roughness: 0.7 });
      const cloth = new THREE.MeshStandardMaterial({ color: spec.garmentColor, roughness: 0.55 });
      const add = (
        material: MeshStandardMaterial,
        geometry: BufferGeometry,
        x: number,
        y: number,
        z: number,
        sx = 1,
        sy = 1,
        sz = 1,
      ) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        group.add(mesh);
      };

      add(skin, new THREE.SphereGeometry(0.16, 24, 16), 0, 1.72, 0);
      add(skin, new THREE.BoxGeometry(0.34, 0.46, 0.18), 0, 1.38, 0);
      add(skin, new THREE.BoxGeometry(0.32, 0.22, 0.18), 0, 1.05, 0, spec.waist, 1, 1);
      add(skin, new THREE.BoxGeometry(0.08, 0.34, 0.08), -0.24, 1.42, 0, 1, spec.sleeve, 1);
      add(skin, new THREE.BoxGeometry(0.08, 0.34, 0.08), 0.24, 1.42, 0, 1, spec.sleeve, 1);
      add(skin, new THREE.BoxGeometry(0.1, 0.42, 0.1), -0.1, 0.72, 0);
      add(skin, new THREE.BoxGeometry(0.1, 0.42, 0.1), 0.1, 0.72, 0);

      if (spec.garment === 'TOP' || spec.garment === 'FULL_BODY') {
        add(cloth, new THREE.BoxGeometry(0.4, 0.5 * spec.length, 0.22), 0, 1.38, 0.02);
      }
      if (spec.garment === 'LOWER_BODY' || spec.garment === 'FULL_BODY') {
        const top = spec.garment === 'FULL_BODY' ? 0.95 : 1.02;
        add(cloth, new THREE.BoxGeometry(0.16, 0.5 * spec.length, 0.16), -0.1, top - 0.2, 0.02);
        add(cloth, new THREE.BoxGeometry(0.16, 0.5 * spec.length, 0.16), 0.1, top - 0.2, 0.02);
      }

      renderer.render(scene, camera);
      teardown = () => {
        renderer.dispose();
        scene.traverse((object) => {
          const mesh = object as Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
        });
        skin.dispose();
        cloth.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      cancelled = true;
      teardown();
    };
    // specKey is the serialized pose. The object identity is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);

  return <div ref={hostRef} className="mx-auto w-full max-w-md" data-testid="mannequin-stage" />;
}
