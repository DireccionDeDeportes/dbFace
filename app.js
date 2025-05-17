import { openDB } from 'idb';

class JugadoresDB {
    constructor() {
        this.dbPromise = this.initDB();
    }

    async initDB() {
        return openDB('jugadoresDB', 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('jugadores')) {
                    db.createObjectStore('jugadores', { keyPath: 'dni' });
                }
            }
        });
    }

    async guardarJugador(jugador) {
        const db = await this.dbPromise;
        await db.put('jugadores', {
            dni: jugador.dni,
            year: jugador.year,
            descriptorFacial: jugador.descriptorFacial
        });
    }

    async obtenerTodosJugadores() {
        const db = await this.dbPromise;
        return await db.getAll('jugadores');
    }

    async importarJugadores(jugadores) {
        const db = await this.dbPromise;
        const tx = db.transaction('jugadores', 'readwrite');
        const store = tx.objectStore('jugadores');
        
        // Limpiar datos existentes
        await store.clear();
        
        // Importar nuevos datos
        for (const jugador of jugadores) {
            await store.add(jugador);
        }
        
        await tx.done;
    }

    async obtenerJugador(dni) {
        const db = await this.dbPromise;
        return await db.get('jugadores', dni);
    }

    async actualizarJugador(jugador) {
        const db = await this.dbPromise;
        await db.put('jugadores', jugador);
    }
}

class FaceRecognitionManager {
    constructor() {
        this.modelosListo = false;
        this.inicializarModelos();
    }

    async inicializarModelos() {
        await faceapi.nets.ssdMobilenetv1.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        await faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        await faceapi.nets.faceRecognitionNet.loadFromUri('https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/');
        this.modelosListo = true;
    }

    async obtenerDescriptor(videoElement) {
        if (!this.modelosListo) {
            throw new Error('Los modelos no están listos');
        }

        const detections = await faceapi.detectSingleFace(videoElement)
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detections) {
            throw new Error('No se detectó ningún rostro');
        }

        return detections.descriptor;
    }

    async compararRostros(descriptor1, descriptor2) {
        const distancia = faceapi.euclideanDistance(descriptor1, descriptor2);
        return distancia < 0.6; // umbral de similitud
    }
}

class App {
    constructor() {
        this.db = new JugadoresDB();
        this.faceManager = new FaceRecognitionManager();
        this.setupEventListeners();
        this.descriptorActual = null;
        this.jugadorActual = null;
    }

    setupEventListeners() {
        document.getElementById('btnRegistro').addEventListener('click', () => this.cambiarTab('Registro'));
        document.getElementById('btnDatos').addEventListener('click', () => this.cambiarTab('Datos'));
        document.getElementById('btnFoto').addEventListener('click', () => this.abrirModalCaptura());
        document.getElementById('btnExportar').addEventListener('click', () => this.exportarDatos());
        document.getElementById('formRegistro').addEventListener('submit', (e) => this.registrarJugador(e));
        
        // Eventos para el modal
        document.querySelector('.close').addEventListener('click', () => this.cerrarModal());
        document.getElementById('btnCapturaModal').addEventListener('click', () => this.tomarFotoModal());
        document.getElementById('btnGuardarModal').addEventListener('click', () => this.guardarFotoModal());

        // Evento para verificar DNI
        document.getElementById('dni').addEventListener('change', (e) => this.verificarDNI(e.target.value));
    }

    async verificarDNI(dni) {
        const jugador = await this.db.obtenerJugador(dni);
        const datosJugador = document.getElementById('datosJugador');
        
        if (jugador) {
            this.jugadorActual = jugador;
            this.descriptorActual = jugador.descriptorFacial ? new Float32Array(jugador.descriptorFacial) : null;
            document.getElementById('year').value = jugador.year || '';
            datosJugador.innerHTML = `
                <div class="dni-registrado">DNI ya registrado. Puede actualizar los datos.</div>
                <button type="submit" class="btn-primary">Actualizar Registro</button>
            `;
        } else {
            this.jugadorActual = null;
            document.getElementById('formRegistro').reset();
            document.getElementById('dni').value = dni;
            datosJugador.innerHTML = `
                <button type="submit" class="btn-primary">Registrar Jugador</button>
            `;
        }
        
        datosJugador.style.display = 'block';
    }

    cambiarTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('section').forEach(sec => sec.classList.remove('active'));

        document.getElementById(`btn${tab}`).classList.add('active');
        document.getElementById(`seccion${tab}`).classList.add('active');
    }

    async abrirModalCaptura() {
        const dni = document.getElementById('dni').value;
        if (!dni) {
            alert('Por favor ingrese el DNI primero');
            return;
        }

        const modal = document.getElementById('modalCaptura');
        modal.style.display = 'block';
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { exact: "environment" },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                }
            });
            document.getElementById('videoModal').srcObject = stream;
        } catch (error) {
            console.error('Error al acceder a la cámara:', error);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: { 
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    } 
                });
                document.getElementById('videoModal').srcObject = stream;
            } catch (err) {
                alert('No se pudo acceder a la cámara');
            }
        }
    }

    cerrarModal() {
        const modal = document.getElementById('modalCaptura');
        modal.style.display = 'none';
        
        // Detener la cámara
        const video = document.getElementById('videoModal');
        const stream = video.srcObject;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        video.srcObject = null;
        
        this.jugadorActual = null;
        document.getElementById('estadoFotoModal').textContent = 'No se ha tomado la foto';
    }

    async tomarFotoModal() {
        try {
            const estadoFoto = document.getElementById('estadoFotoModal');
            estadoFoto.textContent = 'Procesando...';
            
            const video = document.getElementById('videoModal');
            this.descriptorActual = await this.faceManager.obtenerDescriptor(video);
            
            estadoFoto.textContent = 'Foto capturada correctamente';
            estadoFoto.style.color = 'green';
        } catch (error) {
            document.getElementById('estadoFotoModal').textContent = 'Error al capturar la foto';
            console.error(error);
        }
    }

    async guardarFotoModal() {
        if (!this.descriptorActual) {
            alert('Por favor tome una foto antes de guardar');
            return;
        }

        const dni = document.getElementById('dni').value;
        this.jugadorActual = {
            dni: dni,
            descriptorFacial: Array.from(this.descriptorActual)
        };

        try {
            await this.db.actualizarJugador(this.jugadorActual);
            this.cerrarModal();
            alert('Rostro guardado exitosamente');
        } catch (error) {
            console.error('Error al guardar el rostro:', error);
            alert('Error al guardar el rostro');
        }
    }

    async registrarJugador(e) {
        e.preventDefault();
        
        if (!this.descriptorActual) {
            alert('Por favor tome una foto antes de registrar');
            return;
        }

        const jugador = {
            dni: document.getElementById('dni').value,
            year: parseInt(document.getElementById('year').value),
            descriptorFacial: Array.from(this.descriptorActual)
        };

        try {
            await this.db.guardarJugador(jugador);
            alert(this.jugadorActual ? 'Jugador actualizado exitosamente' : 'Jugador registrado exitosamente');
            e.target.reset();
            this.descriptorActual = null;
            this.jugadorActual = null;
            document.getElementById('datosJugador').style.display = 'none';
        } catch (error) {
            alert('Error al registrar jugador');
            console.error(error);
        }
    }

    async exportarDatos() {
        try {
            const jugadores = await this.db.obtenerTodosJugadores();
            const dataStr = JSON.stringify(jugadores, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `jugadores_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error al exportar datos:', error);
            alert('Error al exportar datos');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});