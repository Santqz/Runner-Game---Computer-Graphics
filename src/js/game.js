/* Logica de todo el juego */

/* SISTEMA DE COORDENADAS:
    - Bloque 1x1x1
    - Eje X -> Derecha (avance del jugador)
    - Eje Y -> Arriba (altura del jugador)
    - Eje Z -> Adelante (profundidad del jugador)
*/
import * as THREE from 'three';

const CONFIG = {
    GRAVEDAD: -32,
    VEL_CAMINAR: 6,
    VEL_CORRER: 9,
    ACELERACION: 40,
    FRICCION: 30,
    FUERZA_SALTO: 15,
    CORTE_SALTO: 0.45,
    VEL_MAX_CAIDA: -20,
    TIEMPO_COYOTE: 0.1,
    BUFFER_SALTO: 0.12,
    VIDAS_INICIALES: 3,
    TIEMPO_NIVEL: 300,
    LIMITE_CAIDA: -5,
    VEL_ENEMIGO: 1.5,
    INVULNERABLE: 2.0,
};

/* Diseño del nivel (TILEMAP) */
/* **************************************************
    # Suelo
    G bloque sorpresa
    C Columna de piedra
    E Enemigo
    K Punto de control
    B ladrillo (se puede romper)
    S bloque de piedra (escaleras)
    o Coleccionable (gema)
    P Jugador (posición inicial)
    F Bandera de Meta
***************************************************** */
const MAPA_NIVEL = [
    "                                                                                ",
    "                                      ooo                                       ",
    "   #      G             ooo           ooooo                                      ",
    "   #                   BBBBB         ooooooo                                   F ",
    "   #                                   BBB                   S                 # ",
    "   # P    G   G                       E                     SS                 # ",
    "   ###  #######  #   K   #  ##C##   #####   ##B#B##       SSS                ###",
    "################ ################ ################ ################ ################",
];

const MAPA_NIVEL_2 = [
    "C                                                                                            ",
    "C                                                                                            ",
    "C                                                                                            ",
    "C                                         SS      S                                          ",
    "C      BBBGBBB               BBBB        SSS      SS        BGBBGB                           ",
    "C                                       SSSS      SSS                                        ",
    "C P                                    SSSSS      SSSS                      #################",
    "C###################   #####################      ######################    #################",
]

// Lista de niveles en orden (todos usan los mismos materiales)
const MAPAS = [MAPA_NIVEL, MAPA_NIVEL_2];
let nivelActual = 1;

const SOLIDOS = new Set(["#", "B", "G", "S", "C", "K", "F"]);

