
const CENTRO_INICIAL = [5.0689, -75.5174]; // respaldo si no hay ubicación

const mapa = L.map('mapa').setView(CENTRO_INICIAL, 15);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(mapa);

const $ = (id) => document.getElementById(id);

const CLAVE_GUARDADO = 'taller-poligono:puntos';
const COLOR_GUIA = '#e67e22';
const OPCIONES_GPS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
const ERRORES_GPS = {
  1: 'Permiso denegado. Activa la ubicación en el navegador.',
  2: 'No se pudo determinar la ubicación.',
  3: 'Se agotó el tiempo de espera.'
};

const textoDeError = (fallo) => ERRORES_GPS[fallo.code] || 'Error desconocido.';
const colorElegido = () => $('campoColor').value;
const nombreElegido = () => $('campoNombre').value.trim() || 'Mi polígono';
const conDecimales = (numero, cifras) => numero.toLocaleString('es-CO', {
  minimumFractionDigits: cifras,
  maximumFractionDigits: cifras
});

// Evita que el nombre escrito por el usuario se interprete como HTML en el popup
function sinEtiquetas(texto) {
  const caja = document.createElement('span');
  caja.textContent = texto;
  return caja.innerHTML;
}

function mostrarInfo(texto, esAlerta = false) {
  const linea = $('info');
  linea.textContent = texto;
  linea.classList.toggle('alerta', esAlerta);
}

let puntos = [];           // vértices en orden, formato Leaflet [lat, lng]
let vertices = [];         // circleMarkers visibles de cada vértice
let poligono = null;       // L.polygon una vez se cierra
let fechaSellado = null;   // momento en que se cerró (va al GeoJSON)
let marcasCruce = [];      // puntos rojos donde el polígono se corta (reto 9)
let capaReferencia = null; // GeoJSON importado que no es polígono (reto 6)

let marcadorUsuario = null;  // marcador del usuario
let circuloPrecision = null; // círculo de precisión
let idSeguimiento = null;    // id de watchPosition (reto 8)
let estabaDentro = null;     // último estado conocido en la geocerca

const lineaGuia = L.polyline([], { color: COLOR_GUIA, dashArray: '6 6' }).addTo(mapa);


// Pide la posición una vez; la usan "Mi ubicación", el reto 4 y el reto 7
function pedirPosicion(alObtener) {
  if (!('geolocation' in navigator)) {
    mostrarInfo('Tu navegador no soporta geolocalización.', true);
    return;
  }
  mostrarInfo('Buscando tu ubicación...');
  navigator.geolocation.getCurrentPosition(
    (posicion) => alObtener(posicion.coords),
    (fallo) => mostrarInfo(textoDeError(fallo), true),
    OPCIONES_GPS
  );
}

// Crea o mueve el marcador y el círculo de precisión
function ponerMarcadorUsuario(lat, lng, precision) {
  if (!marcadorUsuario) {
    marcadorUsuario = L.marker([lat, lng]).addTo(mapa).bindPopup('Estás aquí');
    circuloPrecision = L.circle([lat, lng], { radius: precision, fillOpacity: 0.1 }).addTo(mapa);
    return;
  }
  marcadorUsuario.setLatLng([lat, lng]);
  circuloPrecision.setLatLng([lat, lng]).setRadius(precision);
}

function ubicarUsuario(centrar = true) {
  pedirPosicion(({ latitude, longitude, accuracy }) => {
    ponerMarcadorUsuario(latitude, longitude, accuracy);
    if (centrar) {
      mapa.setView([latitude, longitude], 17);
      marcadorUsuario.openPopup();
    }
    mostrarInfo(`Ubicación encontrada (precisión: ${Math.round(accuracy)} m). Haz clic para dibujar.`);
  });
}


function agregarVertice(lat, lng) {
  if (poligono) return; // cerrado: no se agregan más puntos

  puntos.push([lat, lng]);
  const vertice = L.circleMarker([lat, lng], { radius: 6, color: COLOR_GUIA, fillOpacity: 1 });
  vertices.push(vertice.addTo(mapa));
  lineaGuia.setLatLngs(puntos);

  trasCadaCambio();
  const faltan = 3 - puntos.length;
  mostrarInfo(`${puntos.length} vértice(s). ` +
    (faltan > 0 ? `Necesitas al menos 3 para cerrar.` : 'Ya puedes cerrar el polígono.'));
}

function actualizarBotones() {
  const cerrada = poligono !== null;
  $('btnCerrar').disabled = puntos.length < 3 || cerrada;
  $('btnDeshacer').disabled = puntos.length === 0 || cerrada;
  $('btnExportar').disabled = !cerrada;
  $('btnDentro').disabled = !cerrada;
  $('btnGeocerca').disabled = !cerrada;
  $('btnMiPosicion').disabled = cerrada;
}

