// Raw-camera readback is synchronous inside the active XRFrame. JPEG encoding
// and the network happen afterwards; XRFrame/XRCamera never escape this method.
export function intrinsics(projection, width, height) {
  return [[projection[0] * width / 2, 0, (1 - projection[8]) * width / 2], [0, projection[5] * height / 2, (1 + projection[9]) * height / 2], [0, 0, 1]];
}
export class RawCamera {
  constructor(renderer, session) { this.renderer = renderer; this.session = session; this.gl = renderer.getContext(); this.binding = new XRWebGLBinding(session, this.gl); this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d'); this.init(); }
  init() {
    const g = this.gl;
    const shader = (type, code) => { const s = g.createShader(type); g.shaderSource(s, code); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; };
    const vs = shader(g.VERTEX_SHADER, '#version 300 es\nout vec2 uv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); uv=p; gl_Position=vec4(p*2.0-1.0,0,1); }');
    const fs = shader(g.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; uniform sampler2D camera; in vec2 uv; out vec4 color; void main(){ color=texture(camera,uv); }');
    this.program = g.createProgram(); g.attachShader(this.program, vs); g.attachShader(this.program, fs); g.linkProgram(this.program); g.deleteShader(vs); g.deleteShader(fs);
    if (!g.getProgramParameter(this.program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(this.program));
    this.fbo = g.createFramebuffer(); this.texture = g.createTexture(); this.vao = g.createVertexArray();
  }
  capture(frame, space, view, T) {
    const camera = view.camera; if (!camera) return null;
    const g = this.gl, width = Math.round(camera.width * Math.min(1, 640 / Math.max(camera.width, camera.height))), height = Math.round(camera.height * Math.min(1, 640 / Math.max(camera.width, camera.height)));
    // Preserve XR's framebuffer, including implementations where Three owns it.
    const previousTarget = this.renderer.getRenderTarget(), previousFbo = g.getParameter(g.FRAMEBUFFER_BINDING), viewport = g.getParameter(g.VIEWPORT);
    try {
      const texture = this.binding.getCameraImage(camera);
      if (!texture) throw new Error('Raw camera texture unavailable');
      g.bindTexture(g.TEXTURE_2D, this.texture); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
      g.bindFramebuffer(g.FRAMEBUFFER, this.fbo); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, this.texture, 0);
      if (g.checkFramebufferStatus(g.FRAMEBUFFER) !== g.FRAMEBUFFER_COMPLETE) throw new Error('Camera readback framebuffer incomplete');
      g.viewport(0, 0, width, height); g.disable(g.DEPTH_TEST); g.disable(g.SCISSOR_TEST); g.disable(g.BLEND); g.disable(g.CULL_FACE); g.colorMask(true, true, true, true);
      g.useProgram(this.program); g.bindVertexArray(this.vao); g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, texture); g.uniform1i(g.getUniformLocation(this.program, 'camera'), 0); g.drawArrays(g.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(width * height * 4); g.readPixels(0, 0, width, height, g.RGBA, g.UNSIGNED_BYTE, pixels);
      if (g.getError() !== g.NO_ERROR) throw new Error('Camera texture readback rejected');
      const flipped = new Uint8ClampedArray(pixels.length), stride = width * 4;
      for (let y = 0; y < height; y++) flipped.set(pixels.subarray((height - y - 1) * stride, (height - y) * stride), y * stride);
      this.canvas.width = width; this.canvas.height = height; this.ctx.putImageData(new ImageData(flipped, width, height), 0, 0);
      const meta = { mode: 'webxr', metric: true, width, height, pose: Array.from(view.transform.matrix), intrinsics: intrinsics(view.projectionMatrix, width, height), depthPoints: [], planes: [] };
      const transform = new T.Matrix4().fromArray(view.transform.matrix), inverseP = new T.Matrix4().fromArray(view.projectionMatrix).invert();
      if (frame.session.depthUsage === 'cpu-optimized' && frame.getDepthInformation) {
        try {
          const depth = frame.getDepthInformation(view);
          if (depth) for (let y = .06; y < 1; y += .11) for (let x = .06; x < 1; x += .11) {
            const z = depth.getDepthInMeters(x, y);
            if (!(z > .15 && z < 10)) continue;
            const p = new T.Vector3(x * 2 - 1, 1 - y * 2, .5).applyMatrix4(inverseP); p.multiplyScalar(z / -p.z).applyMatrix4(transform);
            meta.depthPoints.push({ uv: [x, y], point: p.toArray() });
          }
        } catch { /* optional CPU depth may be absent even when requested */ }
      }
      if (frame.detectedPlanes) for (const plane of frame.detectedPlanes) {
        const pose = frame.getPose(plane.planeSpace, space); if (!pose) continue;
        const matrix = new T.Matrix4().fromArray(pose.transform.matrix);
        const vertices = Array.from(plane.polygon).slice(0, 12).map((p) => new T.Vector3(p.x, p.y, p.z).applyMatrix4(matrix));
        const points = vertices.map((p) => p.toArray());
        for (let i = 1; i < vertices.length - 1; i++) for (let a = 0; a <= 5; a++) for (let b = 0; b <= 5 - a; b++) { const p = vertices[0].clone().multiplyScalar(1 - (a + b) / 5).addScaledVector(vertices[i], a / 5).addScaledVector(vertices[i + 1], b / 5); points.push(p.toArray()); }
        meta.planes.push({ orientation: plane.orientation, semantic: plane.semanticLabel || null, points: points.slice(0, 80) });
        if (meta.planes.length >= 16) break;
      }
      return { canvas: this.canvas, camera: meta };
    } finally { this.renderer.resetState(); this.renderer.setRenderTarget(previousTarget); g.bindFramebuffer(g.FRAMEBUFFER, previousFbo); g.viewport(...viewport); }
  }
  dispose() { const g = this.gl; g.deleteFramebuffer(this.fbo); g.deleteTexture(this.texture); g.deleteProgram(this.program); g.deleteVertexArray(this.vao); this.renderer.resetState(); }
}
