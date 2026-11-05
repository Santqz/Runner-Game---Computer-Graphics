/* =====================================================================
   RUNNER GAME — Lógica de todo el juego
   ===================================================================== */
import * as THREE from 'three';


/* =====================================================================
   1. CONFIGURACIÓN
   Cambiar estos números cambia cómo "se siente" el juego.
   ===================================================================== */
const CONFIG = {
    GRAVEDAD: -32,          // aceleración hacia abajo (unidades/segundo²)
    VEL_CAMINAR: 6,         // velocidad máxima caminando
    VEL_CORRER: 9,          // velocidad máxima con SHIFT
    ACELERACION: 40,        // qué tan rápido alcanza la velocidad máxima
    FRICCION: 30,           // qué tan rápido frena al soltar las teclas
    FUERZA_SALTO: 15,       // velocidad vertical inicial del salto
    CORTE_SALTO: 0.45,      // si sueltas el botón antes, el salto se corta
    VEL_MAX_CAIDA: -20,     // límite de velocidad al caer
    TIEMPO_COYOTE: 0.1,     // gracia para saltar justo después de salir del borde
    BUFFER_SALTO: 0.12,     // si presionas saltar un poco antes de tocar el suelo, igual salta
    VIDAS_INICIALES: 3,
    TIEMPO_NIVEL: 300,      // segundos para completar el nivel
    LIMITE_CAIDA: -5,       // si el jugador baja de esta Y, se cayó al vacío
    VEL_ENEMIGO: 1.5,
    INVULNERABLE: 2.0,      // segundos de invulnerabilidad tras perder una vida
    // --- Ataque con el martillo ---
    DURACION_ATAQUE: 0.28,  // cuánto dura la animación del golpe
    GOLPE_ACTIVO: 0.16,     // durante los primeros X segundos el golpe hace daño
    ENFRIAMIENTO_ATAQUE: 0.35, // tiempo mínimo entre un golpe y el siguiente
    ALCANCE_ATAQUE: 1.2,    // ancho de la zona de golpe delante del jugador
};


/* =====================================================================
   2. DISEÑO DEL NIVEL (TILEMAP)
   Cada carácter es una casilla de 1x1. La PRIMERA fila es la de ARRIBA.
   **************************************************
    # Suelo                    B ladrillo (se puede romper)
    G bloque sorpresa          S bloque de piedra (escaleras)
    C Columna de piedra        o Coleccionable (gema)
    E Enemigo                  P Jugador (posición inicial)
    K Punto de control         F Bandera de Meta
   ***************************************************** */
const MAPA_NIVEL = [
  "",
  "                                                                                                                       ",
  "          G                                                                                                               ",
  "                              oooo                                                                                           ",
  "                              BBBB                      SS    S                                                                         SS",
  "        GBGBG                                          SSS    SS                           E                                           SSS",
  "                    C                     C           SSSS    SSS                        SSS                                          SSSS",
  "  P            E    C               E E   C    E     SSSSS    SSSS    K        E                    o       0        E               SSSSS          F",
  "#########################    #############################    ############  ####   ###         ####   #    ###  ###############################################",
];

// Caracteres SÓLIDOS: el jugador choca con ellos.
// OJO: K (punto de control) y F (meta) NO van aquí. No son bloques: son objetos
// que el jugador debe ATRAVESAR para activarlos. Si fueran sólidos, la meta
// sería una pared y nunca se podría ganar.
// U = bloque sorpresa ya usado (no está en el mapa: aparece cuando golpeas una G).
const SOLIDOS = new Set(["#", "B", "G", "S", "C", "U"]);


/* =====================================================================
   3. ESCENA, CÁMARA, RENDERIZADOR Y LUCES
   ===================================================================== */
const COLOR_CIELO = 0x6ec6ff;
const COLOR_NIEBLA = 0x26355a;   // azul oscuro de cueva (la sección 6 lo ajusta al color de la imagen)

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLOR_CIELO);   // la sección 6 lo cambia por la imagen de fondo
// FOG: lo lejano se mezcla con el color del horizonte (da profundidad).
// Empieza a notarse a 22 unidades de la cámara y a 80 ya es solo niebla,
// así las montañas del fondo (sección 6) se ven "lejanas" y se funden con la imagen.
scene.fog = new THREE.Fog(COLOR_NIEBLA, 22, 80);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(5, 5, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // máx. 2: nítido sin exigir demasiado a la GPU
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    // 1. Actualizar el tamaño del renderizador
    renderer.setSize(window.innerWidth, window.innerHeight);
    // 2. Actualizar la relación de aspecto de la cámara
    camera.aspect = window.innerWidth / window.innerHeight;
    // 3. Recalcular la matriz de proyección con el nuevo aspecto
    camera.updateProjectionMatrix();
});

// LUCES
// Una AmbientLight sola ilumina todo por igual: no hay sombras ni volumen
// (los cubos se ven planos). Por eso combinamos dos luces:
//  - HemisphereLight: luz de relleno, azul claro arriba y azul oscuro abajo (cueva).
//  - DirectionalLight: el "sol". Es la única de las dos que proyecta sombras.
const luzAmbiente = new THREE.HemisphereLight(0xd6ecff, 0x1f3a5c, 2.2);
scene.add(luzAmbiente);

const luzSol = new THREE.DirectionalLight(0xe3f1ff, 2.6);
luzSol.castShadow = true;
luzSol.shadow.mapSize.set(2048, 2048);     // resolución de la sombra
luzSol.shadow.camera.left = -22;           // zona que recibe sombras
luzSol.shadow.camera.right = 22;
luzSol.shadow.camera.top = 15;
luzSol.shadow.camera.bottom = -10;
luzSol.shadow.camera.near = 1;
luzSol.shadow.camera.far = 60;
scene.add(luzSol);
scene.add(luzSol.target);                  // el objetivo de la luz también va en la escena


/* =====================================================================
   4. TEXTURAS DESDE IMÁGENES
   ===================================================================== */
const RUTA_TEXTURAS = './src/img/texture/';

// 1. El LoadingManager vigila todas las cargas
const manager = new THREE.LoadingManager();

manager.onProgress = (url, cargadas, total) => {
    // Mostramos el progreso en el botón de jugar
    const boton = document.getElementById('btn-jugar');
    if (boton) boton.textContent = `CARGANDO ${cargadas}/${total}`;
};

manager.onLoad = () => {
    // Todas las texturas listas: habilitamos el botón
    const boton = document.getElementById('btn-jugar');
    if (boton) { boton.textContent = 'JUGAR'; boton.disabled = false; }
};

manager.onError = (url) => {
    // Error típico: la ruta está mal escrita o el archivo no existe.
    console.error(`No se pudo cargar la textura: ${url}. Revisa la ruta y el nombre del archivo.`);
};

// 2. Crear el cargador de texturas usando el manager
const textureLoader = new THREE.TextureLoader(manager);

// 3. Función de ayuda: carga una imagen y la configura
function cargarTextura(archivo) {
    // El segundo parámetro de load() es una función que se ejecuta cuando la imagen YA llegó
    const textura = textureLoader.load(RUTA_TEXTURAS + archivo, (tex) => {
        // Corrección de proporción: cada cara del cubo es cuadrada (1x1).
        // Si la imagen no es cuadrada (ej. ladrillo.jpg es 1024x512), se vería
        // estirada. Con repeat mostramos solo una porción cuadrada de la imagen.
        const { width, height } = tex.image;
        if (width > height) tex.repeat.set(height / width, 1);   // más ancha: recortamos en X
        if (height > width) tex.repeat.set(1, width / height);   // más alta: recortamos en Y
    });
    // Indica que la imagen está en sRGB. Sin esto los colores se ven lavados.
    textura.colorSpace = THREE.SRGBColorSpace;
    // Filtrado anisotrópico: la textura se ve nítida aunque la cara esté inclinada
    // respecto a la cámara (por ejemplo, la cara de arriba del suelo vista en ángulo).
    textura.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // Las texturas son PIXEL ART: con NearestFilter cada píxel se ve como un
    // cuadrito nítido. Con el filtro por defecto (LinearFilter) se verían borrosas.
    textura.magFilter = THREE.NearestFilter;
    return textura;
}


