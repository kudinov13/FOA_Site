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
      vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 2.6;

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
      if (u_dark > 1.5) {
        /* серый режим: бумага + едва заметные графитовые прожилки */
        col = mix(paper, paper2, smoothstep(0.25, 0.75, f));
        float vein = smoothstep(0.465, 0.50, f) * smoothstep(0.54, 0.50, f);
        col = mix(col, ink, vein * 0.16);
      } else if (u_dark < 0.5) {
        /* светлый режим: бумага, редкие мазки оранжевого и графита */
        col = mix(paper, paper2, smoothstep(0.25, 0.75, f));
        float blob = smoothstep(0.66, 0.80, f) * smoothstep(0.90, 0.74, f);
        col = mix(col, orange, blob * 0.5);
        float vein = smoothstep(0.465, 0.50, f) * smoothstep(0.545, 0.50, f);
        col = mix(col, ink, vein * 0.28);
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
    gl.uniform1f(uDark, canvas.dataset.theme === 'dark' ? 1 : (canvas.dataset.theme === 'gray' ? 2 : 0));

    let mx = 0.5, my = 0.5, tmx = 0.5, tmy = 0.5;
    canvas.parentElement.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      tmx = (e.clientX - r.left) / r.width;
      tmy = 1 - (e.clientY - r.top) / r.height;
    });

    let visible = false, raf = null, t0 = performance.now();
    /* рендер в пониженном разрешении — «краска» всё равно мягкая,
       а GPU-нагрузка падает в разы (важно на слабых устройствах) */
    const scale = matchMedia('(max-width: 760px)').matches ? 0.35 : 0.55;
    function resize() {
      const dpr = Math.min(devicePixelRatio, 1.5) * scale;
      const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, canvas.width, canvas.height);
    }
    let last = 0;
    /* мобильный: 20 fps — плавно для «краски», нагрузка ниже */
    const FPS_MS = 1000 / (matchMedia('(max-width: 760px)').matches ? 20 : 30);
    function frame(now) {
      if (!visible || document.hidden) { raf = null; return; }
      raf = requestAnimationFrame(frame);
      if (now - last < FPS_MS) return;
      last = now;
      resize();
      mx += (tmx - mx) * 0.04; my += (tmy - my) * 0.04;
      gl.uniform1f(uTime, (now - t0) / 1000);
      gl.uniform2f(uMouse, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    new IntersectionObserver(en => {
      visible = en[0].isIntersecting;
      if (visible && !raf && !reduced) raf = requestAnimationFrame(frame);
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => {
      if (visible && !document.hidden && !raf && !reduced) raf = requestAnimationFrame(frame);
    });

    if (reduced) { /* один статичный кадр */
      resize(); gl.uniform1f(uTime, 10); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /* ===== Worker-рендеринг для мобильных =====
     Весь WebGL уходит в worker через OffscreenCanvas — главный поток
     не трогается вообще (TBT ≈ 0), анимация остаётся живой. */
  const workerSrc = `
const VERT=${JSON.stringify(VERT)};
const FRAG=${JSON.stringify(FRAG)};
const states=new Map();
function sh(gl,t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x;}
onmessage=e=>{
  const d=e.data;
  if(d.type==='init'){
    const gl=d.canvas.getContext('webgl',{antialias:false,alpha:false});
    if(!gl)return;
    const p=gl.createProgram();
    gl.attachShader(p,sh(gl,gl.VERTEX_SHADER,VERT));
    gl.attachShader(p,sh(gl,gl.FRAGMENT_SHADER,FRAG));
    gl.linkProgram(p);gl.useProgram(p);
    const b=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,b);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const l=gl.getAttribLocation(p,'a_pos');
    gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,2,gl.FLOAT,false,0,0);
    gl.uniform1f(gl.getUniformLocation(p,'u_dark'),d.dark);
    states.set(d.id,{gl,c:d.canvas,uRes:gl.getUniformLocation(p,'u_res'),
      uTime:gl.getUniformLocation(p,'u_time'),uMouse:gl.getUniformLocation(p,'u_mouse'),
      mx:.5,my:.5,tmx:.5,tmy:.5,t0:performance.now(),w:0,h:0,vis:false,last:0});
    return;
  }
  const s=states.get(d.id);if(!s)return;
  if(d.type==='size'){s.w=d.w;s.h=d.h;}
  else if(d.type==='vis')s.vis=d.v;
  else if(d.type==='mouse'){s.tmx=d.x;s.tmy=d.y;}
};
setInterval(()=>{
  const now=performance.now();
  for(const s of states.values()){
    if(!s.vis||!s.w)continue;
    if(now-s.last<50)continue;   /* ~20 fps — «краска» и так медленная */
    s.last=now;
    const gl=s.gl,c=s.c;
    if(c.width!==s.w||c.height!==s.h){
      c.width=s.w;c.height=s.h;
      gl.viewport(0,0,s.w,s.h);gl.uniform2f(s.uRes,s.w,s.h);
    }
    s.mx+=(s.tmx-s.mx)*0.04;s.my+=(s.tmy-s.my)*0.04;
    gl.uniform1f(s.uTime,(now-s.t0)/1000);
    gl.uniform2f(s.uMouse,s.mx,s.my);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
},33);
`;

  const mobile = matchMedia('(max-width: 760px)').matches;
  const MOBILE_SCALE = 0.35;
  let worker = null, wseq = 0;

  function initWorker(canvas) {
    if (!worker) {
      worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
    }
    const off = canvas.transferControlToOffscreen();
    const id = wseq++;
    const dark = canvas.dataset.theme === 'dark' ? 1 : (canvas.dataset.theme === 'gray' ? 2 : 0);
    worker.postMessage({ type: 'init', id, canvas: off, dark }, [off]);

    new ResizeObserver(() => {
      const dpr = Math.min(devicePixelRatio, 1.5) * MOBILE_SCALE;
      worker.postMessage({ type: 'size', id,
        w: Math.round(canvas.clientWidth * dpr), h: Math.round(canvas.clientHeight * dpr) });
    }).observe(canvas);

    let inView = false;
    const sendVis = () => worker.postMessage({ type: 'vis', id, v: inView && !document.hidden });
    new IntersectionObserver(en => { inView = en[0].isIntersecting; sendVis(); }).observe(canvas);
    document.addEventListener('visibilitychange', sendVis);

    canvas.parentElement.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect();
      worker.postMessage({ type: 'mouse', id,
        x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height });
    });
  }

  /* инициализация откладывается до idle — не конкурирует с LCP/FCP.
     на мобильном сначала мгновенно показывается запечённая текстура,
     затем поверх поднимается живая анимация из worker'а */
  function start() {
    const cs = [...document.querySelectorAll('canvas[data-shader]')];
    if (!mobile) { cs.forEach(init); return; }
    cs.forEach(c => {
      const t = c.dataset.theme === 'gray' ? 'shader_gray' :
                c.dataset.theme === 'dark' ? 'shader_dark' : 'shader_light';
      c.style.background = `url("Photo/${t}.webp") center/cover`;
    });
    if (reduced) return; /* статичная текстура — корректный «кадр» того же шейдера */
    cs.forEach((c, i) => setTimeout(() => {
      try { initWorker(c); } catch (e) { /* нет OffscreenCanvas — остаётся текстура */ }
    }, 300 + i * 300));
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(start, { timeout: 1800 });
  } else {
    setTimeout(start, 600);
  }
})();