const COLOR_CIELO = 0x6ec6ff;

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLOR_CIELO);
// FOG
scene.fog = new THREE.Fog(COLOR_CIELO, 25, 60);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(5, 5, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

const light = new THREE.AmbientLight( 0x404040, 50); // soft white light
scene.add( light );


window.addEventListener('resize', () => {
    // 1. Actualizar el tamaño del renderizador
    renderer.setSize(window.innerWidth, window.innerHeight);

    // 2. Actualizar la relación de aspecto de la cámara
    camera.aspect = window.innerWidth / window.innerHeight;

    // 3. Renderizar los cambios en la matriz de proyección
    camera.updateProjectionMatrix();
});


/* Diseño del nivel (TILEMAP) */
/* ************************************************** */
let grupoNivel = null,
    bloques = new Map(),
    gemas = [],
    enemigos = [],
    particulas = [],
    posicionInicial = { x: 2.5, y: 1 },
    puntoControl = null,
    banderaMeta = null;
/* ************************************************** */

const clave = (x, y) => x + "," + y;

function construirNivel(indice) {
    // Eliminar el grupo de nivel anterior
    if (grupoNivel) scene.remove(grupoNivel);

    grupoNivel = new THREE.Group();
    scene.add(grupoNivel);

    bloques = new Map();
    gemas = [];
    enemigos = [];
    particulas = [];

    const mapa = MAPAS[indice];
    const alto = mapa.length;
    mapa.forEach((fila, y) => {
        const yMundo = alto - 1 - y; // Invertir el eje Y para que (0,0) esté en la esquina inferior izquierda

        for (let index = 0; index < fila.length; index++) {
            const element = fila[index];
            // Posición inicial del jugador: centro de la celda en X, pies en la base de la celda en Y
            if(element == "P"){
                posicionInicial = {
                    x : index + 0.5,
                    y : yMundo
                }
            }
            if (SOLIDOS.has(element)) {
                // Crear un bloque sólido
                const arriba = y > 0 ? mapa[y - 1][index] : " ";
                crearBloque(index, yMundo, element, arriba === "#");
            }
        }

    })
}

// 1. Crear el cargador de texturas
const textureLoader = new THREE.TextureLoader();
// 2. Cargar la imagen especificando su ruta (local o URL externa)
const texTierra = textureLoader.load('./src/img/texture/ground.jpg');
const texSuelo = textureLoader.load('./src/img/texture/pasto.jpg');
const texLadrillo = textureLoader.load('./src/img/texture/ladrillo.jpg');
const texSorpresa = textureLoader.load('./src/img/texture/sorpresa.jpg');
const texPiedra = textureLoader.load('./src/img/texture/piedra.png');

for (const tex of [texTierra, texSuelo, texLadrillo, texSorpresa, texPiedra]) {
    // Colores correctos (evita que las texturas se vean lavadas)
    tex.colorSpace = THREE.SRGBColorSpace;
    // Pixel art nítido (sin que se vea borroso de cerca)
    tex.magFilter = THREE.NearestFilter;
}

// CREAR EL MATERIAL
const MATERIALES = {
    suelo: new THREE.MeshLambertMaterial({map: texSuelo}), 
    tierra: new THREE.MeshLambertMaterial({map: texTierra}), 
    ladrillo: new THREE.MeshLambertMaterial({map: texLadrillo}),
    sorpresa: new THREE.MeshLambertMaterial({map: texSorpresa}),
    piedra: new THREE.MeshLambertMaterial({map: texPiedra}),
    columna: new THREE.MeshLambertMaterial({map: texPiedra, color: 0xc9c2b8}), // piedra un poco más clara
}

const GEO_BLOQUE = new THREE.BoxGeometry(1,1,1);
const GEO_TIERRA = new THREE.BoxGeometry(1,4,1);
const GEO_GEMA = new THREE.OctahedronGeometry(0.28);

// tapado = true cuando encima hay otro bloque de suelo (entonces se ve tierra, no pasto)
function crearBloque(x,y,tipo,tapado) {
    // Seleccionar el material que se le va a colocar al bloque
    const material = {
        "#": tapado ? MATERIALES.tierra : MATERIALES.suelo,
        "B": MATERIALES.ladrillo,
        "G": MATERIALES.sorpresa,
        "S": MATERIALES.piedra,
        "C": MATERIALES.columna,
    }[tipo];

    // K (punto de control) y F (bandera) no se dibujan como bloques
    if (!material) return;

    const malla = new THREE.Mesh(GEO_BLOQUE,material);

    malla.position.set(x+0.5,y+0.5,0);
    grupoNivel.add(malla);
    bloques.set(clave(x,y), {x,y,tipo, malla, rebote:0});

    // Solo bajo la fila inferior se pone la columna de tierra
    // (si se pone en todos los "#", las cajas se montan unas sobre otras y parpadean)
    if(tipo==="#" && y===0){
        const tierra = new THREE.Mesh(GEO_TIERRA,MATERIALES.tierra);
        tierra.position.set(x+0.5,y-2,0);
        grupoNivel.add(tierra);
    }

}


/* ************************************************** */
/* JUGADOR (Caballerito)                               */
/* ************************************************** */
// Caja de colisión del jugador (en bloques). Mide menos de 1 de alto
// para que pueda pasar por huecos de un bloque.
const JUGADOR_ANCHO = 0.6;
const JUGADOR_ALTO = 0.95;

// La imagen se dibuja en un plano. Si el PNG tiene fondo transparente,
// alphaTest hace que las partes transparentes no se vean.
const texJugador = textureLoader.load('./src/img/caballerito.png', (tex) => {
    // Cuando la imagen termina de cargar, se ajusta el ancho del plano a sus proporciones
    const proporcion = tex.image.width / tex.image.height;
    spriteJugador.scale.x = proporcion * ALTO_SPRITE;
});
texJugador.colorSpace = THREE.SRGBColorSpace;
texJugador.magFilter = THREE.NearestFilter;

const ALTO_SPRITE = 1.0; // alto de la imagen en bloques
const spriteJugador = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texJugador, transparent: true, alphaTest: 0.5 })
);
spriteJugador.scale.set(ALTO_SPRITE, ALTO_SPRITE, 1);
spriteJugador.position.z = 0.51; // justo delante de los bloques para que no se esconda dentro
scene.add(spriteJugador);