const texTierra    = cargarTextura('tierra_cueva_conexion.png');

const texTierraRelleno = cargarTextura('tierra_cueva_conexion.png');
texTierraRelleno.wrapS = THREE.RepeatWrapping;
texTierraRelleno.wrapT = THREE.RepeatWrapping;
texTierraRelleno.repeat.set(1, 4);
const texSueloLado = cargarTextura('tierra_cueva.png');   // lados del suelo (con borde arriba)
const texLadrillo  = cargarTextura('ladrillos_claros.png');
const texSorpresa  = cargarTextura('sorpresa_activado.png');
const texUsado     = cargarTextura('sorpresa_desactivado.png');
const texPiedra    = cargarTextura('ladrillos_oscuros.png');

// CREAR LOS MATERIALES
// MeshLambertMaterial: material sencillo que reacciona a la luz.
const matSueloLado = new THREE.MeshLambertMaterial({ map: texSueloLado });
const MATERIALES = {
    // Un BoxGeometry tiene 6 caras, en este orden: [+X, -X, +Y (arriba), -Y (abajo), +Z, -Z]
    // Pasando un ARREGLO de materiales, cada cara usa uno distinto.
    suelo: [
        matSueloLado,
        matSueloLado,
        new THREE.MeshLambertMaterial({ map: texTierra }),  // arriba: tierra de cueva
        new THREE.MeshLambertMaterial({ map: texTierra }),  // abajo: tierra
        matSueloLado,
        matSueloLado,
    ],
    tierra:   new THREE.MeshLambertMaterial({ map: texTierraRelleno }),
    ladrillo: new THREE.MeshLambertMaterial({ map: texLadrillo }),
    // emissive: el bloque "brilla" un poco aunque esté en sombra
    sorpresa: new THREE.MeshLambertMaterial({ map: texSorpresa, emissive: 0x0a2a44 }),
    usado:    new THREE.MeshLambertMaterial({ map: texUsado }),
    piedra:   new THREE.MeshLambertMaterial({ map: texPiedra }),
    columna:  new THREE.MeshLambertMaterial({ map: texPiedra }),   // misma textura que la piedra
    // La gema no usa imagen: un color brillante se ve mejor en un objeto pequeño
    gema:     new THREE.MeshPhongMaterial({ color: 0x26c6da, emissive: 0x0b5560, shininess: 100 }),
};

// Reutilizamos UNA sola geometría para todos los bloques (ahorra memoria)
const GEO_BLOQUE = new THREE.BoxGeometry(1, 1, 1);
const GEO_TIERRA = new THREE.BoxGeometry(1, 4, 1);
const GEO_GEMA = new THREE.OctahedronGeometry(0.28);


/* =====================================================================
   5. MODELOS 3D
   ===================================================================== */

// Ayuda: crea una malla, la ubica y activa sombras
function pieza(geometria, material, x, y, z) {
    const malla = new THREE.Mesh(geometria, material);
    malla.position.set(x, y, z);
    malla.castShadow = true;
    return malla;
}

// Ángulos del martillo (rotación en X del pivote):
//   reposo: apuntando hacia adelante a la altura del pecho (no tapa la cara)
//   inicio/fin del golpe: va de atrás-arriba a adelante-abajo
const REPOSO_ARMA = 1.2;
const ARMA_INICIO_GOLPE = -1.5;
const ARMA_FIN_GOLPE = 2.3;

function crearModeloJugador() {
    const grupo = new THREE.Group();   // el origen del grupo está en los PIES
    const matPiel = new THREE.MeshLambertMaterial({ color: 0xf6d2b4 });
    const matPelo = new THREE.MeshLambertMaterial({ color: 0x7a4a26 });
    const matCamisa = new THREE.MeshLambertMaterial({ color: 0xf29b1d });     // naranja
    const matPantalon = new THREE.MeshLambertMaterial({ color: 0x3b3340 });
    const matNegro = new THREE.MeshLambertMaterial({ color: 0x1e1e22 });      // bufanda y cinta
    const matMascara = new THREE.MeshLambertMaterial({ color: 0x7b2cbf });    // morado
    const matOjoMascara = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });   // Basic = no le afecta la luz
    const matOjoVerde = new THREE.MeshBasicMaterial({ color: 0x2fd34a });

    // Piernas (la animación de caminar las mueve)
    const piernaIzq = pieza(new THREE.BoxGeometry(0.14, 0.2, 0.18), matPantalon, -0.1, 0.1, 0);
    const piernaDer = pieza(new THREE.BoxGeometry(0.14, 0.2, 0.18), matPantalon, 0.1, 0.1, 0);

    // Torso con camisa naranja
    const torso = pieza(new THREE.BoxGeometry(0.42, 0.3, 0.3), matCamisa, 0, 0.35, 0);

    // Bufanda negra gruesa: un cilindro alrededor del cuello + la punta atrás
    const bufanda = pieza(new THREE.CylinderGeometry(0.24, 0.27, 0.16, 16), matNegro, 0, 0.55, 0);
    const puntaBufanda = pieza(new THREE.BoxGeometry(0.12, 0.26, 0.05), matNegro, 0.1, 0.43, -0.2);
    puntaBufanda.rotation.z = 0.25;

    // Cabeza grande (esfera un poco achatada)
    const cabeza = pieza(new THREE.SphereGeometry(0.3, 24, 18), matPiel, 0, 0.86, 0);
    cabeza.scale.set(1, 0.95, 0.95);

    const peloArriba = pieza(new THREE.SphereGeometry(0.33, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), matPelo, 0, 0.84, -0.01);
    const peloAtras = pieza(new THREE.SphereGeometry(0.31, 20, 14), matPelo, 0, 0.84, -0.07);
    const mechones = [
        [-0.2, 1.1, 0.02, 0.6], [0.0, 1.17, -0.04, 0.1], [0.2, 1.1, 0.0, -0.6],
        [-0.3, 0.92, 0.1, 1.3], [0.3, 0.92, 0.1, -1.3], [0.08, 1.12, 0.14, -0.3],
    ].map(([x, y, z, giro]) => {
        const m = pieza(new THREE.ConeGeometry(0.07, 0.2, 5), matPelo, x, y, z);
        m.rotation.z = giro;
        return m;
    });

    const cinta = pieza(new THREE.TorusGeometry(0.305, 0.03, 8, 28), matNegro, 0, 0.9, 0);
    cinta.rotation.x = Math.PI / 2 - 0.12;   // un poco inclinada

    const mascara = pieza(new THREE.BoxGeometry(0.46, 0.2, 0.08), matMascara, 0, 0.92, 0.26);
    const mascaraArriba = pieza(new THREE.BoxGeometry(0.34, 0.06, 0.07), matMascara, 0, 1.04, 0.24);
    const mascaraAbajo = pieza(new THREE.BoxGeometry(0.36, 0.05, 0.07), matMascara, 0, 0.8, 0.255);

    const z = 0.305;
    const ojosMascara = [
        [-0.15, 0.95, 0.07, 0.1], [-0.09, 0.88, 0.07, 0.08],   // ojo izquierdo
        [0.14, 0.93, 0.07, 0.14], [0.08, 0.87, 0.05, 0.04],    // ojo derecho
    ].map(([x, y, ancho, alto]) => pieza(new THREE.BoxGeometry(ancho, alto, 0.01), matOjoMascara, x, y, z));

    const ojoVerdeIzq = pieza(new THREE.BoxGeometry(0.06, 0.035, 0.01), matOjoVerde, -0.09, 0.755, 0.27);
    const ojoVerdeDer = pieza(new THREE.BoxGeometry(0.06, 0.035, 0.01), matOjoVerde, 0.09, 0.755, 0.27);
    const boca = pieza(new THREE.BoxGeometry(0.05, 0.015, 0.01), matOjoMascara, 0.02, 0.69, 0.255);

    const matMango = new THREE.MeshLambertMaterial({ color: 0x9c6644 });
    const matCabeza = new THREE.MeshLambertMaterial({ color: 0xb8c0cc });
    const brazoArma = new THREE.Group();
    brazoArma.position.set(0, 0.36, 0.18);
    const mango = pieza(new THREE.CylinderGeometry(0.03, 0.03, 0.46), matMango, 0, 0.23, 0);
    const cabezaMartillo = pieza(new THREE.BoxGeometry(0.16, 0.16, 0.3), matCabeza, 0, 0.48, 0);
    const bandaMartillo = pieza(new THREE.BoxGeometry(0.17, 0.17, 0.07), matMascara, 0, 0.48, 0);
    brazoArma.add(mango, cabezaMartillo, bandaMartillo);
    brazoArma.rotation.x = REPOSO_ARMA;

    grupo.add(piernaIzq, piernaDer, torso, bufanda, puntaBufanda, cabeza, peloArriba, peloAtras,
              ...mechones, cinta, mascara, mascaraArriba, mascaraAbajo, ...ojosMascara,
              ojoVerdeIzq, ojoVerdeDer, boca, brazoArma);
    grupo.userData = { piernaIzq, piernaDer, brazoArma };   // guardamos lo que vamos a animar
    return grupo;
}


