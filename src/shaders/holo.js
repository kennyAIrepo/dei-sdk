// Holographic Fresnel shader for the hand mesh. Additive-blended.
// uGlow > 0 tints orange (used as visual feedback when colliding).

export const HOLO_VS = `
varying vec3 vN, vV, vW;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  vV = normalize(-mv.xyz);
  vW = (modelMatrix * vec4(position, 1.)).xyz;
  gl_Position = projectionMatrix * mv;
}`;

export const HOLO_FS = `
uniform float uTime;
uniform float uGlow;
varying vec3 vN, vV, vW;
void main() {
  float f = pow(1. - abs(dot(vN, vV)), 1.8);
  vec3 c = mix(vec3(.15,.4,.6), vec3(.3,.7,.9), .5 + f*.5)
         + vec3(.5,.9,1.) * f * .6;
  c += vec3(.3,.15,0.) * uGlow;
  c *= sin(vW.y * 80. + uTime * 1.5) * .08 + .92;
  gl_FragColor = vec4(c, .35 + f*.35 + uGlow*.15);
}`;
