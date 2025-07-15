/*
 * Interactive Tavern Demo - Three.js + Rapier Physics + Gaussian Splats (Split‑Screen Edition)
 * -----------------------------------------------------------------------------
 * Left view: first‑person (PointerLock) controlled by WASD/mouse.
 * Right view: camera positioned 1m to the right of left camera with same rotation.
 */

import * as RAPIER from "@dimforge/rapier3d-compat";
import { SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { AnimationMixer } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ============================================================================
// CONFIGURATION
// ============================================================================
const CONFIG = {
  // Physics
  GRAVITY: { x: 0, y: -9.81, z: 0 },
  RAPIER_INIT_TIMEOUT: 10_000,

  // Movement
  MOVE_SPEED: 1.5,
  PROJECTILE_SPEED: 10,
  WALKING_RADIUS: 1.7, // 2 meter radius for walking area
  INITIAL_POSITION: { x: -0.9966660888848381, y: 0, z: -0.8759025102943658 },

  // Audio
  VOICE_COOLDOWN: 1.0,
  MUSIC_VOLUME: 0.15,
  VOICE_VOLUME: 0.4,

  // Physics Objects
  PROJECTILE_RADIUS: 0.1,
  PROJECTILE_RESTITUTION: 0.9,
  ENVIRONMENT_RESTITUTION: 0.6,
  BONE_COLLIDER_RADIUS: 0.3,

  // Audio Processing
  BOUNCE_DETECTION_THRESHOLD: 2.0,
  CHARACTER_HIT_DISTANCE: 0.8,
  VELOCITY_PITCH_RANGE: { min: 0.9, max: 1.1 },
  VOLUME_DISTANCE_MAX: 10,

  // Assets
  ENVIRONMENT: {
    MESH: "tavern_mesh.glb",
    SPLATS: "tavern_splats.spz",
    SPLAT_SCALE: 3,
  },

  CHARACTERS: {
    ORC: {
      MODEL: "orc.glb",
      POSITION: [-4, -1.5, 2],
      ROTATION: Math.PI / 2,
      SCALE: [1.5, 1.5, 1.5],
    },
    BARTENDER: {
      MODEL: "Bartending.fbx",
      POSITION: [1, -1.5, 3],
      ROTATION: -Math.PI / 2,
      SCALE: [0.01, 0.01, 0.01],
    },
  },

  AUDIO_FILES: {
    BOUNCE: "bounce.mp3",
    BACKGROUND_MUSIC: "song.mp3",
    ORC_VOICES: [
      "lines/rocks.mp3",
      "lines/mushroom.mp3",
      "lines/watch.mp3",
      "lines/vex.mp3",
    ],
    BARTENDER_VOICES: [
      "lines/working.mp3",
      "lines/juggler.mp3",
      "lines/drink.mp3",
    ],
  },
};

// ============================================================================
// UTILITY FUNCTIONS (lighting helpers, audio, bone colliders, …)
// ============================================================================
function setupMaterialsForLighting(object, brightnessMultiplier = 1) {
  object.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    const newMats = mats.map((mat) => {
      if (mat.emissive) mat.emissive.setHex(0x000000);
      if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0;
      if (mat.type === "MeshBasicMaterial") {
        return new THREE.MeshStandardMaterial({
          color: mat.color,
          map: mat.map,
          normalMap: mat.normalMap,
          roughness: 0.8,
          metalness: 0.1,
          transparent: mat.transparent,
          opacity: mat.opacity,
        });
      }
      if (mat.roughness !== undefined) mat.roughness = 0.8;
      if (mat.metalness !== undefined) mat.metalness = 0.1;
      if (mat.color && brightnessMultiplier !== 1) {
        mat.color = mat.color.clone().multiplyScalar(brightnessMultiplier);
      }
      if (mat.transparent && mat.opacity === 1) mat.transparent = false;
      return mat;
    });
    child.material = Array.isArray(child.material) ? newMats : newMats[0];
  });
}

function createBoneColliders(character, world) {
  const list = [];
  character.traverse((child) => {
    if (!child.isBone) return;
    const p = new THREE.Vector3();
    child.getWorldPosition(p);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(CONFIG.BONE_COLLIDER_RADIUS),
      body,
    );
    list.push({ bone: child, body });
  });
  return list;
}

async function loadAudioFiles(ctx, paths) {
  const buffers = await Promise.all(
    paths.map((p) =>
      fetch(p)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab)),
    ),
  );
  return buffers;
}