// ---------- Enemigo: un "blob" morado ----------
// Material compartido: lo usan el cuerpo del enemigo y sus pedacitos al morir
const MAT_ENEMIGO = new THREE.MeshLambertMaterial({ color: 0x9b5de5 });

function crearModeloEnemigo() {
    const grupo = new THREE.Group();
    const matCuerpo = MAT_ENEMIGO;
    const matBlanco = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const matNegro = new THREE.MeshBasicMaterial({ color: 0x111111 });

    const cuerpo = pieza(new THREE.SphereGeometry(0.42, 20, 16), matCuerpo, 0, 0.32, 0);
    cuerpo.scale.set(1, 0.78, 0.9);     // achatamos la esfera
    const ojoIzq = pieza(new THREE.SphereGeometry(0.1, 10, 10), matBlanco, -0.14, 0.42, 0.3);
    const ojoDer = pieza(new THREE.SphereGeometry(0.1, 10, 10), matBlanco, 0.14, 0.42, 0.3);
    const pupIzq = pieza(new THREE.SphereGeometry(0.05, 8, 8), matNegro, -0.14, 0.42, 0.39);
    const pupDer = pieza(new THREE.SphereGeometry(0.05, 8, 8), matNegro, 0.14, 0.42, 0.39);
    const cejaIzq = pieza(new THREE.BoxGeometry(0.16, 0.04, 0.04), matNegro, -0.14, 0.55, 0.33);
    cejaIzq.rotation.z = -0.4;
    const cejaDer = pieza(new THREE.BoxGeometry(0.16, 0.04, 0.04), matNegro, 0.14, 0.55, 0.33);
    cejaDer.rotation.z = 0.4;

    grupo.add(cuerpo, ojoIzq, ojoDer, pupIzq, pupDer, cejaIzq, cejaDer);
    return grupo;
}

// ---------- Bandera (meta) y punto de control ----------
function crearBandera(alto, colorTela) {
    const grupo = new THREE.Group();
    const matPoste = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
    const matTela = new THREE.MeshLambertMaterial({ color: colorTela, side: THREE.DoubleSide });
    grupo.add(pieza(new THREE.CylinderGeometry(0.06, 0.06, alto), matPoste, 0, alto / 2, 0));
    grupo.add(pieza(new THREE.SphereGeometry(0.14, 12, 12), MATERIALES.sorpresa, 0, alto + 0.1, 0));
    const tela = pieza(new THREE.BoxGeometry(0.9, 0.6, 0.04), matTela, -0.48, alto - 0.4, 0);
    grupo.add(tela);
    grupo.userData.tela = tela;
    return grupo;
}


/* =====================================================================
   6. DECORACIÓN DE FONDO
    ===================================================================== */
const RUTA_FONDOS = './src/img/fondo/';

const CAPAS_IMAGEN = [
    { archivo: 'capa-1-cielo.png',        velocidad: 0.0015 },
    { archivo: 'capa-2-cristales.png',    velocidad: 0.004 },
    { archivo: 'capa-3-estalactitas.png', velocidad: 0.007 },
    { archivo: 'capa-4-bosque.png',       velocidad: 0.011 },
    { archivo: 'capa-5-picos.png',        velocidad: 0.016 },
];
const DISTANCIA_IMAGEN_FONDO = 150;   // la capa más lejana; cada siguiente va 1 unidad más cerca

const planosFondo = CAPAS_IMAGEN.map((capa, i) => {
    const material = new THREE.MeshBasicMaterial({
        fog: false,
        depthWrite: false,
        transparent: i > 0,          // el cielo es opaco
    });
    const plano = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    plano.position.z = -(DISTANCIA_IMAGEN_FONDO - i);   // la capa 1 atrás, la 5 adelante
    plano.renderOrder = -10 + i;                         // se dibujan en orden: de atrás hacia adelante
    plano.visible = false;                               // hasta que cargue su imagen
    plano.userData.velocidad = capa.velocidad;
    camera.add(plano);   // hijo de la cámara: se mueve y gira con ella
    return plano;
});
scene.add(camera);   // los hijos de la cámara solo se dibujan si la cámara está en la escena

function ajustarPlanoFondo() {
    planosFondo.forEach(plano => {
        const distancia = -plano.position.z;
        const alto = 2 * distancia * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        const ancho = alto * camera.aspect;
        plano.scale.set(ancho * 1.02, alto * 1.02, 1);   // 2 % extra para que no se vean bordes

        const textura = plano.material.map;
        if (textura && textura.image) {
            // Cuántas copias de la imagen caben a lo ancho de la pantalla
            const proporcionImagen = textura.image.width / textura.image.height;
            textura.repeat.set(camera.aspect / proporcionImagen, 1);
        }
    });
}
window.addEventListener('resize', ajustarPlanoFondo);

// Color promedio de la franja central de una imagen → color de la niebla
function colorPromedio(imagen) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imagen, 0, 0, 32, 32);
    const datos = ctx.getImageData(0, 10, 32, 14).data;   // filas del medio (horizonte)
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < datos.length; i += 4) { r += datos[i]; g += datos[i + 1]; b += datos[i + 2]; }
    const n = datos.length / 4;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

scene.background = scene.fog.color;
const cargadorFondo = new THREE.TextureLoader();
CAPAS_IMAGEN.forEach((capa, i) => {
    cargadorFondo.load(
        RUTA_FONDOS + capa.archivo,
        (textura) => {
            textura.colorSpace = THREE.SRGBColorSpace;
            textura.wrapS = THREE.RepeatWrapping;        // se repite: las imágenes empalman sin costura
            textura.wrapT = THREE.ClampToEdgeWrapping;
            textura.anisotropy = renderer.capabilities.getMaxAnisotropy();
            const plano = planosFondo[i];
            plano.material.map = textura;
            plano.material.needsUpdate = true;
            plano.visible = true;
            ajustarPlanoFondo();
            if (i === 0) scene.fog.color.copy(colorPromedio(textura.image));
        },
        undefined,
        () => console.warn(`No se encontró ${RUTA_FONDOS}${capa.archivo}: el juego sigue sin esa capa.`)
    );
});

