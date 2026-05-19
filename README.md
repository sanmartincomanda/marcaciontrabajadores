# Control de Horas Extras - CSM Granada

Aplicacion web para calcular horas extras semanales por colaborador, registrar entradas y salidas, y exportar archivos de Excel con:

- consolidado semanal de pago
- colillas individuales por trabajador
- paquete completo de colillas

## Lo que hace

- Carga la lista de colaboradores con su salario mensual desde el archivo original.
- Permite ingreso manual de horario de entrada y salida.
- Incluye una pantalla de marcacion por trabajador con botones de entrada y salida.
- Calcula hora ordinaria con la formula `salario / 30 / 8`.
- Calcula hora extra con multiplicador configurable.
- Guarda marcaciones y ajustes en Firebase Firestore en tiempo real.
- Usa Firebase Authentication anonimo para conectar cada dispositivo.

## Flujo de uso

1. Define la semana, la jornada ordinaria y el multiplicador de hora extra.
2. Registra horarios manualmente o marca entrada/salida desde la pantalla de marcacion.
3. Revisa el resumen semanal.
4. Descarga el consolidado o las colillas en Excel.

## Desarrollo local

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Configuracion de Firebase

1. Crea un proyecto en Firebase.
2. Activa `Authentication > Sign-in method > Anonymous`.
3. Crea una base de datos de `Cloud Firestore`.
4. Copia las variables del SDK web a `.env.local` usando `.env.example`.
5. Aplica las reglas base de `firebase.rules`.

Variables esperadas:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_NAMESPACE=csm-granada-horas-extras
```

## Build de produccion

```bash
npm run build
```

## Despliegue en Netlify

La app ya incluye `netlify.toml`, asi que en Netlify solo necesitas:

1. Conectar el repositorio.
2. Dejar el comando de build como `npm run build`.
3. Dejar el directorio de publicacion como `dist`.
4. Agregar en Netlify las mismas variables de entorno de Firebase.

## Nota importante

Las marcaciones ahora quedan centralizadas en Firestore y se reflejan entre dispositivos que usen la misma configuracion de Firebase. El login `admin` y `marcar` sigue siendo de interfaz; si quieres seguridad real por rol en la base de datos, el siguiente paso es agregar autenticacion de Firebase por usuario y reglas por permisos.
