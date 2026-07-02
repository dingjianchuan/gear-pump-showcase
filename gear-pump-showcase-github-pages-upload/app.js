/* ============================================================
   app.js — 微型齿轮泵仿真展示
   Module A: 3D 点云渲染 (WebGL 1.0)
   Module B: 2D 齿轮泵流体动画 (Canvas 2D)
   ============================================================ */

(function () {
  "use strict";

  /* ========================================================
     Module A · 3D 点云模型
     ======================================================== */
  (function () {
    var canvas = document.getElementById("modelCanvas");
    if (!canvas) return;

    // ── WebGL 初始化 ───────────────────────────────────────
    var gl = canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) {
      var msg = document.createElement("p");
      msg.style.cssText = "color:#fff;text-align:center;padding:40px";
      msg.textContent = "浏览器不支持 WebGL，请使用 Chrome 或 Firefox。";
      canvas.parentElement.appendChild(msg);
      return;
    }

    // ── 着色器源码 ─────────────────────────────────────────
    var vsrc =
      "attribute vec3 aPos;" +
      "attribute float aGroup;" +
      "uniform mat4 uMVP;" +
      "uniform float uPointSize;" +
      "uniform float uPointMode;" +
      "uniform float uExplode;" +
      "uniform float uClipY;" +
      "uniform vec3 uGroupDirs[12];" +
      "uniform vec3 uColors[12];" +
      "varying vec3 vColor;" +
      "varying vec3 vWorldPos;" +
      "varying float vDiscard;" +
      "void main(){" +
      "  vec3 p=aPos;" +
      "  int g=int(aGroup+.5);" +
      "  if(g<0)g=0; if(g>11)g=11;" +
      "  p+=uGroupDirs[g]*uExplode;" +
      "  vDiscard=(p.y>uClipY)?1.0:0.0;" +
      "  vColor=uColors[g];" +
      "  vWorldPos=p;" +
      "  gl_Position=uMVP*vec4(p,1.0);" +
      "  gl_PointSize=uPointSize;" +
      "}";

    var fsrc =
      "precision mediump float;" +
      "uniform float uPointMode;" +
      "varying vec3 vColor;" +
      "varying vec3 vWorldPos;" +
      "varying float vDiscard;" +
      "void main(){" +
      "  if(vDiscard>0.5)discard;" +
      "  if(uPointMode>0.5){" +
      "    vec2 c=gl_PointCoord*2.0-1.0;" +
      "    if(dot(c,c)>1.0)discard;" +
      "  }" +
      "  vec3 light=normalize(vec3(0.45,0.8,0.55));" +
      "  float shade=uPointMode>0.5?1.0:(0.72+0.36*max(dot(normalize(vWorldPos+vec3(0.15,0.2,0.35)),light),0.0));" +
      "  vec3 color=vColor*shade+vec3(0.14)*pow(max(dot(normalize(vWorldPos+vec3(0.4,0.5,0.7)),light),0.0),16.0);" +
      "  color=min(color,vec3(1.0));" +
      "  gl_FragColor=vec4(color,uPointMode>0.5?0.92:1.0);" +
      "}";

    // ── 编译工具 ───────────────────────────────────────────
    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s));
      return s;
    }

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // ── Uniform 与 Attribute 位置 ──────────────────────────
    var loc = {
      mvp: gl.getUniformLocation(prog, "uMVP"),
      pointSize: gl.getUniformLocation(prog, "uPointSize"),
      pointMode: gl.getUniformLocation(prog, "uPointMode"),
      explode: gl.getUniformLocation(prog, "uExplode"),
      clipY: gl.getUniformLocation(prog, "uClipY"),
      groupDirs: [],
      colors: [],
    };
    for (var i = 0; i < 12; i++) {
      loc.groupDirs.push(
        gl.getUniformLocation(prog, "uGroupDirs[" + i + "]")
      );
      loc.colors.push(gl.getUniformLocation(prog, "uColors[" + i + "]"));
    }
    var aPos = gl.getAttribLocation(prog, "aPos");
    var aGroup = gl.getAttribLocation(prog, "aGroup");

    // ── 加载点云数据 ───────────────────────────────────────
    var data = window.STEP_POINT_CLOUD;
    if (!data || !data.positions || !data.pointGroups) {
      console.error("未找到 STEP_POINT_CLOUD 数据。");
      return;
    }

    function createBuffer(values, size) {
      var buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      return { buffer: buffer, size: size };
    }

    function makePointCloudModel(pointData) {
      var count = pointData.count || pointData.positions.length / 3;
      return {
        kind: "points",
        drawMode: gl.POINTS,
        count: count,
        pos: createBuffer(pointData.positions, 3),
        group: createBuffer(pointData.pointGroups, 1),
        name: "STEP point cloud fallback",
      };
    }

    function normalizeVertices(values) {
      if (!values.length) return values;
      var min = [Infinity, Infinity, Infinity];
      var max = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < values.length; i += 3) {
        for (var a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], values[i + a]);
          max[a] = Math.max(max[a], values[i + a]);
        }
      }
      var center = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      ];
      var span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
      var scale = 1.65 / span;
      for (var j = 0; j < values.length; j += 3) {
        values[j] = (values[j] - center[0]) * scale;
        values[j + 1] = (values[j + 1] - center[1]) * scale;
        values[j + 2] = (values[j + 2] - center[2]) * scale;
      }
      return values;
    }

    function groupsForVertices(count, value) {
      var groups = new Float32Array(count);
      groups.fill(value || 0);
      return groups;
    }

    function parseStl(buffer, keepScale) {
      var view = new DataView(buffer);
      var textHead = new TextDecoder("utf-8").decode(buffer.slice(0, Math.min(256, buffer.byteLength)));
      var isBinary = buffer.byteLength >= 84 && 84 + view.getUint32(80, true) * 50 === buffer.byteLength;
      var vertices = [];

      if (isBinary) {
        var triangles = view.getUint32(80, true);
        for (var t = 0; t < triangles; t++) {
          var offset = 84 + t * 50 + 12;
          for (var v = 0; v < 3; v++) {
            vertices.push(
              view.getFloat32(offset, true),
              view.getFloat32(offset + 4, true),
              view.getFloat32(offset + 8, true)
            );
            offset += 12;
          }
        }
      } else if (/solid/i.test(textHead)) {
        var text = new TextDecoder("utf-8").decode(buffer);
        var re = /vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/g;
        var match;
        while ((match = re.exec(text))) {
          vertices.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
        }
      }

      if (!vertices.length) throw new Error("STL file did not contain triangles.");
      return keepScale ? vertices : normalizeVertices(vertices);
    }

    function parseObj(text) {
      var sourceVerts = [];
      var vertices = [];
      var lines = text.split(/\r?\n/);

      function faceIndex(token) {
        var raw = parseInt(token.split("/")[0], 10);
        if (!raw) return -1;
        return raw < 0 ? sourceVerts.length + raw : raw - 1;
      }

      for (var i = 0; i < lines.length; i++) {
        var parts = lines[i].trim().split(/\s+/);
        if (parts[0] === "v" && parts.length >= 4) {
          sourceVerts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (parts[0] === "f" && parts.length >= 4) {
          var ids = parts.slice(1).map(faceIndex).filter(function (id) { return id >= 0; });
          for (var k = 1; k < ids.length - 1; k++) {
            [ids[0], ids[k], ids[k + 1]].forEach(function (id) {
              var p = sourceVerts[id];
              if (p) vertices.push(p[0], p[1], p[2]);
            });
          }
        }
      }

      if (!vertices.length) throw new Error("OBJ file did not contain faces.");
      return normalizeVertices(vertices);
    }

    function makeMeshModel(vertices, name, groups) {
      var count = vertices.length / 3;
      return {
        kind: "mesh",
        drawMode: gl.TRIANGLES,
        count: count,
        pos: createBuffer(vertices, 3),
        group: createBuffer(groups || groupsForVertices(count, 0), 1),
        name: name,
      };
    }

    function partGroup(name) {
      if (/基准件/i.test(name)) return 0;
      if (/上-1/i.test(name)) return 1;
      if (/下-2/i.test(name)) return 2;
      if (/中-1/i.test(name)) return 3;
      if (/圆柱齿轮.*-1/i.test(name)) return 4;
      if (/圆柱齿轮.*-2/i.test(name)) return 5;
      if (/主轴/i.test(name)) return 6;
      if (/副轴/i.test(name)) return 7;
      if (/衬套/i.test(name)) return 8;
      if (/密封橡胶圈/i.test(name)) return 9;
      if (/减震硅胶/i.test(name)) return 10;
      if (/screw|cap screws|定位销/i.test(name)) return 11;
      return 0;
    }

    function setModelStatus(text) {
      var el = document.getElementById("modelStatus");
      if (el) el.textContent = text;
    }

    function tryLoadMesh(path, parser) {
      return fetch(path, { cache: "no-store" }).then(function (res) {
        if (!res.ok) throw new Error(path + " returned " + res.status);
        return parser(res);
      }).then(function (vertices) {
        model = makeMeshModel(vertices, path.split("/").pop());
        setTimeout(function () {
          setModelStatus("Loaded real triangle mesh: " + model.name + " / " + model.count.toLocaleString() + " vertices.");
        }, 0);
        setModelStatus("实体网格已加载: " + model.name + " / " + model.count.toLocaleString() + " vertices");
      });
    }

    function loadAssemblyStlParts(names) {
      var loads = names.map(function (name) {
        var url = "assets/" + encodeURIComponent(name);
        return fetch(url, { cache: "no-store" }).then(function (res) {
          if (!res.ok) throw new Error(name + " returned " + res.status);
          return res.arrayBuffer();
        }).then(function (buffer) {
          return parseStl(buffer, true);
        });
      });

      return Promise.all(loads).then(function (parts) {
        var merged = [];
        var mergedGroups = [];
        parts.forEach(function (vertices, index) {
          var group = partGroup(names[index]);
          for (var i = 0; i < vertices.length; i++) merged.push(vertices[i]);
          for (var g = 0; g < vertices.length / 3; g++) mergedGroups.push(group);
        });
        model = makeMeshModel(normalizeVertices(merged), names.length + " SolidWorks STL parts", mergedGroups);
        setModelStatus("Loaded real SolidWorks assembly mesh: " + names.length + " parts / " + model.count.toLocaleString() + " vertices.");
      });
    }

    var model = makePointCloudModel(data);
    var pointCount = model.count;

    // 更新数据来源状态
    var modelStatus = document.getElementById("modelStatus");
    if (modelStatus) {
      modelStatus.textContent =
        data.source + " · " + pointCount.toLocaleString() + " 点";
    }

    // ── 方向向量 & 颜色（6 组）───────────────────────────────
    //  外壳=0  上盖=1  齿轮=2  紧固件=3  泵体=4  底座=5
    setModelStatus("Looking for STL/OBJ mesh. Temporary STEP point-cloud preview: " + pointCount.toLocaleString() + " points.");

    var assemblyStlParts = [
      "micro-gear-pump - hexagon socket head cap screws gb-1.STL",
      "micro-gear-pump - hexagon socket head cap screws gb-2.STL",
      "micro-gear-pump - hexagon socket head cap screws gb-3.STL",
      "micro-gear-pump - hexagon socket head cap screws gb-4.STL",
      "micro-gear-pump - 上-1.STL",
      "micro-gear-pump - 上衬套-1.STL",
      "micro-gear-pump - 上衬套-2.STL",
      "micro-gear-pump - 下-2.STL",
      "micro-gear-pump - 下衬套-1.STL",
      "micro-gear-pump - 下衬套-2.STL",
      "micro-gear-pump - 中-1.STL",
      "micro-gear-pump - 主副齿轮-1 主轴-1.STL",
      "micro-gear-pump - 主副齿轮-1 副轴-1.STL",
      "micro-gear-pump - 主副齿轮-1 圆柱齿轮12×0.8-1.STL",
      "micro-gear-pump - 主副齿轮-1 圆柱齿轮12×0.8-2.STL",
      "micro-gear-pump - 减震硅胶-1.STL",
      "micro-gear-pump - 基准件-1-part1.STL",
      "micro-gear-pump - 基准件-1-part2.STL",
      "micro-gear-pump - 定位销φ3-14-1.STL",
      "micro-gear-pump - 定位销φ3-14-2.STL",
      "micro-gear-pump - 密封橡胶圈-1.STL",
      "micro-gear-pump - 密封橡胶圈-2.STL",
    ];

    tryLoadMesh("assets/micro-gear-pump.stl", function (res) {
      return res.arrayBuffer().then(parseStl);
    }).catch(function () {
      return tryLoadMesh("assets/micro-gear-pump.obj", function (res) {
        return res.text().then(parseObj);
      });
    }).catch(function () {
      return loadAssemblyStlParts(assemblyStlParts);
    }).catch(function () {
      setModelStatus("No STL/OBJ mesh found. Export assets/micro-gear-pump.stl or .obj; showing point-cloud fallback only.");
    });

    var groupDirs = [
      [0, 0, 0.4],   // 外壳 — 向 Z+
      [0, 0.9, 0],   // 上盖 — 向 Y+（上方向）
      [0, -0.9, 0],  // 齿轮 — 向 Y-（下方向）
      [0.7, 0.7, 0], // 紧固件 — 向 XY 对角
      [0, 0, -0.4],  // 泵体 — 向 Z-
      [0, -0.8, 0],  // 底座 — 向 Y-
    ];

    var COLORS = [
      [0.78, 0.80, 0.82], // 0 covers and main light alloy
      [0.72, 0.48, 0.26], // 1 bushings, bronze-like
      [0.93, 0.74, 0.30], // 2 gears and shafts
      [0.24, 0.27, 0.30], // 3 screws and pins
      [0.45, 0.57, 0.65], // 4 center pump body
      [0.05, 0.055, 0.06], // 5 rubber and damping parts
    ];

    groupDirs = [
      [0.0, 0.0, 0.34],
      [0.0, 0.72, 0.18],
      [0.0, -0.72, 0.12],
      [0.0, 0.0, -0.42],
      [-0.48, 0.0, 0.0],
      [0.48, 0.0, 0.0],
      [-0.25, 0.0, 0.36],
      [0.25, 0.0, 0.36],
      [0.0, 0.44, -0.22],
      [0.0, 0.0, -0.72],
      [0.0, -0.36, -0.44],
      [0.62, 0.36, 0.0],
    ];

    COLORS = [
      [0.02, 0.58, 0.82],
      [0.00, 0.78, 0.94],
      [0.00, 0.42, 0.82],
      [0.00, 0.70, 0.88],
      [0.95, 0.18, 0.08],
      [1.00, 0.30, 0.12],
      [0.86, 0.88, 0.90],
      [0.62, 0.66, 0.72],
      [0.95, 0.46, 0.16],
      [0.94, 0.02, 0.02],
      [0.005, 0.005, 0.006],
      [0.78, 0.80, 0.84],
    ];

    for (var ci = 0; ci < 12; ci++) {
      gl.uniform3fv(loc.groupDirs[ci], groupDirs[ci]);
      gl.uniform3fv(loc.colors[ci], COLORS[ci]);
    }

    // ── 矩阵工具 ───────────────────────────────────────────
    function mat4Mul(a, b) {
      var r = new Float32Array(16);
      for (var i = 0; i < 4; i++)
        for (var j = 0; j < 4; j++) {
          var v = 0;
          for (var k = 0; k < 4; k++) v += a[i + k * 4] * b[k + j * 4];
          r[i + j * 4] = v;
        }
      return r;
    }

    function perspective(fov, aspect, near, far) {
      var f = 1 / Math.tan(fov / 2),
        nf = 1 / (near - far);
      return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0,
      ]);
    }

    function lookAt(eye, target, up) {
      var zx = eye[0] - target[0],
        zy = eye[1] - target[1],
        zz = eye[2] - target[2];
      var zl = Math.hypot(zx, zy, zz);
      zx /= zl; zy /= zl; zz /= zl;
      var xx = up[1] * zz - up[2] * zy,
        xy = up[2] * zx - up[0] * zz,
        xz = up[0] * zy - up[1] * zx;
      var xl = Math.hypot(xx, xy, xz);
      xx /= xl; xy /= xl; xz /= xl;
      var yx = zy * xz - zz * xy,
        yy = zz * xx - zx * xz,
        yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
        1,
      ]);
    }

    // ── 相机状态 ───────────────────────────────────────────
    var cam = { theta: 0.4, phi: 0.5, dist: 3.5, autoRot: true, gearMotion: false };

    function render() {
      var w = canvas.width,
        h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.05, 0.09, 0.13, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      if (model.kind === "points") {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.disable(gl.BLEND);
      }

      // 自动旋转
      if (cam.autoRot) cam.theta += 0.004;

      // 齿轮运动模式：绕 Y 轴快速旋转
      if (cam.gearMotion) cam.theta += 0.02;

      // 爆炸距离
      var explodeVal = (parseInt(explodeEl.value) || 0) / 100;

      // 剖切高度：slider 100 → 完整模型，slider 0 → 隐藏所有
      var clipVal = (parseInt(clipEl.value) || 100) / 100 * 2 - 1;

      // 相机位置
      var ex = cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta);
      var ey = cam.dist * Math.cos(cam.phi);
      var ez = cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta);

      var proj = perspective(0.8, w / h, 0.1, 100);
      var view = lookAt([ex, ey, ez], [0, 0, 0], [0, 1, 0]);
      var mvp = mat4Mul(proj, view);

      gl.uniformMatrix4fv(loc.mvp, false, mvp);
      gl.uniform1f(loc.pointSize, parseFloat(pointSizeEl.value) || 3);
      gl.uniform1f(loc.pointMode, model.kind === "points" ? 1 : 0);
      gl.uniform1f(loc.explode, explodeVal * 1.5);
      gl.uniform1f(loc.clipY, clipVal);

      // 绘制点云
      gl.bindBuffer(gl.ARRAY_BUFFER, model.pos.buffer);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, model.group.buffer);
      gl.enableVertexAttribArray(aGroup);
      gl.vertexAttribPointer(aGroup, 1, gl.FLOAT, false, 0, 0);

      gl.drawArrays(model.drawMode, 0, model.count);

      requestAnimationFrame(render);
    }

    // ── 控件绑定 ───────────────────────────────────────────
    var explodeEl = document.getElementById("explodeRange");
    var clipEl = document.getElementById("clipRange");
    var pointSizeEl = document.getElementById("pointSizeRange");
    var autoBtn = document.getElementById("autoRotateButton");
    var gearBtn = document.getElementById("gearMotionButton");
    var resetBtn = document.getElementById("resetViewButton");

    // ── 鼠标交互 ───────────────────────────────────────────
    var dragging = false,
      lastX = 0,
      lastY = 0;

    canvas.addEventListener("mousedown", function (e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      cam.theta += (e.clientX - lastX) * 0.007;
      cam.phi -= (e.clientY - lastY) * 0.007;
      cam.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cam.phi));
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener("mouseup", function () {
      dragging = false;
    });

    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      cam.dist *= e.deltaY > 0 ? 1.08 : 0.92;
      cam.dist = Math.max(1.5, Math.min(8, cam.dist));
    }, { passive: false });

    canvas.addEventListener("dblclick", function () {
      cam.theta = 0.4;
      cam.phi = 0.5;
      cam.dist = 3.5;
      if (explodeEl) explodeEl.value = 0;
      if (clipEl) clipEl.value = 100;
      if (pointSizeEl) pointSizeEl.value = 3;
    });

    // ── 触摸交互 ───────────────────────────────────────────
    var touches = [],
      lastPinch = 0;

    canvas.addEventListener("touchstart", function (e) {
      e.preventDefault();
      touches = Array.from(e.touches);
      if (touches.length === 2) {
        lastPinch = Math.hypot(
          touches[0].clientX - touches[1].clientX,
          touches[0].clientY - touches[1].clientY
        );
      }
    }, { passive: false });

    canvas.addEventListener("touchmove", function (e) {
      e.preventDefault();
      var t = Array.from(e.touches);
      if (t.length === 1 && touches.length >= 1) {
        cam.theta += (t[0].clientX - touches[0].clientX) * 0.007;
        cam.phi -= (t[0].clientY - touches[0].clientY) * 0.007;
        cam.phi = Math.max(0.1, Math.min(Math.PI - 0.1, cam.phi));
      } else if (t.length === 2) {
        var pinch = Math.hypot(
          t[0].clientX - t[1].clientX,
          t[0].clientY - t[1].clientY
        );
        cam.dist *= lastPinch / Math.max(pinch, 1);
        cam.dist = Math.max(1.5, Math.min(8, cam.dist));
        lastPinch = pinch;
      }
      touches = t;
    }, { passive: false });

    canvas.addEventListener("touchend", function (e) {
      touches = Array.from(e.touches);
    });

    // ── 按钮绑定 ───────────────────────────────────────────
    if (autoBtn) {
      autoBtn.addEventListener("click", function () {
        cam.autoRot = !cam.autoRot;
        this.classList.toggle("is-active", cam.autoRot);
        this.setAttribute("aria-pressed", String(cam.autoRot));
      });
    }

    if (gearBtn) {
      gearBtn.addEventListener("click", function () {
        cam.gearMotion = !cam.gearMotion;
        this.classList.toggle("is-active", cam.gearMotion);
        this.setAttribute("aria-pressed", String(cam.gearMotion));
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        cam.theta = 0.4;
        cam.phi = 0.5;
        cam.dist = 3.5;
        if (explodeEl) explodeEl.value = 0;
        if (clipEl) clipEl.value = 100;
        if (pointSizeEl) pointSizeEl.value = 3;
      });
    }

    // 启动渲染
    render();
  })();

  /* ========================================================
     Module B · 2D 齿轮泵流体动画
     ======================================================== */
  (function () {
    var canvas = document.getElementById("pumpCanvas");
    if (!canvas) return;

    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var W = canvas.width,
      H = canvas.height;

    // ── 泵体参数 ───────────────────────────────────────────
    var CX = W * 0.44,
      CY = H * 0.50;
    var R1 = 92,
      R2 = 72,
      TOOTH = 9;
    var CR = R1 + 20,
      GAP = R1 + R2 + 3;
    var INLET = { x: CX - GAP / 2 - 60, y: CY - CR - 20, r: 18 },
      OUTLET = { x: CX + GAP / 2 + 60, y: CY - CR - 20, r: 18 };
    var MAX_P = 240;

    // ── 颜色主题 ───────────────────────────────────────────
    var COL = {
      stroke: "#c0d8e8",
      dim: "#3a5568",
      gear: "rgba(50,160,220,0.13)",
      gearStroke: "#48b0dc",
      gearB: "rgba(100,200,160,0.10)",
      gearBStroke: "#48c8a0",
      shaft: "#2868a0",
      chamber: "rgba(20,80,140,0.08)",
      port: "#f08840",
      suction: "#38c0f0",
      transport: "#50dcb0",
      discharge: "#f06838",
    };

    // ── 动画状态 ───────────────────────────────────────────
    var anim = {
      speed: 56,
      flow: 54,
      angle: 0,
      suction: [],
      transport: [],
      discharge: [],
      mode: "flow",
      t: 0,
    };

    // ── 齿形生成 ───────────────────────────────────────────
    function gearProfile(cx, cy, r, teeth, angle, toothH, toothW) {
      var pts = [];
      var step = (Math.PI * 2) / teeth;
      for (var i = 0; i < teeth; i++) {
        var a = angle + i * step;
        var hw = step * toothW;
        pts.push([
          cx + (r - toothH * 0.5) * Math.cos(a - hw),
          cy + (r - toothH * 0.5) * Math.sin(a - hw),
        ]);
        pts.push([
          cx + (r + toothH * 0.5) * Math.cos(a - hw * 0.45),
          cy + (r + toothH * 0.5) * Math.sin(a - hw * 0.45),
        ]);
        pts.push([
          cx + (r + toothH * 0.5) * Math.cos(a + hw * 0.45),
          cy + (r + toothH * 0.5) * Math.sin(a + hw * 0.45),
        ]);
        pts.push([
          cx + (r - toothH * 0.5) * Math.cos(a + hw),
          cy + (r - toothH * 0.5) * Math.sin(a + hw),
        ]);
      }
      return pts;
    }

    function drawGearPath(cx, cy, r, teeth, angle, th, tw, rotDir) {
      var pts = gearProfile(cx, cy, r, teeth, angle, th, tw);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
    }

    // ── 粒子系统 ───────────────────────────────────────────
    function spawnSuction() {
      var count = Math.floor(anim.flow / 18) + 2;
      for (var i = 0; i < count; i++) {
        anim.suction.push({
          x: INLET.x + (Math.random() - 0.5) * INLET.r * 0.6,
          y: INLET.y + Math.random() * 10,
          vx: (Math.random() - 0.5) * 0.3,
          vy: 0.9 + Math.random() * 0.4,
          life: 1,
          r: 2 + Math.random() * 1.5,
        });
      }
    }

    function spawnTransport() {
      if (Math.random() > anim.flow / 70) return;
      var side = Math.random() > 0.5 ? 1 : -1;
      var yOff = (Math.random() - 0.5) * CR * 0.5;
      anim.transport.push({
        x: CX + (GAP / 2 + 6) * side,
        y: CY + yOff,
        vx: 0,
        vy: -0.4 - Math.random() * 0.3,
        life: 1,
        side: side,
        r: 1.8 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
      });
    }

    function spawnDischarge() {
      var count = Math.floor(anim.flow / 22) + 1;
      for (var i = 0; i < count; i++) {
        anim.discharge.push({
          x: OUTLET.x + (Math.random() - 0.5) * OUTLET.r * 0.4,
          y: OUTLET.y + OUTLET.r + 5,
          vx: (Math.random() - 0.5) * 0.2,
          vy: -1.0 - Math.random() * 0.5,
          life: 1,
          r: 2 + Math.random() * 1.5,
        });
      }
    }

    // ── 背景绘制 ───────────────────────────────────────────
    function drawBackground() {
      // 泵体腔
      ctx.fillStyle = COL.chamber;
      ctx.strokeStyle = COL.dim;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(CX - CR, CY - CR * 1.1);
      ctx.lineTo(CX - CR, CY + CR * 1.1);
      ctx.arc(CX - GAP / 2, CY, CR, Math.PI * 0.5, -Math.PI * 0.5, false);
      ctx.lineTo(CX + GAP / 2, CY - CR);
      ctx.arc(CX + GAP / 2, CY, CR, -Math.PI * 0.5, Math.PI * 0.5, false);
      ctx.lineTo(CX + CR, CY + CR * 1.1);
      ctx.lineTo(CX - CR, CY + CR * 1.1);
      ctx.fill();
      ctx.stroke();

      // 入口
      ctx.strokeStyle = COL.port;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(INLET.x, INLET.y - 50);
      ctx.lineTo(INLET.x, INLET.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(INLET.x, INLET.y, INLET.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(240,136,64,0.10)";
      ctx.fill();
      ctx.stroke();

      // 出口
      ctx.beginPath();
      ctx.moveTo(OUTLET.x, OUTLET.y + OUTLET.r);
      ctx.lineTo(OUTLET.x, OUTLET.y - 50);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(OUTLET.x, OUTLET.y, OUTLET.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(240,136,64,0.10)";
      ctx.fill();
      ctx.stroke();

      // 轴
      ctx.strokeStyle = COL.shaft;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(CX - GAP / 2, CY - R1 - 30);
      ctx.lineTo(CX - GAP / 2, CY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(CX + GAP / 2, CY - R2 - 30);
      ctx.lineTo(CX + GAP / 2, CY);
      ctx.stroke();
      ctx.lineCap = "butt";
    }

    // ── 齿轮绘制 ───────────────────────────────────────────
    function drawGears() {
      // 主齿轮
      ctx.fillStyle = COL.gear;
      ctx.strokeStyle = COL.gearStroke;
      ctx.lineWidth = 1.2;
      drawGearPath(
        CX - GAP / 2, CY, R1, TOOTH, anim.angle, 15, 0.42, 1
      );
      ctx.fill();
      ctx.stroke();

      // 从齿轮（反向旋转）
      ctx.fillStyle = COL.gearB;
      ctx.strokeStyle = COL.gearBStroke;
      drawGearPath(
        CX + GAP / 2, CY, R2, TOOTH, -anim.angle + Math.PI / TOOTH, 15, 0.42, -1
      );
      ctx.fill();
      ctx.stroke();

      // 中心轴点
      ctx.fillStyle = COL.shaft;
      ctx.beginPath();
      ctx.arc(CX - GAP / 2, CY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CX + GAP / 2, CY, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── 粒子更新 ───────────────────────────────────────────
    function updateParticles(arr, type) {
      var spd = anim.speed / 50;
      for (var i = arr.length - 1; i >= 0; i--) {
        var p = arr[i];
        p.life -= 0.006 * spd;

        if (type === "suction") {
          p.x += p.vx * spd;
          p.y += p.vy * spd;
          // 接近齿轮时向两侧偏转
          var dy = p.y - CY;
          if (dy > -CR * 0.4 && dy < CR * 0.4) {
            p.vx += (p.x < CX ? -0.06 : 0.06) * spd;
          }
        } else if (type === "transport") {
          p.vy -= 0.005 * spd;
          p.x += Math.sin(anim.t * 2 + p.phase) * 0.3 * p.side * spd;
          p.y += p.vy * spd;
        } else {
          p.y += p.vy * spd;
          p.x += p.vx * spd;
          p.vy -= 0.012 * spd;
        }

        if (p.life <= 0 || p.y < 0 || p.y > H || p.x < 0 || p.x > W) {
          arr.splice(i, 1);
        }
      }
    }

    // ── 粒子绘制 ───────────────────────────────────────────
    function drawParticles() {
      function render(arr, color) {
        for (var i = 0; i < arr.length; i++) {
          var p = arr[i];
          ctx.globalAlpha = p.life * 0.7;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      render(anim.suction, COL.suction);
      render(anim.transport, COL.transport);
      render(anim.discharge, COL.discharge);
      ctx.globalAlpha = 1;
    }

    // ── 流线模式 ───────────────────────────────────────────
    function drawFlowLines() {
      var spd = anim.speed / 60;
      var offset = anim.t * 60 * spd;

      // 入口流线
      ctx.strokeStyle = COL.suction;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        var sx = INLET.x - 6 + i * 6;
        ctx.moveTo(sx, INLET.y - 60);
        ctx.bezierCurveTo(
          sx, INLET.y - 20,
          sx + (i - 1) * 4, INLET.y - 5,
          INLET.x, INLET.y
        );
        ctx.stroke();
      }

      // 泵体环流
      ctx.strokeStyle = COL.transport;
      for (var ci = -1; ci <= 1; ci += 2) {
        ctx.beginPath();
        var cx = CX + (GAP / 2 + 8) * ci;
        ctx.arc(cx, CY, CR * 0.65, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 出口流线
      ctx.strokeStyle = COL.discharge;
      for (var j = 0; j < 3; j++) {
        ctx.beginPath();
        var ox = OUTLET.x - 6 + j * 6;
        ctx.moveTo(OUTLET.x, OUTLET.y);
        ctx.bezierCurveTo(
          ox + (j - 1) * 4, OUTLET.y - 10,
          ox, OUTLET.y - 30,
          ox, OUTLET.y - 60
        );
        ctx.stroke();
      }

      // 流动点
      var dotColors = [COL.suction, COL.transport, COL.discharge];
      for (var d = 0; d < 12; d++) {
        var phase = (offset + d * 40) % 400;
        var dx, dy, dc;
        if (phase < 100) {
          dc = 0;
          var t = phase / 100;
          dx = INLET.x + (CX - GAP / 2 - INLET.x) * t;
          dy = INLET.y + (CY - INLET.y) * t * t;
        } else if (phase < 250) {
          dc = 1;
          var t2 = (phase - 100) / 150;
          var angle = t2 * Math.PI * 2;
          dx = CX - GAP / 2 + Math.cos(angle) * CR * 0.65;
          dy = CY + Math.sin(angle) * CR * 0.65;
        } else {
          dc = 2;
          var t3 = (phase - 250) / 150;
          dx = CX + GAP / 2 + (OUTLET.x - CX - GAP / 2) * t3;
          dy = CY + (OUTLET.y - CY) * t3 * t3;
        }
        ctx.fillStyle = dotColors[dc];
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ── 剖面模式 ───────────────────────────────────────────
    function drawSectionMode() {
      drawBackground();
      drawGears();

      // 剖面线
      ctx.strokeStyle = "rgba(180,220,255,0.18)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(W * 0.08, CY);
      ctx.lineTo(W * 0.82, CY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = "12px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "left";

      // 区域标注
      function label(text, x, y, color) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
      }

      label("吸入区", INLET.x - 30, CY + CR + 40, COL.suction);
      label(
        "左侧输送",
        CX - GAP / 2 - 50,
        CY + CR + 40,
        COL.transport
      );
      label(
        "右侧输送",
        CX + GAP / 2 + 10,
        CY + CR + 40,
        COL.transport
      );
      label("排出区", OUTLET.x - 30, CY + CR + 40, COL.discharge);

      // 箭头
      var arrows = [
        { x: INLET.x, y: CY - CR - 5, angle: Math.PI / 2, color: COL.suction },
        { x: CX - GAP / 2 - CR * 0.6, y: CY, angle: 0, color: COL.transport },
        { x: CX + GAP / 2 + CR * 0.6, y: CY, angle: Math.PI, color: COL.transport },
        { x: OUTLET.x, y: CY - CR - 5, angle: -Math.PI / 2, color: COL.discharge },
      ];

      for (var ai = 0; ai < arrows.length; ai++) {
        var a = arrows[ai];
        ctx.fillStyle = a.color;
        ctx.globalAlpha = 0.7;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.angle);
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(8, 5);
        ctx.lineTo(-8, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // ── 轮廓模式 ───────────────────────────────────────────
    function drawOutlineMode() {
      ctx.strokeStyle = COL.stroke;
      ctx.lineWidth = 1;

      // 泵壳轮廓
      ctx.beginPath();
      ctx.moveTo(CX - CR, CY - CR * 1.1);
      ctx.lineTo(CX - CR, CY + CR * 1.1);
      ctx.arc(CX - GAP / 2, CY, CR, Math.PI * 0.5, -Math.PI * 0.5, false);
      ctx.lineTo(CX + GAP / 2, CY - CR);
      ctx.arc(CX + GAP / 2, CY, CR, -Math.PI * 0.5, Math.PI * 0.5, false);
      ctx.lineTo(CX + CR, CY + CR * 1.1);
      ctx.lineTo(CX - CR, CY + CR * 1.1);
      ctx.stroke();

      // 齿轮轮廓
      ctx.lineWidth = 0.8;
      drawGearPath(CX - GAP / 2, CY, R1, TOOTH, anim.angle, 15, 0.42, 1);
      ctx.stroke();
      drawGearPath(CX + GAP / 2, CY, R2, TOOTH, -anim.angle + Math.PI / TOOTH, 15, 0.42, -1);
      ctx.stroke();

      // 轴
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(CX - GAP / 2, CY - R1 - 40);
      ctx.lineTo(CX - GAP / 2, CY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(CX + GAP / 2, CY - R2 - 40);
      ctx.lineTo(CX + GAP / 2, CY);
      ctx.stroke();

      // 入口/出口管路
      ctx.strokeStyle = COL.port;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(INLET.x, INLET.y - 60);
      ctx.lineTo(INLET.x, INLET.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(OUTLET.x, OUTLET.y + OUTLET.r);
      ctx.lineTo(OUTLET.x, OUTLET.y - 60);
      ctx.stroke();

      // 中心点
      ctx.fillStyle = COL.stroke;
      ctx.beginPath();
      ctx.arc(CX - GAP / 2, CY, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(CX + GAP / 2, CY, 3, 0, Math.PI * 2);
      ctx.fill();

      // 尺寸标注
      ctx.strokeStyle = "rgba(180,220,255,0.3)";
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(CX - GAP / 2, CY + CR + 30);
      ctx.lineTo(CX + GAP / 2, CY + CR + 30);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "rgba(180,220,255,0.5)";
      ctx.font = "11px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("中心距", CX, CY + CR + 45);
    }

    // ── 标题文字 ───────────────────────────────────────────
    function drawTitle() {
      ctx.fillStyle = COL.stroke;
      ctx.globalAlpha = 0.5;
      ctx.font = "12px 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("微型齿轮泵剖面 · 流体输送仿真", 18, 24);
      ctx.globalAlpha = 1;
    }

    // ── 主循环 ─────────────────────────────────────────────
    function loop() {
      var spd = anim.speed / 50;

      // 更新角度
      anim.angle += 0.022 * spd;
      anim.t += 1 / 60;

      // 生成粒子
      if (anim.mode === "flow") {
        spawnSuction();
        spawnTransport();
        spawnDischarge();
        updateParticles(anim.suction, "suction");
        updateParticles(anim.transport, "transport");
        updateParticles(anim.discharge, "discharge");
      }

      // 清屏
      ctx.clearRect(0, 0, W, H);

      // 根据模式绘制
      if (anim.mode === "flow") {
        drawBackground();
        drawGears();
        drawFlowLines();
        drawParticles();
      } else if (anim.mode === "section") {
        drawSectionMode();
      } else {
        drawOutlineMode();
      }

      drawTitle();

      // 更新状态文字
      var stateText = document.getElementById("stateText");
      if (stateText) {
        if (anim.mode === "flow") {
          stateText.textContent =
            anim.speed > 70
              ? "高速运转 · 吸排同步增强"
              : anim.speed < 20
              ? "低速运转 · 流量减小"
              : "吸入与排出同步进行";
        } else if (anim.mode === "section") {
          stateText.textContent = "剖面视图 · 区域标注模式";
        } else {
          stateText.textContent = "外形轮廓 · 几何结构模式";
        }
      }

      requestAnimationFrame(loop);
    }

    // ── 控件绑定 ───────────────────────────────────────────
    var speedEl = document.getElementById("speedRange");
    var flowEl = document.getElementById("flowRange");
    var modeButtons = document.querySelectorAll(".simulation .toggle-row .icon-button[data-mode]");

    if (speedEl) {
      speedEl.addEventListener("input", function () {
        anim.speed = parseInt(this.value) || 56;
      });
    }

    if (flowEl) {
      flowEl.addEventListener("input", function () {
        anim.flow = parseInt(this.value) || 54;
      });
    }

    modeButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        modeButtons.forEach(function (b) {
          b.classList.remove("is-active");
          b.setAttribute("aria-pressed", "false");
        });
        this.classList.add("is-active");
        this.setAttribute("aria-pressed", "true");
        anim.mode = this.getAttribute("data-mode");
      });
    });

    // 启动动画
    loop();
  })();
})();