function actualizarFondo() {
    // Cada capa de imagen avanza a su propia velocidad (las lejanas más despacio)
    planosFondo.forEach(plano => {
        if (plano.material.map) plano.material.map.offset.x = camera.position.x * plano.userData.velocidad;
    });
}


/* =====================================================================
   7. SONIDOS
   Usamos el sistema de audio de Three.js:
   - AudioListener: los "oídos". Va pegado a la cámara.
   - THREE.Audio: un sonido (no posicional: se oye igual en todos lados).
   - AudioLoader: descarga y decodifica el archivo.

   POLÍTICA DE LOS NAVEGADORES: el audio solo puede empezar después de que
   el usuario interactúe con la página (clic o tecla). Por eso NO creamos
   nada al cargar: todo se crea en iniciarAudio(), que se llama en el
   primer clic o la primera tecla. Así tampoco aparecen avisos en la consola.

   ARCHIVOS (carpeta src/css/Sonidos/). Si alguno falta, el juego sigue sin ese sonido.

   MÚSICA DE FONDO: suena en bucle mientras se juega (también en pausa y
   mientras el jugador pierde una vida). Se detiene en la pantalla de
   inicio y en la pantalla final (Game Over / Nivel completado).
   ===================================================================== */
const RUTA_AUDIO = './src/css/Sonidos/';

// nombre: [archivo, volumen 0-1]
// Los nombres de archivo tienen espacios; encodeURI() los convierte a %20
// al armar la URL, así el navegador los encuentra sin problema.
const ARCHIVOS_EFECTOS = {
    golpe:        ['Sonido Ataque.mp3', 0.6],    // el jugador lanza un golpe
    romperBloque: ['Sonido Bloque.mp3', 0.6],    // el jugador rompe un bloque
    enemigo:      ['Sonido Enemigo.mp3', 0.7],   // el jugador mata un enemigo
    gema:         ['Sonido Gema.mp3', 0.5],      // el jugador recoge una gema (o golpea un "?")
    perderVida:   ['Sonido Muerte.mp3', 0.7],    // el jugador pierde una vida
    salto:        ['Sonido Salto.mp3', 0.5],     // el jugador salta
};
const ARCHIVOS_MUSICA = {
    juego: ['Sonido Fondo.mp3', 0.3],            // música de fondo en bucle
};
// Nota: el código también llama a sonar('puntoControl'), sonar('vidaExtra'),
// sonar('victoria') y sonar('gameOver'). Como no están en la lista, no suenan
// (sonar() simplemente no hace nada). Si luego tienes esos audios, agrégalos aquí.

let oyente = null;            // AudioListener (se crea en la primera interacción)
const efectos = {};           // nombre -> THREE.Audio
const musicas = {};           // nombre -> THREE.Audio (en bucle)
let musicaActual = null;      // qué música DEBERÍA sonar ahora
let silenciado = false;

function iniciarAudio() {
    if (oyente) {
        // Ya existe: por si el navegador lo suspendió, lo reanudamos
        if (oyente.context.state === 'suspended') oyente.context.resume();
        return;
    }
    oyente = new THREE.AudioListener();
    camera.add(oyente);
    oyente.setMasterVolume(silenciado ? 0 : 1);

    const cargador = new THREE.AudioLoader();
    const cargar = (nombre, [archivo, volumen], destino, enBucle) => {
        const audio = new THREE.Audio(oyente);
        audio.setVolume(volumen);
        audio.setLoop(enBucle);
        destino[nombre] = audio;
        cargador.load(
            RUTA_AUDIO + encodeURI(archivo),
            (buffer) => {
                audio.setBuffer(buffer);
                // Si es la música que toca ahora, empieza en cuanto llega
                if (enBucle && nombre === musicaActual) audio.play();
            },
            undefined,
            () => console.warn(`Falta el audio ${RUTA_AUDIO + archivo}: el juego sigue sin ese sonido.`)
        );
    };
    Object.entries(ARCHIVOS_EFECTOS).forEach(([n, datos]) => cargar(n, datos, efectos, false));
    Object.entries(ARCHIVOS_MUSICA).forEach(([n, datos]) => cargar(n, datos, musicas, true));
}

// La primera interacción "desbloquea" el audio
window.addEventListener('pointerdown', iniciarAudio);
window.addEventListener('keydown', iniciarAudio);

// Reproduce un efecto. Si ya estaba sonando, lo reinicia (ej. muchas gemas seguidas).
function sonar(nombre) {
    const audio = efectos[nombre];
    if (!audio || !audio.buffer) return;   // todavía no cargó o el archivo falta
    if (audio.isPlaying) audio.stop();
    audio.play();
}

function reproducirMusica(nombre) {
    if (musicaActual !== nombre) detenerMusica();
    musicaActual = nombre;
    const musica = musicas[nombre];
    if (musica && musica.buffer && !musica.isPlaying) musica.play();
}

function detenerMusica() {
    const musica = musicas[musicaActual];
    if (musica && musica.isPlaying) musica.stop();
    musicaActual = null;
}

// Tecla M: silenciar / activar todo el sonido
function alternarSilencio() {
    silenciado = !silenciado;
    if (oyente) oyente.setMasterVolume(silenciado ? 0 : 1);
    mostrarAviso(silenciado ? 'SONIDO: NO' : 'SONIDO: SÍ');
}


/* =====================================================================
   8. CONSTRUCCIÓN DEL NIVEL
   Recorremos el mapa de texto y creamos un objeto por cada carácter.
   Los bloques sólidos se guardan en un Map con la clave "x,y" para
   encontrarlos rápido al calcular colisiones.
   IMPORTANTE: construirNivel() se llama UNA vez al iniciar la partida,
   nunca dentro de animate(). Si se llamara en cada cuadro, crearíamos
   cientos de mallas 60 veces por segundo y el juego se volvería lento.
   ===================================================================== */
let grupoNivel = null,
    bloques = new Map(),             // "x,y" -> { x, y, tipo, malla, rebote }
    gemas = [],
    enemigos = [],
    particulas = [],
    posicionInicial = { x: 2.5, y: 1 },
    puntoControl = null,             // { x, y, bandera, activo }
    banderaMeta = null;              // { x, bandera }

const clave = (x, y) => x + "," + y;

function construirNivel() {
    // Eliminar el grupo de nivel anterior
    if (grupoNivel) scene.remove(grupoNivel);

    grupoNivel = new THREE.Group();
    scene.add(grupoNivel);

    bloques = new Map();
    gemas = [];
    enemigos = [];
    particulas = [];
    puntoControl = null;
    banderaMeta = null;

    const alto = MAPA_NIVEL.length;
    MAPA_NIVEL.forEach((fila, y) => {
        // Invertir el eje Y: la fila 0 del arreglo es la de ARRIBA del nivel
        const yMundo = alto - 1 - y;

        for (let index = 0; index < fila.length; index++) {
            const element = fila[index];

            if (SOLIDOS.has(element)) {
                crearBloque(index, yMundo, element);         // bloque sólido
            } else if (element === "o") {
                crearGema(index, yMundo);
            } else if (element === "E") {
                crearEnemigo(index, yMundo);
            } else if (element === "P") {
                posicionInicial = { x: index + 0.5, y: yMundo };
            } else if (element === "K") {
                const bandera = crearBandera(2, 0x9e9e9e);   // gris hasta que se active
                bandera.position.set(index + 0.5, yMundo, 0);
                grupoNivel.add(bandera);
                puntoControl = { x: index + 0.5, y: yMundo, bandera, activo: false };
            } else if (element === "F") {
                const bandera = crearBandera(6, 0xff595e);
                bandera.position.set(index + 0.5, yMundo, 0);
                grupoNivel.add(bandera);
                banderaMeta = { x: index + 0.5, bandera };
            }
        }
    });
}

