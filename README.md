# Manhattan Latency Analyzer 🚀

**Manhattan Latency Analyzer** es una solución de monitoreo y diagnóstico de red multiplataforma (compatible con **Linux**, **Windows** y **macOS**) desarrollada para realizar mediciones continuas y detalladas de latencia hacia endpoints web (por defecto `https://alkop.sce.manh.com/ping`).

---

## 🏢 Manejo de Múltiples Sedes y Días (Sin Confusión de Resultados)

Para evitar que los resultados se confundan al realizar pruebas en **diferentes días o desde diferentes sedes/oficinas**, la aplicación incluye un **Sistema de Etiquetado por Sede (Location Tagging)**:

1. **Etiquetado por Sede**: En el menú `⚙️ Configuración`, puedes asignar el nombre de la sede actual (ej. `Sede Bogotá`, `Sede Medellín`, `Sede Cali`, `Home Office`). Todas las mediciones tomadas desde ese equipo quedarán etiquetadas automáticamente.
2. **Filtro Global por Sede**: En la barra superior de la aplicación web se incluye el selector **"Filtrar por Sede / Ubicación"**. Permite consultar de forma independiente las métricas de una sede específica o seleccionar *"Todas las Sedes"*.
3. **Panel de Comparativa entre Sedes**: Se incluye un panel de análisis comparativo que muestra en paralelo el promedio de latencia total, DNS, TCP, TLS y TTFB de cada sede registrada.
4. **Registro con Timestamp UTC y Local**: Cada medición registra la fecha y la hora exacta en formato estándar ISO 8601, lo que permite auditar qué ocurrió en cada día y rango horario.
5. **Exportación Filtrada a CSV**: Puedes exportar el archivo CSV filtrando por sede específica o fecha para entregar informes independientes por oficina.

---

## 📊 Desglose de Fases de Latencia Medidas

| Fase | Métricas | Descripción |
| :--- | :--- | :--- |
| **1. Resolución DNS** | `dns_ms` | Tiempo transcurrido para resolver el nombre de dominio a su dirección IP (`136.68.87.180`). |
| **2. Conexión TCP** | `tcp_ms` | Tiempo que toma establecer el Handshake TCP de la capa de transporte (Socket connect). |
| **3. Negociación TLS / SSL** | `tls_ms` | Tiempo dedicado a la negociación del canal cifrado SSL/TLS (peticiones HTTPS). |
| **4. Espera del Servidor (TTFB)** | `ttfb_ms` | **Time To First Byte**: Tiempo desde que se envía la solicitud HTTP hasta recibir el primer byte de respuesta del servidor. |
| **5. Transferencia de Datos** | `transfer_ms` | Tiempo de lectura del cuerpo completo de la respuesta del servidor. |
| **6. Latencia Total** | `total_ms` | Tiempo acumulado end-to-end (`DNS + TCP + TLS + TTFB + Transfer`). |

---

## 🛠️ Requisitos de Sistema

- **Python 3.8+** (utiliza únicamente la librería estándar de Python; no requiere instalar paquetes mediante `pip` ni dependencias externas).
- Navegador web moderno (Chrome, Edge, Firefox, Safari).

---

## 🚀 Instrucciones de Ejecución

### En Linux / macOS:
```bash
./run.sh
```
*O ejecutando directamente:*
```bash
python3 app.py
```

### En Windows:
Ejecuta haciendo doble clic en:
- **`run.bat`** (Windows CMD)
- **`run.ps1`** (Windows PowerShell)

---

## 🌐 Acceso al Dashboard Web

Ingresa a tu navegador en:
👉 **[http://localhost:8080](http://localhost:8080)**