// Todo lo que debe ocurrir cuando cambian los vértices o la figura
function trasCadaCambio() {
  actualizarBotones();
  pintarTablaVertices();
  guardarEnNavegador();
}

function cerrarPoligono() {
  if (puntos.length < 3 || poligono) return;

  poligono = L.polygon(puntos, { color: colorElegido(), fillOpacity: 0.35 }).addTo(mapa);
  fechaSellado = fechaSellado || new Date().toISOString();
  lineaGuia.setLatLngs([]);
  mapa.fitBounds(poligono.getBounds());

  const seCruza = revisarCruces();
  poligono.bindPopup('');
  const { area } = refrescarPopup();
  poligono.openPopup();

  if (!seCruza) {
    mostrarInfo(`Polígono cerrado. Área: ${conDecimales(area, 1)} m² (${conDecimales(area / 10000, 3)} ha).`);
  }
  trasCadaCambio();
}

function deshacerPunto() {
  if (puntos.length === 0 || poligono) return;
  puntos.pop();
  mapa.removeLayer(vertices.pop());
  lineaGuia.setLatLngs(puntos);
  trasCadaCambio();
  mostrarInfo(`${puntos.length} vértice(s).`);
}

function limpiar() {
  detenerGeocerca();
  puntos = [];
  vertices.forEach((vertice) => mapa.removeLayer(vertice));
  vertices = [];
  lineaGuia.setLatLngs([]);
  if (poligono) {
    mapa.removeLayer(poligono);
    poligono = null;
  }
  if (capaReferencia) {
    mapa.removeLayer(capaReferencia);
    capaReferencia = null;
  }
  borrarMarcasCruce();
  fechaSellado = null;
  trasCadaCambio();
  mostrarInfo('Mapa limpio. Haz clic para empezar de nuevo.');
}

// Leaflet usa [lat, lng]; GeoJSON/Turf usan [lng, lat] y el anillo se cierra repitiendo el primer punto
function aGeoJSON() {
  const anillo = puntos.map(([lat, lng]) => [lng, lat]);
  anillo.push(anillo[0]);
  return turf.polygon([anillo], {
    nombre: nombreElegido(),
    color: colorElegido(),
    creado: fechaSellado || new Date().toISOString()
  });
}

function medir(feature = aGeoJSON()) {
  const area = turf.area(feature); // m²
  const perimetro = turf.length(turf.polygonToLine(feature), { units: 'meters' });
  return { area, perimetro };
}

// Reescribe el popup con nombre, área, perímetro y advertencia de cruce
function refrescarPopup() {
  const medidas = medir();
  const advertencia = marcasCruce.length ? '<br><b style="color:#c0392b">⚠ Se cruza consigo mismo</b>' : '';
  poligono.setPopupContent(
    `<b>${sinEtiquetas(nombreElegido())}</b><br>` +
    `Área: ${conDecimales(medidas.area, 1)} m²<br>` +
    `Perímetro: ${conDecimales(medidas.perimetro, 1)} m` +
    advertencia
  );
  return medidas;
}

function exportar() {
  const feature = aGeoJSON();
  const { area, perimetro } = medir(feature);
  feature.properties.area_m2 = Number(area.toFixed(2));
  feature.properties.perimetro_m = Number(perimetro.toFixed(2));

  const contenido = JSON.stringify(feature, null, 2);
  const paquete = new Blob([contenido], { type: 'application/geo+json' });
  const vinculo = document.createElement('a');
  vinculo.href = URL.createObjectURL(paquete);
  vinculo.download = 'poligono.geojson';
  vinculo.click();
  setTimeout(() => URL.revokeObjectURL(vinculo.href), 1000);
}


function pintarTablaVertices() {
  const cuerpo = $('cuerpoTabla');
  cuerpo.replaceChildren();

  puntos.forEach(([lat, lng], posicion) => {
    const fila = document.createElement('tr');
    [posicion + 1, lat.toFixed(6), lng.toFixed(6)].forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    cuerpo.appendChild(fila);
  });

  $('sinVertices').hidden = puntos.length > 0;
}

function aplicarColor() {
  if (poligono) {
    poligono.setStyle({ color: colorElegido(), fillColor: colorElegido() });
  }
  guardarEnNavegador();
}

function aplicarNombre() {
  if (poligono) refrescarPopup();
  guardarEnNavegador();
}