function crearBloque(x, y, tipo) {
    // Seleccionar el material que se le va a colocar al bloque según su tipo
    const material = {
        "#": MATERIALES.suelo,
        "B": MATERIALES.ladrillo,
        "G": MATERIALES.sorpresa,
        "S": MATERIALES.piedra,
        "C": MATERIALES.columna,
        "U": MATERIALES.usado,
    }[tipo];

    const malla = new THREE.Mesh(GEO_BLOQUE, material);
    // +0.5 porque el cubo se ubica desde su centro, pero la casilla va de x a x+1
    malla.position.set(x + 0.5, y + 0.5, 0);
    malla.castShadow = true;
    malla.receiveShadow = true;
    grupoNivel.add(malla);
    bloques.set(clave(x, y), { x, y, tipo, malla, rebote: 0 });

    // Debajo de cada bloque de suelo agregamos tierra (solo decorativa, sin colisión)
    if (tipo === "#") {
        const tierra = new THREE.Mesh(GEO_TIERRA, MATERIALES.tierra);
        tierra.position.set(x + 0.5, y - 2, 0);
        tierra.receiveShadow = true;
        grupoNivel.add(tierra);
    }
}

function crearGema(x, y) {
    const malla = new THREE.Mesh(GEO_GEMA, MATERIALES.gema);
    malla.position.set(x + 0.5, y + 0.5, 0);
    malla.castShadow = true;
    grupoNivel.add(malla);
    gemas.push({ x, y, malla, recogida: false });
}

function crearEnemigo(x, y) {
    const malla = crearModeloEnemigo();
    grupoNivel.add(malla);
    enemigos.push({
        x: x + 0.5, y: y,          // x = centro, y = base (pies)
        vx: 0, vy: 0,
        ancho: 0.8, alto: 0.7,     // caja de colisión
        direccion: -1,             // empieza caminando a la izquierda
        vivo: true,
        tiempoMuerto: 0,
        malla,
    });
}

/* =====================================================================
   9. ENTRADA DEL TECLADO
   Guardamos qué teclas están presionadas; en cada cuadro preguntamos.
   ===================================================================== */
const teclas = {};

window.addEventListener('keydown', (e) => {
    teclas[e.code] = true;

    // Evita que la página haga scroll con espacio o flechas
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();

    // "Buffer" de salto: recordamos que el jugador quiso saltar
    if (!e.repeat && esTeclaSalto(e.code) && estado === 'jugando') {
        jugador.bufferSalto = CONFIG.BUFFER_SALTO;
    }

    // Ataque: J o X
    if (!e.repeat && esTeclaAtaque(e.code) && estado === 'jugando') {
        intentarAtacar();
    }

    if (e.code === 'KeyP') alternarPausa();
    if (e.code === 'KeyM') alternarSilencio();
    if (e.code === 'KeyR' && estado !== 'inicio') iniciarJuego();
});

window.addEventListener('keyup', (e) => { teclas[e.code] = false; });

const esTeclaSalto = (code) => code === 'Space' || code === 'ArrowUp' || code === 'KeyW';
const esTeclaAtaque = (code) => code === 'KeyJ' || code === 'KeyX';
const teclaIzquierda = () => teclas['ArrowLeft'] || teclas['KeyA'];
const teclaDerecha = () => teclas['ArrowRight'] || teclas['KeyD'];
const teclaSaltoPresionada = () => teclas['Space'] || teclas['ArrowUp'] || teclas['KeyW'];
const teclaCorrer = () => teclas['ShiftLeft'] || teclas['ShiftRight'];


/* =====================================================================
   10. FÍSICA Y COLISIONES (AABB contra la grilla)
   Movemos primero en X y resolvemos choques, y LUEGO en Y.
   Separar los ejes evita que el personaje se "pegue" en las esquinas.
   Toda entidad tiene: x (centro), y (pies), ancho, alto, vx, vy.
   ===================================================================== */
function obtenerBloque(tx, ty) {
    return bloques.get(clave(tx, ty)) || null;
}

// Devuelve los bloques sólidos que se cruzan con la caja de la entidad
function bloquesQueToca(ent) {
    const resultado = [];
    const izquierda = Math.floor(ent.x - ent.ancho / 2);
    const derecha = Math.floor(ent.x + ent.ancho / 2 - 0.001);
    const abajo = Math.floor(ent.y);
    const arriba = Math.floor(ent.y + ent.alto - 0.001);

    for (let tx = izquierda; tx <= derecha; tx++) {
        for (let ty = abajo; ty <= arriba; ty++) {
            const b = obtenerBloque(tx, ty);
            if (b) resultado.push(b);
        }
    }
    return resultado;
}

// Mueve una entidad y la saca de los bloques con los que choque.
// alGolpearTecho: función opcional (callback) si choca con la cabeza.
function moverEntidad(ent, dt, alGolpearTecho) {
    ent.chocoPared = false;

    // --- Eje X ---
    ent.x += ent.vx * dt;
    let choques = bloquesQueToca(ent);
    if (choques.length > 0) {
        if (ent.vx > 0) {
            ent.x = Math.min(...choques.map(b => b.x)) - ent.ancho / 2 - 0.001;
        } else if (ent.vx < 0) {
            ent.x = Math.max(...choques.map(b => b.x)) + 1 + ent.ancho / 2 + 0.001;
        }
        ent.vx = 0;
        ent.chocoPared = true;
    }

    // --- Eje Y ---
    ent.y += ent.vy * dt;
    ent.enSuelo = false;
    choques = bloquesQueToca(ent);
    if (choques.length > 0) {
        if (ent.vy < 0) {
            // Cayendo: aterriza encima del bloque
            ent.y = Math.max(...choques.map(b => b.y)) + 1;
            ent.enSuelo = true;
        } else if (ent.vy > 0) {
            // Subiendo: se golpea la cabeza
            ent.y = Math.min(...choques.map(b => b.y)) - ent.alto - 0.001;
            if (alGolpearTecho) alGolpearTecho(choques);
        }
        ent.vy = 0;
    }
}

// ¿Se superponen dos cajas? (prueba AABB)
function seSuperponen(a, b) {
    return Math.abs(a.x - b.x) < (a.ancho + b.ancho) / 2 &&
           a.y < b.y + b.alto &&
           a.y + a.alto > b.y;
}


/* =====================================================================
   11. BLOQUES: ROMPER LADRILLOS Y BLOQUES SORPRESA
   ===================================================================== */
function golpearBloque(listaBloques) {
    // Si la cabeza toca dos bloques, golpeamos el más cercano al centro del jugador
    const bloque = listaBloques.reduce((mejor, b) =>
        Math.abs(b.x + 0.5 - jugador.x) < Math.abs(mejor.x + 0.5 - jugador.x) ? b : mejor);

    if (bloque.tipo === 'B') {
        destruirBloque(bloque);
    } else if (bloque.tipo === 'G') {
        // Bloque sorpresa: suelta una gema y queda "usado" (cambia su textura)
        bloque.tipo = 'U';
        bloque.malla.material = MATERIALES.usado;
        bloque.rebote = 0.2;
        gemaQueSalta(bloque.x, bloque.y + 1);
        sumarGema(100);
    } else {
        bloque.rebote = 0.1;
    }

    // Si había un enemigo parado sobre el bloque golpeado, ¡también lo derrota!
    enemigos.forEach(en => {
        if (en.vivo && Math.floor(en.x) === bloque.x && Math.abs(en.y - (bloque.y + 1)) < 0.1) {
            derrotarEnemigo(en, 100);
        }
    });
}

function destruirBloque(bloque) {
    grupoNivel.remove(bloque.malla);                 // lo quitamos de la escena
    bloques.delete(clave(bloque.x, bloque.y));       // y del mapa de colisiones
    crearParticulas(bloque.x + 0.5, bloque.y + 0.5, MATERIALES.ladrillo, 8);
    sonar('romperBloque');
    puntos += 50;
}

