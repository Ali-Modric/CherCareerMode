import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// postfx.js — lightweight broadcast finishing chain.
//
// Keeps the filmic grade + ACES tonemapping + sRGB output while skipping
// heavy MSAA, SMAA, multi-mip bloom, and depth-of-field passes for 60 FPS on
// low-power GPUs.
// ---------------------------------------------------------------------------

const GradeShader = {
  name: 'BroadcastGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.14 },
    uPivot: { value: 0.16 },
    uContrast: { value: 1.15 },
    uToe: { value: 0.40 },
    uToeRange: { value: 0.14 },
    uHiGain: { value: 0.28 },
    uHiKnee: { value: new THREE.Vector2(0.38, 1.10) },
    uSaturation: { value: 1.10 },
    uShadowTint: { value: new THREE.Vector3(0.935, 0.968, 1.036) },
    uVignette: { value: 0.26 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uPivot;
    uniform float uContrast;
    uniform float uToe;
    uniform float uToeRange;
    uniform float uHiGain;
    uniform vec2 uHiKnee;
    uniform float uSaturation;
    uniform vec3 uShadowTint;
    uniform float uVignette;

    varying vec2 vUv;

    float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec3 col = max( texel.rgb, vec3( 0.0 ) );

      col *= uExposure;
      col = pow( col * ( 1.0 / uPivot ), vec3( uContrast ) ) * uPivot;

      float l = luma( col );
      col *= mix( 1.0 - uToe, 1.0, smoothstep( 0.0, uToeRange, l ) );

      l = luma( col );
      col *= 1.0 + uHiGain * smoothstep( uHiKnee.x, uHiKnee.y, l );

      l = luma( col );
      float shadowMask = 1.0 - smoothstep( 0.0, 0.30, l );
      col *= mix( vec3( 1.0 ), uShadowTint, shadowMask );

      l = luma( col );
      col = max( mix( vec3( l ), col, uSaturation ), vec3( 0.0 ) );

      vec2 q = vUv - 0.5;
      float d = length( q ) * 1.41421356;
      col *= 1.0 - uVignette * smoothstep( 0.46, 1.0, d );

      gl_FragColor = vec4( max( col, vec3( 0.0 ) ), texel.a );
    }
  `,
};

export function createPostFX(ctx, { camera }) {
  const { renderer, scene } = ctx;

  const size = renderer.getSize(new THREE.Vector2());
  const pw = Math.max(1, Math.floor(size.x));
  const ph = Math.max(1, Math.floor(size.y));

  const target = new THREE.WebGLRenderTarget(pw, ph, {
    type: THREE.HalfFloatType,
    stencilBuffer: false,
  });
  target.texture.name = 'PostFX.hdr';

  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  composer.addPass(new OutputPass());

  composer.setPixelRatio(1);
  composer.setSize(size.x, size.y);

  function update() {}

  function resize(w, h) {
    composer.setPixelRatio(1);
    composer.setSize(w, h);
  }

  return { composer, update, resize, bloomPass: null, gradePass, smaaPass: null };
}