function sumarMiPosicion() {
  pedirPosicion(({ latitude, longitude, accuracy }) => {
    ponerMarcadorUsuario(latitude, longitude, accuracy);
    agregarVertice(latitude, longitude);
    mapa.panTo([latitude, longitude]);
    mostrarInfo(`Vértice ${puntos.length} tomado de tu ubicación (precisión: ${Math.round(accuracy)} m).`);
  });
}

function guardarEnNavegador() {
  try {
    if (puntos.length === 0) {
      localStorage.removeItem(CLAVE_GUARDADO);
      return;
    }
    localStorage.setItem(CLAVE_GUARDADO, JSON.stringify({
      puntos,
      cerrada: poligono !== null,
      nombre: $('campoNombre').value,
      color: colorElegido(),
      fechaSellado
    }));
  } catch {
    // almacenamiento bloqueado (modo privado, etc.): la app sigue funcionando sin guardar
  }
}

const esParValido = (par) => Array.isArray(par) && par.length >= 2 && par.every(Number.isFinite);

function restaurarDelNavegador() {
  let respaldo = null;
  try {
    respaldo = JSON.parse(localStorage.getItem(CLAVE_GUARDADO));
  } catch {
    return false;
  }
  if (!respaldo || !Array.isArray(respaldo.puntos)) return false;

  const puntosLimpios = respaldo.puntos.filter(esParValido);
  if (puntosLimpios.length === 0) return false;

  $('campoNombre').value = respaldo.nombre || '';
  if (/^#[0-9a-f]{6}$/i.test(respaldo.color)) $('campoColor').value = respaldo.color;
  fechaSellado = respaldo.fechaSellado || null;

  cargarPuntos(puntosLimpios, respaldo.cerrada);
  if (!poligono) mapa.fitBounds(lineaGuia.getBounds());
  mostrarInfo(`Se recuperó tu polígono guardado (${puntosLimpios.length} vértices).`);
  return true;
}

// Dibuja una lista de [lat, lng] como si se hubiera hecho clic en cada punto
function cargarPuntos(lista, cerrar) {
  lista.forEach(([lat, lng]) => agregarVertice(lat, lng));
  if (cerrar) cerrarPoligono();
}


// Busca el primer Polygon dentro de cualquier objeto GeoJSON
function hallarPoligono(datos) {
  if (!datos || typeof datos !== 'object') return null;

  switch (datos.type) {
    case 'FeatureCollection':
      for (const elemento of datos.features || []) {
        const hallado = hallarPoligono(elemento);
        if (hallado) return hallado;
      }
      return null;
    case 'Feature': {
      const hallado = hallarPoligono(datos.geometry);
      return hallado && { anillo: hallado.anillo, propiedades: datos.properties || {} };
    }
    case 'Polygon':
      return { anillo: datos.coordinates?.[0], propiedades: {} };
    case 'MultiPolygon':
      return { anillo: datos.coordinates?.[0]?.[0], propiedades: {} };
    default:
      return null;
  }
}

// Convierte un anillo GeoJSON [lng, lat] (cerrado) a vértices Leaflet [lat, lng] (abierto)
function anilloAPuntos(anillo) {
  if (!Array.isArray(anillo)) return [];
  const pares = anillo.filter(esParValido).map(([lng, lat]) => [lat, lng]);
  const primero = pares[0];
  const ultimo = pares[pares.length - 1];
  if (pares.length > 1 && primero[0] === ultimo[0] && primero[1] === ultimo[1]) pares.pop();
  return pares;
}

function procesarImportado(datos) {
  const hallado = hallarPoligono(datos);
  const puntosNuevos = hallado ? anilloAPuntos(hallado.anillo) : [];

  if (puntosNuevos.length >= 3) {
    limpiar();
    const { nombre, color, creado } = hallado.propiedades;
    $('campoNombre').value = typeof nombre === 'string' ? nombre : '';
    if (/^#[0-9a-f]{6}$/i.test(color)) $('campoColor').value = color;
    fechaSellado = typeof creado === 'string' ? creado : null;
    cargarPuntos(puntosNuevos, true);
    return;
  }

  // Sin polígono editable: se dibuja tal cual, solo como referencia
  const capa = L.geoJSON(datos); // lanza error si el GeoJSON es inválido
  limpiar();
  capaReferencia = capa.addTo(mapa);
  if (capa.getBounds().isValid()) mapa.fitBounds(capa.getBounds());
  mostrarInfo('Archivo importado, pero no trae un polígono editable: se muestra solo como referencia.');
}

function leerArchivo(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  const lector = new FileReader();
  lector.onload = () => {
    try {
      procesarImportado(JSON.parse(lector.result));
    } catch {
      mostrarInfo('El archivo no es un GeoJSON válido.', true);
    }
    evento.target.value = ''; // permite volver a elegir el mismo archivo
  };
  lector.onerror = () => mostrarInfo('No se pudo leer el archivo.', true);
  lector.readAsText(archivo);
}

const quedaDentro = (lat, lng) => turf.booleanPointInPolygon(turf.point([lng, lat]), aGeoJSON());

function comprobarSiEstoyDentro() {
  pedirPosicion(({ latitude, longitude, accuracy }) => {
    ponerMarcadorUsuario(latitude, longitude, accuracy);
    const dentro = quedaDentro(latitude, longitude);
    mostrarInfo(dentro
      ? `Estás DENTRO del polígono (precisión: ${Math.round(accuracy)} m).`
      : `Estás FUERA del polígono (precisión: ${Math.round(accuracy)} m).`, !dentro);
  });
}

function alternarGeocerca() {
  if (idSeguimiento === null) {
    iniciarGeocerca();
  } else {
    detenerGeocerca();
    mostrarInfo('Geocerca detenida.');
  }
}

function iniciarGeocerca() {
  if (!('geolocation' in navigator)) {
    mostrarInfo('Tu navegador no soporta geolocalización.', true);
    return;
  }
  estabaDentro = null;
  idSeguimiento = navigator.geolocation.watchPosition(
    revisarGeocerca,
    (fallo) => {
      if (fallo.code === 1) detenerGeocerca(); // sin permiso no tiene sentido seguir
      mostrarInfo(`Geocerca: ${textoDeError(fallo)}`, true);
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
  );
  $('btnGeocerca').textContent = 'Detener geocerca';
  $('btnGeocerca').classList.add('activo');
  mostrarInfo('Vigilando tu posición...');
}

function revisarGeocerca({ coords }) {
  const { latitude, longitude, accuracy } = coords;
  ponerMarcadorUsuario(latitude, longitude, accuracy);
  const dentro = quedaDentro(latitude, longitude);

  if (estabaDentro === true && !dentro) {
    mostrarInfo('¡Saliste del polígono!', true);
    alert(`Saliste de "${nombreElegido()}".`);
  } else if (estabaDentro !== dentro) {
    mostrarInfo(dentro ? 'Geocerca: estás dentro del polígono.' : 'Geocerca: estás fuera del polígono.', !dentro);
  }
  estabaDentro = dentro;
}

function detenerGeocerca() {
  if (idSeguimiento === null) return;
  navigator.geolocation.clearWatch(idSeguimiento);
  idSeguimiento = null;
  estabaDentro = null;
  $('btnGeocerca').textContent = 'Vigilar geocerca';
  $('btnGeocerca').classList.remove('activo');
}

function revisarCruces() {
  borrarMarcasCruce();
  const cruces = turf.kinks(aGeoJSON()).features;
  if (cruces.length === 0) return false;

  cruces.forEach((cruce) => {
    const [lng, lat] = cruce.geometry.coordinates;
    const marca = L.circleMarker([lat, lng], { radius: 7, color: '#c0392b', fillColor: '#e74c3c', fillOpacity: 1 });
    marcasCruce.push(marca.addTo(mapa).bindTooltip('Cruce'));
  });
  mostrarInfo(`Atención: el polígono se cruza consigo mismo (${cruces.length} cruce(s)); ` +
    'el área calculada no es confiable. Usa "Limpiar" y dibújalo de nuevo.', true);
  return true;
}

function borrarMarcasCruce() {
  marcasCruce.forEach((marca) => mapa.removeLayer(marca));
  marcasCruce = [];
}


mapa.on('click', (evento) => agregarVertice(evento.latlng.lat, evento.latlng.lng));

$('btnUbicar').addEventListener('click', () => ubicarUsuario());
$('btnCerrar').addEventListener('click', cerrarPoligono);
$('btnDeshacer').addEventListener('click', deshacerPunto);
$('btnLimpiar').addEventListener('click', limpiar);
$('btnExportar').addEventListener('click', exportar);

$('campoColor').addEventListener('input', aplicarColor);
$('campoNombre').addEventListener('input', aplicarNombre);
$('btnMiPosicion').addEventListener('click', sumarMiPosicion);
$('campoArchivo').addEventListener('change', leerArchivo);
$('btnDentro').addEventListener('click', comprobarSiEstoyDentro);
$('btnGeocerca').addEventListener('click', alternarGeocerca);

const habiaGuardado = restaurarDelNavegador();
pintarTablaVertices();
actualizarBotones();
ubicarUsuario(!habiaGuardado); // si se recuperó un polígono, no se mueve la vista
