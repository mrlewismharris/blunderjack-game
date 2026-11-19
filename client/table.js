import * as THREE from "./vendor/three.module.js";

const CARD_SUITS = {
  clubs: new Path2D("M9 22h6l-1-6c5 3 11-3 6-7-2-2-4-1-4-1 3-9-11-9-8 0-7-3-11 6-5 9 2 1 4 0 7-1Z"),
  diamonds: new Path2D("M12 1 22 12 12 23 2 12Z"),
  hearts: new Path2D("M12 22 3 13C-5 4 7-3 12 5 17-3 29 4 21 13Z"),
  spades: new Path2D("M9 23h6l-1-6c6 4 12-3 7-8L12 1 3 9c-5 5 1 12 7 8Z"),
};

function drawSuit(context, suit, x, y, size) {
  if (!CARD_SUITS[suit]) return;
  context.save();
  context.translate(x, y);
  context.scale(size / 24, size / 24);
  context.fill(CARD_SUITS[suit]);
  context.restore();
}
const FACE_RANKS = { 11: "J", 12: "Q", 13: "K" };

function isRedSuit(suit) {
  return suit === "hearts" || suit === "diamonds";
}
const TABLE_TOP = 1.228;
const SEAT_COUNT = 10;
const TAU = Math.PI * 2;
const HAND_REFERENCE_FOV = 57;
const OVERVIEW = {
  yaw: 0.04,
  pitch: 0.71,
  distance: 12.4,
  x: 0,
  y: 1.04,
  z: 0,
};

function material(color, properties) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.77,
    ...properties,
  });
}

function mesh(parent, geometry, surface, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, surface);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function box(parent, surface, size, position) {
  return mesh(parent, new THREE.BoxGeometry(...size), surface, ...position);
}

function sphere(parent, surface, size, position) {
  const object = mesh(
    parent,
    new THREE.SphereGeometry(1, 18, 12),
    surface,
    ...position,
  );
  object.scale.set(...size);
  return object;
}

function roundedRectangle(halfWidth, halfDepth, radius) {
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + radius, -halfDepth);
  shape.lineTo(halfWidth - radius, -halfDepth);
  shape.absarc(
    halfWidth - radius,
    -halfDepth + radius,
    radius,
    -Math.PI / 2,
    0,
  );
  shape.lineTo(halfWidth, halfDepth - radius);
  shape.absarc(halfWidth - radius, halfDepth - radius, radius, 0, Math.PI / 2);
  shape.lineTo(-halfWidth + radius, halfDepth);
  shape.absarc(
    -halfWidth + radius,
    halfDepth - radius,
    radius,
    Math.PI / 2,
    Math.PI,
  );
  shape.lineTo(-halfWidth, -halfDepth + radius);
  shape.absarc(
    -halfWidth + radius,
    -halfDepth + radius,
    radius,
    Math.PI,
    Math.PI * 1.5,
  );
  shape.closePath();
  return shape;
}

function makePokerTable(scene) {
  const apron = material(0x182824, { roughness: 0.55 });
  const rail = material(0x253b32, { roughness: 0.4 });
  const seam = material(0xb7a987, { metalness: 0.55, roughness: 0.35 });
  const feltCanvas = document.createElement("canvas");
  feltCanvas.width = feltCanvas.height = 256;
  const feltContext = feltCanvas.getContext("2d");
  const pixels = feltContext.createImageData(256, 256);
  // Fine, low-contrast fibres give the surface a soft woven appearance.
  let seed = 1837;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const variation = (seed >>> 27) - 16;
    pixels.data[i] = 20 + variation * 0.2;
    pixels.data[i + 1] = 105 + variation * 0.7;
    pixels.data[i + 2] = 64 + variation * 0.35;
    pixels.data[i + 3] = 255;
  }
  feltContext.putImageData(pixels, 0, 0);
  const feltTexture = new THREE.CanvasTexture(feltCanvas);
  feltTexture.colorSpace = THREE.SRGBColorSpace;
  feltTexture.wrapS = feltTexture.wrapT = THREE.RepeatWrapping;
  const felt = material(0xffffff, { map: feltTexture, roughness: 1 });

  function layer(
    surface,
    halfWidth,
    halfDepth,
    radius,
    elevation,
    depth,
    bevel,
  ) {
    const geometry = new THREE.ExtrudeGeometry(
      roundedRectangle(halfWidth, halfDepth, radius),
      {
        depth,
        bevelSize: bevel,
        bevelThickness: bevel,
        bevelSegments: 2,
        curveSegments: 12,
      },
    );
    const object = mesh(scene, geometry, surface, 0, elevation, 0);
    object.rotation.x = -Math.PI / 2;
  }

  layer(apron, 3.79, 1.32, 1.11, 0.79, 0.25, 0.07);
  layer(rail, 3.92, 1.44, 1.21, 1.02, 0.12, 0.065);
  layer(seam, 3.7, 1.25, 1.04, 1.163, 0.025, 0.009);
  layer(felt, 3.65, 1.2, 1, 1.185, 0.025, 0.008);

  const title = document.getElementById("game-title");
  const titleStyle = getComputedStyle(title);
  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = 768;
  logoCanvas.height = 160;
  const ink = logoCanvas.getContext("2d");
  ink.font = `${titleStyle.fontWeight} 128px ${titleStyle.fontFamily}`;
  ink.letterSpacing = "-5px";
  ink.textAlign = "center";
  ink.textBaseline = "middle";
  ink.fillStyle = "#f8f6e9";
  ink.fillText(title.textContent, 384, 80, 744);
  const logoTexture = new THREE.CanvasTexture(logoCanvas);
  logoTexture.colorSpace = THREE.SRGBColorSpace;
  const logo = mesh(
    scene,
    new THREE.PlaneGeometry(2.1, 2.1 * logoCanvas.height / logoCanvas.width),
    material(0xffffff, {
      map: logoTexture,
      roughness: 1,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
    0, TABLE_TOP, 0,
  );
  logo.rotation.x = -Math.PI / 2;
  logo.castShadow = false;

  for (const x of [-1.96, 1.96]) {
    box(scene, apron, [0.68, 0.82, 0.74], [x, 0.42, 0]);
    box(scene, rail, [0.96, 0.14, 1.13], [x, 0.09, 0]);
  }

  const inlay = roundedRectangle(3.37, 0.95, 0.76).getPoints(48);
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      inlay.map((point) => new THREE.Vector3(point.x, TABLE_TOP, -point.y)),
    ),
    new THREE.LineBasicMaterial({
      color: 0xf8f6e9,
      transparent: true,
      opacity: 0.9,
    }),
  );
  scene.add(line);
}

function drawCard(canvas, card) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.beginPath();
  context.roundRect(3, 3, width - 6, height - 6, 20);
  context.fillStyle = "#fff9eb";
  context.fill();
  context.strokeStyle = "#19191b";
  context.lineWidth = 6;
  context.stroke();

  if (!card) {
    context.beginPath();
    context.roundRect(13, 13, width - 26, height - 26, 12);
    context.fillStyle = "#741e36";
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = "#e7c591";
    context.stroke();
    // A contrasting diamond lattice reads as a card back at every scale.
    context.save();
    context.clip();
    context.strokeStyle = "#e7c59190";
    context.lineWidth = 2;
    for (let x = -height; x < width + height; x += 22) {
      context.beginPath();
      context.moveTo(x, 13);
      context.lineTo(x + height, height - 13);
      context.moveTo(x, height - 13);
      context.lineTo(x + height, 13);
      context.stroke();
    }
    context.restore();
    return;
  }

  context.fillStyle = isRedSuit(card.suit) ? "#ba263c" : "#17171a";
  context.textAlign = "left";
  context.textBaseline = "top";
  drawSuit(context, card.suit, 13, 14, 45);
  context.save();
  context.translate(width / 2, height * 0.56);
  context.rotate(-Math.PI / 45);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = '900 86px "Arial Black", "Segoe UI", sans-serif';
  context.fillText(FACE_RANKS[card.rank] ?? card.rank, 0, 0, width - 18);
  context.restore();
}

