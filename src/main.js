import * as RAPIER from "@dimforge/rapier3d-compat";
import { SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { AnimationMixer } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
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
	const hemi = new THREE.HemisphereLight(0xfff4e6, 0x2a1a0a, 0.5); // Warm sky, dark ground, slightly increased intensity
	hemi.position.set(0, 20, 0);
	scene.add(hemi);

	const dir = new THREE.DirectionalLight(0xffe6cc, 0.3); // Warm directional light, slightly increased intensity
	dir.position.set(3, 10, -5);
	scene.add(dir);
	
	// Add atmospheric point light
	const pointLight = new THREE.PointLight(0xffa500, 2.0, 10); // Orange-yellow, bright intensity, 10 unit range
	pointLight.position.set(-3.2, -1., 4.5);
	scene.add(pointLight);

	// Rapier physics world
	const gravity = { x: 0, y: -9.81, z: 0 };
	const world = new RAPIER.World(gravity);

	// --- Audio setup for bounce sounds ---
	let audioContext = null;
	let bounceSound = null;
	let backgroundMusic = null;
	let musicSource = null;
	let orcVoiceLines = []; // Array to store orc voice lines
	let bartenderVoiceLines = []; // Array to store bartender voice lines
	let orcVoiceCooldown = 0; // Cooldown timer for orc voice lines
	let bartenderVoiceCooldown = 0; // Cooldown timer for bartender voice lines

	// Initialize audio context (needs user interaction first)
	function initAudio() {
		if (audioContext) return; // Already initialized

		audioContext = new (window.AudioContext || window.webkitAudioContext)();

		// Load bounce sound
		fetch("bounce.mp3")
			.then((response) => response.arrayBuffer())
			.then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
			.then((audioBuffer) => {
				bounceSound = audioBuffer;
				console.log("Bounce sound loaded");
			})
			.catch((error) => console.error("Error loading bounce sound:", error));

		// Load orc voice lines
		const orcVoiceLineFiles = [
			"lines/rocks.mp3",
			"lines/mushroom.mp3",
			"lines/watch.mp3",
			"lines/vex.mp3",
		];
		Promise.all(
			orcVoiceLineFiles.map((file) =>
				fetch(file)
					.then((response) => response.arrayBuffer())
					.then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer)),
			),
		)
			.then((audioBuffers) => {
				orcVoiceLines = audioBuffers;
				console.log("Orc voice lines loaded:", orcVoiceLines.length);
			})
			.catch((error) => console.error("Error loading orc voice lines:", error));

		// Load bartender voice lines
		const bartenderVoiceLineFiles = [
			"lines/working.mp3",
			"lines/juggler.mp3",
			"lines/drink.mp3",
		];
		Promise.all(
			bartenderVoiceLineFiles.map((file) =>
				fetch(file)
					.then((response) => response.arrayBuffer())
					.then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer)),
			),
		)
			.then((audioBuffers) => {
				bartenderVoiceLines = audioBuffers;
				console.log(
					"Bartender voice lines loaded:",
					bartenderVoiceLines.length,
				);
			})
			.catch((error) =>
				console.error("Error loading bartender voice lines:", error),
			);

		// Load and start background music
		fetch("song.mp3")
			.then((response) => response.arrayBuffer())
			.then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer))
			.then((audioBuffer) => {
				backgroundMusic = audioBuffer;
				startBackgroundMusic();
				console.log("Background music loaded and started");
			})
			.catch((error) =>
				console.error("Error loading background music:", error),
			);
	}

	// Start background music loop
	function startBackgroundMusic() {
		if (!audioContext || !backgroundMusic) return;

		function playMusic() {
			musicSource = audioContext.createBufferSource();
			const musicGain = audioContext.createGain();

			musicSource.buffer = backgroundMusic;
			musicSource.connect(musicGain);
			musicGain.connect(audioContext.destination);

			// Set tasteful volume (adjust as needed)
			musicGain.gain.value = 0.15; // 15% volume

			musicSource.start(0);

			// Loop the music
			musicSource.onended = playMusic;
		}

		playMusic();
	}

	// Play random orc voice line with cooldown
	function playOrcVoiceLine() {
		if (!audioContext || orcVoiceLines.length === 0 || orcVoiceCooldown > 0)
			return;

		const randomIndex = Math.floor(Math.random() * orcVoiceLines.length);
		const voiceLine = orcVoiceLines[randomIndex];

		const source = audioContext.createBufferSource();
		const gainNode = audioContext.createGain();

		source.buffer = voiceLine;
		source.connect(gainNode);
		gainNode.connect(audioContext.destination);

		// Set volume for voice line (adjust as needed)
		gainNode.gain.value = 0.4; // 40% volume

		// Set cooldown to prevent overlapping voice lines (1 second)
		orcVoiceCooldown = 1.0;

		source.start(0);
		console.log(`Orc says line ${randomIndex + 1}`);
	}

	// Play random bartender voice line with cooldown
	function playBartenderVoiceLine() {
		if (
			!audioContext ||
			bartenderVoiceLines.length === 0 ||
			bartenderVoiceCooldown > 0
		)
			return;

		const randomIndex = Math.floor(Math.random() * bartenderVoiceLines.length);
		const voiceLine = bartenderVoiceLines[randomIndex];

		const source = audioContext.createBufferSource();
		const gainNode = audioContext.createGain();

		source.buffer = voiceLine;
		source.connect(gainNode);
		gainNode.connect(audioContext.destination);

		// Set volume for voice line (adjust as needed)
		gainNode.gain.value = 0.4; // 40% volume

		// Set cooldown to prevent overlapping voice lines (1 second)
		bartenderVoiceCooldown = 1.0;

		source.start(0);
		console.log(`Bartender says line ${randomIndex + 1}`);
	}

	// Play bounce sound with distance-based volume, velocity-based pitch, and random perturbation
	function playBounceSound(collisionPosition = null, impactVelocity = null) {
		if (!audioContext || !bounceSound) return;

		const source = audioContext.createBufferSource();
		const gainNode = audioContext.createGain();

		source.buffer = bounceSound;
		source.connect(gainNode);
		gainNode.connect(audioContext.destination);

		// Calculate velocity-based pitch with random perturbation
		let pitchVariation = 1.0; // Base pitch

		if (impactVelocity) {
			const velocityMagnitude = impactVelocity.length();
			const minVelocity = 2.0;
			const maxVelocity = 20.0;

			// Clamp velocity to our range
			const clampedVelocity = Math.max(
				minVelocity,
				Math.min(maxVelocity, velocityMagnitude),
			);

			// Velocity-based pitch: higher velocity = higher pitch
			const velocityPitch =
				0.9 +
				((clampedVelocity - minVelocity) / (maxVelocity - minVelocity)) * 0.2; // Range: 0.8 to 1.2

			// Add small random perturbation (±3%)
			const randomPerturbation = 0.97 + Math.random() * 0.06; // Range: 0.97 to 1.03

			pitchVariation = velocityPitch * randomPerturbation;
		} else {
			// Fallback to small random variation if no velocity
			pitchVariation = 0.95 + Math.random() * 0.1;
		}

		source.playbackRate.value = pitchVariation;

		// Calculate volume based on distance from camera and impact velocity
		let volume = 0.5; // Default volume

		if (collisionPosition) {
			const distance = camera.position.distanceTo(collisionPosition);
			const maxDistance = 10; // Maximum distance for full volume
			const minVolume = 0.1; // Minimum volume (10%)
			const maxVolume = 1.0; // Maximum volume (100%)

			// Distance-based volume falloff
			const distanceVolume = Math.max(
				minVolume,
				maxVolume * (1 - distance / maxDistance),
			);

			// Velocity-based volume multiplier
			let velocityMultiplier = 1.0;
			if (impactVelocity) {
				const velocityMagnitude = impactVelocity.length();
				const minVelocity = 2.0; // Minimum velocity for sound
				const maxVelocity = 20.0; // Velocity for maximum volume

				// Clamp velocity to our range and calculate multiplier
				const clampedVelocity = Math.max(
					minVelocity,
					Math.min(maxVelocity, velocityMagnitude),
				);
				velocityMultiplier =
					(clampedVelocity - minVelocity) / (maxVelocity - minVelocity);
				velocityMultiplier = 0.3 + velocityMultiplier * 0.7; // Range: 0.3 to 1.0
			}

			// Combine distance and velocity factors
			volume = distanceVolume * velocityMultiplier;

			console.log(
				`Bounce at distance ${distance.toFixed(1)}, velocity: ${impactVelocity ? impactVelocity.length().toFixed(1) : "N/A"}, volume: ${volume.toFixed(2)}, pitch: ${pitchVariation.toFixed(2)}`,
			);
		}

		gainNode.gain.value = volume;
		source.start(0);
	}

	// Initialize audio on first user interaction
	document.addEventListener("click", initAudio, { once: true });
	document.addEventListener("keydown", initAudio, { once: true });

	// --- Load environment mesh and create collider ---
	let env = null; // Collider mesh reference
	let splat = null; // SplatMesh reference
	let splatsLoaded = false; // Track if splats have finished loading

	// Show loading indicator
	const loadingElement = document.getElementById("loading");
	loadingElement.style.display = "block";

	const loader = new GLTFLoader();
	const mesh_file = "tavern_mesh.glb";
	// const mesh_file = "office.glb";
	// const mesh_file = "kitchen.glb";
	// const mesh_file = "spaceship.glb";
	loader.load(mesh_file, (gltf) => {
		env = gltf.scene;
		scene.add(env);
		// Keep mesh visible initially until splats load

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

			// Switch from mesh to splats now that they're loaded
			splatsLoaded = true;
			if (env) {
				env.visible = false; // Hide the collider mesh
			}
			if (splat && !scene.getObjectById(splat.id)) {
				scene.add(splat); // Add splats to scene if not already there
			}

			// Hide loading indicator
			loadingElement.style.display = "none";
		},
	});
	console.log("splat scale", splat.scale);
	const scale = 3;
	splat.scale.set(scale, -scale, scale);
	splat.position.set(0, 0, 0);
	// Don't add splat to scene yet - wait until it's loaded

	// --- Visibility toggle and scaling controls ---
	const splatInScene = true; // Track if splat is in the scene

	let debugMode = false;
	let orcTransformControls = null;
	let colliderVisuals = [];
	let bartenderColliderVisuals = [];

	window.addEventListener("keydown", (e) => {
		// Toggle debug mode with Spacebar
		if (e.code === "Space") {
			debugMode = !debugMode;
			if (env && splat && splatsLoaded) {
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
					
					// Visualize bartender collider spheres
					if (bartenderBoneColliders.length > 0 && bartenderColliderVisuals.length === 0) {
						for (const { bone } of bartenderBoneColliders) {
							const pos = new THREE.Vector3();
							bone.getWorldPosition(pos);
							const sphereGeo = new THREE.SphereGeometry(0.3, 16, 16);
							const sphereMat = new THREE.MeshBasicMaterial({
								color: 0x00ffff, // Cyan color to distinguish from orc
								wireframe: true,
							});
							const sphere = new THREE.Mesh(sphereGeo, sphereMat);
							sphere.position.copy(pos);
							scene.add(sphere);
							bartenderColliderVisuals.push({ sphere, bone });
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
					
					// Remove bartender collider visuals
					for (const { sphere } of bartenderColliderVisuals) {
						scene.remove(sphere);
					}
					bartenderColliderVisuals = [];
				}
			} else if (env && !splatsLoaded) {
				// If splats haven't loaded yet, just toggle mesh visibility
				env.visible = !env.visible;
			}
		}
		// Scale SplatMesh with - and =
		if (splat && splatsLoaded) {
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
		const collider = world.createCollider(collDesc, body);

		// Shoot in camera direction
		const dir = new THREE.Vector3();
		camera.getWorldDirection(dir);
		dir.normalize();
		const speed = 15;
		body.setLinvel(
			{ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
			true,
		);

		projectiles.push({
			mesh,
			body,
			collider,
			lastVelocity: new THREE.Vector3(
				dir.x * speed,
				dir.y * speed,
				dir.z * speed,
			),
		});
	}

	window.addEventListener("click", () => {
		if (controls.isLocked) shoot();
	});

	// --- Animation loop ---
	let prevTime = performance.now();
	let orc = null;
	let orcMixer = null;
	let orcBoneColliders = [];
	let bartender = null;
	let bartenderMixer = null;
	let bartenderBoneColliders = [];

	// Load orc.glb animated character
	const gltfLoader = new GLTFLoader();
	gltfLoader.load("orc.glb", (gltf) => {
		orc = gltf.scene;
		// Rotate 45 degrees to the left (Y axis) and move back 2 units in X, Y, Z
		orc.rotation.y = Math.PI / 2;
		orc.scale.set(1.5, 1.5, 1.5);
		orc.position.set(-4, -1.5, 2);
		scene.add(orc);

		// Adjust orc materials to respond better to lighting
		orc.traverse((child) => {
			if (child.isMesh && child.material) {
				// Handle both single material and material arrays
				const materials = Array.isArray(child.material)
					? child.material
					: [child.material];
				const newMaterials = [];

				for (let i = 0; i < materials.length; i++) {
					const material = materials[i];

					// Remove any emissive properties that might make it glow
					if (material.emissive) {
						material.emissive.setHex(0x000000);
					}
					if (material.emissiveIntensity !== undefined) {
						material.emissiveIntensity = 0;
					}

					// Ensure material responds to lighting
					if (material.type === "MeshBasicMaterial") {
						// Convert basic materials to standard materials for lighting
						const newMaterial = new THREE.MeshStandardMaterial({
							color: material.color,
							map: material.map,
							normalMap: material.normalMap,
							roughness: 0.8,
							metalness: 0.1,
						});
						newMaterials.push(newMaterial);
					} else {
						// Adjust material properties for better lighting response
						if (material.roughness !== undefined) {
							material.roughness = 0.8; // More matte finish
						}
						if (material.metalness !== undefined) {
							material.metalness = 0.1; // Less metallic
						}

						// Ensure material is not transparent unless intended
						if (material.transparent && material.opacity === 1) {
							material.transparent = false;
						}

						newMaterials.push(material);
					}
				}

				// Update the mesh material reference
				if (Array.isArray(child.material)) {
					child.material = newMaterials;
				} else {
					child.material = newMaterials[0];
				}
			}
		});

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

	// Load bartending character
	const fbxLoader = new FBXLoader();
	fbxLoader.load("Bartending.fbx", (fbx) => {
		bartender = fbx;
		// Scale and position the bartender
		bartender.scale.set(0.01, 0.01, 0.01); // FBX files are often much larger, so scale down
		bartender.position.set(1, -1.5, 3); // Position opposite side from orc
		bartender.rotation.y = -Math.PI / 2; // Rotate to face the center
		scene.add(bartender);

		// Animation setup
		if (fbx.animations && fbx.animations.length > 0) {
			bartenderMixer = new AnimationMixer(bartender);
			for (const clip of fbx.animations) {
				bartenderMixer.clipAction(clip).play();
			}
		}

		// Create collision spheres for bartender bones
		bartenderBoneColliders = [];
		bartender.traverse((child) => {
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
				bartenderBoneColliders.push({ bone: child, body });
			}
		});

		// Adjust bartender materials to respond better to lighting (same as orc)
		bartender.traverse((child) => {
			if (child.isMesh && child.material) {
				// Handle both single material and material arrays
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				const newMaterials = [];
				
				for (let i = 0; i < materials.length; i++) {
					const material = materials[i];
					
					// Remove any emissive properties that might make it glow
					if (material.emissive) {
						material.emissive.setHex(0x000000);
					}
					if (material.emissiveIntensity !== undefined) {
						material.emissiveIntensity = 0;
					}
					
					// Ensure material responds to lighting
					if (material.type === 'MeshBasicMaterial') {
						// Convert basic materials to standard materials for lighting
						const newMaterial = new THREE.MeshStandardMaterial({
							color: material.color,
							map: material.map,
							normalMap: material.normalMap,
							roughness: 0.8,
							metalness: 0.1
						});
						newMaterials.push(newMaterial);
					} else {
						// Adjust material properties for better lighting response
						if (material.roughness !== undefined) {
							material.roughness = 0.8; // More matte finish
						}
						if (material.metalness !== undefined) {
							material.metalness = 0.1; // Less metallic
						}
						
						// Make bartender 2x brighter by adjusting color
						if (material.color) {
							const currentColor = material.color.clone();
							currentColor.multiplyScalar(2.0); // Make 2x brighter
							material.color = currentColor;
						}
						
						// Ensure material is not transparent unless intended
						if (material.transparent && material.opacity === 1) {
							material.transparent = false;
						}
						
						newMaterials.push(material);
					}
				}
				
				// Update the mesh material reference
				if (Array.isArray(child.material)) {
					child.material = newMaterials;
				} else {
					child.material = newMaterials[0];
				}
			}
		});
	});

	function animate(now) {
		requestAnimationFrame(animate);
		const delta = (now - prevTime) / 1000;
		prevTime = now;

		if (controls.isLocked) updateMovement(delta);

		// Update orc voice cooldown
		if (orcVoiceCooldown > 0) {
			orcVoiceCooldown -= delta;
		}

		// Update bartender voice cooldown
		if (bartenderVoiceCooldown > 0) {
			bartenderVoiceCooldown -= delta;
		}

		// Step physics
		world.step();

		// Sync dynamic objects with physics bodies and detect bounces
		for (const projectile of projectiles) {
			const pos = projectile.body.translation();
			const rot = projectile.body.rotation();
			projectile.mesh.position.set(pos.x, pos.y, pos.z);
			projectile.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

			// Detect bounces by monitoring velocity changes
			const currentVelocity = projectile.body.linvel();
			const currentVelVec = new THREE.Vector3(
				currentVelocity.x,
				currentVelocity.y,
				currentVelocity.z,
			);
			const lastVelVec = projectile.lastVelocity;

			// Check if velocity direction changed significantly (indicating a bounce)
			const velocityChange = currentVelVec.clone().sub(lastVelVec);
			if (velocityChange.length() > 2.0) { // Threshold for bounce detection
				console.log(`Collider mesh bounce at position: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`);
				console.log(`Velocity change: (${velocityChange.x.toFixed(2)}, ${velocityChange.y.toFixed(2)}, ${velocityChange.z.toFixed(2)})`);
				playBounceSound(pos, currentVelVec);
				
				// Check if projectile hit the orc
				const projectilePos = new THREE.Vector3(pos.x, pos.y, pos.z);
				for (const { bone } of orcBoneColliders) {
					const bonePos = new THREE.Vector3();
					bone.getWorldPosition(bonePos);
					const distance = projectilePos.distanceTo(bonePos);
					
					// If projectile is close to orc bone, trigger voice line
					if (distance < 0.8) { // Collision threshold
						playOrcVoiceLine();
						break; // Only play one voice line per hit
					}
				}
				
				// Check if projectile hit the bartender
				for (const { bone } of bartenderBoneColliders) {
					const bonePos = new THREE.Vector3();
					bone.getWorldPosition(bonePos);
					const distance = projectilePos.distanceTo(bonePos);
					
					// If projectile is close to bartender bone, trigger voice line
					if (distance < 0.8) { // Collision threshold
						playBartenderVoiceLine();
						break; // Only play one voice line per hit
					}
				}
			}

			// Update last velocity
			projectile.lastVelocity.copy(currentVelVec);
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

		// Update bartender animation
		if (bartenderMixer) {
			bartenderMixer.update(delta);
		}
		// Update bartender bone colliders to follow bones
		if (bartenderBoneColliders.length > 0) {
			for (const { bone, body } of bartenderBoneColliders) {
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
		// Update bartender collider visuals if in debug mode
		if (debugMode && bartenderColliderVisuals.length > 0) {
			for (const { sphere, bone } of bartenderColliderVisuals) {
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
