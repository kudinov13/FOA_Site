/* FOA — «живая краска»: лёгкий WebGL-фон (fbm-шум), бумага + оранжевый + графит. */

(function () {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const VERT = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_dark;   /* 0 = светлый (бумага), 1 = тёмный (CTA) */
    uniform vec2 u_mouse;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 2.2;

      float t = u_time * 0.05;
      /* domain warp — «краска растекается» */
      vec2 q = vec2(fbm(p + t * 0.6), fbm(p + vec2(5.2, 1.3) - t * 0.4));
      vec2 r = vec2(fbm(p + 2.8 * q + vec2(1.7, 9.2) + t * 0.3),
                    fbm(p + 2.4 * q + vec2(8.3, 2.8) - t * 0.5));
      float f = fbm(p + 2.5 * r);

      /* курсор слегка расталкивает краску */
      float md = distance(uv, u_mouse);
      f += 0.08 * exp(-md * 4.0);

      vec3 paper  = vec3(0.945, 0.925, 0.890);
      vec3 paper2 = vec3(0.905, 0.878, 0.828);
      vec3 orange = vec3(0.941, 0.306, 0.137);   /* #F04E23 */
      vec3 ink    = vec3(0.090, 0.075, 0.055);   /* Mars Black */

      vec3 col;
      if (u_dark < 0.5) {
        /* светлый режим: бумага, редкие мазки оранжевого и графита */
        col = mix(paper, paper2, smoothstep(0.25, 0.75, f));
        float blob = smoothstep(0.62, 0.78, f) * smoothstep(0.92, 0.72, f);
        col = mix(col, orange, blob * 0.85);
        float vein = smoothstep(0.46, 0.50, f) * smoothstep(0.55, 0.50, f);
        col = mix(col, ink, vein * 0.55);
      } else {
        /* тёмный режим: графитовое поле, разводы оранжевого и бумаги */
        col = mix(ink * 0.9, ink * 1.5, smoothstep(0.2, 0.8, f));
        float blob = smoothstep(0.58, 0.80, f);
        col = mix(col, orange, blob * 0.9);
        float flash = smoothstep(0.80, 0.94, f);
        col = mix(col, paper, flash * 0.5);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function makeShader(gl, src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  function init(canvas) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
    if (!gl) { canvas.remove(); return; }

    const prog = gl.createProgram();
    gl.attachShader(prog, makeShader(gl, VERT, gl.VERTEX_SHADER));
    gl.attachShader(prog, makeShader(gl, FRAG, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uDark = gl.getUniformLocation(prog, 'u_dark');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');
    gl.uniform1f(uDark, canvas.dataset.theme === 'dark' ? 1 : 0);

    let mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
    canvas.parentElement.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      tmx = (e.clientX - r.left) / r.width;
      tmy = 1 - (e.clientY - r.top) / r.height;
    });

    let visible = false, raf = null, t0 = performance.now();
    function resize() {
      const dpr = Math.min(devicePixelRatio, 1.5);
      const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }
    function frame(now) {
      if (!visible) { raf = null; return; }
      resize();
      mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform2f(uMouse, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    new IntersectionObserver(en => {
      visible = en[0].isIntersecting;
      if (visible && !raf && !reduced) raf = requestAnimationFrame(frame);
    }).observe(canvas);

    if (reduced) { /* один статичный кадр */
      resize(); gl.uniform1f(uTime, 10); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  document.querySelectorAll('canvas[data-shader]').forEach(init);
})();