// This overlay belongs to the camera, so it follows the player's view without
// exposing the hand to the table scene or other players.
function makeFirstPersonHand(camera, requestFrame) {
  const group = new THREE.Group();
  camera.add(group);
  const geometry = new THREE.PlaneGeometry(0.2, 0.275);
  const textures = new Map();
  const cards = [];
  let hand = { cards: [], selected: [], hidden: false };

  function textureFor(card) {
    const key = card ? `${card.suit}:${card.rank}` : "back";
    if (textures.has(key)) return textures.get(key);
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 220;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    function paint() {
      drawCard(canvas, card);
      if (card) {
        // Keep rank visible in the exposed corner when cards overlap.
        const context = canvas.getContext("2d");
        context.fillStyle = isRedSuit(card.suit) ? "#ba263c" : "#17171a";
        context.font = "bold 34px Georgia";
        context.textAlign = "left";
        context.textBaseline = "top";
        context.fillText(FACE_RANKS[card.rank] ?? card.rank, 14, 65);
      }
      texture.needsUpdate = true;
    }
    paint();
    textures.set(key, texture);
    return texture;
  }

  function update(detail) {
    hand = detail;
    while (cards.length < hand.cards.length) {
      const surface = new THREE.MeshBasicMaterial({
        transparent: true,
        alphaTest: 0.4,
        depthTest: false,
        depthWrite: false,
      });
      const card = new THREE.Mesh(geometry, surface);
      card.frustumCulled = false;
      group.add(card);
      cards.push(card);
    }
    const selected = new Set(hand.selected);
    cards.forEach((mesh, index) => {
      const card = hand.cards[index];
      mesh.visible = Boolean(card);
      if (!card) return;
      mesh.material.map = textureFor(hand.hidden ? null : card);
      mesh.material.needsUpdate = true;
      mesh.userData.selected = selected.has(card.id);
      mesh.renderOrder = 1000 + index;
    });
    requestFrame();
  }

  function layout(aspect, enabled) {
    group.visible = enabled && hand.cards.length > 0;
    if (!group.visible) return;
    const scale =
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
      Math.tan(THREE.MathUtils.degToRad(HAND_REFERENCE_FOV / 2));
    group.scale.set(scale, scale, 1);
    const count = hand.cards.length;
    const span = Math.min(0.8, Math.max(0, aspect * 0.95 - 0.22));
    const spacing = count > 1 ? Math.min(0.115, span / (count - 1)) : 0;
    cards.forEach((card, index) => {
      if (!card.visible) return;
      const offset = index - (count - 1) / 2;
      const tilt = count > 1 ? (-offset / (count - 1)) * 0.18 : 0;
      card.position.set(
        offset * spacing,
        -0.435 -
          Math.abs(offset) * 0.002 +
          (card.userData.selected ? 0.045 : 0),
        -1,
      );
      card.rotation.z = tilt;
    });
  }
  return { update, layout };
}

function makePiles(scene, renderer, requestFrame) {
  const cardWidth = 0.88;
  const cardLength = 1.21;
  const cardThickness = 0.023;
  const layerStep = 0.028;
  const cardShape = roundedRectangle(cardWidth / 2, cardLength / 2, 0.08);
  const body = new THREE.ExtrudeGeometry(cardShape, {
    depth: cardThickness,
    bevelEnabled: false,
    curveSegments: 5,
  });
  body.rotateX(-Math.PI / 2);
  const faceGeometry = new THREE.PlaneGeometry(cardWidth, cardLength);
  faceGeometry.rotateX(-Math.PI / 2);
  const paper = material(0xffffff);
  const shades = [0xe4dac8, 0xfff4df, 0xd8cdbb, 0xf5ebd7].map(
    (color) => new THREE.Color(color),
  );

  function createPile(x, rotation, capacity, back) {
    const group = new THREE.Group();
    group.position.set(x, TABLE_TOP, 0);
    group.rotation.y = rotation;
    scene.add(group);

    const layers = new THREE.InstancedMesh(body, paper, capacity);
    layers.castShadow = true;
    layers.receiveShadow = true;
    group.add(layers);

    const transform = new THREE.Object3D();
    const poses = Array.from({ length: capacity }, (_, index) => {
      const scatter = back ? 0.3 : 1;
      const pose = {
        x: Math.sin(index * 2.31) * 0.025 * scatter,
        y: index * layerStep,
        z: Math.sin(index * 1.74) * 0.023 * scatter,
        yaw: Math.sin(index * 1.17) * 0.13 * scatter,
      };
      transform.position.set(pose.x, pose.y, pose.z);
      transform.rotation.y = pose.yaw;
      transform.updateMatrix();
      layers.setMatrixAt(index, transform.matrix);
      layers.setColorAt(index, shades[index % shades.length]);
      return pose;
    });
    layers.computeBoundingSphere();
    layers.count = 0;

    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 220;
    if (back) drawCard(canvas, null);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const face = mesh(
      group,
      faceGeometry,
      new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.4 }),
    );
    face.castShadow = false;
    face.receiveShadow = false;
    group.visible = false;
    return { group, layers, face, canvas, texture, poses };
  }

  const pickup = createPile(-0.72, -0.14, 12, true);
  // Four standard decks can be in play. Leave room for every discarded card.
  const pot = createPile(0.72, 0.13, 208, false);
  function setHeight(pile, count) {
    pile.layers.count = Math.min(count, pile.poses.length);
    const top = pile.poses[pile.layers.count - 1];
    pile.group.visible = Boolean(top);
    if (!top) return;
    pile.face.position.set(top.x, top.y + cardThickness + 0.001, top.z);
    pile.face.rotation.y = top.yaw;
  }

  let currentFace;
  return {
    get potHeight() {
      return pot.layers.count * layerStep;
    },
    get flightGeometry() {
      return { body, faceGeometry, paper };
    },
    flightPosition(kind) {
      const pile = kind === "play" ? pot : pickup;
      const index =
        kind === "play" ? pile.layers.count : Math.max(0, pile.layers.count - 1);
      const pose = pile.poses[Math.min(index, pile.poses.length - 1)];
      const lift = kind === "draw" ? cardThickness : 0;
      return {
        position: pile.group.localToWorld(
          new THREE.Vector3(pose.x, pose.y + lift + 0.004, pose.z),
        ),
        yaw: pile.group.rotation.y + pose.yaw,
      };
    },
    update({ pickup: remaining, pot: card, potCount }) {
      setHeight(pickup, Math.ceil(remaining / 11));
      setHeight(pot, card ? potCount : 0);
      const nextFace = card ? card.suit + card.rank : null;
      if (nextFace === currentFace) return;
      currentFace = nextFace;
      if (card) {
        drawCard(pot.canvas, card);
        pot.texture.needsUpdate = true;
      }
    },
  };
}

function makeChair(parent, point, seat, frame, cushion, index) {
  const anchor = new THREE.Group();
  anchor.position.copy(point);
  anchor.rotation.y = Math.atan2(-point.x, -point.z);
  parent.add(anchor);
  const group = new THREE.Group();
  anchor.add(group);
  box(group, frame, [0.79, 0.13, 0.72], [0, 0.68, 0]);
  box(group, cushion, [0.68, 0.1, 0.61], [0, 0.76, 0.02]);
  const back = box(group, frame, [0.79, 0.83, 0.14], [0, 1.14, -0.33]);
  back.rotation.x = -0.07;
  const padding = box(group, cushion, [0.67, 0.65, 0.1], [0, 1.17, -0.25]);
  padding.rotation.x = -0.07;
  for (const x of [-0.3, 0.3]) {
    for (const z of [-0.24, 0.24]) {
      box(group, frame, [0.085, 0.65, 0.085], [x, 0.34, z]);
    }
  }
  if (!seat) return;

  // Keep the chair at the seat when the character moves independently.
  const character = new THREE.Group();
  anchor.add(character);

  const profile = seat.profile || {};
  const tint = seat.connected ? 1 : 0.7;
  const avatarMaterial = (color) =>
    material(new THREE.Color(color).multiplyScalar(tint));
  const skin = avatarMaterial(0xffffff);
  const colors = [0x527ca3, 0xa45158, 0x8071a5, 0xbd8a42, 0x4d928a];
  const sweaterColor = /^#[0-9a-f]{6}$/i.test(profile.sweaterColor || "")
    ? profile.sweaterColor
    : colors[index % colors.length];
  const jersey = avatarMaterial(sweaterColor);
  const shape = [
    [0, 0],
    [0.23, 0],
    [0.31, 0.04],
    [0.35, 0.13],
    [0.35, 0.36],
    [0.32, 0.49],
    [0.26, 0.56],
    [0.14, 0.61],
    [0, 0.61],
  ];
  const sweater = mesh(
    character,
    new THREE.LatheGeometry(
      shape.map(([r, y]) => new THREE.Vector2(r, y)),
      32,
    ),
    jersey,
    0,
    0.81,
    0.06,
  );
  sweater.scale.z = 0.72;
  const danglingBalls = new THREE.Group();
  danglingBalls.position.set(0, 0.84, 0.06);
  danglingBalls.visible = false;
  character.add(danglingBalls);
  const ballSurface = avatarMaterial(0xf1b99f);
  const ballProfile = new THREE.Path();
  ballProfile.moveTo(0, -0.59);
  ballProfile.bezierCurveTo(0.11, -0.59, 0.17, -0.54, 0.17, -0.44);
  ballProfile.bezierCurveTo(0.17, -0.34, 0.09, -0.33, 0.064, -0.23);
  ballProfile.quadraticCurveTo(0.047, -0.14, 0.05, 0.045);
  ballProfile.lineTo(0, 0.045);
  const ballShape = new THREE.LatheGeometry(ballProfile.getPoints(8), 20);
  const leftBall = mesh(danglingBalls, ballShape, ballSurface, -0.069, 0, 0);
  const rightBall = mesh(danglingBalls, ballShape, ballSurface, 0.069, 0, 0);
  rightBall.scale.y = 0.94;
  sphere(character, skin, [0.1, 0.12, 0.1], [0, 1.49, 0.06]);
  const head = new THREE.Group();
  head.position.set(0, 1.77, 0.06);
  character.add(head);
  sphere(head, skin, [0.26, 0.27, 0.25], [0, 0, 0]);
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = faceCanvas.height = 256;
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  const faceGeometry = new THREE.PlaneGeometry(0.48, 0.48, 12, 12);
  const vertices = faceGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const radiusSquared =
      (vertices.getX(i) / 0.26) ** 2 + (vertices.getY(i) / 0.27) ** 2;
    vertices.setZ(i, 0.25 * Math.sqrt(Math.max(0, 1 - radiusSquared)) + 0.006);
  }
  const face = mesh(
    head,
    faceGeometry,
    new THREE.MeshBasicMaterial({
      map: faceTexture,
      transparent: true,
      depthWrite: false,
    }),
    0,
    0,
    0,
  );
  face.castShadow = false;
  const eyes = new THREE.Group();
  eyes.visible = false;
  head.add(eyes);
  const pupilSurface = material(0x19191b);
  const eyeParts = [-0.068, 0.068].map((x) => {
    const stalk = sphere(eyes, skin, [0.026, 0.029, 0.1], [x, 0.04, 0.24]);
    const eyeball = sphere(eyes, skin, [0.06, 0.069, 0.056], [x, 0.04, 0.24]);
    const pupil = sphere(
      eyes,
      pupilSurface,
      [0.024, 0.03, 0.013],
      [x, 0.04, 0.291],
    );
    stalk.castShadow = eyeball.castShadow = pupil.castShadow = false;
    return { stalk, eyeball, pupil };
  });
  const fanCanvas = document.createElement("canvas");
  fanCanvas.width = 2048;
  fanCanvas.height = 512;
  const fanTexture = new THREE.CanvasTexture(fanCanvas);
  fanTexture.colorSpace = THREE.SRGBColorSpace;
  fanTexture.generateMipmaps = false;
  fanTexture.minFilter = THREE.LinearFilter;
  const fanBackCanvas = document.createElement("canvas");
  fanBackCanvas.width = 512;
  fanBackCanvas.height = 128;
  const fanBackTexture = new THREE.CanvasTexture(fanBackCanvas);
  fanBackTexture.colorSpace = THREE.SRGBColorSpace;
  fanBackTexture.generateMipmaps = false;
  fanBackTexture.minFilter = THREE.LinearFilter;
  const fan = mesh(
    character,
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({
      map: fanTexture,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    }),
    0,
    1.55,
    0.62,
  );
  const fanBack = mesh(
    fan,
    new THREE.PlaneGeometry(2.4, 0.6),
    new THREE.MeshBasicMaterial({
      map: fanBackTexture,
      transparent: true,
      depthWrite: false,
    }),
  );
  fanBack.castShadow = false;
  fan.castShadow = false;
  fan.rotation.x = -0.22;
  fan.visible = false;
  return {
    group: anchor,
    chair: group,
    visual: character,
    head,
    eyes,
    eyeParts,
    eyeExtension: 0,
    headHeight: head.position.y,
    sweater,
    danglingBalls,
    leftBall,
    rightBall,
    sweaterColor: jersey.color.clone(),
    faceCanvas,
    faceTexture,
    fan,
    fanCanvas,
    fanTexture,
    fanBackCanvas,
    fanBackTexture,
    expression: "",
    blinking: false,
    count: -1,
    yaw: 0,
    pitch: 0,
    decoration: [],
    glanceUntil: 0,
    nextGlance: 0,
    glanceTarget: null,
  };
}