// Gema que sale de un bloque sorpresa (sube, gira y desaparece)
function gemaQueSalta(x, y) {
    const malla = new THREE.Mesh(GEO_GEMA, MATERIALES.gema);
    malla.position.set(x + 0.5, y + 0.3, 0);
    grupoNivel.add(malla);
    particulas.push({ malla, vx: 0, vy: 8, vz: 0, vida: 0.5, gira: 15, gravedad: -20 });
}

function sumarGema(puntosExtra) {
    sonar('gema');
    gemasRecogidas++;
    puntos += puntosExtra;
    // Cada 20 gemas, ¡una vida extra!
    if (gemasRecogidas % 20 === 0) {
        vidas++;
        mostrarAviso('¡VIDA EXTRA!');
        sonar('vidaExtra');
    }
}


/* =====================================================================
   12. JUGADOR
   ===================================================================== */
const jugador = {
    x: 0, y: 0, vx: 0, vy: 0,
    ancho: 0.7, alto: 0.9,
    enSuelo: false,
    mirando: 1,               // 1 = derecha, -1 = izquierda
    tiempoCoyote: 0,
    bufferSalto: 0,
    saltando: false,
    invulnerable: 0,
    tiempoAnimacion: 0,
    tiempoAtaque: 0,          // > 0 mientras dura el golpe
    enfriamientoAtaque: 0,    // > 0 mientras no puede volver a golpear
    direccionAtaque: 1,       // hacia dónde va el golpe actual
    malla: crearModeloJugador(),
};
scene.add(jugador.malla);

// Efecto visual del golpe: un arco semitransparente (media luna) delante del jugador.
// RingGeometry(radioInterno, radioExterno, segmentos, segmentosRadiales, anguloInicio, anguloLargo)
// De -90° a +90° = la mitad derecha del anillo. Para golpear a la izquierda lo
// reflejamos con scale.x = -1.
const efectoCorte = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.95, 24, 1, -Math.PI / 2, Math.PI),
    new THREE.MeshBasicMaterial({
        color: 0xfff3b0, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
    })
);
efectoCorte.visible = false;
scene.add(efectoCorte);

function reaparecerJugador() {
    // Si activamos el punto de control, reaparecemos ahí
    const inicio = (puntoControl && puntoControl.activo) ? puntoControl : posicionInicial;
    jugador.x = inicio.x;
    jugador.y = inicio.y;
    jugador.vx = 0;
    jugador.vy = 0;
    jugador.mirando = 1;
    jugador.tiempoAtaque = 0;
    jugador.enfriamientoAtaque = 0;
    efectoCorte.visible = false;
    jugador.invulnerable = CONFIG.INVULNERABLE;
    jugador.malla.rotation.set(0, 0, 0);
    jugador.malla.visible = true;
}

function actualizarJugador(dt) {
    const j = jugador;

    // --- Movimiento horizontal con aceleración y fricción ---
    let direccion = 0;
    if (teclaIzquierda()) direccion -= 1;
    if (teclaDerecha()) direccion += 1;
    const velocidadMaxima = teclaCorrer() ? CONFIG.VEL_CORRER : CONFIG.VEL_CAMINAR;

    if (direccion !== 0) {
        j.vx += direccion * CONFIG.ACELERACION * dt;
        j.vx = Math.max(-velocidadMaxima, Math.min(velocidadMaxima, j.vx)); // limitar (clamp)
        j.mirando = direccion;
    } else {
        // Fricción: reducimos la velocidad poco a poco hasta 0
        const freno = CONFIG.FRICCION * dt;
        j.vx = Math.abs(j.vx) <= freno ? 0 : j.vx - Math.sign(j.vx) * freno;
    }

    // --- Salto (con coyote time y buffer) ---
    j.tiempoCoyote = j.enSuelo ? CONFIG.TIEMPO_COYOTE : j.tiempoCoyote - dt;
    j.bufferSalto -= dt;

    if (j.bufferSalto > 0 && j.tiempoCoyote > 0) {
        j.vy = CONFIG.FUERZA_SALTO;
        sonar('salto');
        j.bufferSalto = 0;
        j.tiempoCoyote = 0;
        j.saltando = true;
    }

    // Salto variable: si sueltas el botón mientras subes, el salto se corta
    if (j.saltando && !teclaSaltoPresionada() && j.vy > 0) {
        j.vy *= CONFIG.CORTE_SALTO;
        j.saltando = false;
    }
    if (j.vy <= 0) j.saltando = false;

    // --- Gravedad ---
    j.vy += CONFIG.GRAVEDAD * dt;
    j.vy = Math.max(j.vy, CONFIG.VEL_MAX_CAIDA);

    // --- Mover y resolver colisiones ---
    moverEntidad(j, dt, golpearBloque);

    // No dejar que salga por el borde izquierdo del mundo
    if (j.x < j.ancho / 2) { j.x = j.ancho / 2; j.vx = 0; }

    // --- ¿Se cayó al vacío? ---
    if (j.y < CONFIG.LIMITE_CAIDA) {
        perderVida(false);
        return;
    }

    // --- Recoger gemas ---
    gemas.forEach(g => {
        if (!g.recogida && seSuperponen(j, { x: g.x + 0.5, y: g.y + 0.15, ancho: 0.6, alto: 0.7 })) {
            g.recogida = true;
            grupoNivel.remove(g.malla);
            sumarGema(100);
        }
    });

    // --- Punto de control (K): se activa al pasar por él ---
    if (puntoControl && !puntoControl.activo && j.x >= puntoControl.x) {
        puntoControl.activo = true;
        puntoControl.bandera.userData.tela.material.color.set(0x4caf50); // se pone verde
        mostrarAviso('¡PUNTO DE CONTROL!');
        sonar('puntoControl');
    }

    // --- Meta (F) ---
    if (banderaMeta && j.x >= banderaMeta.x - 0.2) {
        ganarNivel();
    }

    if (j.invulnerable > 0) j.invulnerable -= dt;
    actualizarModeloJugador(dt);
}

// Sincroniza el modelo 3D con los datos del jugador y lo anima
function actualizarModeloJugador(dt) {
    const j = jugador;
    const m = j.malla;
    m.position.set(j.x, j.y, 0);

    // Girar suavemente hacia donde mira (sin llegar a 90° para que se vea la cara)
    const anguloObjetivo = j.mirando * 0.9;
    m.rotation.y += (anguloObjetivo - m.rotation.y) * Math.min(1, 12 * dt);

    // Animación de caminar: las piernas suben y bajan con una función seno
    const { piernaIzq, piernaDer } = m.userData;
    if (j.enSuelo && Math.abs(j.vx) > 0.5) {
        j.tiempoAnimacion += dt * Math.abs(j.vx) * 2.2;
        piernaIzq.position.y = 0.1 + Math.max(0, Math.sin(j.tiempoAnimacion)) * 0.08;
        piernaDer.position.y = 0.1 + Math.max(0, -Math.sin(j.tiempoAnimacion)) * 0.08;
    } else {
        piernaIzq.position.y = piernaDer.position.y = 0.1;
    }

    // Martillo: durante el golpe gira rápido de atrás hacia adelante;
    // si no está atacando, vuelve suavemente a la posición de reposo.
    const { brazoArma } = m.userData;
    if (j.tiempoAtaque > 0) {
        const p = 1 - j.tiempoAtaque / CONFIG.DURACION_ATAQUE;   // 0 → 1
        const suave = 1 - Math.pow(1 - p, 3);                     // "ease-out": rápido al inicio
        brazoArma.rotation.x = ARMA_INICIO_GOLPE + (ARMA_FIN_GOLPE - ARMA_INICIO_GOLPE) * suave;
    } else {
        brazoArma.rotation.x += (REPOSO_ARMA - brazoArma.rotation.x) * Math.min(1, 10 * dt);
    }

    // "Squash & stretch": se estira al subir y se aplasta al caer
    const estirar = j.enSuelo ? 1 : 1 + Math.max(-0.15, Math.min(0.15, j.vy * 0.015));
    m.scale.set(2 - estirar, estirar, 2 - estirar);

    // Parpadeo mientras es invulnerable
    m.visible = j.invulnerable > 0 ? Math.floor(j.invulnerable * 12) % 2 === 0 : true;
}