const jugador = {
    x: 0, y: 0,      // x = centro, y = pies
    vx: 0, vy: 0,
    enSuelo: false,
    coyote: 0,       // tiempo extra para saltar justo después de salir de un borde
    buffer: 0,       // recuerda el salto si se presiona W un instante antes de tocar el suelo
    mirando: 1,      // 1 = derecha, -1 = izquierda
};

function reaparecer() {
    jugador.x = posicionInicial.x;
    jugador.y = posicionInicial.y;
    jugador.vx = jugador.vy = 0;
    jugador.mirando = 1;
}


/* ************************************************** */
/* CONTROLES: W (saltar), A (izquierda), D (derecha)   */
/* ************************************************** */
const teclas = {};

window.addEventListener('keydown', (e) => {
    teclas[e.code] = true;
    if (e.code === 'KeyW' && !e.repeat) jugador.buffer = CONFIG.BUFFER_SALTO;
});

window.addEventListener('keyup', (e) => {
    teclas[e.code] = false;
    // Salto variable: si suelta W mientras sube, el salto se corta
    if (e.code === 'KeyW' && jugador.vy > 0) jugador.vy *= CONFIG.CORTE_SALTO;
});

// Si la ventana pierde el foco, soltar todas las teclas (evita que camine solo)
window.addEventListener('blur', () => {
    for (const t in teclas) teclas[t] = false;
});


/* ************************************************** */
/* FÍSICA Y COLISIONES CON LOS BLOQUES                 */
/* ************************************************** */
const esSolido = (tx, ty) => bloques.has(clave(tx, ty));

// Mueve un valor hacia un objetivo sin pasarse
function acercar(valor, objetivo, paso) {
    if (valor < objetivo) return Math.min(valor + paso, objetivo);
    return Math.max(valor - paso, objetivo);
}

function moverJugador(dt) {
    const j = jugador;
    const direccion = (teclas.KeyD ? 1 : 0) - (teclas.KeyA ? 1 : 0);

    // --- Horizontal: acelera al presionar, frena con fricción al soltar ---
    if (direccion !== 0) {
        j.vx = acercar(j.vx, direccion * CONFIG.VEL_CAMINAR, CONFIG.ACELERACION * dt);
        j.mirando = direccion;
    } else {
        j.vx = acercar(j.vx, 0, CONFIG.FRICCION * dt);
    }
    j.x += j.vx * dt;
    colisionHorizontal(j);

    // --- Salto ---
    j.coyote = j.enSuelo ? CONFIG.TIEMPO_COYOTE : j.coyote - dt;
    j.buffer -= dt;
    if (j.buffer > 0 && j.coyote > 0) {
        j.vy = CONFIG.FUERZA_SALTO;
        j.buffer = 0;
        j.coyote = 0;
    }

    // --- Vertical: gravedad ---
    j.vy = Math.max(j.vy + CONFIG.GRAVEDAD * dt, CONFIG.VEL_MAX_CAIDA);
    j.y += j.vy * dt;
    colisionVertical(j);

    // Si cae al vacío, vuelve al inicio
    if (j.y < CONFIG.LIMITE_CAIDA) reaparecer();
}

