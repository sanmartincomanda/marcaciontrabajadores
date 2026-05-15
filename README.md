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
- Guarda la informacion en el navegador usando `localStorage`.

## Flujo de uso

1. Define la semana, la jornada ordinaria y el multiplicador de hora extra.
2. Registra horarios manualmente o marca entrada/salida desde la pantalla de marcacion.
3. Revisa el resumen semanal.
4. Descarga el consolidado o las colillas en Excel.

## Desarrollo local

```bash
npm install
npm run dev
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

## Nota importante

En esta primera version los datos quedan guardados localmente en el navegador del dispositivo donde se usa la app. Si luego quieres que varios usuarios marquen desde distintos telefonos o computadoras y todo quede centralizado, el siguiente paso seria agregar una base de datos y autenticacion.