function createTable(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;

  const canvas = renderer.domElement;
  canvas.className = "table-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "3D table. Left-drag or use the arrow keys to look around. Middle-drag to move the camera. Scroll or use plus and minus to zoom.",
  );
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.12, 70);
  scene.add(camera);
  const firstPersonHand = makeFirstPersonHand(camera, queueFrame);
  scene.add(new THREE.HemisphereLight(0xf8f8ff, 0x565660, 1.45));
  const key = new THREE.DirectionalLight(0xfff6ef, 2.25);
  key.position.set(-3.5, 9, 5);
  key.castShadow = true;
  Object.assign(key.shadow.camera, {
    left: -7.8,
    right: 7.8,
    top: 6,
    bottom: -6,
    near: 0.1,
    far: 27,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = 0.025;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe0e3ff, 1.35);
  rim.position.set(3, 5, -7);
  scene.add(rim);

  const ground = mesh(
    scene,
    new THREE.PlaneGeometry(55, 55),
    new THREE.ShadowMaterial({ opacity: 0.31 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  makePokerTable(scene);
  const piles = makePiles(scene, renderer, queueFrame);

  const models = new THREE.Group();
  scene.add(models);
  const chairFrame = material(0x27272a);
  const chairCushion = material(0x3a3a3e);
  const cardBack = document.createElement("canvas");
  cardBack.width = 160;
  cardBack.height = 220;
  drawCard(cardBack, null);
  const angleAt = (index) => ((index + 0.5) * TAU) / SEAT_COUNT;
  const seatPoints = Array.from({ length: SEAT_COUNT }, (_, index) => {
    const angle = angleAt(index);
    return new THREE.Vector3(
      Math.sin(angle) * 4.79,
      0,
      -Math.cos(angle) * 2.69,
    );
  });
  let seats = Array(SEAT_COUNT).fill(null);
  let seatSignature;
  let avatars = [];
  const pranks = Array(SEAT_COUNT).fill(null);
  const bombEffects = Array(SEAT_COUNT).fill(null);
  function makeBombEffect(index) {
    const root = new THREE.Group();
    root.position.copy(seatPoints[index]);
    scene.add(root);
    const plane = new THREE.Group();
    root.add(plane);
    const course = seatPoints[index].clone().normalize();
    plane.rotation.y = Math.atan2(-course.z, course.x);
    const red = material(0xd84b3e),
      cream = material(0xffe6ad);
    const dark = material(0x252b31),
      smoke = material(0x8d8983, { transparent: true });
    const fire = material(0xf59b39, { transparent: true });
    sphere(plane, red, [0.65, 0.18, 0.2], [0, 0, 0]);
    box(plane, cream, [0.34, 0.07, 1.35], [0, 0, 0]);
    box(plane, cream, [0.25, 0.06, 0.58], [-0.48, 0.12, 0]);
    box(plane, red, [0.22, 0.3, 0.07], [-0.48, 0.2, 0]);
    sphere(plane, dark, [0.18, 0.12, 0.16], [0.1, 0.17, 0]);
    const bomb = new THREE.Group();
    root.add(bomb);
    sphere(bomb, dark, [0.16, 0.24, 0.16], [0, 0, 0]);
    box(bomb, dark, [0.27, 0.13, 0.04], [0, 0.23, 0]);
    box(bomb, dark, [0.04, 0.13, 0.27], [0, 0.23, 0]);
    const cloud = new THREE.Group();
    root.add(cloud);
    sphere(cloud, smoke, [0.4, 0.72, 0.4], [0, 0.55, 0]);
    for (const [x, y, z, size] of [
      [0, 1.38, 0, 0.65],
      [-0.55, 1.24, 0, 0.48],
      [0.55, 1.24, 0, 0.48],
      [0, 1.2, 0.43, 0.45],
      [0, 1.2, -0.43, 0.45],
    ])
      sphere(cloud, smoke, [size, size * 0.8, size], [x, y, z]);
    sphere(cloud, fire, [0.65, 0.24, 0.65], [0, 0.12, 0]);
    root.traverse((object) => {
      if (object.isMesh) object.castShadow = object.receiveShadow = false;
    });
    root.visible = false;
    return { root, plane, course, bomb, cloud, smoke, fire };
  }
  let tableState = {};
  let tableVisible = true;
  let reactionUntil = 0,
    lastPlayId,
    lastTurn,
    turnChangedAt = 0;

  function rebuildSeats() {
    const materials = new Set();
    for (const chair of models.children) {
      chair.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        if (object.material.map) object.material.map.dispose();
        if (
          object.material !== chairFrame &&
          object.material !== chairCushion
        ) {
          materials.add(object.material);
        }
      });
    }
    for (const surface of materials) surface.dispose();
    models.clear();
    avatars = seats.map((seat, index) =>
      makeChair(
        models,
        seatPoints[index],
        seat,
        chairFrame,
        chairCushion,
        index,
      ),
    );
    pranks.forEach((prank, index) => {
      if (
        !avatars[index] ||
        (prank?.effect === "teabag" && !avatars[prank.targetSeat])
      ) {
        pranks[index] = null;
        if (bombEffects[index]) bombEffects[index].root.visible = false;
      }
    });
    renderer.shadowMap.needsUpdate = true;
  }

  const chip = new THREE.Group();
  const darkChip = material(0x343438);
  const lightChip = material(0xf0f0f0);
  mesh(
    chip,
    new THREE.CylinderGeometry(0.18, 0.18, 0.035, 24),
    lightChip,
    0,
    0.017,
    0,
  );
  mesh(
    chip,
    new THREE.CylinderGeometry(0.115, 0.115, 0.009, 24),
    darkChip,
    0,
    0.039,
    0,
  );
  chip.visible = false;
  scene.add(chip);

  const currentMark = mesh(
    scene,
    new THREE.RingGeometry(0.5, 0.537, 40),
    new THREE.MeshBasicMaterial({
      color: 0xe3e3e3,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.63,
    }),
  );
  currentMark.rotation.x = -Math.PI / 2;
  currentMark.castShadow = false;
  currentMark.receiveShadow = false;
  currentMark.visible = false;

  const turnLight = new THREE.SpotLight(0xffe9a8, 22, 8, 0.3, 0.65, 1.5);
  const turnLightTarget = new THREE.Object3D();
  scene.add(turnLight, turnLightTarget);
  turnLight.target = turnLightTarget;
  const turnBeam = mesh(
    scene,
    new THREE.ConeGeometry(0.8, 3, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffefb5,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  turnBeam.castShadow = false;
  turnBeam.visible = turnLight.visible = false;

  const followButton = document.getElementById("camera-follow");
  const overviewButton = document.getElementById("camera-overview");
  const firstPersonButton = document.getElementById("camera-first-person");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let quickMode = false;
  const motionReduced = () => reducedMotion.matches || quickMode;
  const target = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  let view = { ...OVERVIEW };
  let firstPerson = false;
  let firstPersonFov = window.savedFirstPersonFov();
  const zoomKeys = new Set();
  let eyeYaw = 0,
    eyePitch = 0.16;
  let sharedGaze = [];
  let lastGaze;
  let gazeTimer;
  let current = null;
  let round = null;
  let follow = true;
  let flight;
  let eyeFlight;
  let dealer;
  let dealerTravel;
  let pointer;
  let width, height;
  let frame = 0;

  // Flight meshes and card textures are shared across transfers, including draws.
  const cardFlights = [];
  let deal = null;
  let dealTimer;
  let firstPersonDetail = { cards: [], selected: [], hidden: false };
  const flightPool = [];
  const flightTextures = new Map();
  const { body: flightBody, faceGeometry: flightFace, paper: flightPaper } =
    piles.flightGeometry;
  function flightTexture(card) {
    const key = card ? `${card.suit}:${card.rank}` : "back";
    if (!flightTextures.has(key)) {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 220;
      drawCard(canvas, card);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      flightTextures.set(key, texture);
    }
    return flightTextures.get(key);
  }
  function acquireFlight(card) {
    const texture = flightTexture(card);
    let item = flightPool.pop();
    if (!item) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(flightBody, flightPaper);
      const face = new THREE.Mesh(
        flightFace,
        new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.4 }),
      );
      const back = new THREE.Mesh(
        flightFace,
        new THREE.MeshBasicMaterial({ map: flightTexture(null), alphaTest: 0.4 }),
      );
      face.position.y = 0.024;
      back.position.y = -0.001;
      back.rotation.x = Math.PI;
      root.add(body, face, back);
      scene.add(root);
      item = { root, face };
    }
    item.face.material.map = texture;
    item.root.visible = true;
    return item;
  }
  function clearCardFlights() {
    for (const item of cardFlights.splice(0)) {
      item.root.visible = false;
      flightPool.push(item);
    }
  }
  function animateCardFlights(now) {
    for (let i = cardFlights.length - 1; i >= 0; i--) {
      const item = cardFlights[i];
      const t = THREE.MathUtils.clamp((now - item.start) / item.duration, 0, 1);
      if (now < item.start) {
        item.root.visible = false;
        continue;
      }
      if (t >= 1) {
        item.root.visible = false;
        cardFlights.splice(i, 1);
        flightPool.push(item);
        continue;
      }
      item.root.visible = true;
      if (item.kind === "shuffle") {
        const wave = Math.sin(t * Math.PI * 4 + item.phase);
        item.root.position.copy(item.from);
        item.root.position.x += wave * 0.32;
        item.root.position.y += 0.04 + (1 + Math.cos(t * Math.PI * 4 + item.phase)) * 0.07;
        item.root.rotation.set(Math.PI, item.yaw + wave * 0.16, 0);
        item.root.scale.setScalar(1);
        continue;
      }
      const eased = t * t * (3 - 2 * t);
      item.root.position.lerpVectors(item.from, item.to, eased);
      item.root.position.y += Math.sin(Math.PI * t) * 0.38;
      const playing = item.kind === "play";
      const scale = THREE.MathUtils.lerp(0.46, 1, playing ? eased : 1 - eased);
      item.root.scale.setScalar(scale);
      item.root.rotation.set(playing ? Math.PI * (1 - eased) : Math.PI, item.yaw, 0);
    }
  }
  document.addEventListener("blunderjack:card-flight", ({ detail }) => {
    const { kind, seat, card } = detail || {};
    if (kind === "cancel") {
      finishDeal();
      clearCardFlights();
      queueFrame();
      return;
    }
    if (
      motionReduced() ||
      !["play", "draw"].includes(kind) ||
      !Number.isInteger(seat) ||
      !avatars[seat] ||
      (kind === "play" && !card)
    ) return;
    const duration = Math.max(1, Number(detail.durationMs) || 1);
    const pile = piles.flightPosition(kind);
    const hand = avatars[seat].fan.getWorldPosition(new THREE.Vector3());
    // Bound the visual work for exceptionally large penalties while preserving the direction.
    const count = kind === "draw" ? Math.min(8, detail.amount) : 1;
    const now = performance.now();
    const stagger = count > 1 ? duration * 0.35 : 0;
    for (let i = 0; i < count; i++) {
      const item = acquireFlight(kind === "play" ? card : null);
      const delay = stagger ? (stagger * i) / (count - 1) : 0;
      Object.assign(item, {
        kind,
        start: now + delay,
        duration: Math.max(1, duration - stagger),
        yaw: pile.yaw,
        from: kind === "play" ? hand : pile.position,
        to: kind === "play" ? pile.position : hand,
      });
      cardFlights.push(item);
    }
    animateCardFlights(now);
    queueFrame();
  });
  function updateDealHand(now) {
    const count = deal ? deal.deliveries.filter((delivery) =>
      delivery.seat === tableState.you && now >= delivery.arrival
    ).length : firstPersonDetail.cards.length;
    firstPersonHand.update({ ...firstPersonDetail, cards: firstPersonDetail.cards.slice(0, count) });
  }
  function finishDeal() {
    if (!deal) return;
    clearTimeout(dealTimer);
    deal = null;
    updateDealHand(performance.now());
    document.dispatchEvent(new CustomEvent("blunderjack:deal-complete"));
    queueFrame();
  }
  document.addEventListener("blunderjack:deal", ({ detail }) => {
    clearTimeout(dealTimer);
    deal = null;
    const order = (detail?.seats || []).filter((seat) => Number.isInteger(seat) && avatars[seat]);
    const counts = detail?.counts || [];
    if (motionReduced() || !order.length) {
      document.dispatchEvent(new CustomEvent("blunderjack:deal-complete"));
      return;
    }
    clearCardFlights();
    const now = performance.now();
    const pile = piles.flightPosition("draw");
    const deliveries = [];
    const maxCount = Math.max(0, ...order.map((seat) => Math.max(0, Math.floor(counts[seat] || 0))));
    for (let card = 0; card < maxCount; card++) {
      for (const seat of order) {
        if (card < counts[seat]) deliveries.push({ seat, arrival: now + 700 + deliveries.length * 100 + 250 });
      }
    }
    deal = { deliveries };
    for (let i = 0; i < 4; i++) {
      const item = acquireFlight(null);
      Object.assign(item, { kind: "shuffle", start: now, duration: 700, from: pile.position, yaw: pile.yaw, phase: i * Math.PI / 2 });
      cardFlights.push(item);
    }
    deliveries.forEach(({ seat, arrival }) => {
      const item = acquireFlight(null);
      Object.assign(item, { kind: "draw", start: arrival - 250, duration: 250, yaw: pile.yaw,
        from: pile.position, to: avatars[seat].fan.getWorldPosition(new THREE.Vector3()) });
      cardFlights.push(item);
    });
    updateDealHand(now);
    dealTimer = setTimeout(finishDeal, 700 + Math.max(0, deliveries.length - 1) * 100 + 250);
    queueFrame();
  });
  const fpsCounter = document.getElementById("fps-counter");
  let showFps = localStorage.getItem("bj-show-fps") === "true";
  let fpsStart = 0,
    fpsFrames = 0;
  fpsCounter.classList.toggle("hidden", !showFps);
  document.addEventListener("blunderjack:show-fps", ({ detail }) => {
    showFps = detail;
    fpsStart = fpsFrames = 0;
    fpsCounter.textContent = "FPS: —";
    fpsCounter.classList.toggle("hidden", !showFps);
    queueFrame();
  });

  function paintFace(avatar, expression, blink, poppedEyes) {
    if (
      avatar.expression === expression &&
      avatar.blinking === blink &&
      avatar.poppedEyes === poppedEyes
    )
      return;
    avatar.expression = expression;
    avatar.blinking = blink;
    avatar.poppedEyes = poppedEyes;
    const c = avatar.faceCanvas.getContext("2d");
    c.clearRect(0, 0, 256, 256);
    c.strokeStyle = c.fillStyle = "#171717";
    c.lineWidth = 6;
    c.lineCap = "round";
    for (const x of [92, 164]) {
      if (!poppedEyes && blink) {
        c.beginPath();
        c.moveTo(x - 11, 106 + (x < 128 ? -3 : 3));
        c.lineTo(x + 11, 106 + (x < 128 ? 3 : -3));
        c.stroke();
      } else if (!poppedEyes) {
        c.beginPath();
        c.arc(x, 108, 6, 0, TAU);
        c.fill();
      }
      if (["surprised", "devious", "sad", "shouting"].includes(expression)) {
        const inner = x < 128 ? 1 : -1,
          slope = expression === "sad" || expression === "surprised" ? -1 : 1;
        c.beginPath();
        c.moveTo(x - 14, 81 - inner * slope * 5);
        c.lineTo(x + 14, 81 + inner * slope * 5);
        c.stroke();
      }
    }
    c.beginPath();
    if (expression === "surprised" || expression === "shouting") {
      c.ellipse(
        128,
        165,
        expression === "shouting" ? 22 : 12,
        expression === "shouting" ? 27 : 16,
        0,
        0,
        TAU,
      );
      c.fill();
    } else if (expression === "sad") {
      c.arc(128, 184, 24, Math.PI * 1.2, Math.PI * 1.8);
      c.stroke();
    } else {
      c.arc(128, 145, expression === "devious" ? 27 : 23, 0.2, Math.PI - 0.2);
      c.stroke();
    }
    avatar.faceTexture.needsUpdate = true;
  }
  function paintFan(avatar, count, now) {
    count = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    if (avatar.count === count && !avatar.reorder) return;
    if (
      avatar.count === count &&
      avatar.reorder &&
      now - (avatar.fanPaintedAt || 0) < 100
    )
      return;
    avatar.fanPaintedAt = now;
    avatar.count = count;
    const c = avatar.fanCanvas.getContext("2d");
    c.clearRect(0, 0, 2048, 512);
    const backs = avatar.fanBackCanvas.getContext("2d");
    backs.setTransform(0.25, 0, 0, 0.25, 0, 0);
    backs.clearRect(0, 0, 2048, 512);
    avatar.fan.visible = count > 0;
    const spread = Math.min(1780, Math.max(0, (count - 1) * 88)),
      step = count > 1 ? spread / (count - 1) : 0;
    const suits = ["spades", "hearts", "clubs", "diamonds"];
    // Decorative faces depend only on the position, never on private cards.
    const reorder = avatar.reorder;
    if (reorder && (reorder.from >= count || reorder.to >= count))
      avatar.reorder = null;
    const moving = avatar.reorder;
    const progress = moving ? Math.min(1, (now - moving.start) / 700) : 0;
    const slide = Math.max(0, Math.min(1, (progress - 0.2) / 0.6));
    function paint(i) {
      let slot = i;
      if (moving) {
        const { from, to } = moving;
        if (i === from) slot += (to - from) * slide;
        else if (from < i && i <= to) slot -= slide;
        else if (to <= i && i < from) slot += slide;
      }
      const offset = count > 1 ? slot / (count - 1) - 0.5 : 0;
      c.save();
      const x = 1024 - spread / 2 + slot * step;
      let y = 245 + offset ** 2 * 500;
      if (i === moving?.from) y -= Math.sin(progress * Math.PI) * 120;
      backs.save();
      backs.translate(x, y);
      backs.rotate(offset * 0.8);
      backs.drawImage(cardBack, -77, -113, 154, 226);
      backs.restore();
      c.translate(x, y);
      c.rotate(offset * 0.8);
      c.beginPath();
      c.roundRect(-77, -113, 154, 226, 12);
      c.fillStyle = "#fff9eb";
      c.fill();
      c.lineWidth = 5;
      c.strokeStyle = "#252525";
      c.stroke();
      const decoration = (avatar.decoration[i] ||= {
        suit: Math.floor(Math.random() * 4),
        rank: Math.floor(Math.random() * 13) + 1,
      });
      const suit = decoration.suit;
      c.fillStyle = suit % 2 ? "#ba263c" : "#17171a";
      c.font = "bold 45px Georgia";
      c.textAlign = "left";
      c.fillText(
        String(FACE_RANKS[decoration.rank] ?? decoration.rank),
        -65,
        -48,
      );
      drawSuit(c, suits[suit], -65, -38, 42);
      c.restore();
    }
    for (let i = 0; i < count; i++) if (i !== moving?.from) paint(i);
    if (moving) paint(moving.from);
    avatar.fanTexture.needsUpdate = true;
    avatar.fanBackTexture.needsUpdate = true;
    if (moving && progress === 1) {
      const { from, to } = moving;
      avatar.decoration.splice(to, 0, avatar.decoration.splice(from, 1)[0]);
      avatar.reorder = null;
      avatar.count = -1;
    }
  }
  function animateAvatars(now) {
    const {
      turn,
      active = [],
      counts = [],
      last,
      pendingBlunder,
      gestures,
    } = tableState;
    const caller = pendingBlunder?.caller;
    avatars.forEach((avatar, index) => {
      if (!avatar) return;
      const prank = pranks[index];
      const bombEffect = bombEffects[index];
      if (bombEffect) bombEffect.root.visible = false;
      let spin = 0;
      // Reset every animated property before applying the current effect, so
      // changing effects or rebuilding seats cannot leave a transform behind.
      avatar.visual.position.set(0, 0, 0);
      avatar.visual.rotation.y = 0;
      avatar.chair.rotation.y = 0;
      avatar.visual.scale.set(1, 1, 1);
      avatar.head.position.y = avatar.headHeight;
      avatar.head.scale.setScalar(1);
      avatar.danglingBalls.visible = false;
      avatar.sweater.material.color.copy(avatar.sweaterColor);
      if (prank) {
        const duration = motionReduced()
          ? 900
          : prank.effect === "teabag"
            ? 9250
            : prank.effect === "bomb"
              ? 4300
              : 2600;
        const elapsed = now - prank.start;
        const progress = elapsed / duration;
        if (
          progress >= 1 ||
          (prank.effect === "teabag" && !avatars[prank.targetSeat])
        ) {
          pranks[index] = null;
          renderer.shadowMap.needsUpdate = true;
        } else {
          const smooth = (value) => {
            const t = THREE.MathUtils.clamp(value, 0, 1);
            return t * t * (3 - 2 * t);
          };
          const amount = smooth(progress / 0.2) * smooth((1 - progress) / 0.25);
          const strength = motionReduced() ? 0.25 : 1;
          if (prank.effect === "teabag") {
            if (motionReduced()) {
              avatar.head.scale.setScalar(1 + 0.12 * amount);
            } else {
              // All positions are world-space route points converted into the
              // origin seat's local frame; only the character leaves its chair.
              const route = prank.route;
              const bounceStart = 3460;
              const bounceEnd = 6050;
              const contactHeight = 1.61;
              let x, z, height;
              if (elapsed < 800 || elapsed >= 8770) {
                const t =
                  elapsed < 800 ? elapsed / 800 : (duration - elapsed) / 480;
                const step = smooth(t);
                x = THREE.MathUtils.lerp(route.startX, route.outerStartX, step);
                z = THREE.MathUtils.lerp(route.startZ, route.outerStartZ, step);
                height = -0.81 * step + 1.2 * Math.sin(Math.PI * t);
              } else if (elapsed < 2640 || elapsed >= 6930) {
                const t =
                  elapsed < 2640
                    ? (elapsed - 800) / 1840
                    : (8770 - elapsed) / 1840;
                const angle = route.startAngle + route.arc * smooth(t);
                x = route.radiusX * Math.sin(angle);
                z = -route.radiusZ * Math.cos(angle);
                height =
                  -0.81 + 0.22 * Math.abs(Math.sin(t * Math.PI * route.hops));
              } else if (elapsed < bounceStart || elapsed >= bounceEnd) {
                const t =
                  elapsed < bounceStart
                    ? (elapsed - 2640) / (bounceStart - 2640)
                    : (6930 - elapsed) / (6930 - bounceEnd);
                const step = smooth(t);
                x = THREE.MathUtils.lerp(
                  route.outerTargetX,
                  route.targetX,
                  step,
                );
                z = THREE.MathUtils.lerp(
                  route.outerTargetZ,
                  route.targetZ,
                  step,
                );
                height =
                  THREE.MathUtils.lerp(-0.81, contactHeight, step) +
                  0.35 * Math.sin(Math.PI * t);
              } else {
                x = route.targetX;
                z = route.targetZ;
                const bounce =
                  ((elapsed - bounceStart) / (bounceEnd - bounceStart)) *
                  Math.PI *
                  3;
                height = contactHeight + 0.6 * Math.abs(Math.sin(bounce));
                avatar.danglingBalls.visible = true;
                avatar.leftBall.rotation.z =
                  -0.23 + Math.sin(bounce * 2) * 0.12;
                avatar.rightBall.rotation.z =
                  0.23 + Math.sin(bounce * 2 + 0.8) * 0.12;
              }
              const dx = x - route.startX;
              const dz = z - route.startZ;
              avatar.visual.position.set(
                route.cos * dx - route.sin * dz,
                height,
                route.sin * dx + route.cos * dz,
              );
            }
          } else if (prank.effect === "bomb") {
            const effect = bombEffects[index];
            effect.root.visible = true;
            if (motionReduced()) {
              effect.plane.visible = effect.bomb.visible = false;
              effect.cloud.visible = true;
              effect.cloud.scale.setScalar(0.45);
              effect.smoke.opacity = effect.fire.opacity = 1;
            } else {
              effect.plane.visible = elapsed < 3200;
              effect.plane.position
                .copy(effect.course)
                .multiplyScalar((elapsed / 1600 - 1) * 6);
              effect.plane.position.y = 3.15;
              effect.bomb.visible = elapsed >= 1600 && elapsed < 2300;
              effect.bomb.position.set(
                0,
                THREE.MathUtils.lerp(2.95, 1.1, smooth((elapsed - 1600) / 700)),
                0,
              );
              effect.cloud.visible = elapsed >= 2300;
              const expansion = smooth((elapsed - 2300) / 450);
              const fade = smooth((4300 - elapsed) / 650);
              effect.cloud.scale.setScalar(1.35 * expansion);
              effect.smoke.opacity = fade;
              effect.fire.opacity = fade;
            }
          } else if (prank.effect === "grow_head") {
            avatar.head.scale.setScalar(1 + 2 * amount * strength);
            avatar.head.position.y += 0.48 * amount * strength;
          } else if (prank.effect === "tiny_head")
            avatar.head.scale.setScalar(1 - 0.7 * amount * strength);
          else if (prank.effect === "spin_chair" && !motionReduced()) {
            spin = TAU * smooth(progress);
            avatar.visual.rotation.y = spin;
            avatar.chair.rotation.y = spin;
          } else if (prank.effect === "bounce" && !motionReduced()) {
            avatar.visual.position.y =
              Math.abs(Math.sin(progress * Math.PI * 3)) * 0.65 * amount;
          } else if (prank.effect === "pancake") {
            avatar.visual.scale.set(
              1 + 0.45 * amount * strength,
              1 - 0.65 * amount * strength,
              1 + 0.45 * amount * strength,
            );
          } else if (prank.effect === "disco") {
            const color = new THREE.Color().setHSL(
              (progress * 2) % 1,
              0.8,
              0.5,
            );
            avatar.sweater.material.color.lerp(color, amount * strength);
          }
          renderer.shadowMap.needsUpdate = true;
        }
      }
      let expression = "smile";
      if (now < reactionUntil && last?.kind === "blunder") {
        if (last.outcome === "valid" && index === last.caller)
          expression = "sad";
        if (last.outcome !== "valid" && index === last.seat) expression = "sad";
        if (last.outcome !== "valid" && index === last.caller)
          expression = "devious";
      } else if (
        now < reactionUntil &&
        last?.kind === "draw" &&
        last.amount > 5 &&
        index === last.seat
      )
        expression = "sad";
      else if (now < reactionUntil && last?.cards?.length >= 4)
        expression = index === last.seat ? "devious" : "surprised";
      if (caller === index) expression = "shouting";
      const blink =
        !motionReduced() &&
        (now + index * 719) % (4200 + index * 173) < 38;
      const zoom =
        firstPerson && index === tableState.you
          ? zoomKeys.size > 0
          : sharedGaze[index]?.zoom === true;
      const extension = zoom ? 1 : 0;
      avatar.eyeExtension = motionReduced()
        ? extension
        : THREE.MathUtils.lerp(avatar.eyeExtension, extension, 0.22);
      avatar.eyes.visible = avatar.eyeExtension > 0.03;
      if (avatar.eyes.visible) {
        const pop = avatar.eyeExtension * 0.31;
        for (const { stalk, eyeball, pupil } of avatar.eyeParts) {
          stalk.position.z = 0.24 + pop / 2;
          stalk.scale.z = Math.max(0.016, pop / 2);
          eyeball.position.z = 0.24 + pop;
          pupil.position.z = 0.291 + pop;
        }
      }
      paintFace(avatar, expression, blink, avatar.eyes.visible);
      const dealt = deal ? deal.deliveries.filter((delivery) =>
        delivery.seat === index && now >= delivery.arrival
      ).length : counts[index];
      paintFan(avatar, active.includes(index) ? dealt : 0, now);
      const gesture = gestures?.[index];
      const look = gesture?.look;
      const manual =
        firstPerson && index === tableState.you
          ? { yaw: eyeYaw, pitch: eyePitch }
          : sharedGaze[index];
      let gaze = look ?? caller ?? turn;
      let ownCards = false;
      let lookingAtPot = false;
      if (
        !quickMode &&
        look == null &&
        !manual &&
        caller == null &&
        now - turnChangedAt > 1000
      ) {
        if (now >= avatar.nextGlance) {
          const others = active.filter((seat) => seat !== index && seats[seat]);
          const options =
            index === turn
              ? ["cards", "cards", "cards", "pot", ...others]
              : ["cards", "turn", "turn", "pot"];
          avatar.glanceTarget =
            options[Math.floor(Math.random() * options.length)];
          avatar.glanceUntil = now + 650 + Math.random() * 1100;
          avatar.nextGlance = avatar.glanceUntil + 900 + Math.random() * 2500;
        }
        if (now < avatar.glanceUntil) {
          ownCards = avatar.glanceTarget === "cards";
          if (typeof avatar.glanceTarget === "number")
            gaze = avatar.glanceTarget;
          else if (avatar.glanceTarget === "pot") {
            gaze = null;
            lookingAtPot = true;
          }
        } else if (index === turn) ownCards = true;
      }
      let desiredYaw = 0,
        desiredPitch = ownCards ? 0.35 : lookingAtPot ? 0.13 : 0;
      if (!ownCards && gaze != null && gaze !== index && seatPoints[gaze]) {
        const destination = seatPoints[gaze].clone();
        avatar.group.worldToLocal(destination);
        desiredYaw = Math.atan2(destination.x, destination.z);
        if (look == null)
          desiredYaw = THREE.MathUtils.clamp(desiredYaw, -1.05, 1.05);
      }
      if (manual && look == null) {
        desiredYaw = manual.yaw;
        desiredPitch = manual.pitch;
      }
      desiredYaw -= spin;
      if (motionReduced()) {
        avatar.yaw = desiredYaw;
        avatar.pitch = desiredPitch;
      } else {
        const turn =
          THREE.MathUtils.euclideanModulo(
            desiredYaw - avatar.yaw + Math.PI,
            TAU,
          ) - Math.PI;
        avatar.yaw += turn * 0.07;
        avatar.pitch += (desiredPitch - avatar.pitch) * 0.07;
      }
      avatar.head.rotation.set(avatar.pitch, avatar.yaw, 0, "YXZ");
      avatar.fan.position.y =
        1.55 +
        (motionReduced() ? 0 : Math.sin(now / 1000 + index) * 0.025);
    });
  }

  function draw() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const extraHeight = Math.max(0, piles.potHeight - 1.6);
    const focusHeight = view.y + extraHeight * 0.44;
    const distance =
      (view.distance + extraHeight * 0.63) * Math.max(1, 1.3 / camera.aspect);
    const base = Math.cos(view.pitch) * distance;
    target.set(view.x, focusHeight, view.z);
    camera.position.set(
      view.x + Math.sin(view.yaw) * base,
      focusHeight + Math.sin(view.pitch) * distance,
      view.z + Math.cos(view.yaw) * base,
    );
    const viewer = firstPerson ? avatars[tableState.you] : null;
    if (viewer) {
      const yaw = viewer.group.rotation.y + eyeYaw;
      camera.position.copy(viewer.head.position);
      camera.position.y = viewer.headHeight + 0.14;
      viewer.group.localToWorld(camera.position);
      target
        .set(
          Math.sin(yaw) * Math.cos(eyePitch),
          -Math.sin(eyePitch),
          Math.cos(yaw) * Math.cos(eyePitch),
        )
        .add(camera.position);
    }
    camera.lookAt(target);
    firstPersonHand.layout(camera.aspect, Boolean(viewer));
    camera.updateMatrixWorld();
    if (viewer) {
      viewer.head.visible = false;
      viewer.fan.visible = false;
    }
    renderer.render(scene, camera);
    if (viewer) {
      viewer.head.visible = true;
      viewer.fan.visible = viewer.count > 0;
    }

    for (const element of container.querySelectorAll(".seat")) {
      const index = Number(element.dataset.index);
      const point = seatPoints[index];
      const avatar = avatars[index];
      const labelHeight = avatar
        ? (avatar.head.position.y + 0.48 * avatar.head.scale.y) *
            avatar.visual.scale.y +
          avatar.visual.position.y
        : 1.22;
      if (avatar) {
        projected.set(
          avatar.visual.position.x,
          labelHeight,
          avatar.visual.position.z,
        );
        avatar.group.localToWorld(projected);
      } else {
        projected.set(point.x, labelHeight, point.z);
      }
      projected.project(camera);
      const visible =
        !(firstPerson && index === tableState.you) &&
        Math.abs(projected.x) < 0.97 &&
        Math.abs(projected.y) < 0.97 &&
        Math.abs(projected.z) < 1;
      element.style.visibility = visible ? "" : "hidden";
      element.style.left = (projected.x + 1) * 50 + "%";
      element.style.top = (1 - projected.y) * 50 + "%";
    }
  }

  function queueFrame() {
    if (!frame && tableVisible && !document.hidden)
      frame = requestAnimationFrame(updateFrame);
  }

  function positionChip(index) {
    const angle = angleAt(index);
    chip.position.set(
      Math.sin(angle) * 3.15,
      TABLE_TOP,
      -Math.cos(angle) * 0.91,
    );
  }

  function updateFrame(now) {
    frame = 0;
    if (!tableVisible || document.hidden) return;
    if (eyeFlight) {
      const fraction = THREE.MathUtils.clamp(
        (now - eyeFlight.start) / 450,
        0,
        1,
      );
      const eased = fraction * fraction * (3 - 2 * fraction);
      eyeYaw = THREE.MathUtils.lerp(eyeFlight.fromYaw, eyeFlight.yaw, eased);
      eyePitch = THREE.MathUtils.lerp(
        eyeFlight.fromPitch,
        eyeFlight.pitch,
        eased,
      );
      if (fraction === 1) {
        eyeFlight = null;
        publishGaze();
      } else {
        gazeTimer ??= setTimeout(publishGaze, 65);
      }
    }
    if (flight) {
      const fraction = THREE.MathUtils.clamp((now - flight.start) / 820, 0, 1);
      const eased = fraction * fraction * (3 - 2 * fraction);
      for (const key of Object.keys(view)) {
        view[key] = THREE.MathUtils.lerp(
          flight.from[key],
          flight.to[key],
          eased,
        );
      }
      if (fraction === 1) flight = null;
    }
    if (dealerTravel) {
      const progress = THREE.MathUtils.clamp(
        (now - dealerTravel.start) / 620,
        0,
        1,
      );
      positionChip(
        dealerTravel.from + dealerTravel.steps * (1 - (1 - progress) ** 3),
      );
      if (progress === 1) dealerTravel = null;
    }
    animateAvatars(now);
    if (deal) updateDealHand(now);
    animateCardFlights(now);
    draw();
    if (showFps) {
      if (!fpsStart || now - fpsStart > 2000) {
        fpsStart = now;
        fpsFrames = 0;
      }
      fpsFrames++;
      if (now - fpsStart >= 500) {
        fpsCounter.textContent = `FPS: ${Math.round((fpsFrames * 1000) / (now - fpsStart))}`;
        fpsStart = now;
        fpsFrames = 0;
      }
    }
    if (
      showFps ||
      flight ||
      eyeFlight ||
      dealerTravel ||
      cardFlights.length ||
      avatars.some((avatar) => avatar?.reorder) ||
      pranks.some(Boolean) ||
      (!motionReduced() && avatars.some(Boolean)) ||
      now < reactionUntil
    )
      queueFrame();
  }

  function moveCamera(destination, snap = false) {
    const yaw =
      view.yaw +
      THREE.MathUtils.euclideanModulo(
        destination.yaw - view.yaw + Math.PI,
        TAU,
      ) -
      Math.PI;
    const to = { ...destination, yaw };
    if (snap || motionReduced()) {
      view = to;
      flight = null;
    } else {
      flight = { from: { ...view }, to, start: performance.now() };
    }
    queueFrame();
  }

  function focusCurrent() {
    if (firstPerson) {
      const viewer = avatars[tableState.you];
      if (!viewer) return;
      const player = current === tableState.you ? null : avatars[current];
      const aim = player
        ? player.group.localToWorld(
            player.head.position.clone().setY(player.headHeight),
          )
        : new THREE.Vector3(0, TABLE_TOP, 0);
      viewer.group.worldToLocal(aim);
      aim.y -= viewer.headHeight + 0.14;
      aim.z -= viewer.head.position.z;
      const yaw = THREE.MathUtils.clamp(Math.atan2(aim.x, aim.z), -1.45, 1.45);
      const pitch = Math.atan2(-aim.y, Math.hypot(aim.x, aim.z));
      if (motionReduced()) {
        eyeFlight = null;
        eyeYaw = yaw;
        eyePitch = pitch;
        publishGaze();
      } else {
        eyeFlight = {
          fromYaw: eyeYaw,
          fromPitch: eyePitch,
          yaw,
          pitch,
          start: performance.now(),
        };
      }
      queueFrame();
      return;
    }
    if (current == null) {
      moveCamera(OVERVIEW);
      return;
    }
    const point = seatPoints[current];
    moveCamera({
      yaw: Math.atan2(-point.x, -point.z) + 0.12,
      pitch: 0.55,
      distance: 10.65,
      x: point.x * 0.35,
      y: 1.19,
      z: point.z * 0.35,
    });
  }

  function changeOrbit(yaw, pitch, zoom = 1) {
    if (firstPerson) {
      if (!yaw && !pitch) return;
      eyeFlight = null;
      if (yaw) eyeYaw = THREE.MathUtils.clamp(eyeYaw - yaw, -1.45, 1.45);
      eyePitch = THREE.MathUtils.clamp(eyePitch - pitch, -0.85, 1.1);
      gazeTimer ??= setTimeout(publishGaze, 65);
      queueFrame();
      return;
    }
    flight = null;
    view.yaw += yaw;
    view.pitch = THREE.MathUtils.clamp(view.pitch + pitch, 0.28, 1.24);
    view.distance = THREE.MathUtils.clamp(view.distance * zoom, 8.2, 20);
    queueFrame();
  }

  function moveDealer(next) {
    if (next === dealer) return;
    dealerTravel = null;
    chip.visible = next != null;
    if (next != null) {
      if (dealer == null || motionReduced()) positionChip(next);
      else
        dealerTravel = {
          from: dealer,
          steps: (next - dealer + SEAT_COUNT) % SEAT_COUNT,
          start: performance.now(),
        };
    }
    dealer = next;
  }

  document.addEventListener("blunderjack:table", ({ detail }) => {
    const now = performance.now();
    if (detail.last?.id !== lastPlayId) {
      lastPlayId = detail.last?.id;
      reactionUntil = !quickMode && detail.last ? now + 2000 : 0;
    }
    if (detail.turn !== lastTurn) {
      lastTurn = detail.turn;
      turnChangedAt = now;
    }
    tableState = detail;
    const turnPoint = Number.isInteger(detail.turn)
      ? seatPoints[detail.turn]
      : null;
    turnBeam.visible = turnLight.visible = Boolean(
      turnPoint && detail.seats?.[detail.turn],
    );
    if (turnBeam.visible) {
      turnLight.position.set(turnPoint.x, 5, turnPoint.z);
      turnLightTarget.position.set(turnPoint.x, 1.6, turnPoint.z);
      turnBeam.position.set(turnPoint.x, 3.5, turnPoint.z);
    }
    firstPersonButton.disabled = detail.you == null;
    if (detail.you == null && firstPerson) setFirstPerson(false);
    const signature = JSON.stringify(detail.seats);
    if (signature !== seatSignature) {
      seats = detail.seats;
      seatSignature = signature;
      rebuildSeats();
    }
    moveDealer(detail.dealer);
    if (round != null && detail.round !== round) clearCardFlights();
    if (current !== detail.current || round !== detail.round) {
      current = detail.current ?? null;
      round = detail.round;
      currentMark.visible = current != null;
      if (current != null) {
        const point = seatPoints[current];
        currentMark.position.set(point.x, 0.006, point.z);
      }
      if (follow) {
        if (pointer) pointer.refocus = true;
        else focusCurrent();
      }
    }
    queueFrame();
  });
  document.addEventListener("blunderjack:prank", ({ detail }) => {
    if (quickMode) return;
    const { seat, effect, targetSeat } = detail || {};
    if (
      !Number.isInteger(seat) ||
      !avatars[seat] ||
      ![
        "grow_head",
        "tiny_head",
        "spin_chair",
        "bounce",
        "disco",
        "pancake",
        "bomb",
        "teabag",
      ].includes(effect)
    )
      return;
    if (
      effect === "teabag" &&
      (!Number.isInteger(targetSeat) ||
        targetSeat === seat ||
        !avatars[targetSeat])
    )
      return;
    if (bombEffects[seat]) bombEffects[seat].root.visible = false;
    if (effect === "bomb") bombEffects[seat] ||= makeBombEffect(seat);
    let route;
    if (effect === "teabag") {
      const radiusX = 5.8,
        radiusZ = 3.7;
      const startAngle = angleAt(seat);
      const targetAngle = angleAt(targetSeat);
      const forward = (targetAngle - startAngle + TAU) % TAU;
      // Compare the two ellipse arcs by length, not just their angle.
      const arcLength = (arc) => {
        let length = 0;
        let x = radiusX * Math.sin(startAngle);
        let z = -radiusZ * Math.cos(startAngle);
        for (let i = 1; i <= 64; i++) {
          const angle = startAngle + (arc * i) / 64;
          const nextX = radiusX * Math.sin(angle);
          const nextZ = -radiusZ * Math.cos(angle);
          length += Math.hypot(nextX - x, nextZ - z);
          x = nextX;
          z = nextZ;
        }
        return length;
      };
      const backward = forward - TAU;
      const arc =
        arcLength(forward) <= arcLength(backward) ? forward : backward;
      const rotation = avatars[seat].group.rotation.y;
      route = {
        radiusX,
        radiusZ,
        startAngle,
        arc,
        hops: Math.max(2, Math.round(arcLength(arc) / 1.2)),
        startX: seatPoints[seat].x,
        startZ: seatPoints[seat].z,
        targetX: seatPoints[targetSeat].x,
        targetZ: seatPoints[targetSeat].z,
        outerStartX: radiusX * Math.sin(startAngle),
        outerStartZ: -radiusZ * Math.cos(startAngle),
        outerTargetX: radiusX * Math.sin(targetAngle),
        outerTargetZ: -radiusZ * Math.cos(targetAngle),
        cos: Math.cos(rotation),
        sin: Math.sin(rotation),
      };
    }
    pranks[seat] = { effect, targetSeat, route, start: performance.now() };
    queueFrame();
  });
  document.addEventListener("blunderjack:reorder", ({ detail }) => {
    const avatar = avatars[detail?.seat];
    if (!avatar || avatar.count < 2 || motionReduced()) return;
    const from = Math.floor(Math.random() * avatar.count);
    const to =
      (from + 1 + Math.floor(Math.random() * (avatar.count - 1))) %
      avatar.count;
    avatar.reorder = { from, to, start: performance.now() };
    queueFrame();
  });
  document.addEventListener("blunderjack:first-person-hand", ({ detail }) => {
    firstPersonDetail = detail;
    updateDealHand(performance.now());
  });
  document.addEventListener("blunderjack:gaze-snapshot", ({ detail }) => {
    sharedGaze = detail;
    queueFrame();
  });
  document.addEventListener("blunderjack:gaze", ({ detail: { seat, gaze } }) => {
    sharedGaze[seat] = gaze;
    queueFrame();
  });
  document.addEventListener("blunderjack:gaze-offline", () => {
    sharedGaze = [];
    lastGaze = undefined;
    queueFrame();
  });
  document.addEventListener("blunderjack:gaze-ready", () => {
    lastGaze = undefined;
    if (firstPerson) publishGaze();
  });
  document.addEventListener("blunderjack:piles", ({ detail }) => {
    piles.update(detail);
    renderer.shadowMap.needsUpdate = true;
    queueFrame();
  });
  document.addEventListener("blunderjack:reset-view", () => {
    finishDeal();
    clearCardFlights();
    seats = Array(SEAT_COUNT).fill(null);
    pranks.fill(null);
    bombEffects.forEach((effect) => {
      if (effect) effect.root.visible = false;
    });
    tableState = {};
    sharedGaze = [];
    firstPersonDetail = { cards: [], selected: [], hidden: false };
    firstPersonHand.update(firstPersonDetail);
    firstPersonButton.disabled = true;
    setFirstPerson(false);
    seatSignature = null;
    rebuildSeats();
    current = null;
    round = null;
    currentMark.visible = false;
    turnBeam.visible = turnLight.visible = false;
    moveDealer(null);
    piles.update({ pickup: 0, pot: null, potCount: 0 });
    moveCamera(OVERVIEW, true);
  });

  canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (pointer || (event.button !== 0 && event.button !== 1)) return;
    event.preventDefault();
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      travel: 0,
    };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
    canvas.focus({ preventScroll: true });
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointer?.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (!dx && !dy) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.travel += Math.hypot(dx, dy);
    if (pointer.button === 1) {
      if (firstPerson) return;
      flight = null;
      const distance =
        (view.distance + Math.max(0, piles.potHeight - 1.6) * 0.63) *
        Math.max(1, 1.3 / camera.aspect);
      const scale =
        (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
        height;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const offset = right
        .multiplyScalar(-dx * scale)
        .addScaledVector(up, dy * scale);
      view.x += offset.x;
      view.y += offset.y;
      view.z += offset.z;
      queueFrame();
    } else if (firstPerson) {
      changeOrbit(dx * 0.008, -dy * 0.006);
    } else {
      changeOrbit(-dx * 0.008, dy * 0.006);
    }
  });
  function endDrag(event) {
    if (pointer?.id !== event.pointerId) return;
    if (
      event.type === "pointerup" &&
      pointer.button === 0 &&
      pointer.travel < 5 &&
      container.closest(".choosing-look")
    ) {
      const rect = canvas.getBoundingClientRect();
      ray.setFromCamera(
        {
          x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
          y: 1 - ((event.clientY - rect.top) / rect.height) * 2,
        },
        camera,
      );
      const targets = avatars.flatMap((avatar, index) =>
        index !== tableState.you && seats[index]?.connected
          ? [avatar.head.children[0], avatar.sweater]
          : [],
      );
      const hit = ray.intersectObjects(targets, false)[0];
      if (hit) {
        const index = avatars.findIndex(
          (avatar) =>
            avatar &&
            (avatar.sweater === hit.object ||
              avatar.head === hit.object.parent),
        );
        document.dispatchEvent(
          new CustomEvent("blunderjack:look", { detail: index }),
        );
      }
    }
    const refocus = pointer.refocus;
    pointer = null;
    canvas.classList.remove("dragging");
    if (refocus && follow) focusCurrent();
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : 1;
      changeOrbit(0, 0, Math.exp(event.deltaY * scale * 0.0016));
    },
    { passive: false },
  );
  canvas.addEventListener("keydown", (event) => {
    const movement = {
      ArrowLeft: [-0.13, 0],
      ArrowRight: [0.13, 0],
      ArrowUp: [0, 0.08],
      ArrowDown: [0, -0.08],
      "+": [0, 0, 0.9],
      "=": [0, 0, 0.9],
      "-": [0, 0, 1.1],
    }[event.key];
    if (movement) {
      if (firstPerson) changeOrbit(-movement[0], movement[1]);
      else changeOrbit(...movement);
    } else if (event.key === "Home") overviewButton.click();
    else return;
    event.preventDefault();
  });
  function updateFov() {
    camera.fov = firstPerson ? (zoomKeys.size ? 30 : firstPersonFov) : 35;
    camera.updateProjectionMatrix();
    queueFrame();
  }
  function resetZoom() {
    if (!zoomKeys.size) return;
    zoomKeys.clear();
    updateFov();
    publishGaze();
  }
  document.addEventListener("blunderjack:first-person-fov", ({ detail }) => {
    firstPersonFov = detail;
    if (firstPerson) updateFov();
  });
  window.addEventListener("keydown", (event) => {
    if (
      !firstPerson ||
      event.key !== "Shift" ||
      event.repeat ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.target === document.getElementById("chat-input") ||
      !document.getElementById("modal").classList.contains("hidden")
    )
      return;
    zoomKeys.add(event.code || event.key);
    updateFov();
    gazeTimer ??= setTimeout(publishGaze, 65);
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Shift" && zoomKeys.delete(event.code || event.key)) {
      updateFov();
      gazeTimer ??= setTimeout(publishGaze, 65);
    }
  });
  window.addEventListener("blur", resetZoom);
  function setFirstPerson(enabled) {
    if (firstPerson === enabled) return;
    firstPerson = enabled;
    eyeFlight = null;
    zoomKeys.clear();
    updateFov();
    firstPersonButton.setAttribute("aria-pressed", String(enabled));
    if (enabled) {
      eyeYaw = 0;
      eyePitch = 0.16;
      flight = null;
    }
    publishGaze();
    if (enabled && follow) focusCurrent();
    queueFrame();
  }
  function publishGaze() {
    clearTimeout(gazeTimer);
    gazeTimer = undefined;
    const detail = firstPerson
      ? { yaw: eyeYaw, pitch: eyePitch, zoom: zoomKeys.size > 0 }
      : null;
    const signature = detail
      ? `${eyeYaw.toFixed(3)},${eyePitch.toFixed(3)},${detail.zoom}`
      : null;
    if (lastGaze === signature) return;
    lastGaze = signature;
    document.dispatchEvent(new CustomEvent("blunderjack:gaze-aim", { detail }));
  }
  firstPersonButton.onclick = () => {
    setFirstPerson(!firstPerson);
    if (!firstPerson && follow) focusCurrent();
  };
  overviewButton.onclick = () => {
    setFirstPerson(false);
    moveCamera(OVERVIEW);
  };
  followButton.onclick = () => {
    follow = !follow;
    followButton.setAttribute("aria-pressed", String(follow));
    followButton.textContent = follow ? "Follow: On" : "Follow: Off";
    if (follow) focusCurrent();
    else {
      flight = null;
      eyeFlight = null;
    }
  };
  rebuildSeats();
  container.prepend(canvas);
  new ResizeObserver(queueFrame).observe(container);
  new IntersectionObserver(([entry]) => {
    tableVisible = entry.isIntersecting;
    if (tableVisible) queueFrame();
  }).observe(container);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetZoom();
    else queueFrame();
  });
  document.addEventListener("blunderjack:quick-mode", ({ detail }) => {
    const enabled = detail === true;
    if (enabled === quickMode) return;
    quickMode = enabled;
    if (quickMode) {
      pranks.fill(null);
      reactionUntil = 0;
      bombEffects.forEach((effect) => {
        if (effect) effect.root.visible = false;
      });
      finishDeal();
      clearCardFlights();
      if (flight) view = flight.to;
      flight = null;
      if (eyeFlight) {
        eyeYaw = eyeFlight.yaw;
        eyePitch = eyeFlight.pitch;
        eyeFlight = null;
        publishGaze();
      }
      if (dealerTravel && dealer != null) positionChip(dealer);
      dealerTravel = null;
      avatars.forEach((avatar) => {
        if (avatar?.reorder) {
          avatar.reorder = null;
          avatar.count = -1;
        }
      });
    }
    queueFrame();
  });
  reducedMotion.addEventListener("change", () => {
    if (motionReduced()) {
      finishDeal();
      clearCardFlights();
    }
    queueFrame();
  });
  container.classList.add("webgl-table");
  queueFrame();
}

const container = document.querySelector(".table-scene");
try {
  createTable(container);
} catch (error) {
  console.warn("3D unavailable. Using the table illustration.", error);
}