// ---------- ATAQUE CON EL MARTILLO ----------
// Al presionar J/X empieza un golpe (si ya pasó el enfriamiento).
function intentarAtacar() {
    const j = jugador;
    if (j.enfriamientoAtaque > 0) return;
    j.tiempoAtaque = CONFIG.DURACION_ATAQUE;
    j.enfriamientoAtaque = CONFIG.ENFRIAMIENTO_ATAQUE;
    j.direccionAtaque = j.mirando;
    sonar('golpe');
}

// Caja de colisión del golpe: un rectángulo justo delante del jugador.
// Usa el mismo formato que las entidades (x = centro, y = base) para poder
// reutilizar seSuperponen().
function cajaAtaque() {
    const j = jugador;
    return {
        x: j.x + j.direccionAtaque * (j.ancho / 2 + CONFIG.ALCANCE_ATAQUE / 2),
        y: j.y - 0.1,
        ancho: CONFIG.ALCANCE_ATAQUE,
        alto: j.alto + 0.3,
    };
}

function actualizarAtaque(dt) {
    const j = jugador;
    if (j.enfriamientoAtaque > 0) j.enfriamientoAtaque -= dt;
    if (j.tiempoAtaque <= 0) { efectoCorte.visible = false; return; }

    j.tiempoAtaque -= dt;
    const transcurrido = CONFIG.DURACION_ATAQUE - j.tiempoAtaque;
    const progreso = Math.min(1, transcurrido / CONFIG.DURACION_ATAQUE);   // 0 → 1

    // ¿El golpe todavía hace daño? Solo al inicio del movimiento
    if (transcurrido <= CONFIG.GOLPE_ACTIVO) {
        const caja = cajaAtaque();
        enemigos.forEach(en => {
            if (en.vivo && seSuperponen(caja, en)) derrotarEnemigo(en, 200, true);
        });
    }

    // Efecto visual: aparece delante, crece un poco y se desvanece
    efectoCorte.visible = true;
    efectoCorte.position.set(j.x + j.direccionAtaque * 0.3, j.y + 0.45, 0.4);
    const escala = 0.9 + progreso * 0.3;
    efectoCorte.scale.set(escala * j.direccionAtaque, escala, 1);
    efectoCorte.material.opacity = (1 - progreso) * 0.85;
}

// Se llama cuando el jugador recibe daño o se cae
function perderVida(conAnimacion) {
    if (estado !== 'jugando') return;
    vidas--;
    estado = 'muriendo';
    sonar('perderVida');
    jugador.tiempoAtaque = 0;          // cancelamos un golpe a medias
    efectoCorte.visible = false;
    tiempoMuerte = 1.4;
    jugador.malla.visible = true;
    // Animación clásica: sale disparado hacia arriba y cae fuera de la pantalla
    jugador.vy = conAnimacion ? 12 : 0;
    jugador.vx = 0;
}

function actualizarMuerte(dt) {
    tiempoMuerte -= dt;
    jugador.vy += CONFIG.GRAVEDAD * dt;
    jugador.y += jugador.vy * dt;               // sin colisiones: atraviesa el suelo
    jugador.malla.position.set(jugador.x, jugador.y, 0);
    jugador.malla.rotation.z += dt * 8;          // da vueltas

    if (tiempoMuerte <= 0) {
        if (vidas <= 0) {
            terminarJuego(false);
        } else {
            reaparecerJugador();
            tiempoRestante = CONFIG.TIEMPO_NIVEL;
            estado = 'jugando';
        }
    }
}


/* =====================================================================
   13. ENEMIGOS
   Caminan de lado a lado; dan media vuelta en paredes y bordes.
   Solo mueren con el martillo (o si golpeas desde abajo el bloque
   donde están parados). Tocarlos, incluso cayéndoles encima, quita una vida.
   ===================================================================== */
function actualizarEnemigos(dt, tiempo) {
    enemigos.forEach(en => {
        // Enemigo aplastado: esperamos un momento y lo quitamos
        if (!en.vivo) {
            en.tiempoMuerto -= dt;
            if (en.tiempoMuerto <= 0 && en.malla.parent) grupoNivel.remove(en.malla);
            return;
        }

        // Solo se activan cuando están cerca del jugador
        if (Math.abs(en.x - jugador.x) > 18) return;

        en.vx = en.direccion * CONFIG.VEL_ENEMIGO;
        en.vy += CONFIG.GRAVEDAD * dt;
        moverEntidad(en, dt);

        // Media vuelta al chocar con una pared
        if (en.chocoPared) en.direccion *= -1;

        // Media vuelta si adelante no hay suelo (no se cae de las plataformas)
        if (en.enSuelo) {
            const pieDelantero = Math.floor(en.x + en.direccion * (en.ancho / 2 + 0.05));
            if (!obtenerBloque(pieDelantero, Math.floor(en.y - 0.1))) en.direccion *= -1;
        }

        if (en.y < CONFIG.LIMITE_CAIDA) { en.vivo = false; en.tiempoMuerto = 0; }

        // Animación: rebota un poquito y mira hacia donde va
        en.malla.position.set(en.x, en.y, 0);
        en.malla.scale.y = 1 + Math.sin(tiempo * 12) * 0.08;
        en.malla.rotation.y = en.direccion * 0.6;

        // --- Colisión con el jugador ---
        if (estado === 'jugando' && seSuperponen(jugador, en) && jugador.invulnerable <= 0) {
            perderVida(true);
        }
    });
}

// conArma = true: estalla en pedacitos morados. Si no, queda aplastado un momento.
function derrotarEnemigo(en, puntosGanados, conArma = false) {
    en.vivo = false;
    puntos += puntosGanados;
    sonar('enemigo');
    if (conArma) {
        en.tiempoMuerto = 0;
        grupoNivel.remove(en.malla);
        crearParticulas(en.x, en.y + 0.35, MAT_ENEMIGO, 6);
    } else {
        en.tiempoMuerto = 0.5;
        en.malla.scale.set(1.2, 0.25, 1.2);
    }
}


/* =====================================================================
   14. PARTÍCULAS Y ANIMACIONES DEL NIVEL
   Los pedacitos usan el MISMO material del ladrillo: así llevan su
   textura de imagen y parecen trozos reales del bloque.
   ===================================================================== */
const GEO_PEDAZO = new THREE.BoxGeometry(0.25, 0.25, 0.25);

function crearParticulas(x, y, material, cantidad) {
    for (let i = 0; i < cantidad; i++) {
        const malla = new THREE.Mesh(GEO_PEDAZO, material);
        malla.position.set(x, y, 0);
        grupoNivel.add(malla);
        particulas.push({
            malla,
            vx: (Math.random() - 0.5) * 6,
            vy: 5 + Math.random() * 5,
            vz: (Math.random() - 0.5) * 6,
            vida: 1.2,
            gira: 10,
            gravedad: CONFIG.GRAVEDAD,
        });
    }
}

function actualizarParticulas(dt) {
    // Recorremos al revés para poder borrar del arreglo sin saltarnos elementos
    for (let i = particulas.length - 1; i >= 0; i--) {
        const p = particulas[i];
        p.vy += p.gravedad * dt;
        p.malla.position.x += p.vx * dt;
        p.malla.position.y += p.vy * dt;
        p.malla.position.z += p.vz * dt;
        p.malla.rotation.x += p.gira * dt;
        p.malla.rotation.y += p.gira * dt;
        p.vida -= dt;
        if (p.vida <= 0) {
            grupoNivel.remove(p.malla);
            particulas.splice(i, 1);
        }
    }
}

