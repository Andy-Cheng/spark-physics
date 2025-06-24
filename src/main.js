/**
 * Interactive Tavern Demo - Three.js + Rapier Physics + Gaussian Splats
 * 
 * This demo showcases the integration of:
 * - Spark library for Gaussian Splat rendering (@sparkjsdev/spark)
 * - Rapier physics engine for realistic collision detection
 * - Three.js for 3D graphics and scene management
 * - Web Audio API for spatial audio and interactive sound effects
 * 
 * Features:
 * - First-person controls with pointer lock
 * - Physics-based projectile shooting
 * - Animated characters with bone-level collision detection
 * - Gaussian splat environment rendering with collision mesh fallback
 * - Dynamic audio system with distance-based volume and velocity-based pitch
 * - Debug mode for visualizing collision spheres and transform controls
 * 
 * Controls:
 * - Click to enter first-person mode
 * - WASD: Move around
 * - R/F: Fly up/down
 * - Click: Shoot projectiles
 * - Space: Toggle debug mode (shows collision mesh instead of splats)
 */

import * as RAPIER from "@dimforge/rapier3d-compat";
import { SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import { AnimationMixer } from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";

import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ===================================================================================================
// CONFIGURATION
// ===================================================================================================

const CONFIG = {
	// Physics
	GRAVITY: { x: 0, y: -9.81, z: 0 },
	RAPIER_INIT_TIMEOUT: 10000,

	// Movement
	MOVE_SPEED: 5,
	PROJECTILE_SPEED: 15,

	// Audio
	VOICE_COOLDOWN: 1.0,
	MUSIC_VOLUME: 0.15,
	VOICE_VOLUME: 0.4,

	// Physics Objects
	PROJECTILE_RADIUS: 0.2,
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

// ===================================================================================================
// UTILITY FUNCTIONS
// ===================================================================================================

/**
 * Configures materials to respond properly to lighting
 * Converts MeshBasicMaterial to MeshStandardMaterial and adjusts properties
 */
function setupMaterialsForLighting(object, brightnessMultiplier = 1.0) {
	object.traverse((child) => {
		if (child.isMesh && child.material) {
			const materials = Array.isArray(child.material)
				? child.material
				: [child.material];
			const newMaterials = [];

			for (const material of materials) {
				// Remove emissive properties
				if (material.emissive) material.emissive.setHex(0x000000);
				if (material.emissiveIntensity !== undefined)
					material.emissiveIntensity = 0;

				// Convert basic materials to standard materials for lighting
				if (material.type === "MeshBasicMaterial") {
					const newMaterial = new THREE.MeshStandardMaterial({
						color: material.color,
						map: material.map,
						normalMap: material.normalMap,
						roughness: 0.8,
						metalness: 0.1,
					});
					newMaterials.push(newMaterial);
				} else {
					// Adjust existing material properties
					if (material.roughness !== undefined) material.roughness = 0.8;
					if (material.metalness !== undefined) material.metalness = 0.1;

					// Apply brightness multiplier
					if (material.color && brightnessMultiplier !== 1.0) {
						const currentColor = material.color.clone();
						currentColor.multiplyScalar(brightnessMultiplier);
						material.color = currentColor;
					}

					// Fix transparency issues
					if (material.transparent && material.opacity === 1) {
						material.transparent = false;
					}

					newMaterials.push(material);
				}
			}

			// Update mesh material reference
			child.material = Array.isArray(child.material)
				? newMaterials
				: newMaterials[0];
		}
	});
}

/**
 * Creates physics colliders for character bones
 */
function createBoneColliders(character, world) {
	const boneColliders = [];
	character.traverse((child) => {
		if (child.isBone) {
			const bonePos = new THREE.Vector3();
			child.getWorldPosition(bonePos);

			const colliderDesc = RAPIER.ColliderDesc.ball(
				CONFIG.BONE_COLLIDER_RADIUS,
			);
			const bodyDesc =
				RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
					bonePos.x,
					bonePos.y,
					bonePos.z,
				);

			const body = world.createRigidBody(bodyDesc);
			world.createCollider(colliderDesc, body);

			boneColliders.push({ bone: child, body });
		}
	});
	return boneColliders;
}

/**
 * Loads audio files and returns decoded audio buffers
 */
async function loadAudioFiles(audioContext, fileList) {
	try {
		const buffers = await Promise.all(
			fileList.map((file) =>
				fetch(file)
					.then((response) => response.arrayBuffer())
					.then((arrayBuffer) => audioContext.decodeAudioData(arrayBuffer)),
			),
		);
		return buffers;
	} catch (error) {
		console.error("Error loading audio files:", error);
		return [];
	}
}

/**
 * Plays audio with Web Audio API
 */
function playAudio(audioContext, buffer, volume = 1.0, playbackRate = 1.0) {
	if (!audioContext || !buffer) return;

	const source = audioContext.createBufferSource();
	const gainNode = audioContext.createGain();

	source.buffer = buffer;
	source.connect(gainNode);
	gainNode.connect(audioContext.destination);

	gainNode.gain.value = volume;
	source.playbackRate.value = playbackRate;
	source.start(0);

	return source;
}

// ===================================================================================================
// MAIN APPLICATION
// ===================================================================================================

async function init() {
	// ===== RAPIER PHYSICS INITIALIZATION =====
	try {
		const initPromise = RAPIER.init();
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Rapier initialization timeout")),
				CONFIG.RAPIER_INIT_TIMEOUT,
			),
		);
		await Promise.race([initPromise, timeoutPromise]);
		console.log("✓ Rapier physics initialized");
	} catch (error) {
		console.error("Failed to initialize Rapier:", error);
		// Continue without physics - the demo will still show the environment
	}

	// ===== THREE.JS SCENE SETUP =====
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x202020);

	const camera = new THREE.PerspectiveCamera(
		75,
		window.innerWidth / window.innerHeight,
		0.1,
		1000,
	);
	camera.rotation.y = Math.PI; // Start facing opposite direction

	const renderer = new THREE.WebGLRenderer();
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	document.body.appendChild(renderer.domElement);

	// ===== LIGHTING SETUP =====
	// Warm hemisphere lighting
	const hemiLight = new THREE.HemisphereLight(0xfff4e6, 0x2a1a0a, 0.5);
	hemiLight.position.set(0, 20, 0);
	scene.add(hemiLight);

	// Warm directional lighting
	const dirLight = new THREE.DirectionalLight(0xffe6cc, 0.3);
	dirLight.position.set(3, 10, -5);
	scene.add(dirLight);

	// Atmospheric point light
	const pointLight = new THREE.PointLight(0xffa500, 2.0, 10);
	pointLight.position.set(-3.2, -1, 4.5);
	scene.add(pointLight);

	// ===== PHYSICS WORLD =====
	const world = new RAPIER.World(CONFIG.GRAVITY);

	// ===== CONTROLS SETUP =====
	const controls = new PointerLockControls(camera, document.body);

	// UI elements
	const startButton = document.getElementById("start");
	const infoElement = document.getElementById("info");
	const loadingElement = document.getElementById("loading");

	startButton.addEventListener("click", () => controls.lock());
	controls.addEventListener("lock", () => {
		infoElement.style.display = "none";
	});
	controls.addEventListener("unlock", () => {
		infoElement.style.display = "";
	});

	// ===== AUDIO SYSTEM =====
	let audioContext = null;
	const audioBuffers = {};
	const voiceCooldowns = { orc: 0, bartender: 0 };
	let musicSource = null;

	function initAudio() {
		if (audioContext) return;

		audioContext = new (window.AudioContext || window.webkitAudioContext)();

		// Load all audio files
		Promise.all([
			fetch(CONFIG.AUDIO_FILES.BOUNCE)
				.then((response) => response.arrayBuffer())
				.then((buffer) => audioContext.decodeAudioData(buffer))
				.then((buffer) => {
					audioBuffers.bounce = buffer;
					return buffer;
				}),

			loadAudioFiles(audioContext, CONFIG.AUDIO_FILES.ORC_VOICES).then(
				(buffers) => {
					audioBuffers.orcVoices = buffers;
					return buffers;
				},
			),

			loadAudioFiles(audioContext, CONFIG.AUDIO_FILES.BARTENDER_VOICES).then(
				(buffers) => {
					audioBuffers.bartenderVoices = buffers;
					return buffers;
				},
			),

			fetch(CONFIG.AUDIO_FILES.BACKGROUND_MUSIC)
				.then((response) => response.arrayBuffer())
				.then((buffer) => audioContext.decodeAudioData(buffer))
				.then((buffer) => {
					audioBuffers.backgroundMusic = buffer;
					startBackgroundMusic();
				}),
		])
			.then(() => {
				console.log("✓ Audio system initialized");
			})
			.catch((error) => {
				console.error("Audio loading error:", error);
			});
	}

	function startBackgroundMusic() {
		if (!audioContext || !audioBuffers.backgroundMusic) return;

		function playMusic() {
			musicSource = playAudio(
				audioContext,
				audioBuffers.backgroundMusic,
				CONFIG.MUSIC_VOLUME,
			);
			musicSource.onended = playMusic; // Loop the music
		}
		playMusic();
	}

	function playVoiceLine(character) {
		const cooldownKey = character;
		if (voiceCooldowns[cooldownKey] > 0) return;

		const voiceBuffers = audioBuffers[`${character}Voices`];
		if (!voiceBuffers || voiceBuffers.length === 0) return;

		const randomBuffer =
			voiceBuffers[Math.floor(Math.random() * voiceBuffers.length)];
		playAudio(audioContext, randomBuffer, CONFIG.VOICE_VOLUME);

		voiceCooldowns[cooldownKey] = CONFIG.VOICE_COOLDOWN;
		console.log(`${character} speaks`);
	}

	function playBounceSound(position, velocity) {
		if (!audioBuffers.bounce) return;

		// Calculate distance-based volume
		const distance = camera.position.distanceTo(position);
		let volume = Math.max(
			0.1,
			1.0 * (1 - distance / CONFIG.VOLUME_DISTANCE_MAX),
		);

		// Calculate velocity-based pitch and volume
		let pitch = 1.0;
		if (velocity) {
			const speed = velocity.length();
			const normalizedSpeed = Math.min(speed / 20, 1.0);
			volume *= 0.3 + normalizedSpeed * 0.7;
			pitch =
				CONFIG.VELOCITY_PITCH_RANGE.min +
				normalizedSpeed *
					(CONFIG.VELOCITY_PITCH_RANGE.max - CONFIG.VELOCITY_PITCH_RANGE.min);
			pitch *= 0.97 + Math.random() * 0.06; // Add slight random variation
		}

		playAudio(audioContext, audioBuffers.bounce, volume, pitch);
	}

	// Initialize audio on first user interaction
	document.addEventListener("click", initAudio, { once: true });
	document.addEventListener("keydown", initAudio, { once: true });

	// ===== ENVIRONMENT LOADING =====
	let environment = null;
	let splatMesh = null;
	let splatsLoaded = false;

	loadingElement.style.display = "block";

	// Load collision mesh
	const gltfLoader = new GLTFLoader();
	gltfLoader.load(CONFIG.ENVIRONMENT.MESH, (gltf) => {
		environment = gltf.scene;
		scene.add(environment);

		// Create physics colliders from mesh geometry
		environment.traverse((child) => {
			if (child.isMesh) {
				const geometry = child.geometry.clone();
				child.updateWorldMatrix(true, false);
				geometry.applyMatrix4(child.matrixWorld);

				const vertices = new Float32Array(geometry.attributes.position.array);
				let indices;

				if (geometry.index) {
					indices = new Uint32Array(geometry.index.array);
				} else {
					const count = geometry.attributes.position.count;
					indices = new Uint32Array(count);
					for (let i = 0; i < count; i++) indices[i] = i;
				}

				const colliderDesc = RAPIER.ColliderDesc.trimesh(
					vertices,
					indices,
				).setRestitution(CONFIG.ENVIRONMENT_RESTITUTION);
				const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
				world.createCollider(colliderDesc, body);
			}
		});

		console.log("✓ Environment collision mesh loaded");
	});

	// Load Gaussian splats
	splatMesh = new SplatMesh({
		url: CONFIG.ENVIRONMENT.SPLATS,
		onLoad: () => {
			console.log(`✓ Gaussian splats loaded (${splatMesh.numSplats} splats)`);

			splatsLoaded = true;
			if (environment) environment.visible = false; // Hide collision mesh
			scene.add(splatMesh);
			loadingElement.style.display = "none";
		},
	});

	// Configure splat mesh
	const { SPLAT_SCALE } = CONFIG.ENVIRONMENT;
	splatMesh.scale.set(SPLAT_SCALE, -SPLAT_SCALE, SPLAT_SCALE);
	splatMesh.position.set(0, 0, 0);

	// ===== CHARACTER LOADING =====
	const characters = {};
	const animationMixers = {};
	const boneColliders = {};

	// Load Orc
	gltfLoader.load(CONFIG.CHARACTERS.ORC.MODEL, (gltf) => {
		const orc = gltf.scene;
		const config = CONFIG.CHARACTERS.ORC;

		orc.rotation.y = config.ROTATION;
		orc.scale.set(...config.SCALE);
		orc.position.set(...config.POSITION);
		scene.add(orc);

		setupMaterialsForLighting(orc);

		// Setup animation
		if (gltf.animations && gltf.animations.length > 0) {
			animationMixers.orc = new AnimationMixer(orc);
			for (const clip of gltf.animations) {
				animationMixers.orc.clipAction(clip).play();
			}
		}

		boneColliders.orc = createBoneColliders(orc, world);
		characters.orc = orc;

		console.log("✓ Orc character loaded");
	});

	// Load Bartender
	const fbxLoader = new FBXLoader();
	fbxLoader.load(CONFIG.CHARACTERS.BARTENDER.MODEL, (fbx) => {
		const bartender = fbx;
		const config = CONFIG.CHARACTERS.BARTENDER;

		bartender.scale.set(...config.SCALE);
		bartender.position.set(...config.POSITION);
		bartender.rotation.y = config.ROTATION;
		scene.add(bartender);

		setupMaterialsForLighting(bartender, 2.0); // Make bartender brighter

		// Setup animation
		if (fbx.animations && fbx.animations.length > 0) {
			animationMixers.bartender = new AnimationMixer(bartender);
			for (const clip of fbx.animations) {
				animationMixers.bartender.clipAction(clip).play();
			}
		}

		boneColliders.bartender = createBoneColliders(bartender, world);
		characters.bartender = bartender;

		console.log("✓ Bartender character loaded");
	});

	// ===== INPUT HANDLING =====
	const keyState = {};
	let debugMode = false;
	const debugVisuals = { orc: [], bartender: [] };

	// Keyboard input
	window.addEventListener("keydown", (e) => {
		keyState[e.code] = true;

		// Debug mode toggle
		if (e.code === "Space") {
			debugMode = !debugMode;
			toggleDebugMode();
		}
	});

	window.addEventListener("keyup", (e) => {
		keyState[e.code] = false;
	});

	function toggleDebugMode() {
		if (!environment || !splatMesh || !splatsLoaded) return;

		if (debugMode) {
			// Show collision mesh, hide splats
			environment.visible = true;
			scene.remove(splatMesh);

			// Visualize bone colliders
			const characters = ["orc", "bartender"];
			for (let index = 0; index < characters.length; index++) {
				const character = characters[index];
				if (boneColliders[character] && debugVisuals[character].length === 0) {
					const color = index === 0 ? 0xff00ff : 0x00ffff;
					for (const { bone } of boneColliders[character]) {
						const pos = new THREE.Vector3();
						bone.getWorldPosition(pos);

						const sphere = new THREE.Mesh(
							new THREE.SphereGeometry(CONFIG.BONE_COLLIDER_RADIUS, 16, 16),
							new THREE.MeshBasicMaterial({ color, wireframe: true }),
						);
						sphere.position.copy(pos);
						scene.add(sphere);
						debugVisuals[character].push({ sphere, bone });
					}
				}
			}
		} else {
			// Hide collision mesh, show splats
			environment.visible = false;
			scene.add(splatMesh);

			// Remove debug visuals
			for (const character of ["orc", "bartender"]) {
				for (const { sphere } of debugVisuals[character]) {
					scene.remove(sphere);
				}
				debugVisuals[character] = [];
			}
		}
	}

	// Movement
	function updateMovement(deltaTime) {
		if (!controls.isLocked) return;

		const velocity = new THREE.Vector3();

		if (keyState.KeyW) velocity.z += 1;
		if (keyState.KeyS) velocity.z -= 1;
		if (keyState.KeyA) velocity.x += 1;
		if (keyState.KeyD) velocity.x -= 1;
		if (keyState.KeyR) velocity.y += 1;
		if (keyState.KeyF) velocity.y -= 1;

		if (velocity.lengthSq() > 0) {
			velocity.normalize().multiplyScalar(CONFIG.MOVE_SPEED * deltaTime);

			const forward = new THREE.Vector3();
			camera.getWorldDirection(forward);
			forward.y = 0;
			forward.normalize();

			const right = new THREE.Vector3();
			right.crossVectors(camera.up, forward).normalize();

			camera.position.addScaledVector(forward, velocity.z);
			camera.position.addScaledVector(right, velocity.x);
			camera.position.addScaledVector(camera.up, velocity.y);
		}
	}

	// ===== PROJECTILE SYSTEM =====
	const projectiles = [];

	function shootProjectile() {
		const geometry = new THREE.SphereGeometry(CONFIG.PROJECTILE_RADIUS, 16, 16);
		const material = new THREE.MeshStandardMaterial({ color: 0xff4444 });
		const mesh = new THREE.Mesh(geometry, material);

		const origin = camera.position.clone();
		mesh.position.copy(origin);
		scene.add(mesh);

		// Create physics body
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(
			origin.x,
			origin.y,
			origin.z,
		);
		const body = world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.ball(
			CONFIG.PROJECTILE_RADIUS,
		).setRestitution(CONFIG.PROJECTILE_RESTITUTION);
		world.createCollider(colliderDesc, body);

		// Launch projectile
		const direction = new THREE.Vector3();
		camera.getWorldDirection(direction);
		direction.normalize();

		const velocity = direction.multiplyScalar(CONFIG.PROJECTILE_SPEED);
		body.setLinvel(velocity, true);

		projectiles.push({
			mesh,
			body,
			lastVelocity: velocity.clone(),
		});
	}

	// Shooting on click
	window.addEventListener("click", () => {
		if (controls.isLocked) shootProjectile();
	});

	// ===== ANIMATION LOOP =====
	let previousTime = performance.now();

	function animate(currentTime) {
		requestAnimationFrame(animate);
		const deltaTime = (currentTime - previousTime) / 1000;
		previousTime = currentTime;

		// Update movement
		updateMovement(deltaTime);

		// Update voice cooldowns
		for (const key of Object.keys(voiceCooldowns)) {
			if (voiceCooldowns[key] > 0) voiceCooldowns[key] -= deltaTime;
		}

		// Step physics simulation
		world.step();

		// Update projectiles and detect collisions
		for (const projectile of projectiles) {
			const pos = projectile.body.translation();
			const rot = projectile.body.rotation();

			projectile.mesh.position.set(pos.x, pos.y, pos.z);
			projectile.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

			// Bounce detection through velocity change
			const currentVelocity = new THREE.Vector3(
				projectile.body.linvel().x,
				projectile.body.linvel().y,
				projectile.body.linvel().z,
			);

			const velocityChange = currentVelocity
				.clone()
				.sub(projectile.lastVelocity);
			if (velocityChange.length() > CONFIG.BOUNCE_DETECTION_THRESHOLD) {
				const position = new THREE.Vector3(pos.x, pos.y, pos.z);
				playBounceSound(position, currentVelocity);

				// Check character hits
				for (const character of ["orc", "bartender"]) {
					if (boneColliders[character]) {
						const hit = boneColliders[character].some(({ bone }) => {
							const bonePos = new THREE.Vector3();
							bone.getWorldPosition(bonePos);
							return (
								position.distanceTo(bonePos) < CONFIG.CHARACTER_HIT_DISTANCE
							);
						});

						if (hit) playVoiceLine(character);
					}
				}
			}

			projectile.lastVelocity.copy(currentVelocity);
		}

		// Update character animations
		for (const mixer of Object.values(animationMixers)) {
			mixer?.update(deltaTime);
		}

		// Update bone colliders to follow animated bones
		for (const [character, colliders] of Object.entries(boneColliders)) {
			for (const { bone, body } of colliders) {
				const pos = new THREE.Vector3();
				bone.getWorldPosition(pos);
				body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
			}
		}

		// Update debug visuals
		if (debugMode) {
			for (const character of ["orc", "bartender"]) {
				for (const { sphere, bone } of debugVisuals[character]) {
					bone.getWorldPosition(sphere.position);
				}
			}


		}

		renderer.render(scene, camera);
	}

	// ===== WINDOW RESIZE HANDLING =====
	window.addEventListener("resize", () => {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	});

	// Start the animation loop
	animate(previousTime);
	console.log("🚀 Tavern demo initialized successfully!");
}

// Initialize the application
init();
