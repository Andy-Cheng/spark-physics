import * as RAPIER from "@dimforge/rapier3d-compat";
import { SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { AnimationMixer } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

async function init() {
	try {
		// Initialize Rapier WASM with a timeout
		const initPromise = RAPIER.init();
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Rapier initialization timeout")),
				10000,
			),
		);
		await Promise.race([initPromise, timeoutPromise]);
		console.log("Rapier initialized successfully");
	} catch (error) {
		console.error("Failed to initialize Rapier:", error);
		// Continue without physics for now
	}

	// Three.js scene setup
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x202020);

	const camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000,
	);
	// print camera's extrinsic matrix
	console.log(camera.matrix);
	// camera.position.set(0, 1.6, 0); // Eye-level height
	// Turn the camera around 180 degrees
	camera.rotation.y = Math.PI;

	const renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild(renderer.domElement);

	// Pointer-lock first-person controls
	const controls = new PointerLockControls(camera, document.body);

	// UI to enter pointer-lock
	const startButton = document.getElementById("start");
	startButton.addEventListener("click", () => controls.lock());

	controls.addEventListener("lock", () => {
		document.getElementById("info").style.display = "none";
	});
	controls.addEventListener("unlock", () => {
		document.getElementById("info").style.display = "";
	});

	// Basic lighting
	const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
	hemi.position.set(0, 20, 0);
	scene.add(hemi);

	const dir = new THREE.DirectionalLight(0xffffff, 0.5);
	dir.position.set(-3, 10, -10);
	scene.add(dir);

	// Rapier physics world
	const gravity = { x: 0, y: -9.81, z: 0 };
	const world = new RAPIER.World(gravity);

	// --- Load environment mesh and create collider ---
	let env = null; // Collider mesh reference
	let splat = null; // SplatMesh reference
	const loader = new GLTFLoader();
	const mesh_file = "tavern_mesh.glb";
	// const mesh_file = "office.glb";
	// const mesh_file = "kitchen.glb";
	// const mesh_file = "spaceship.glb";
	loader.load(mesh_file, (gltf) => {
		env = gltf.scene;
		scene.add(env);

		// Optionally, scale or rotate tavern env here if needed.
		env.traverse((child) => {
			if (child.isMesh) {
				// Convert geometry to world coordinates so a single fixed body works.
				const geo = child.geometry.clone();
				child.updateWorldMatrix(true, false);
				geo.applyMatrix4(child.matrixWorld);
				console.log("geo child matrix");
				console.log(child.matrixWorld);

				const posAttr = geo.attributes.position;
				const vertices = new Float32Array(posAttr.array);

				let indices;
				if (geo.index) {
					indices = new Uint32Array(geo.index.array);
				} else {
					// Non-indexed geom: generate sequential indices
					const count = posAttr.count;
					indices = new Uint32Array(count);
					for (let i = 0; i < count; i++) indices[i] = i;
				}

				const colliderDesc = RAPIER.ColliderDesc.trimesh(
					vertices,
					indices,
				).setRestitution(0.6);
				const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
				world.createCollider(colliderDesc, body);
			}

			// print bounding box of child
			const boundingBox = new THREE.Box3().setFromObject(child);
			console.log("bounding box", boundingBox);
		});
	});

	// --- Load gaussian splat scene ---
	// const splat_file = "tavern_splats.ply";
	const splat_file = "tavern_splats.spz";
	// const splat_file = "office.ply";
	// const splat_file = "kitchen.ply";
	// const splat_file = "spaceship.ply";
	splat = new SplatMesh({
		url: splat_file,
		onLoad: () => {
			console.log("Splat scene loaded. Total splats:", splat.numSplats);
			console.log("splat scale after load", splat.scale);
			console.log(splat);

			// Compute stats on splat centers
			const minPos = new THREE.Vector3(
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
				Number.POSITIVE_INFINITY,
			);
			const maxPos = new THREE.Vector3(
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
				Number.NEGATIVE_INFINITY,
			);
			const sumPos = new THREE.Vector3(0, 0, 0);
			const numSplats = splat.numSplats;

			splat.packedSplats.forEachSplat(
				(index, center, scales, quaternion, opacity, color) => {
					// Update min
					minPos.x = Math.min(minPos.x, center.x);
					minPos.y = Math.min(minPos.y, center.y);
					minPos.z = Math.min(minPos.z, center.z);

					// Update max
					maxPos.x = Math.max(maxPos.x, center.x);
					maxPos.y = Math.max(maxPos.y, center.y);
					maxPos.z = Math.max(maxPos.z, center.z);

					// Accumulate sum
					sumPos.add(center);
				},
			);

			// Calculate mean by dividing sum by number of splats
			const meanPos = sumPos.divideScalar(numSplats);

			console.log("Splat position statistics:");
			console.log("Min:", minPos);
			console.log("Max:", maxPos);
			console.log("Mean:", meanPos);
		},
	});
	console.log("splat scale", splat.scale);
	const scale = 3;
	splat.scale.set(scale, -scale, scale);
	splat.position.set(0, 0, 0);
	scene.add(splat);

	// --- Visibility toggle and scaling controls ---
	const splatInScene = true; // Track if splat is in the scene

	let debugMode = false;
	let orcTransformControls = null;
	let colliderVisuals = [];

	window.addEventListener("keydown", (e) => {
		// Toggle debug mode with Spacebar
		if (e.code === "Space") {
			debugMode = !debugMode;
			if (env && splat) {
				if (debugMode) {
					// Show collider mesh, hide splats
					env.visible = true;
					if (scene.getObjectById(splat.id)) scene.remove(splat);

					// Attach TransformControls to orc
					if (orc && !orcTransformControls) {
						console.log("Attaching TransformControls to orc");
						console.log("orc is Object3D:", orc instanceof THREE.Object3D);
						orcTransformControls = new TransformControls(
							camera,
							renderer.domElement,
						);
						orcTransformControls.attach(orc);
						orcTransformControls.size = 25.0;
						orcTransformControls.enabled = true;
						orcTransformControls.visible = true;
						orcTransformControls.setMode("translate");
						orcTransformControls.addEventListener("mouseDown", () =>
							controls.unlock(),
						);
						renderer.render(scene, camera);
					}

					// Visualize collider spheres
					if (orcBoneColliders.length > 0 && colliderVisuals.length === 0) {
						for (const { bone } of orcBoneColliders) {
							const pos = new THREE.Vector3();
							bone.getWorldPosition(pos);
							const sphereGeo = new THREE.SphereGeometry(0.3, 16, 16);
							const sphereMat = new THREE.MeshBasicMaterial({
								color: 0xff00ff,
								wireframe: true,
							});
							const sphere = new THREE.Mesh(sphereGeo, sphereMat);
							sphere.position.copy(pos);
							scene.add(sphere);
							colliderVisuals.push({ sphere, bone });
						}
					}
				} else {
					// Hide collider mesh, show splats
					env.visible = false;
					if (!scene.getObjectById(splat.id)) scene.add(splat);

					// Remove TransformControls
					if (orcTransformControls) {
						scene.remove(orcTransformControls);
						orcTransformControls.dispose();
						orcTransformControls = null;
					}

					// Remove collider visuals
					for (const { sphere } of colliderVisuals) {
						scene.remove(sphere);
					}
					colliderVisuals = [];
				}
			}
		}
		// Scale SplatMesh with - and =
		if (splat) {
			if (e.key === "-") {
				splat.scale.multiplyScalar(0.95);
			}
			if (e.key === "=" || e.key === "+") {
				splat.scale.multiplyScalar(1.05);
			}
		}
		console.log(splat.scale);
	});

	// --- Movement controls (WASD) ---
	const keyState = {};
	window.addEventListener("keydown", (e) => {
		keyState[e.code] = true;
	});
	window.addEventListener("keyup", (e) => {
		keyState[e.code] = false;
	});

	const moveVelocity = new THREE.Vector3();
	function updateMovement(delta) {
		const speed = 5; // units/sec
		moveVelocity.set(0, 0, 0);

		if (keyState.KeyW) moveVelocity.z += 1;
		if (keyState.KeyS) moveVelocity.z -= 1;
		if (keyState.KeyA) moveVelocity.x += 1;
		if (keyState.KeyD) moveVelocity.x -= 1;
		// up and down with R and F
		if (keyState.KeyR) moveVelocity.y += 1;
		if (keyState.KeyF) moveVelocity.y -= 1;

		if (moveVelocity.lengthSq() > 0) {
			moveVelocity.normalize().multiplyScalar(speed * delta);

			const forward = new THREE.Vector3();
			camera.getWorldDirection(forward);
			forward.y = 0; // stay horizontal
			forward.normalize();

			const right = new THREE.Vector3();
			right.crossVectors(camera.up, forward).normalize();

			camera.position.addScaledVector(forward, moveVelocity.z);
			camera.position.addScaledVector(right, moveVelocity.x);
			// use world up for up
			camera.position.addScaledVector(camera.up, moveVelocity.y);
		}
	}

	// --- Shooting balls ---
	const projectiles = [];
	function shoot() {
		const radius = 0.2;
		const geo = new THREE.SphereGeometry(radius, 16, 16);
		const mat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
		const mesh = new THREE.Mesh(geo, mat);

		const origin = new THREE.Vector3().copy(camera.position);
		mesh.position.copy(origin);
		scene.add(mesh);

		const rbDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(
			origin.x,
			origin.y,
			origin.z,
		);
		const body = world.createRigidBody(rbDesc);
		const collDesc = RAPIER.ColliderDesc.ball(radius).setRestitution(0.9);
		world.createCollider(collDesc, body);

		// Shoot in camera direction
		const dir = new THREE.Vector3();
		camera.getWorldDirection(dir);
		dir.normalize();
		const speed = 15;
		body.setLinvel(
			{ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
			true,
		);

		projectiles.push({ mesh, body });
	}

	window.addEventListener("click", () => {
		if (controls.isLocked) shoot();
	});

	// --- Animation loop ---
	let prevTime = performance.now();
	let orc = null;
	let orcMixer = null;
	let orcBoneColliders = [];

	// Load orc.glb animated character
	const gltfLoader = new GLTFLoader();
	gltfLoader.load("orc.glb", (gltf) => {
		orc = gltf.scene;
		// Rotate 45 degrees to the left (Y axis) and move back 2 units in X, Y, Z
		orc.rotation.y = Math.PI / 2;
		orc.scale.set(1.5, 1.5, 1.5);
		orc.position.set(-4, -1.5, 2);
		scene.add(orc);

		// Animation setup
		if (gltf.animations && gltf.animations.length > 0) {
			orcMixer = new AnimationMixer(orc);
			for (const clip of gltf.animations) {
				orcMixer.clipAction(clip).play();
			}
		}

		// Finer per-frame colliders: attach a small sphere collider to each bone
		orcBoneColliders = [];
		orc.traverse((child) => {
			if (child.isBone) {
				// Create a small sphere collider for each bone
				const bonePos = new THREE.Vector3();
				child.getWorldPosition(bonePos);
				const colliderDesc = RAPIER.ColliderDesc.ball(0.3); // small sphere
				const bodyDesc =
					RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
						bonePos.x,
						bonePos.y,
						bonePos.z,
					);
				const body = world.createRigidBody(bodyDesc);
				world.createCollider(colliderDesc, body);
				orcBoneColliders.push({ bone: child, body });
			}
		});
	});

	function animate(now) {
		requestAnimationFrame(animate);
		const delta = (now - prevTime) / 1000;
		prevTime = now;

		if (controls.isLocked) updateMovement(delta);

		// Step physics
		world.step();

		// Sync dynamic objects with physics bodies
		for (const { mesh, body } of projectiles) {
			const pos = body.translation();
			const rot = body.rotation();
			mesh.position.set(pos.x, pos.y, pos.z);
			mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
		}

		// Update orc animation
		if (orcMixer) {
			orcMixer.update(delta);
		}
		// Update orc bone colliders to follow bones
		if (orcBoneColliders.length > 0) {
			for (const { bone, body } of orcBoneColliders) {
				const pos = new THREE.Vector3();
				bone.getWorldPosition(pos);
				body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
			}
		}
		// Update collider visuals if in debug mode
		if (debugMode && colliderVisuals.length > 0) {
			for (const { sphere, bone } of colliderVisuals) {
				bone.getWorldPosition(sphere.position);
			}
		}
		// Update TransformControls if present
		if (orcTransformControls) {
			orcTransformControls.update();
		}

		renderer.render(scene, camera);
	}
	animate(prevTime);

	// Handle resize
	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});
}

init();