// Revisa las celdas que toca el lado hacia donde se mueve y lo saca de la pared
function colisionHorizontal(j) {
    const mitad = JUGADOR_ANCHO / 2;
    const y0 = Math.floor(j.y + 0.01);
    const y1 = Math.floor(j.y + JUGADOR_ALTO - 0.01);

    if (j.vx > 0) {
        const tx = Math.floor(j.x + mitad);
        for (let ty = y0; ty <= y1; ty++) {
            if (esSolido(tx, ty)) { j.x = tx - mitad - 0.001; j.vx = 0; return; }
        }
    } else if (j.vx < 0) {
        const tx = Math.floor(j.x - mitad);
        for (let ty = y0; ty <= y1; ty++) {
            if (esSolido(tx, ty)) { j.x = tx + 1 + mitad + 0.001; j.vx = 0; return; }
        }
    }
}

// Revisa el piso (si cae) o el techo (si sube)
function colisionVertical(j) {
    const mitad = JUGADOR_ANCHO / 2;
    const x0 = Math.floor(j.x - mitad + 0.01);
    const x1 = Math.floor(j.x + mitad - 0.01);
    j.enSuelo = false;

    if (j.vy <= 0) {
        const ty = Math.floor(j.y);
        for (let tx = x0; tx <= x1; tx++) {
            if (esSolido(tx, ty)) { j.y = ty + 1; j.vy = 0; j.enSuelo = true; return; }
        }
    } else {
        const ty = Math.floor(j.y + JUGADOR_ALTO);
        for (let tx = x0; tx <= x1; tx++) {
            if (esSolido(tx, ty)) { j.y = ty - JUGADOR_ALTO - 0.001; j.vy = 0; return; }
        }
    }
}


/* ************************************************** */
/* CÁMARA QUE SIGUE AL JUGADOR                         */
/* ************************************************** */
let camX = 0, camY = 0;

function actualizarCamara(dt) {
    // La cámara va un poco por delante del jugador y lo sigue con suavidad
    const objetivoX = jugador.x + 3;
    const objetivoY = Math.max(jugador.y, 1) + 3;
    const suavizado = Math.min(1, dt * 5);
    camX += (objetivoX - camX) * suavizado;
    camY += (objetivoY - camY) * suavizado;

    camera.position.set(camX, camY, 14);
    camera.lookAt(camX, camY - 2, 0);
}

function dibujarJugador() {
    // El plano se centra en su mitad, por eso se sube medio alto
    spriteJugador.position.x = jugador.x;
    spriteJugador.position.y = jugador.y + ALTO_SPRITE / 2;
    // Voltear la imagen cuando camina a la izquierda
    spriteJugador.scale.x = Math.abs(spriteJugador.scale.x) * jugador.mirando;
}


/* ************************************************** */
/* BUCLE PRINCIPAL                                     */
/* ************************************************** */
let ultimoTiempo = null;

function animate(time) {
    // dt = segundos desde el frame anterior (limitado por si la pestaña se congela)
    const dt = ultimoTiempo === null ? 0 : Math.min((time - ultimoTiempo) / 1000, 1 / 30);
    ultimoTiempo = time;

    moverJugador(dt);
    dibujarJugador();
    actualizarCamara(dt);

    renderer.render(scene, camera);
}

// Construir el nivel una sola vez (no dentro de animate)
construirNivel(nivelActual);
reaparecer();
// La cámara empieza ya ubicada sobre el jugador
camX = jugador.x + 3;
camY = Math.max(jugador.y, 1) + 3;
actualizarCamara(0);