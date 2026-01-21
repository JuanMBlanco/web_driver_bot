# Test Local - Guía de Uso

Este archivo permite probar las funcionalidades del bot de forma local sin necesidad de iniciar el servidor completo.

## ¿Qué hace?

El archivo `src/test-local.ts` ejecuta una prueba completa de la funcionalidad principal:

1. **Carga la configuración** desde `config/ezcater_web_driver_bot.yaml`
2. **Inicializa el pool de navegadores** con la configuración especificada
3. **Abre un navegador** y navega a la URL configurada
4. **Busca elementos** usando el selector de listado configurado
5. **Realiza clicks** en los elementos encontrados según los selectores configurados
6. **Cierra el navegador** y muestra los resultados

## Requisitos Previos

1. **Instalar dependencias:**
   ```bash
   yarn install
   ```

2. **Configurar el archivo YAML:**
   - Edita `config/ezcater_web_driver_bot.yaml`
   - Asegúrate de que la URL, selectores y rutas estén correctamente configurados

## Cómo Ejecutar

### Opción 1: Usando yarn (Recomendado)
```bash
yarn test:local
```

Este comando usa `tsx` que ejecuta TypeScript directamente sin necesidad de compilar.

**Nota:** `tsx` está incluido en las `devDependencies` del proyecto, así que se instalará automáticamente cuando ejecutes `yarn install`.

### Opción 2: Usando tsx directamente
```bash
npx tsx src/test-local.ts
```

### Opción 3: Compilar y ejecutar manualmente
```bash
# Compilar primero
yarn build

# Luego ejecutar el archivo compilado (si test-local.ts se compiló)
node dist/test-local.js
```

## Configuración de Prueba

El test usa la misma configuración que el servidor principal. Edita `config/ezcater_web_driver_bot.yaml`:

```yaml
task:
  url: "https://tu-pagina.com/list"  # URL a probar
  listSelector: ".list-item"         # Selector CSS del listado
  clickSelectors:                    # Selectores de elementos a clickear
    - "button.process-item"
    - "a.action-link"
  maxItemsPerCycle: 10               # Máximo de items a procesar
```

## Salida del Test

El test mostrará:

```
============================================================
EZCater Web Driver Bot - Local Test Mode
============================================================

[INFO] Loading configuration...
[INFO] Configuration loaded successfully

[INFO] Test Configuration:
[INFO]   URL: https://example.com/list
[INFO]   List Selector: .list-item
[INFO]   Click Selectors: button.process-item, a.action-link
[INFO]   Max Items Per Cycle: 10

[INFO] Initializing browser pool...
[INFO] Browser pool initialized with size: 3

[INFO] Starting test execution...
[INFO] Starting list check and click task...
[INFO] Allocated browser profile: ...
[INFO] Page title: Example Page
[INFO] Found 5 items in list
[INFO] Processing item 1/5
[INFO] Clicking element with selector: button.process-item
...

============================================================
Test Results:
============================================================
[INFO]   Processed Items: 5
[INFO]   Clicked Elements: 5
[INFO]   Status: SUCCESS
============================================================
```

## Capturas de Pantalla

Si el test encuentra un error (por ejemplo, no encuentra el selector), automáticamente:

1. Tomará una captura de pantalla completa
2. La guardará en `data/error_[timestamp].png`
3. Mostrará la ruta en los logs

## Diferencias con el Servidor Principal

- **No inicia el servidor HTTP** - Solo ejecuta la funcionalidad de scraping
- **No requiere tokens** - No hay autenticación
- **No envía notificaciones a Telegram** - Solo logs locales
- **Cierra automáticamente** - El proceso termina después de la prueba

## Troubleshooting

### Error: "No browser profiles available in the pool"
- Verifica que `poolSize` en el YAML sea mayor a 0
- Asegúrate de que no haya otros procesos usando los perfiles

### Error: "List selector not found"
- Verifica que el selector CSS sea correcto
- Revisa la captura de pantalla en `data/error_*.png`
- Asegúrate de que la página haya cargado completamente

### Error: "Browser process already running"
- Cierra cualquier instancia de Chrome que esté usando el mismo perfil
- Elimina los archivos PID en `browsers/*/pid.txt` si es necesario

### Error de ejecutable de Chrome
- Verifica que la ruta en `browser.executablePath` sea correcta
- En Windows, podría ser: `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`
- En Linux: `/usr/bin/google-chrome` o `/usr/bin/chromium-browser`

## Notas

- El navegador se abre en modo **no-headless** (visible) para que puedas ver qué está pasando
- El test usa el contexto `test` para los perfiles de navegador (separado del contexto `default`)
- Los logs incluyen timestamps y colores para facilitar el debugging