function playAudio(ctx, buffer, vol = 1, rate = 1) {
  if (!ctx || !buffer) return;
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  gain.gain.value = vol;
  src.connect(gain).connect(ctx.destination);
  src.start();
  return src;
}

// ============================================================================
// MAIN INIT
// ============================================================================
async function init() {
  // ---------- Physics ----------
  try {
    await Promise.race([
      RAPIER.init(),
      new Promise((_, rej) => setTimeout(() => rej("Rapier timeout"), CONFIG.RAPIER_INIT_TIMEOUT)),
    ]);
  } catch (e) {
    console.error(e);
  }
  const world = new RAPIER.World(CONFIG.GRAVITY);

  // ---------- Scene / Renderer ----------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);

  const aspect = window.innerWidth / window.innerHeight;
  const cameraLeft = new THREE.PerspectiveCamera(75, aspect / 2, 0.1, 1000);
  const cameraRight = new THREE.PerspectiveCamera(75, aspect / 2, 0.1, 1000);
  cameraLeft.position.set(CONFIG.INITIAL_POSITION.x, CONFIG.INITIAL_POSITION.y, CONFIG.INITIAL_POSITION.z);
  cameraRight.position.set(CONFIG.INITIAL_POSITION.x, CONFIG.INITIAL_POSITION.y, CONFIG.INITIAL_POSITION.z);
  cameraLeft.rotation.set(-2.949928752360965, 0.4048590181199358, 3.0653084171957103);
  cameraRight.rotation.set(-2.949928752360965, 0.4048590181199358, 3.0653084171957103);

  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  // ---------- Controls (left view) ----------
  const controls = new PointerLockControls(cameraLeft, document.body);
  const startBtn = document.getElementById("start");
  const infoEl = document.getElementById("info");
  startBtn?.addEventListener("click", () => controls.lock());
  controls.addEventListener("lock", () => (infoEl.style.display = "none"));
  controls.addEventListener("unlock", () => (infoEl.style.display = ""));

  // ---------- Lights ----------
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a1a0a, 1.0)); // Increased from 0.5 to 1.0
  const dir = new THREE.DirectionalLight(0xffe6cc, 0.8); // Increased from 0.3 to 0.8
  dir.position.set(3, 10, -5);
  scene.add(dir);
  const pt = new THREE.PointLight(0xffa500, 3, 10); // Increased from 2 to 3
  pt.position.set(-3.2, -1, 4.5);
  scene.add(pt);

  // ---------- Audio ----------
  let audioCtx;
  const audioBuffers = {};
  const voiceCooldown = { orc: 0, bartender: 0 };
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    Promise.all([
      fetch(CONFIG.AUDIO_FILES.BOUNCE)
        .then((r) => r.arrayBuffer())
        .then((b) => audioCtx.decodeAudioData(b))
        .then((buf) => (audioBuffers.bounce = buf)),
      loadAudioFiles(audioCtx, CONFIG.AUDIO_FILES.ORC_VOICES).then((b) => (audioBuffers.orc = b)),
      loadAudioFiles(audioCtx, CONFIG.AUDIO_FILES.BARTENDER_VOICES).then((b) => (audioBuffers.bartender = b)),
      fetch(CONFIG.AUDIO_FILES.BACKGROUND_MUSIC)
        .then((r) => r.arrayBuffer())
        .then((b) => audioCtx.decodeAudioData(b))
        .then((buf) => {
          (function loop() {
            playAudio(audioCtx, buf, CONFIG.MUSIC_VOLUME).onended = loop;
          })();
        }),
    ]).catch(console.error);
  }
  document.addEventListener("click", initAudio, { once: true });
  document.addEventListener("keydown", initAudio, { once: true });

  function playVoice(char) {
    if (voiceCooldown[char] > 0) return;
    const list = audioBuffers[char];
    if (!list?.length) return;
    playAudio(audioCtx, list[Math.floor(Math.random() * list.length)], CONFIG.VOICE_VOLUME);
    voiceCooldown[char] = CONFIG.VOICE_COOLDOWN;
  }

  function playBounce(pos, vel) {
    if (!audioBuffers.bounce) return;
    const dist = cameraLeft.position.distanceTo(pos);
    let vol = Math.max(0.1, 1 - dist / CONFIG.VOLUME_DISTANCE_MAX);
    const speed = vel.length();
    const normSpeed = Math.min(speed / 20, 1);
    vol *= 0.3 + normSpeed * 0.7;
    const pitch =
      CONFIG.VELOCITY_PITCH_RANGE.min +
      normSpeed * (CONFIG.VELOCITY_PITCH_RANGE.max - CONFIG.VELOCITY_PITCH_RANGE.min);
    playAudio(audioCtx, audioBuffers.bounce, vol, pitch);
  }

  // ---------- Environment ----------
  const gltf = new GLTFLoader();
  const fbx = new FBXLoader();
  const loadingEl = document.getElementById("loading");
  loadingEl.style.display = "block";

  // Collision mesh & visual splats
  let collisionEnv;
  let splatMesh;
  gltf.load(CONFIG.ENVIRONMENT.MESH, (g) => {
    collisionEnv = g.scene;
    scene.add(collisionEnv);
    collisionEnv.traverse((c) => {
      if (!c.isMesh) return;
      const geom = c.geometry.clone();
      c.updateWorldMatrix(true, false);
      geom.applyMatrix4(c.matrixWorld);
      const verts = new Float32Array(geom.attributes.position.array);
      const inds = geom.index
        ? new Uint32Array(geom.index.array)
        : Uint32Array.from({ length: geom.attributes.position.count }, (_, i) => i);
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      world.createCollider(
        RAPIER.ColliderDesc.trimesh(verts, inds).setRestitution(CONFIG.ENVIRONMENT_RESTITUTION),
        body,
      );
    });
  });

  splatMesh = new SplatMesh({
    url: CONFIG.ENVIRONMENT.SPLATS,
    onLoad: () => {
      splatMesh.scale.set(CONFIG.ENVIRONMENT.SPLAT_SCALE, -CONFIG.ENVIRONMENT.SPLAT_SCALE, CONFIG.ENVIRONMENT.SPLAT_SCALE);
      scene.add(splatMesh);
      if (collisionEnv) collisionEnv.visible = false;
      loadingEl.style.display = "none";
    },
  });

  // ---------- Characters ----------
  const boneColliders = {};
  const animMixers = {};
  const characters = {};

  gltf.load(CONFIG.CHARACTERS.ORC.MODEL, (g) => {
    const orc = g.scene;
    const cfg = CONFIG.CHARACTERS.ORC;
    orc.position.set(...cfg.POSITION);
    orc.rotation.y = cfg.ROTATION;
    orc.scale.set(...cfg.SCALE);
    setupMaterialsForLighting(orc);
    scene.add(orc);
    animMixers.orc = new AnimationMixer(orc);
    g.animations.forEach((clip) => animMixers.orc.clipAction(clip).play());
    boneColliders.orc = createBoneColliders(orc, world);
    characters.orc = orc;
  });

  fbx.load(CONFIG.CHARACTERS.BARTENDER.MODEL, (m) => {
    const cfg = CONFIG.CHARACTERS.BARTENDER;
    m.position.set(...cfg.POSITION);
    m.rotation.y = cfg.ROTATION;
    m.scale.set(...cfg.SCALE);
    setupMaterialsForLighting(m, 2);
    scene.add(m);
    animMixers.bartender = new AnimationMixer(m);
    m.animations.forEach((clip) => animMixers.bartender.clipAction(clip).play());
    boneColliders.bartender = createBoneColliders(m, world);
    characters.bartender = m;
  });

  // ---------- Input / Movement ----------
  const keys = {};
  window.addEventListener("keydown", (e) => (keys[e.code] = true));
  window.addEventListener("keyup", (e) => (keys[e.code] = false));

  function updateMovement(dt) {
    if (!controls.isLocked) return;
    const dir = new THREE.Vector3();
    if (keys.KeyW) dir.z += 1;
    if (keys.KeyS) dir.z -= 1;
    if (keys.KeyA) dir.x += 1;
    if (keys.KeyD) dir.x -= 1;
    if (keys.KeyR) dir.y += 1;
    if (keys.KeyF) dir.y -= 1;
    if (dir.lengthSq() === 0) return;
    dir.normalize().multiplyScalar(CONFIG.MOVE_SPEED * dt);
    const fwd = new THREE.Vector3();
    cameraLeft.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(cameraLeft.up, fwd).normalize();
    
    // Calculate new position
    const newPosition = cameraLeft.position.clone();
    newPosition.addScaledVector(fwd, dir.z);
    newPosition.addScaledVector(right, dir.x);
    newPosition.addScaledVector(cameraLeft.up, dir.y);
    
    // Check if new position is within walking radius (ignore Y coordinate)
    const horizontalDistance = Math.sqrt((newPosition.x - CONFIG.INITIAL_POSITION.x) * (newPosition.x - CONFIG.INITIAL_POSITION.x) + (newPosition.z - CONFIG.INITIAL_POSITION.z) * (newPosition.z - CONFIG.INITIAL_POSITION.z));
    if (horizontalDistance <= CONFIG.WALKING_RADIUS) {
      cameraLeft.position.copy(newPosition);
    }
  }

  // ---------- Projectiles ----------
  const projectiles = [];
  function shoot() {
    const geom = new THREE.SphereGeometry(CONFIG.PROJECTILE_RADIUS, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(cameraLeft.position);
    scene.add(mesh);

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
      ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(CONFIG.PROJECTILE_RADIUS).setRestitution(CONFIG.PROJECTILE_RESTITUTION),
      body,
    );
    const dir = new THREE.Vector3();
    cameraLeft.getWorldDirection(dir).normalize();
    const vel = dir.multiplyScalar(CONFIG.PROJECTILE_SPEED);
    body.setLinvel(vel, true);
    projectiles.push({ mesh, body, lastVel: vel.clone() });
  }
  window.addEventListener("click", () => controls.isLocked && shoot());

  // ---------- Animation Loop ----------
  let prev = performance.now();
  const rightCameraOffset = 1; // 1 meter to the right

  function animate(t) {
    requestAnimationFrame(animate);
    const dt = (t - prev) / 1000;
    prev = t;

    updateMovement(dt);
    Object.keys(voiceCooldown).forEach((k) => (voiceCooldown[k] = Math.max(0, voiceCooldown[k] - dt)));
    world.step();

    // Update projectiles
    projectiles.forEach((p) => {
      const pos = p.body.translation();
      const rot = p.body.rotation();
      p.mesh.position.set(pos.x, pos.y, pos.z);
      p.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
      const vel = new THREE.Vector3(p.body.linvel().x, p.body.linvel().y, p.body.linvel().z);
      if (vel.clone().sub(p.lastVel).length() > CONFIG.BOUNCE_DETECTION_THRESHOLD) {
        playBounce(new THREE.Vector3(pos.x, pos.y, pos.z), vel);
        ["orc", "bartender"].forEach((char) => {
          if (!boneColliders[char]) return;
          const hit = boneColliders[char].some(({ bone }) => {
            const bp = new THREE.Vector3();
            bone.getWorldPosition(bp);
            return bp.distanceTo(p.mesh.position) < CONFIG.CHARACTER_HIT_DISTANCE;
          });
          if (hit) playVoice(char);
        });
      }
      p.lastVel.copy(vel);
    });

    // Advance animations
    Object.values(animMixers).forEach((m) => m.update(dt));
    // Sync bone colliders
    Object.values(boneColliders).forEach((arr) => {
      arr.forEach(({ bone, body }) => {
        const bp = new THREE.Vector3();
        bone.getWorldPosition(bp);
        body.setTranslation({ x: bp.x, y: bp.y, z: bp.z }, true);
      });
    });

    console.log(cameraLeft.position);
    // Right camera follows left camera, 1m to the right
    const rightVector = new THREE.Vector3(1, 0, 0); // Local right direction
    rightVector.applyQuaternion(cameraLeft.quaternion); // Transform to world space based on left camera's rotation
    cameraRight.position.copy(cameraLeft.position).add(rightVector.multiplyScalar(rightCameraOffset));
    cameraRight.quaternion.copy(cameraLeft.quaternion); // Same rotation as left camera

    // Render split‑screen
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setScissorTest(true);

    renderer.setViewport(0, 0, w / 2, h);
    renderer.setScissor(0, 0, w / 2, h);
    renderer.render(scene, cameraLeft);

    renderer.setViewport(w / 2, 0, w / 2, h);
    renderer.setScissor(w / 2, 0, w / 2, h);
    renderer.render(scene, cameraRight);

    renderer.setScissorTest(false);
  }
  animate(performance.now());

  // ---------- Resize ----------
  window.addEventListener("resize", () => {
    const asp = window.innerWidth / window.innerHeight;
    cameraLeft.aspect = asp / 2;
    cameraRight.aspect = asp / 2;
    cameraLeft.updateProjectionMatrix();
    cameraRight.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// Start the game
init();