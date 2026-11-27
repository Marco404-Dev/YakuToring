# Protocolo mínimo de validación experimental con Hach

**Objetivo:** evaluar el error de la predicción de OD en mg/L, sin confundir el entrenamiento con la prueba final.

1. Registrar una vez las condiciones del manglar con equipos calibrados y el Hach en campo, si la autorización y el equipo lo permiten. No asumir que es obligatorio trasladar agua desde el manglar.
2. Preparar agua dulce, salobre y salada en laboratorio, en múltiples **lotes independientes**. Registrar temperatura, pH, conductividad específica, presión local, hora UTC y OD del Hach prácticamente al mismo instante para la **misma muestra**. Verificar calidad y calibración de ambos equipos.
3. No asumir que salinidad determina OD: variar el oxígeno real de modo controlado y seguro (por ejemplo, aireación y posterior evolución), medirlo con Hach y evitar contaminación.
4. Separar lotes usados para ajuste de lotes de evaluación antes de ver las métricas. **Jamás** usar lecturas repetidas del mismo lote en ambos subconjuntos.
5. Primero evaluar la v5 y la v10 **congeladas**, sin calibrarlas; calcular MAE, RMSE, R² y porcentaje con diferencia ≤ 0.5 mg/L sobre lotes de prueba nuevos. La mejora relativa solo es válida si se comparan sobre exactamente las mismas mediciones.
6. Si más adelante se ajusta el modelo o el sesgo con Hach, reservar *otros* lotes que jamás participen del ajuste. Reportar por separado métricas antes y después de calibrar.
7. No afirmar que el agua de laboratorio demuestra directamente precisión en el manglar: el entorno controlado es una demostración del prototipo, no validación ecológica completa.

Formato de entrada: `plantilla_hach.csv` (sin datos simulados). Ejecutar:

```bash
python -m src.validar_hach --archivo lecturas_hach_reales.csv --salida validacion_hach.csv
```

**Nota de operación:** los sensores pueden tomar una lectura por hora en el prototipo final. Durante una sola jornada de laboratorio, la predicción inicial utilizará la **v5 instantánea**; la variante v10 temporal requiere seis horas de historial horario con la misma muestra/condición experimental y sin interrupciones.
