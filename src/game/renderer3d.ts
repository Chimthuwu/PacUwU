import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CANVAS_W, CANVAS_H, COLS, ROWS, TILE, GRID } from './constants';

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;

  private pacMesh!: THREE.Group;
  private ghostMeshes: THREE.Group[] = [];
  private pelletMesh!: THREE.InstancedMesh;
  private powerMesh!: THREE.InstancedMesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.setSize(CANVAS_W, CANVAS_H, false);
    // Remove the CSS scaling/rotation from the canvas itself so we render sharp
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#030514');

    // Camera setup for an isometric/angled view
    this.camera = new THREE.PerspectiveCamera(45, CANVAS_W / CANVAS_H, 1, 3000);
    this.camera.position.set(CANVAS_W / 2, CANVAS_H + 300, 800);
    this.camera.lookAt(CANVAS_W / 2, CANVAS_H / 2, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight('#ffffff', 0.5);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ffffff', 1.0);
    dirLight.position.set(CANVAS_W / 2, CANVAS_H / 2, 500);
    this.scene.add(dirLight);

    // Post-processing Bloom
    const renderScene = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(CANVAS_W, CANVAS_H), 0.6, 0.4, 0.65);
    bloomPass.threshold = 0.65;
    bloomPass.strength = 0.6;
    bloomPass.radius = 0.5;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(bloomPass);

    this.buildMaze();
    this.buildActors();
  }

  private buildMaze() {
    const sideMat = new THREE.MeshStandardMaterial({
      color: '#050717',
      roughness: 0.9,
      metalness: 0.1,
    });
    
    const topMat = new THREE.MeshStandardMaterial({
      color: '#111841',
      emissive: '#092340',
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0.5,
    });

    const wallMaterials = [sideMat, sideMat, sideMat, sideMat, topMat, sideMat];
    const mazeGroup = new THREE.Group();
    const wallGeo = new THREE.BoxGeometry(TILE, TILE, 30);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (GRID[r] && GRID[r][c] === '#') {
          const mesh = new THREE.Mesh(wallGeo, wallMaterials);
          mesh.position.set(c * TILE + TILE/2, r * TILE + TILE/2, 15);
          mazeGroup.add(mesh);
        }
      }
    }

    // Floor
    const floorGeo = new THREE.PlaneGeometry(CANVAS_W, CANVAS_H);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#030514', roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(CANVAS_W / 2, CANVAS_H / 2, 0);
    mazeGroup.add(floor);

    this.scene.add(mazeGroup);
  }

  private buildActors() {
    // Pacman
    this.pacMesh = new THREE.Group();
    const pacGeo = new THREE.SphereGeometry(TILE * 0.45, 32, 32);
    const pacMat = new THREE.MeshStandardMaterial({ 
      color: '#ffd93d', 
      emissive: '#ffb300', 
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });
    const sphere = new THREE.Mesh(pacGeo, pacMat);
    this.pacMesh.add(sphere);
    this.pacMesh.position.set(0, 0, 12);
    this.scene.add(this.pacMesh);

    // Ghosts
    const ghostGeo = new THREE.CapsuleGeometry(TILE * 0.4, TILE * 0.4, 4, 16);
    for (let i = 0; i < 5; i++) {
      const gGroup = new THREE.Group();
      const gMesh = new THREE.Mesh(ghostGeo, new THREE.MeshStandardMaterial({ roughness: 0.3 }));
      gMesh.rotation.x = Math.PI / 2; // Orient capsule correctly
      gGroup.add(gMesh);
      gGroup.position.set(0, 0, 15);
      this.ghostMeshes.push(gGroup);
      this.scene.add(gGroup);
    }

    // Pellets
    const pGeo = new THREE.SphereGeometry(3, 8, 8);
    const pMat = new THREE.MeshStandardMaterial({ color: '#ff9ee8', emissive: '#ff4fd8' });
    this.pelletMesh = new THREE.InstancedMesh(pGeo, pMat, 400);
    this.scene.add(this.pelletMesh);

    const powGeo = new THREE.SphereGeometry(7, 16, 16);
    const powMat = new THREE.MeshStandardMaterial({ color: '#ffe08a', emissive: '#cc9e00' });
    this.powerMesh = new THREE.InstancedMesh(powGeo, powMat, 10);
    this.scene.add(this.powerMesh);
  }

  // Dirty state sync
  public render(game: any) {
    // Update Pacman
    const pacPos = game.posOf(game.pac);
    this.pacMesh.position.set(pacPos.x, pacPos.y, 12);
    
    // Scale mouth/sphere based on chomp
    const chomp = Math.abs(Math.sin(game.pac.chompT)) * 0.2;
    this.pacMesh.scale.set(1, 1 - chomp, 1);

    // Update Ghosts
    const colors = ['#ff3b5c', '#ff9ed2', '#43e0ff', '#43ff9e', '#ffb347'];
    for (let i = 0; i < game.ghosts.length; i++) {
      const g = game.ghosts[i];
      const gPos = game.posOf(g);
      const meshGroup = this.ghostMeshes[i];
      const mesh = meshGroup.children[0] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;

      let targetColor = colors[i];
      if (g.state === 'eyes') targetColor = '#ffffff'; // eyes only
      else if (g.frightened) targetColor = '#2e4fff'; // scared

      mat.color.set(targetColor);
      mat.emissive.set(targetColor);
      mat.emissiveIntensity = g.frightened ? 1.0 : 0.6;

      meshGroup.position.set(gPos.x, gPos.y, 15);
      
      if (g.state === 'house') {
        meshGroup.position.y += Math.sin(g.bouncePhase) * 10;
      }
    }

    // Update Pellets
    const dummy = new THREE.Object3D();
    let pCount = 0;
    let powCount = 0;
    for (const [key, isPower] of game.pellets.entries()) {
      const r = Math.floor(key / COLS);
      const c = key % COLS;
      dummy.position.set(c * TILE + TILE / 2, r * TILE + TILE / 2, 8);
      
      if (isPower) {
        const pulse = 1 + Math.sin(game.time * 5 + r + c) * 0.2;
        dummy.scale.set(pulse, pulse, pulse);
        dummy.updateMatrix();
        this.powerMesh.setMatrixAt(powCount++, dummy.matrix);
      } else {
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.pelletMesh.setMatrixAt(pCount++, dummy.matrix);
      }
    }
    this.pelletMesh.count = pCount;
    this.powerMesh.count = powCount;
    this.pelletMesh.instanceMatrix.needsUpdate = true;
    this.powerMesh.instanceMatrix.needsUpdate = true;

    // Camera shake
    if (game.shakeT > 0) {
      const s = game.shakeT / 0.35;
      const mag = game.shakeMag * s * 2;
      this.camera.position.x = CANVAS_W / 2 + (Math.random() - 0.5) * mag;
      this.camera.position.y = CANVAS_H + 300 + (Math.random() - 0.5) * mag;
    } else {
      this.camera.position.x = CANVAS_W / 2;
      this.camera.position.y = CANVAS_H + 300;
    }

    // We keep Y pointing downwards in our coordinates, but Three.js expects Y to go up.
    // So we just invert the camera's up vector to easily map 2D canvas coordinates!
    this.camera.up.set(0, -1, 0);
    this.camera.lookAt(CANVAS_W / 2, CANVAS_H / 2, 0);

    // Render via composer for Bloom
    this.composer.render();
  }
}