// Bloques que "rebotan" al golpearlos, gemas que giran y bandera que ondea
function animarNivel(dt, tiempo) {
    bloques.forEach(b => {
        if (b.rebote > 0) {
            b.rebote -= dt;
            b.malla.position.y = b.y + 0.5 + Math.sin(Math.max(0, b.rebote) * 15) * 0.15;
        }
    });
    gemas.forEach(g => {
        if (!g.recogida) {
            g.malla.rotation.y = tiempo * 2;
            g.malla.position.y = g.y + 0.5 + Math.sin(tiempo * 3 + g.x) * 0.08;
        }
    });
    if (banderaMeta) banderaMeta.bandera.userData.tela.rotation.y = Math.sin(tiempo * 3) * 0.25;
}


/* =====================================================================
   15. CÁMARA QUE SIGUE AL JUGADOR
   Interpolación (lerp): en cada cuadro la cámara recorre un porcentaje
   de la distancia hacia su objetivo → movimiento suave.
   ===================================================================== */
function actualizarCamara(dt) {
    const suavizado = Math.min(1, 5 * dt);
    const objetivoX = Math.max(8, jugador.x + 2);         // un poco adelante del jugador
    const objetivoY = Math.max(4.5, jugador.y + 3);

    camera.position.x += (objetivoX - camera.position.x) * suavizado;
    camera.position.y += (objetivoY - camera.position.y) * suavizado;
    camera.position.z = 14;
    camera.lookAt(camera.position.x, camera.position.y - 2, 0);

    moverSol();
}

// La luz del sol sigue a la cámara para que siempre haya sombras cerca
function moverSol() {
    luzSol.position.set(camera.position.x - 6, 18, 12);
    luzSol.target.position.set(camera.position.x, 0, 0);
}


/* =====================================================================
   16. INTERFAZ: HUD Y PANTALLAS
   Necesita estos id en index.html: hud-vidas, hud-gemas, hud-puntos,
   hud-tiempo, aviso, pantalla-inicio, pantalla-pausa, pantalla-fin,
   fin-titulo, fin-detalle, btn-jugar, btn-reiniciar.
   ===================================================================== */
const ui = {
    vidas: document.getElementById('hud-vidas'),
    gemas: document.getElementById('hud-gemas'),
    puntos: document.getElementById('hud-puntos'),
    tiempo: document.getElementById('hud-tiempo'),
    aviso: document.getElementById('aviso'),
    inicio: document.getElementById('pantalla-inicio'),
    pausa: document.getElementById('pantalla-pausa'),
    fin: document.getElementById('pantalla-fin'),
    finTitulo: document.getElementById('fin-titulo'),
    finDetalle: document.getElementById('fin-detalle'),
};

function actualizarHUD() {
    ui.vidas.textContent = vidas;   // también se puede probar: '❤'.repeat(vidas)
    ui.gemas.textContent = gemasRecogidas;
    ui.puntos.textContent = String(puntos).padStart(6, '0');   // 000150
    ui.tiempo.textContent = Math.ceil(tiempoRestante);
}

let temporizadorAviso = null;
function mostrarAviso(texto) {
    ui.aviso.textContent = texto;
    ui.aviso.classList.remove('oculto');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => ui.aviso.classList.add('oculto'), 1500);
}

// El botón de jugar empieza deshabilitado hasta que carguen las texturas (ver sección 4)
const botonJugar = document.getElementById('btn-jugar');
botonJugar.disabled = true;
botonJugar.addEventListener('click', iniciarJuego);
document.getElementById('btn-reiniciar').addEventListener('click', iniciarJuego);


/* =====================================================================
   17. ESTADOS DEL JUEGO Y BUCLE PRINCIPAL
   'inicio' -> 'jugando' <-> 'pausa'
              'jugando' -> 'muriendo' -> 'jugando' o 'gameover'
              'jugando' -> 'victoria'
   ===================================================================== */
let estado = 'inicio';
let vidas = CONFIG.VIDAS_INICIALES,
    puntos = 0,
    gemasRecogidas = 0,
    tiempoRestante = CONFIG.TIEMPO_NIVEL,
    tiempoMuerte = 0;

function iniciarJuego() {
    vidas = CONFIG.VIDAS_INICIALES;
    puntos = 0;
    gemasRecogidas = 0;
    tiempoRestante = CONFIG.TIEMPO_NIVEL;

    construirNivel();          // ← UNA sola vez por partida
    reaparecerJugador();
    jugador.invulnerable = 0;
    camera.position.set(8, 4.5, 14);

    ui.inicio.classList.add('oculto');
    ui.fin.classList.add('oculto');
    ui.pausa.classList.add('oculto');
    estado = 'jugando';
    reproducirMusica('juego');
}

function alternarPausa() {
    if (estado === 'jugando') {
        estado = 'pausa';
        ui.pausa.classList.remove('oculto');
        // la música de fondo sigue sonando en pausa
    } else if (estado === 'pausa') {
        estado = 'jugando';
        ui.pausa.classList.add('oculto');
        reloj.getDelta(); // descartamos el tiempo que pasó en pausa
    }
}

function ganarNivel() {
    const bonus = Math.ceil(tiempoRestante) * 10;   // el tiempo sobrante da puntos
    puntos += bonus;
    terminarJuego(true, bonus);
}

function terminarJuego(gano, bonus = 0) {
    estado = gano ? 'victoria' : 'gameover';
    actualizarHUD();
    // En la pantalla final no hay música de fondo
    detenerMusica();
    sonar(gano ? 'victoria' : 'gameOver');
    ui.finTitulo.textContent = gano ? '¡NIVEL COMPLETADO!' : 'GAME OVER';
    ui.finDetalle.innerHTML = gano
        ? `Puntos: ${puntos}<br>Gemas: ${gemasRecogidas}<br>Bono por tiempo: ${bonus}`
        : `Puntos: ${puntos}<br>Gemas: ${gemasRecogidas}`;
    setTimeout(() => ui.fin.classList.remove('oculto'), gano ? 800 : 200);
}

// ---------- Bucle principal ----------
// renderer.setAnimationLoop(animate) llama a animate ~60 veces por segundo
// (es la versión de Three.js de requestAnimationFrame).
// dt (delta time) = segundos desde el cuadro anterior. Multiplicar las
// velocidades por dt hace que el juego vaya igual en PCs rápidos y lentos.
const reloj = new THREE.Clock();

function animate() {
    const dt = Math.min(reloj.getDelta(), 1 / 30);   // limitamos dt para evitar "teletransportes"
    const tiempo = reloj.elapsedTime;

    if (estado === 'jugando') {
        actualizarJugador(dt);
        actualizarAtaque(dt);
        actualizarEnemigos(dt, tiempo);
        tiempoRestante -= dt;
        if (tiempoRestante <= 0) { tiempoRestante = 0; perderVida(true); }
    } else if (estado === 'muriendo') {
        actualizarMuerte(dt);
    }

    actualizarFondo();

    if (estado !== 'pausa') {
        actualizarParticulas(dt);
        animarNivel(dt, tiempo);
    }

    if (estado !== 'inicio') {
        actualizarCamara(dt);
        actualizarHUD();
    } else {
        // En la pantalla de inicio la cámara recorre el nivel lentamente
        camera.position.set(10 + Math.sin(tiempo * 0.2) * 6, 5, 14);
        camera.lookAt(camera.position.x, 3, 0);
        moverSol();
    }

    renderer.render(scene, camera);
}

// ---------- Arranque ----------
ui.inicio.classList.remove('oculto');   // mostramos el menú de inicio
construirNivel();              // el nivel se ve de fondo en la pantalla de inicio
reaparecerJugador();
actualizarModeloJugador(0);
renderer.setAnimationLoop(animate);